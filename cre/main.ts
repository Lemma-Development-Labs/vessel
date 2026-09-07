/**
 * Vessel CRE workflow — orchestration for the short-manager decision.
 *
 * Why CRE (submission lead): The keeper is a single machine we control. A
 * depositor has to trust it. CRE puts the *decision* under DON consensus:
 * multiple nodes independently read the venue and the chain and must agree
 * before the engine is cranked, reduced, or halted. For a protocol whose
 * thesis is that you should not have to trust us, moving the decision off our
 * machine is the point.
 *
 * Dual path (see docs/CRE.md):
 * - If Monad is enabled for the tenant → set useEvmMonad and add EVMClient reads.
 * - Default / always-safe → HTTP reads of our signed keeper snapshot + consensus.
 *   Never fake an EVM capability that the tenant does not have.
 *
 * Policy: imports decide() from keeper/src/policy.ts — do not fork.
 */
import {
  cre,
  consensusIdenticalAggregation,
  handler,
  ok,
  Runner,
  text,
  type HTTPSendRequester,
  type Runtime,
} from "@chainlink/cre-sdk";
import { z } from "zod";

import { decide } from "../keeper/src/policy.ts";
import type { Decision } from "../keeper/src/types.ts";
import { decisionToJson, snapshotToState, type SnapshotJson } from "./snapshot.ts";

const configSchema = z.object({
  schedule: z.string(),
  perplContextUrl: z.string().url(),
  vesselSnapshotUrl: z.string().url(),
  keeperActUrl: z.string().url(),
  envioGraphqlUrl: z.string().optional(),
  engineLite: z.string(),
  chainId: z.number(),
  ccipMonadTestnetSelector: z.string(),
  creChainName: z.string(),
  useEvmMonad: z.boolean(),
  deviationBandBps: z.number(),
  crankIntervalBlocks: z.number(),
  maxNotionalPerAction: z.string(),
  minGasBudgetWei: z.string(),
  maxMarketDataAgeMs: z.number(),
});

type Config = z.infer<typeof configSchema>;

const fetchSnapshot = (sendRequester: HTTPSendRequester, url: string): SnapshotJson => {
  const response = sendRequester.sendRequest({ url, method: "GET" }).result();
  if (!ok(response)) {
    throw new Error(`snapshot HTTP ${response.statusCode}`);
  }
  return JSON.parse(text(response)) as SnapshotJson;
};

const fetchPerplContextOk = (sendRequester: HTTPSendRequester, url: string): boolean => {
  const response = sendRequester.sendRequest({ url, method: "GET" }).result();
  return ok(response);
};

const postAct = (
  sendRequester: HTTPSendRequester,
  url: string,
  token: string,
  decision: Decision,
): number => {
  const response = sendRequester
    .sendRequest({
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(decisionToJson(decision)),
      cacheSettings: { readFromCache: true, maxAgeMs: 60_000 },
    })
    .result();
  if (!ok(response)) {
    throw new Error(`act HTTP ${response.statusCode}`);
  }
  return response.statusCode;
};

const onCron = (runtime: Runtime<Config>): string => {
  const cfg = runtime.config;
  const http = new cre.capabilities.HTTPClient();

  // Gather — DON consensus on the snapshot so one flaky node cannot alone halt.
  const snap = http
    .sendRequest(runtime, fetchSnapshot, consensusIdenticalAggregation<SnapshotJson>())(
      cfg.vesselSnapshotUrl,
    )
    .result();

  const perplOk = http
    .sendRequest(runtime, fetchPerplContextOk, consensusIdenticalAggregation<boolean>())(
      cfg.perplContextUrl,
    )
    .result();
  if (!perplOk) {
    runtime.log("perpl context unreachable — continuing with snapshot marketDataAgeMs");
  }

  // Optional Envio last-crank (when URL configured) — identical consensus on string body.
  if (cfg.envioGraphqlUrl && cfg.envioGraphqlUrl.length > 0) {
    http
      .sendRequest(
        runtime,
        (sendRequester: HTTPSendRequester, url: string) => {
          const response = sendRequester
            .sendRequest({
              url,
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                query:
                  "{ Crank(order_by: { block: desc }, limit: 1) { block gasLimit txHash } }",
              }),
            })
            .result();
          return ok(response) ? text(response) : "";
        },
        consensusIdenticalAggregation<string>(),
      )(cfg.envioGraphqlUrl)
      .result();
  }

  if (cfg.useEvmMonad) {
    // Reserved: EVMClient reads of EngineLite when tenant supported-chains lists
    // monad-testnet. Do not enable until `cre workflow supported-chains` confirms.
    runtime.log(
      `useEvmMonad=true (chain=${cfg.creChainName}) — confirm tenant supported-chains before relying on EVM path`,
    );
  }

  const state = snapshotToState(snap);
  state.deviationBandBps = cfg.deviationBandBps;
  state.crankIntervalBlocks = BigInt(cfg.crankIntervalBlocks);
  state.maxNotionalPerAction = BigInt(cfg.maxNotionalPerAction);
  state.minGasBudgetWei = BigInt(cfg.minGasBudgetWei);
  state.maxMarketDataAgeMs = cfg.maxMarketDataAgeMs;

  // Decide — SAME function as keeper (prompt 03).
  const decision = decide(state);
  runtime.log(`CRE decision ${decision.kind}: ${decision.reason}`);

  // Act — authenticated HTTP. halt latches keeper killSwitch end-to-end.
  if (decision.kind !== "noop") {
    const secret = runtime.getSecret({ id: "cre-act-token" }).result();
    http
      .sendRequest(
        runtime,
        (sendRequester: HTTPSendRequester, args: { url: string; token: string; d: Decision }) =>
          postAct(sendRequester, args.url, args.token, args.d),
        consensusIdenticalAggregation<number>(),
      )({ url: cfg.keeperActUrl, token: secret.value, d: decision })
      .result();
  }

  return JSON.stringify({
    source: "CRE",
    kind: decision.kind,
    reason: decision.reason,
    chainId: cfg.chainId,
    ccipSelector: cfg.ccipMonadTestnetSelector,
    useEvmMonad: cfg.useEvmMonad,
  });
};

const initWorkflow = (config: Config) => {
  const cron = new cre.capabilities.CronCapability();
  return [handler(cron.trigger({ schedule: config.schedule }), onCron)];
};

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}
