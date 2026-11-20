import type { NextRequest } from "next/server";
import { appFromBrand } from "@/lib/make-for-app";
import { ASSET_COLUMNS, type ProductAsset } from "@/lib/product-assets";
import { isResponse, requireUser } from "@/lib/server/auth";
import { brandFor } from "@/lib/server/brand";
import { zip, type ZipEntry } from "@/lib/zip";
import { getTranslator } from "@/lib/i18n/server";

const MAX_FILE = 15 * 1024 * 1024;
const MAX_TOTAL = 60 * 1024 * 1024;
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg" };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "app";

/**
 * "Download my brand kit": the app's logo, icon and screenshots in one zip, with brand.txt (colours with
 * their roles, fonts, tone, what it does), to paste into another tool next to a ready-made prompt.
 * Files that can't be fetched are left out and named in brand.txt.
 */
export async function GET(_request: NextRequest, ctx: RouteContext<"/api/products/[id]/brand-kit">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { t } = await getTranslator();
  const { id } = await ctx.params;
  const { data: product } = await session.supabase.from("products").select("id, name").eq("id", id).maybeSingle<{ id: string; name: string }>();
  if (!product) return Response.json({ error: t("This app doesn't exist.") }, { status: 404 });
  const [merged, assets] = await Promise.all([
    brandFor(session, id),
    session.supabase.from("product_assets").select(ASSET_COLUMNS).eq("product_id", id).eq("hidden", false).in("kind", ["logo", "app_screen"]).limit(20).returns<ProductAsset[]>(),
  ]);
  const kit = merged.kit;
  const app = appFromBrand({ appName: kit.appName, tagline: kit.tagline, colors: kit.colors, iconUrl: kit.iconUrl, screenshots: kit.screenshotUrls.length, tone: kit.tone, forbiddenClaims: merged.forbiddenClaims, profile: merged.profile, system: merged.system }, assets.data ?? []);
  const wanted: { name: string; url: string }[] = [
    ...(assets.data ?? []).filter((a) => a.kind === "logo").slice(0, 3).map((a, i) => ({ name: `logo${i ? `-${i + 1}` : ""}`, url: a.url })),
    ...(kit.iconUrl ? [{ name: "app-icon", url: kit.iconUrl }] : []),
    ...kit.screenshotUrls.slice(0, 8).map((url, i) => ({ name: `screenshots/screenshot-${i + 1}`, url })),
    ...(assets.data ?? []).filter((a) => a.kind === "app_screen").slice(0, 6).map((a, i) => ({ name: `screens/app-screen-${i + 1}`, url: a.url })),
  ].filter((f) => /^https:\/\//.test(f.url));
  const entries: ZipEntry[] = [];
  const missed: string[] = [];
  let total = 0;
  await Promise.all(wanted.map(async (f) => {
    try {
      const response = await fetch(f.url, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(String(response.status));
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > MAX_FILE || total + bytes.length > MAX_TOTAL) throw new Error("too big");
      total += bytes.length;
      const type = (response.headers.get("content-type") ?? "").split(";")[0].trim();
      entries.push({ path: `${f.name}.${EXT[type] ?? (f.url.match(/\.(png|jpe?g|webp|svg)(?:\?|$)/i)?.[1]?.toLowerCase().replace("jpeg", "jpg") ?? "png")}`, bytes });
    } catch {
      missed.push(f.name);
    }
  }));
  const text = [
    `${app.name || product.name}: brand kit`,
    "",
    app.does ? `What it does: ${app.does}` : "",
    app.audience ? `Who it's for: ${app.audience}` : "",
    app.outcome ? `The outcome it promises: ${app.outcome}` : "",
    app.colors.length ? `Colours: ${app.colors.map((c) => `${c.hex} (${c.role}${c.name ? `, ${c.name}` : ""})`).join(", ")}` : "Colours: none set yet (add them on the Brand page).",
    app.fonts.length ? `Fonts: ${app.fonts.map((f) => `${f.role}: ${f.family}${f.weight ? ` ${f.weight}` : ""}`).join("; ")}` : "",
    app.tone ? `Tone: ${app.tone}` : "",
    app.bannedWords.length ? `Never use these words: ${app.bannedWords.join(", ")}` : "",
    app.forbiddenClaims.length ? `Never claim: ${app.forbiddenClaims.join("; ")}` : "",
    "",
    missed.length ? `Couldn't include (the link didn't load): ${missed.join(", ")}.` : "",
  ].filter((line, i, all) => line || (i > 0 && all[i - 1])).join("\n");
  entries.sort((a, b) => a.path.localeCompare(b.path));
  const body = zip([{ path: "brand.txt", bytes: new TextEncoder().encode(`${text}\n`) }, ...entries]);
  return new Response(body as unknown as BodyInit, {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${slug(app.name || product.name)}-brand-kit.zip"`, "Cache-Control": "no-store" },
  });
}
