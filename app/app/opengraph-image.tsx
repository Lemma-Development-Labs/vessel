import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Vessel — delta-neutral tranche yield on Monad testnet. Unaudited.";

/**
 * Link-unfurl card. Rendered at the edge by satori, so this is a deliberately
 * small flexbox subset with no external font fetch — a preview that fails to
 * render is worse than a plain link.
 *
 * The honesty chrome from CLAUDE.md travels with the card: anywhere this link
 * is pasted, TESTNET and UNAUDITED arrive with it. A preview that looked like a
 * live mainnet product would be the most-shared false claim we could make.
 */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "linear-gradient(160deg, #070B10 0%, #0B1118 100%)",
          padding: "64px 72px",
          fontFamily: "monospace",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              border: "1px solid rgba(240,179,92,0.45)",
              borderRadius: 8,
              padding: "8px 14px",
              color: "#F0B35C",
              fontSize: 22,
              letterSpacing: 2,
            }}
          >
            TESTNET · UNAUDITED
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              border: "1px solid rgba(143,166,188,0.35)",
              borderRadius: 8,
              padding: "8px 14px",
              color: "#8FA6BC",
              fontSize: 22,
              letterSpacing: 2,
            }}
          >
            MONAD 10143
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              color: "#EAEEF3",
              fontSize: 104,
              fontWeight: 700,
              letterSpacing: -2,
              lineHeight: 1,
            }}
          >
            VESSEL
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 20,
              color: "#EAEEF3",
              fontSize: 42,
              lineHeight: 1.2,
              maxWidth: 940,
            }}
          >
            The hedge is public, every block.
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 18,
              color: "rgba(234,238,243,0.62)",
              fontSize: 27,
              maxWidth: 940,
            }}
          >
            Delta-neutral tranche yield. HULL takes a fixed coupon, BALLAST absorbs
            first loss. Demo dollars, simulated venue.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", width: 12, height: 12, borderRadius: 6, background: "#8FA6BC" }} />
            <div style={{ display: "flex", color: "#8FA6BC", fontSize: 24, letterSpacing: 1 }}>HULL · senior</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", width: 12, height: 12, borderRadius: 6, background: "#C9964B" }} />
            <div style={{ display: "flex", color: "#C9964B", fontSize: 24, letterSpacing: 1 }}>
              BALLAST · first-loss
            </div>
          </div>
          <div style={{ display: "flex", marginLeft: "auto", color: "#836EF9", fontSize: 24 }}>
            testnet.vessel.wtf
          </div>
        </div>
      </div>
    ),
    size,
  );
}
