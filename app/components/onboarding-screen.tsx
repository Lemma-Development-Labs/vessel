"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { useAccount, useChainId, useConnect, useSwitchChain } from "wagmi";
import {
  AuthApiError,
  useAcceptConsent,
  useDisclosure,
  useEligibility,
  useRedeemInvite,
  useSession,
  useSignIn,
  useSignOut,
} from "@/lib/auth";
import { shorten } from "@/lib/format";
import { TARGET_CHAIN_ID } from "@/lib/wagmi";
import { Button, Card, Skeleton } from "@/components/ui";

/**
 * /onboarding — redeem invite → sign in → accept versioned disclosure →
 * participant status → sign out (master prompt 1.6). Every step is derived
 * from server state (session, eligibility), so refreshing or reconnecting
 * lands on the right step. Backend onboarding is shown separately from
 * on-chain admission, which does not exist yet and is never implied.
 */

const MESSAGES: Record<string, string> = {
  AUTH_NOT_CONFIGURED: "Sign-in is not available on this deployment yet.",
  AUTH_UNREACHABLE: "The Vessel service is unreachable. Try again shortly.",
  WRONG_CHAIN: "Switch your wallet to the Vessel network before signing in.",
  WALLET_NOT_CONNECTED: "Connect a wallet first.",
  SIWE_WRONG_DOMAIN: "That signature was made for another site and was refused.",
  SIWE_WRONG_URI: "That signature was made for another site and was refused.",
  SIWE_WRONG_CHAIN: "The signature was for the wrong network.",
  SIWE_EXPIRED: "The sign-in request expired. Sign in again.",
  SIWE_NOT_YET_VALID: "Your device clock looks wrong. Check it and sign in again.",
  SIWE_BAD_SIGNATURE: "The signature did not match this wallet. Contract wallets are not supported yet.",
  NONCE_REUSED: "That sign-in request was already used. Sign in again.",
  NONCE_EXPIRED: "The sign-in request expired. Sign in again.",
  NONCE_UNKNOWN: "The sign-in request was not recognised. Sign in again.",
  SESSION_REQUIRED: "Your session ended. Sign in again.",
  INVITE_INVALID: "That invitation code is invalid, already used, or expired.",
  WALLET_ALREADY_BOUND: "This wallet is already linked to a participant.",
  PARTICIPANT_REQUIRED: "Redeem an invitation before accepting the disclosure.",
  CONSENT_VERSION_MISMATCH: "The disclosure changed while you were reading it. Review the current version.",
  RATE_LIMITED: "Too many attempts. Wait a minute and try again.",
  CSRF: "The request was refused by the site's request check. Reload the page.",
};

function explain(err: unknown): string {
  if (err instanceof AuthApiError) return MESSAGES[err.code] ?? `Request failed (${err.code}).`;
  if (err instanceof Error && /reject|denied/i.test(err.message)) return "You declined the request in your wallet. Nothing was signed.";
  return "Something went wrong. Nothing was changed.";
}

function Step({
  n,
  title,
  state,
  children,
}: {
  n: number;
  title: string;
  state: "done" | "current" | "locked";
  children: ReactNode;
}) {
  return (
    <Card className={`p-5 sm:p-6 ${state === "locked" ? "opacity-60" : ""}`}>
      <div className="flex items-baseline gap-3">
        <span className="num text-xs text-steel">{String(n).padStart(2, "0")}</span>
        <h2 className="display text-base font-semibold text-ink">{title}</h2>
        <span className="ml-auto text-[11px] uppercase tracking-[0.12em] text-steel" data-testid={`step-${n}-state`}>
          {state === "done" ? "done" : state === "current" ? "to do" : "locked"}
        </span>
      </div>
      {state === "locked" ? null : <div className="mt-4 space-y-3 text-sm text-dim">{children}</div>}
    </Card>
  );
}

function ErrorLine({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-red">
      {explain(error)}
    </p>
  );
}

const noopSubscribe = () => () => {};

/**
 * False during SSR and the hydrating render, true after mount. Wallet state is
 * only knowable in the browser (the wallet may restore its connection before
 * React hydrates), so it must not decide what the first render shows.
 */
