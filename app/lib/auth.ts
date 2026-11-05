"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { createSiweMessage } from "viem/siwe";
import { useAccount, useChainId, useSignMessage } from "wagmi";

/**
 * Client for the SIWE session API (docs/AUTH.md). Requests go same-origin to
 * `/api/auth/*`, which Next rewrites to vessel-service; cookies are HttpOnly
 * and never readable here. Signing in proves wallet control only — it never
 * authorizes spending.
 */
export const AUTH_BASE = "/api/auth";

/** Every query holding participant-private data lives under this key root. */
export const PRIVATE_ROOT = "private";
export const sessionKey = [PRIVATE_ROOT, "session"] as const;
export const eligibilityKey = [PRIVATE_ROOT, "eligibility"] as const;
export const disclosureKey = ["auth", "disclosure"] as const;

export class AuthApiError extends Error {
  override name = "AuthApiError";
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

async function authFetch<T>(path: string, init: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? "GET";
  const res = await fetch(`${AUTH_BASE}${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    // content-type only with a body: an empty JSON body is a 400 at the server.
    headers: {
      accept: "application/json",
      ...(method === "POST" ? { "x-vessel-csrf": "1" } : {}),
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // A proxy error page or an unreachable service: report it as such.
  }
  if (!res.ok) {
    const code = (json as { error?: unknown } | null)?.error;
    throw new AuthApiError(typeof code === "string" ? code : res.status === 404 ? "AUTH_NOT_CONFIGURED" : "AUTH_UNREACHABLE", res.status);
  }
  return json as T;
}

export interface Session {
  address: `0x${string}`;
  accessExpiresAt: string;
}

export interface Eligibility {
  address: `0x${string}`;
  backendOnboarding: {
    invited: boolean;
    participantId: string | null;
    boundAt: string | null;
    consent: { currentVersion: string; accepted: boolean; acceptedAt: string | null };
    complete: boolean;
  };
  onchainAdmission: { tag: "UNAVAILABLE"; reason: string };
}

export interface DisclosureDoc {
  version: string;
  environment: string;
  text: string;
  sha256: string;
}

/** The session, refreshing once on an expired access token. `null` = signed out. */
export function useSession() {
  return useQuery({
    queryKey: sessionKey,
    retry: false,
    queryFn: async (): Promise<Session | null> => {
      try {
        return await authFetch<Session>("/session");
      } catch (err) {
        if (!(err instanceof AuthApiError) || err.code !== "SESSION_REQUIRED") throw err;
      }
      try {
        return await authFetch<Session>("/refresh", { method: "POST" });
      } catch (err) {
        if (err instanceof AuthApiError && err.status === 401) return null;
        throw err;
      }
    },
  });
}

export function useEligibility(enabled: boolean) {
  return useQuery({
    queryKey: eligibilityKey,
    enabled,
    retry: false,
    queryFn: () => authFetch<Eligibility>("/eligibility"),
  });
}

export function useDisclosure() {
  return useQuery({ queryKey: disclosureKey, retry: false, queryFn: () => authFetch<DisclosureDoc>("/disclosure") });
}

/**
 * Build the EIP-4361 message from what the SERVER says its domain, origin and
 * chain are. The wallet's chain must already match; we refuse to ask for a
 * signature the server would reject.
 */
export function buildSiweMessage(p: {
  address: `0x${string}`;
  walletChainId: number;
  nonce: { nonce: string; domain: string; uri: string; chainId: number };
  now: Date;
}): string {
  if (p.walletChainId !== p.nonce.chainId) {
    throw new AuthApiError("WRONG_CHAIN", 400);
  }
  return createSiweMessage({
    address: p.address,
    chainId: p.nonce.chainId,
    domain: p.nonce.domain,
    uri: p.nonce.uri,
    version: "1",
    nonce: p.nonce.nonce,
    issuedAt: p.now,
    expirationTime: new Date(p.now.getTime() + 5 * 60_000),
    statement: "Sign in to Vessel. This proves you control this wallet. It does not authorize any spending.",
  });
}

export function useSignIn() {
  const qc = useQueryClient();
  const { address } = useAccount();
  const chainId = useChainId();
  const { signMessageAsync } = useSignMessage();
  return useMutation({
    mutationFn: async () => {
      if (!address) throw new AuthApiError("WALLET_NOT_CONNECTED", 400);
      const nonce = await authFetch<{ nonce: string; domain: string; uri: string; chainId: number }>("/nonce", {
        method: "POST",
      });
      const message = buildSiweMessage({ address, walletChainId: chainId, nonce, now: new Date() });
      const signature = await signMessageAsync({ message });
      return authFetch<Session>("/verify", { method: "POST", body: { message, signature } });
    },
    onSuccess: async () => {
      clearPrivateQueries(qc);
      await qc.invalidateQueries({ queryKey: sessionKey });
    },
  });
}

export function useSignOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => authFetch<{ ok: true }>("/logout", { method: "POST" }),
    onSettled: () => {
      clearPrivateQueries(qc);
      qc.setQueryData(sessionKey, null);
    },
  });
}

export function useRedeemInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => authFetch<{ participantId: string }>("/invitations/redeem", { method: "POST", body: { code } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: eligibilityKey }),
  });
}

export function useAcceptConsent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (d: { version: string; sha256: string }) => authFetch<{ ok: true }>("/consent", { method: "POST", body: d }),
    onSuccess: () => qc.invalidateQueries({ queryKey: eligibilityKey }),
  });
}

/** Drop every participant-private query. Public chain data is untouched. */
export function clearPrivateQueries(qc: QueryClient): void {
  qc.removeQueries({ queryKey: [PRIVATE_ROOT] });
}

/**
 * A session belongs to one wallet (spec §14). It ends when:
 *  - a *different* wallet is connected, or
 *  - the wallet this page had connected disconnects.
 * A page that simply has not reconnected the wallet yet (every page load
 * starts that way) is not a switch: treating it as one logged users out on
 * every refresh.
 */
export function sessionMismatch(
  sessionAddress: string | null | undefined,
  walletAddress: string | undefined,
  previousWalletAddress?: string,
): boolean {
  if (!sessionAddress) return false;
  if (walletAddress) return walletAddress.toLowerCase() !== sessionAddress.toLowerCase();
  return previousWalletAddress !== undefined;
}

export function handleAccountChange(
  qc: QueryClient,
  sessionAddress: string | null | undefined,
  walletAddress: string | undefined,
  previousWalletAddress?: string,
): boolean {
  if (!sessionMismatch(sessionAddress, walletAddress, previousWalletAddress)) return false;
  clearPrivateQueries(qc);
  qc.setQueryData(sessionKey, null);
  return true;
}

/** Mount once near the root: enforces handleAccountChange against the live wallet. */
export function useWalletSwitchGuard(): void {
  const qc = useQueryClient();
  const { address, status } = useAccount();
  const session = useSession();
  const loggingOut = useRef(false);
  const previous = useRef<string | undefined>(undefined);
  useEffect(() => {
    // wagmi reports "reconnecting"/"connecting" with no address on load; only
    // a settled state is evidence that the wallet actually changed.
    if (status === "reconnecting" || status === "connecting") return;
    const prev = previous.current;
    previous.current = address;
    if (handleAccountChange(qc, session.data?.address, address, prev) && !loggingOut.current) {
      loggingOut.current = true;
      void authFetch("/logout", { method: "POST" })
        .catch(() => undefined)
        .finally(() => {
          loggingOut.current = false;
        });
    }
  }, [qc, address, status, session.data?.address]);
}
