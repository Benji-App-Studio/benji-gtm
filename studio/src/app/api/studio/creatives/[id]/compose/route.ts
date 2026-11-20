import type { NextRequest } from "next/server";
import { cleanBrandSystem, hasBrandSystem, offerRules } from "@/lib/brand-system";
import { cleanCopy, COMPOSE_WORDS, composedParam, layoutById, type ComposedCopy } from "@/lib/composed-ads";
import { CREATIVES_BUCKET } from "@/lib/creatives";
import type { Aspect } from "@/lib/meta-formats";
import { isResponse, requireUser } from "@/lib/server/auth";
import { ComposeError, composeAd } from "@/lib/server/compose";
import { setCreativeFile } from "@/lib/server/creative-file";
import { creativesBackend } from "@/lib/server/creatives-backend";
import { isLocale } from "@/lib/i18n/locales";
import { getLocale, getTranslator } from "@/lib/i18n/server";
import { translateServerMessage } from "@/lib/i18n/server-messages";
import { caughtFailure, logDbError } from "@/lib/server/errors";
import { fill } from "@/lib/i18n/translate";
import { storedWords } from "@/lib/stored-words";

export const runtime = "nodejs";
export const maxDuration = 60;

/** What `copy.composed` records on a composed creative: enough to set it again, edit it or show its files. */
interface Composed {
  layout: string; copy: ComposedCopy; at: string; warnings: string[];
  plate: { path: string; url: string; sizeBytes: number | null };
  svgUrl: string | null; layersUrl: string | null;
  /** Our real logo file placed in the layout's logo slot, and the product cut-out composited in its product box. */
  logo?: string | null; product?: string | null;
}

