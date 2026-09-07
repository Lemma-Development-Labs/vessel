import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import {
  clearCreHalt,
  healthPayload,
  isCreHaltLatched,
  latchCreHalt,
  recordDecision,
} from "../src/status.ts";
import { decide } from "../src/policy.ts";
import { baseState } from "../src/fixtures.ts";

describe("CRE halt latch (e2e with policy)", () => {
  it("latched CRE halt makes decide() return halt via killSwitch", () => {
    clearCreHalt();
    expect(isCreHaltLatched()).toBe(false);
    latchCreHalt("deviation consensus");
    expect(isCreHaltLatched()).toBe(true);
    const d = decide(baseState({ killSwitch: isCreHaltLatched() }));
    expect(d.kind).toBe("halt");
    clearCreHalt();
  });

  it("POST /cre/decision with token latches halt and records source=CRE", async () => {
    clearCreHalt();
    process.env.CRE_ACT_TOKEN = "test-token";
    const server = createServer((req, res) => {
      if (req.method === "POST" && req.url?.startsWith("/cre/decision")) {
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          if (req.headers.authorization !== "Bearer test-token") {
            res.statusCode = 401;
            res.end("{}");
            return;
          }
          const body = JSON.parse(Buffer.concat(chunks).toString()) as {
            kind: string;
            reason: string;
          };
          if (body.kind === "halt") latchCreHalt(body.reason);
          recordDecision(
            { kind: "halt", reason: body.reason },
            true,
            undefined,
            "accepted via CRE HTTP act",
            "CRE",
          );
          res.end(JSON.stringify({ ok: true, creHaltLatched: isCreHaltLatched() }));
        });
        return;
      }
      res.statusCode = 404;
      res.end("{}");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no port");
    const res = await fetch(`http://127.0.0.1:${addr.port}/cre/decision`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      },
      body: JSON.stringify({ kind: "halt", reason: "cre e2e" }),
    });
    expect(res.status).toBe(200);
    expect(isCreHaltLatched()).toBe(true);
    const health = healthPayload() as {
      lastDecision: { source?: string; decision: { kind: string } };
    };
    expect(health.lastDecision.source).toBe("CRE");
    expect(health.lastDecision.decision.kind).toBe("halt");
    server.close();
    clearCreHalt();
  });
});
