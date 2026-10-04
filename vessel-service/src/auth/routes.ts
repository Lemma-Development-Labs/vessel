import cookie from "@fastify/cookie";
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import type { Hex } from "viem";
import {
  AuthError,
  acceptConsent,
  eligibility,
  issueNonce,
  logout,
  redeemInvitation,
  refreshSession,
  sessionFromAccess,
  sha256Hex,
  verifySiwe,
  type AuthSettings,
  type SessionTokens,
} from "./core.ts";
import type { Disclosure } from "./disclosures.ts";
import type { Sql } from "./sql.ts";

/**
 * Auth HTTP surface (docs/AUTH.md). Reached same-origin through the app's
 * `/api/auth/*` rewrite, so cookies are first-party on the app domain and the
 * public API's CORS policy (GET/HEAD, no credentials) is unchanged.
 */
export const ACCESS_COOKIE = "vs_at";
export const REFRESH_COOKIE = "vs_rt";
/** Browser-side path of the refresh cookie: only sent to the auth endpoints. */
export const REFRESH_COOKIE_PATH = "/api/auth";
export const CSRF_HEADER = "x-vessel-csrf";

export interface AuthRouteDeps {
  sql: Sql;
  settings: AuthSettings;
  disclosure: Disclosure;
  /** Requests per minute per IP across the auth routes. */
  rateLimitPerMin?: number;
}

const ADDRESS_BODY = { type: "string", minLength: 1, maxLength: 64 } as const;

/**
 * Auth as an encapsulated Fastify plugin: the CSRF hook and error handler
 * apply to auth routes only, leaving the public read API's behaviour untouched.
 */
export function authRoutes(deps: AuthRouteDeps): FastifyPluginAsync {
  return async (scope) => {
    const { sql, settings, disclosure } = deps;
    await scope.register(cookie);

    const limited = { config: { rateLimit: { max: deps.rateLimitPerMin ?? 30, timeWindow: 60_000 } } };

    // CSRF: every state-changing auth request must come from the app origin AND
    // carry a custom header (a cross-site form cannot set one; a cross-site
    // fetch that sets one needs a CORS preflight this service never grants).
    scope.addHook("onRequest", async (req, reply) => {
      if (req.method === "GET" || req.method === "HEAD") return;
      if (req.headers.origin !== settings.origin || req.headers[CSRF_HEADER] !== "1") {
        await reply.code(403).send({ error: "CSRF" });
      }
    });

    scope.setErrorHandler(async (err, req, reply) => {
      if (err instanceof AuthError) return reply.code(err.status).send({ error: err.code });
      if ((err as { validation?: unknown }).validation) return reply.code(400).send({ error: "BAD_REQUEST" });
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 429) return reply.code(429).send({ error: "RATE_LIMITED" });
      // Fastify's own client errors (malformed/empty JSON, oversized body…) stay 4xx.
      if (status !== undefined && status >= 400 && status < 500) return reply.code(status).send({ error: "BAD_REQUEST" });
      req.log.error({ err }, "unhandled");
      return reply.code(500).send({ error: "INTERNAL" });
    });

    const setSessionCookies = (reply: FastifyReply, t: SessionTokens) => {
      reply.setCookie(ACCESS_COOKIE, t.accessToken, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        expires: t.accessExpiresAt,
      });
      reply.setCookie(REFRESH_COOKIE, t.refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: REFRESH_COOKIE_PATH,
        expires: t.refreshExpiresAt,
      });
    };
    const clearSessionCookies = (reply: FastifyReply) => {
      reply.clearCookie(ACCESS_COOKIE, { path: "/" });
      reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
    };
    const requireSession = async (req: FastifyRequest) => {
      const s = await sessionFromAccess(sql, settings, req.cookies[ACCESS_COOKIE]);
      if (!s) throw new AuthError("SESSION_REQUIRED", 401);
      return s;
    };

    scope.post("/auth/nonce", limited, async () => {
      const { nonce, expiresAt } = await issueNonce(sql, settings);
      return {
        nonce,
        expiresAt: expiresAt.toISOString(),
        domain: settings.domain,
        uri: settings.origin,
        chainId: settings.chainId,
      };
    });

    scope.post<{ Body: { message: string; signature: Hex } }>(
      "/auth/verify",
      {
        ...limited,
        schema: {
          body: {
            type: "object",
            required: ["message", "signature"],
            additionalProperties: false,
            properties: {
              message: { type: "string", minLength: 1, maxLength: 4096 },
              signature: { type: "string", pattern: "^0x[0-9a-fA-F]{130}$" },
            },
          },
        },
      },
      async (req, reply) => {
        const t = await verifySiwe(sql, settings, req.body.message, req.body.signature);
        setSessionCookies(reply, t);
        return { address: t.address, accessExpiresAt: t.accessExpiresAt.toISOString() };
      },
    );

    scope.post("/auth/refresh", limited, async (req, reply) => {
      try {
        const t = await refreshSession(sql, settings, req.cookies[REFRESH_COOKIE]);
        setSessionCookies(reply, t);
        return { address: t.address, accessExpiresAt: t.accessExpiresAt.toISOString() };
      } catch (err) {
        clearSessionCookies(reply);
        throw err;
      }
    });

    scope.post("/auth/logout", limited, async (req, reply) => {
      await logout(sql, settings, req.cookies[REFRESH_COOKIE], req.cookies[ACCESS_COOKIE]);
      clearSessionCookies(reply);
      return { ok: true };
    });

    scope.get("/auth/session", limited, async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const s = await requireSession(req);
      return { address: s.address, accessExpiresAt: s.accessExpiresAt.toISOString() };
    });

    scope.get("/auth/disclosure", limited, async (_req, reply) => {
      reply.header("Cache-Control", "no-store");
      return { version: disclosure.version, environment: disclosure.environment, text: disclosure.text, sha256: sha256Hex(disclosure.text) };
    });

    scope.post<{ Body: { code: string } }>(
      "/auth/invitations/redeem",
      {
        ...limited,
        schema: {
          body: {
            type: "object",
            required: ["code"],
            additionalProperties: false,
            properties: { code: { type: "string", minLength: 8, maxLength: 128 } },
          },
        },
      },
      async (req) => {
        const s = await requireSession(req);
        return redeemInvitation(sql, settings, s.address, req.body.code);
      },
    );

    scope.post<{ Body: { version: string; sha256: string } }>(
      "/auth/consent",
      {
        ...limited,
        schema: {
          body: {
            type: "object",
            required: ["version", "sha256"],
            additionalProperties: false,
            properties: {
              version: ADDRESS_BODY,
              sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
            },
          },
        },
      },
      async (req) => {
        const s = await requireSession(req);
        await acceptConsent(sql, settings, s.address, req.body.version, req.body.sha256);
        return { ok: true };
      },
    );

    scope.get("/auth/eligibility", limited, async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const s = await requireSession(req);
      return eligibility(sql, s.address, disclosure.version);
    });
  };
}

export async function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps): Promise<void> {
  await app.register(authRoutes(deps));
}