const MAX_LAYER_BYTES = 15 * 1024 * 1024;
async function fetchImage(url: string, what: string): Promise<Uint8Array> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
  if (!response.ok) throw new Error(`Couldn't download the ${what} (${response.status}).`);
  const type = response.headers.get("content-type") ?? "";
  if (type && !/^(image\/|application\/octet-stream|binary\/octet-stream)/i.test(type)) throw new Error(`The ${what} isn't an image (${type.split(";")[0]}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_LAYER_BYTES) throw new Error(`The ${what} is too large (${Math.round(bytes.length / 1e6)} MB).`);
  return bytes;
}

interface Row { id: string; product_id: string; job_id: string | null; kind: string; aspect: string; storage_path: string; url: string; mime: string; size_bytes: number | null; copy: Record<string, unknown> | null }

/**
 * Sets a composed creative's copy on its text-free plate in the brand's fonts (lib/server/compose.tsx),
 * with our real logo file in the layout's logo slot and the product's real cut-out in its product box
 * when the batch asked for them (params.composed.logo / .product).
 * The Studio calls it as each composed creative arrives, and again to edit the words or the layout
 * (`{ copy?, layout? }`): always from the original plate, so it's free and safe to repeat. The creative
 * then points at the composed PNG; the editable SVG and layers.json sit next to it; QA runs again on
 * the exact words. Copy that doesn't fit at the type floors answers 422 with what to shorten.
 *
 * The browser may only write review columns, so the file and `copy` change through the owner-checked
 * `creatives_set_file` function (migration 20261005300000); its review trigger sends the creative back
 * to QA and any decision back to pending.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/studio/creatives/[id]/compose">) {
  const tr = await getTranslator();
  const { t } = tr;
  // A saved English sentence in the page's language: the composer's own templates (COMPOSE_WORDS), else
  // the backend and font messages (lib/i18n/server-messages.ts).
  const shown = (text: string) => {
    const words = storedWords(text, COMPOSE_WORDS, t);
    return words !== text ? words : translateServerMessage(text, tr);
  };
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: t("This creative doesn't exist.") }, { status: 404 });
  const body = await request.json().catch(() => ({})) as { copy?: unknown; layout?: unknown };
  const { supabase } = session;
  const { data: creative } = await supabase.from("creatives").select("id, product_id, job_id, kind, aspect, storage_path, url, mime, size_bytes, copy").eq("id", id).maybeSingle<Row>();
  if (!creative) return Response.json({ error: t("This creative doesn't exist.") }, { status: 404 });
  if (creative.kind !== "image") return Response.json({ error: t("Only image creatives are composed.") }, { status: 400 });
  const [{ data: job }, { data: product }] = await Promise.all([
    creative.job_id ? supabase.from("creative_jobs").select("params").eq("id", creative.job_id).maybeSingle<{ params: Record<string, unknown> }>() : Promise.resolve({ data: null }),
    supabase.from("products").select("brand_system").eq("id", creative.product_id).maybeSingle<{ brand_system: unknown }>(),
  ]);
  const record = (creative.copy?.composed ?? null) as Composed | null;
  const asked = composedParam(job?.params);
  if (!asked && !record) return Response.json({ error: t("This creative wasn't made as a composed ad.") }, { status: 400 });
  const copy = cleanCopy(body.copy) ?? record?.copy ?? asked!.copy;
  const layout = layoutById(body.layout ?? record?.layout ?? asked!.layout);
  // What the batch asked for stays on every re-compose (a record from before these existed falls back to the job's).
  const logoUrl = record && "logo" in record ? record.logo ?? null : asked?.logo ?? null;
  const productUrl = record && "product" in record ? record.product ?? null : asked?.product ?? null;
  const stored = product?.brand_system ? cleanBrandSystem(product.brand_system) : null;
  const system = hasBrandSystem(stored) ? stored : null;
  const offers = offerRules(system);
  if (copy.offer && offers?.allowed.length && !offers.allowed.some((a) => a.toLowerCase() === copy.offer!.toLowerCase())) {
    return Response.json({ error: t("\"{offer}\" isn't one of your offers. Pick one from the Brand page's list.", { offer: copy.offer }) }, { status: 422 });
  }
  const plate = record?.plate ?? { path: creative.storage_path, url: creative.url, sizeBytes: creative.size_bytes };
  const publicUrl = (path: string) => supabase.storage.from(CREATIVES_BUCKET).getPublicUrl(path).data.publicUrl;
  const aspect = (["4:5", "1:1", "9:16"].includes(creative.aspect) ? creative.aspect : "4:5") as Aspect;

  try {
    const response = await fetch(publicUrl(plate.path), { signal: AbortSignal.timeout(30_000), cache: "no-store" });
    if (!response.ok) throw new Error(`Couldn't download the plate (${response.status}).`);
    // The real product is part of the picture (the plate left its spot empty): without it the ad isn't made.
    const product = productUrl ? await fetchImage(productUrl, "product cut-out") : null;
    // A logo that won't load leaves its slot empty, with a warning on the card.
    const logoProblem: string[] = [];
    // Copy in Chinese characters alone takes the ad's language for its glyph shapes (Japanese or Chinese):
    // the copy language stored with the creative or its job when there is one, else the page's.
    const adLanguage = [creative.copy?.copyLanguage, job?.params?.copyLanguage].find(isLocale);
    const logo = logoUrl ? await fetchImage(logoUrl, "logo").catch((e) => { logoProblem.push(fill(COMPOSE_WORDS[3], { reason: e instanceof Error ? e.message : String(e) })); return null; }) : null;
    const out = await composeAd({ plate: new Uint8Array(await response.arrayBuffer()), aspect, layout, copy, system, logo, product, language: adLanguage ?? (await getLocale()) });
    out.warnings.push(...logoProblem);
    const stem = `${plate.path.replace(/\.[^./]+$/, "")}-composed-${Date.now().toString(36)}`;
    const upload = async (path: string, bytes: Buffer | string, type: string) => {
      const { error } = await supabase.storage.from(CREATIVES_BUCKET).upload(path, typeof bytes === "string" ? new Blob([bytes], { type }) : bytes, { contentType: type, upsert: true });
      if (error) throw new Error(/row-level security|policy/i.test(error.message) ? logDbError("compose upload", error, t("Storage refused the upload. Open /setup and press Apply the update, then try again."), t) : logDbError("compose upload", error, t("Couldn't store {file}. Try again.", { file: path.split("/").pop() ?? "" }), t));
      return publicUrl(path);
    };
    const pngUrl = await upload(`${stem}.png`, out.png, "image/png");
    // The editable files are extras: a bucket that doesn't take them yet (migration 20261005200000) doesn't stop the ad.
    const svgUrl = await upload(`${stem}.svg`, out.svg, "image/svg+xml").catch(() => null);
    const layersUrl = await upload(`${stem}-layers.json`, JSON.stringify(out.layers, null, 1), "application/json").catch(() => null);
    const next = {
      ...(creative.copy ?? {}),
      headline: copy.headline, body: [copy.subhead, copy.offer, copy.cta].filter(Boolean).join(" · ") || undefined,
      minTextFrac: Math.round(out.minTextFrac * 1000) / 1000, contrast: out.contrast,
      composed: { layout: layout.id, copy, at: new Date().toISOString(), warnings: out.warnings, plate, svgUrl, layersUrl, logo: logoUrl, product: productUrl } satisfies Composed,
      composeError: null,
    };
    const saved = await setCreativeFile(supabase, id, {
      url: pngUrl, storage_path: `${stem}.png`, mime: "image/png", size_bytes: out.png.length, width: out.plan.width, height: out.plan.height,
      headline: copy.headline, primary_text: copy.subhead ?? null, cta: copy.cta ?? null, copy: next,
    });
    if ("error" in saved) throw new Error(saved.error);
    // QA reads the exact words now (and their sizes and contrast): no OCR needed.
    await creativesBackend(session, "qa", { creativeIds: [id] }).catch(() => null);
    // Warnings are stored in English (data); the answer shows them in the page's language.
    return Response.json({ creative: saved.creative, warnings: out.warnings.map(shown) });
  } catch (error) {
    if (error instanceof ComposeError) {
      // Recorded on the creative, so the card shows "text to shorten" and approval waits for a fix.
      const saved = await setCreativeFile(supabase, id, { copy: { ...(creative.copy ?? {}), composeError: { problems: error.problems, at: new Date().toISOString(), copy, layout: layout.id } } });
      if ("error" in saved) {
        console.error("[api] compose save problems:", saved.error);
        return Response.json({ error: t("{reason} (and the problems couldn't be saved on the creative)", { reason: error.message }), problems: error.problems }, { status: 502 });
      }
      return Response.json({ error: shown(error.message), problems: error.problems.map(shown) }, { status: 422 });
    }
    return caughtFailure("compose", error, t("Couldn't compose the ad. Try again."), 502, {}, t);
  }
}
