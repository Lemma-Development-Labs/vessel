import { describe, expect, it } from "vitest";
import { classifyClose, recoveryFor } from "../src/ws.ts";

describe("ws close recovery", () => {
  it("1008 too many requests → backoff reconnect", () => {
    expect(classifyClose(1008, "too many requests")).toBe("too many requests");
    const r = recoveryFor(1008, "too many requests", 0);
    expect(r.action).toBe("reconnect_backoff");
    expect(r.backoffMs).toBeGreaterThan(0);
  });

  it("1008 too many connections", () => {
    expect(classifyClose(1008, "too many connections")).toBe("too many connections");
  });

  it("1008 ping timeout", () => {
    expect(classifyClose(1008, "ping timeout")).toBe("ping timeout");
  });

  it("1008 idle timeout", () => {
    expect(classifyClose(1008, "idle timeout")).toBe("idle timeout");
  });

  it("1011 failed to process", () => {
    expect(classifyClose(1011, "failed to process")).toBe("failed to process");
  });

  it("3401 auth failure → reconnect_auth", () => {
    expect(classifyClose(3401, "unauthorized")).toBe("unauthorized");
    expect(recoveryFor(3401, "unauthorized", 1).action).toBe("reconnect_auth");
  });
});
