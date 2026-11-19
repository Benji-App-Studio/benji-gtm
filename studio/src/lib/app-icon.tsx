// The browser-tab icon and the home-screen icon, drawn in code so no image file carries a brand: a
// rounded square in the accent colour with three rising bars. Used by app/icon.tsx and
// app/apple-icon.tsx (the Next.js metadata file conventions), which are rendered once at build time.
import { ImageResponse } from "next/og";

/** The light theme's --color-accent in app/globals.css (an image can't read a CSS variable; a test keeps the two in step). */
export const ICON_ACCENT = "#3358d4";
/** Bar heights, as shares of the icon's height, left to right. */
const BARS = [0.28, 0.44, 0.6];

/** `rounded: false` fills the square to its corners (phones round the home-screen icon themselves). */
export function appIcon(size: number, { rounded = true }: { rounded?: boolean } = {}): ImageResponse {
  const bar = Math.round(size * 0.14);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center", gap: Math.round(size * 0.08), paddingBottom: Math.round(size * 0.2), background: ICON_ACCENT, borderRadius: rounded ? Math.round(size * 0.22) : 0 }}>
        {BARS.map((share) => (
          <div key={share} style={{ width: bar, height: Math.round(size * share), background: "#ffffff", borderRadius: Math.max(1, Math.round(bar * 0.3)) }} />
        ))}
      </div>
    ),
    { width: size, height: size },
  );
}
