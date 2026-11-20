import { ImageResponse } from "next/og";
import { APP_NAME } from "@/lib/brand-config";
import { ICON_ACCENT } from "@/lib/app-icon";
import { OG_SIZE } from "@/lib/landing-seo";

// The picture shown when the landing page is shared (Open Graph and X). A plain route rather than the
// opengraph-image convention, so the page links it only when the site has a public address
// (lib/landing-seo.ts): a copy without one never advertises a localhost image. Drawn at build time in the
// light theme's colours (an image can't read CSS variables), in English: link previews are fetched
// without the visitor's language.
export const dynamic = "force-static";

const INK = "#1b1b1f";
const MUTED = "#6b6c73";
const CANVAS = "#fcfcfc";
const LINE = "#ebebee";

export function GET() {
  const steps = ["Research", "Studio", "Launch", "Measure"];
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 80, background: CANVAS, color: INK, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: ICON_ACCENT, color: "#ffffff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, fontWeight: 700 }}>
            {APP_NAME.trim().charAt(0).toUpperCase()}
          </div>
          <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: -0.5 }}>{APP_NAME}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ fontSize: 68, fontWeight: 700, letterSpacing: -2, lineHeight: 1.08, maxWidth: 900 }}>Grow your app with ads that already work</div>
          <div style={{ fontSize: 28, color: MUTED, maxWidth: 900 }}>Research competitors&apos; ads, make your own, launch to Meta and measure CAC and LTV.</div>
        </div>
        <div style={{ display: "flex", gap: 14 }}>
          {steps.map((step, i) => (
            <div key={step} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 20px", borderRadius: 999, border: `2px solid ${LINE}`, background: "#ffffff", fontSize: 24, color: INK }}>
              <span style={{ color: ICON_ACCENT, fontWeight: 600 }}>{i + 1}</span>{step}
            </div>
          ))}
        </div>
      </div>
    ),
    OG_SIZE,
  );
}