function useMounted(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

export function OnboardingScreen() {
  const mounted = useMounted();
  const account = useAccount();
  const address = mounted ? account.address : undefined;
  const isConnected = mounted && account.isConnected;
  const chainId = useChainId();
  const { connectors, connect, isPending: connecting, error: connectError } = useConnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const session = useSession();
  const signIn = useSignIn();
  const signOut = useSignOut();
  const signedIn = Boolean(session.data);
  const eligibility = useEligibility(signedIn);
  const disclosure = useDisclosure();
  const redeem = useRedeemInvite();
  const accept = useAcceptConsent();
  const [code, setCode] = useState("");
  const [read, setRead] = useState(false);

  const onChain = chainId === TARGET_CHAIN_ID;
  const e = eligibility.data;
  const invited = e?.backendOnboarding.invited ?? false;
  const consented = e?.backendOnboarding.consent.accepted ?? false;
  const authDown =
    session.error instanceof AuthApiError &&
    (session.error.code === "AUTH_NOT_CONFIGURED" || session.error.code === "AUTH_UNREACHABLE");

  return (
    <div className="mx-auto max-w-[720px] px-4 py-8 sm:px-5 sm:py-12">
      <h1 className="display text-2xl font-bold text-ink sm:text-3xl">Join the private beta</h1>
      <p className="mt-2 text-sm text-steel">
        Signing in proves you control a wallet. It never authorizes spending — every deposit or exit is a separate
        transaction you approve.
      </p>

      {authDown ? (
        <p role="alert" className="mt-6 rounded-lg border border-amber/30 bg-amber/10 px-4 py-3 text-sm text-amber">
          {explain(session.error)}
        </p>
      ) : null}

      <div className="mt-8 space-y-4">
        <Step n={1} title="Connect a wallet" state={isConnected && onChain ? "done" : "current"}>
          {isConnected && address ? (
            <>
              <p>
                Connected <span className="num text-ink">{shorten(address)}</span>
              </p>
              {!onChain ? (
                <Button variant="ghost" disabled={switching} onClick={() => switchChain({ chainId: TARGET_CHAIN_ID })}>
                  Switch to the Vessel network
                </Button>
              ) : null}
            </>
          ) : (
            <div className="flex flex-wrap gap-2">
              {connectors.map((c) => (
                <Button key={c.uid} disabled={connecting} onClick={() => connect({ connector: c })}>
                  {c.name}
                </Button>
              ))}
            </div>
          )}
          <ErrorLine error={connectError} />
        </Step>

        <Step n={2} title="Sign in" state={signedIn ? "done" : isConnected && onChain ? "current" : "locked"}>
          {session.isLoading ? (
            <Skeleton className="h-11 w-40" />
          ) : signedIn ? (
            <p data-testid="signed-in-as">
              Signed in as <span className="num text-ink">{shorten(session.data!.address)}</span>
            </p>
          ) : (
            <>
              <p>Your wallet will show a sign-in message for this site. It is not a transaction and costs no gas.</p>
              <Button disabled={signIn.isPending || authDown} onClick={() => signIn.mutate()}>
                {signIn.isPending ? "Waiting for your wallet…" : "Sign in with wallet"}
              </Button>
              <ErrorLine error={signIn.error} />
            </>
          )}
        </Step>

        <Step n={3} title="Redeem your invitation" state={invited ? "done" : signedIn ? "current" : "locked"}>
          {invited ? (
            <p>Invitation redeemed. This wallet is linked to your participant record.</p>
          ) : eligibility.isLoading ? (
            <Skeleton className="h-11 w-full" />
          ) : (
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(ev) => {
                ev.preventDefault();
                if (code.trim()) redeem.mutate(code.trim());
              }}
            >
              <label className="sr-only" htmlFor="invite-code">
                Invitation code
              </label>
              <input
                id="invite-code"
                value={code}
                onChange={(ev) => setCode(ev.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="Invitation code"
                className="num min-h-11 flex-1 rounded-[10px] border border-line bg-bg px-3 text-sm text-ink placeholder:text-steel/60 focus:border-purple focus:outline-none"
              />
              <Button type="submit" disabled={redeem.isPending || !code.trim()}>
                Redeem
              </Button>
            </form>
          )}
          <ErrorLine error={redeem.error ?? eligibility.error} />
        </Step>

        <Step n={4} title="Read and accept the disclosure" state={consented ? "done" : invited ? "current" : "locked"}>
          {consented ? (
            <p>
              Accepted version <span className="num text-ink">{e!.backendOnboarding.consent.currentVersion}</span>.
            </p>
          ) : disclosure.data ? (
            <>
              <p className="num text-xs text-steel">version {disclosure.data.version}</p>
              <div
                className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-bg p-4 text-[13px] leading-relaxed text-ink"
                data-testid="disclosure-text"
              >
                {disclosure.data.text}
              </div>
              <label className="flex min-h-11 items-center gap-3 text-sm text-ink">
                <input type="checkbox" checked={read} onChange={(ev) => setRead(ev.target.checked)} className="h-4 w-4" />
                I have read this version of the disclosure.
              </label>
              <Button
                disabled={!read || accept.isPending}
                onClick={() => accept.mutate({ version: disclosure.data!.version, sha256: disclosure.data!.sha256 })}
              >
                Accept
              </Button>
              <ErrorLine error={accept.error} />
            </>
          ) : disclosure.error ? (
            <ErrorLine error={disclosure.error} />
          ) : (
            <Skeleton className="h-40 w-full" />
          )}
        </Step>

        <Step n={5} title="Participant status" state={consented ? "done" : "locked"}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <dt className="text-steel">Backend onboarding</dt>
            <dd className="text-ink" data-testid="backend-onboarding">
              {e?.backendOnboarding.complete ? "complete" : "incomplete"}
            </dd>
            <dt className="text-steel">On-chain admission</dt>
            <dd data-testid="onchain-admission">
              <span className="num text-steel/60" title={e?.onchainAdmission.reason}>
                — not available
              </span>
              <p className="mt-1 text-xs text-steel">{e?.onchainAdmission.reason}</p>
            </dd>
          </dl>
        </Step>
      </div>

      {signedIn ? (
        <div className="mt-8">
          <Button variant="ghost" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
            Sign out
          </Button>
        </div>
      ) : null}
    </div>
  );
}
