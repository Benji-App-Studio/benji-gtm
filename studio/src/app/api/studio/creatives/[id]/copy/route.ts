import type { NextRequest } from "next/server";
import { copyRequest, finishCopy, isAiGenerated } from "@/lib/creative-copy";
import { CREATIVE_COLUMNS } from "@/lib/creative-types";
import { isLocale } from "@/lib/i18n/locales";
import { getTranslator } from "@/lib/i18n/server";
import { serverErrorText } from "@/lib/i18n/server-messages";
import { isResponse, requireUser } from "@/lib/server/auth";
import { brandFor } from "@/lib/server/brand";
import { creativesBackend } from "@/lib/server/creatives-backend";
import { dbFailure } from "@/lib/server/errors";

/** OpenAI writes in the creatives edge function; give it its minute. */
export const maxDuration = 60;

interface Row {
  id: string;
  product_id: string;
  batch_id: string | null;
  job_id: string | null;
  kind: "image" | "video";
  style: string;
  model: string | null;
  prompt: string | null;
  cta: string | null;
  awareness_level: number | null;
  qa: { textSeen?: string[] } | null;
  ocr: { lines?: { text?: string }[] } | null;
}

/**
 * Writes A/B ad copy for a creative (lib/creative-copy.ts): A in the creator's voice, B in the brand's,
 * from the brand's voice and rules, the words on the creative, its brief and its awareness level. The
 * `creatives` edge function asks OpenAI (it holds the key); the answer is finished here and saved as
 * copy_variants, with the chosen variant (`variant`, else A) as the headline, primary text and
 * description. Saving resets QA (the copy is checked too).
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/studio/creatives/[id]/copy">) {
  const tr = await getTranslator();
  const { t } = tr;
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const { data: creative } = await session.supabase.from("creatives")
    .select("id, product_id, batch_id, job_id, kind, style, model, prompt, cta, awareness_level, qa, ocr").eq("id", id).maybeSingle<Row>();
  if (!creative) return Response.json({ error: t("This creative doesn't exist.") }, { status: 404 });
  const [{ data: batch }, merged] = await Promise.all([
    creative.batch_id
      ? session.supabase.from("creative_batches").select("brief, awareness_level").eq("id", creative.batch_id).maybeSingle<{ brief: string; awareness_level: number | null }>()
      : Promise.resolve({ data: null }),
    brandFor(session, creative.product_id).catch(() => null),
  ]);
  if (!merged) return Response.json({ error: t("This creative's product doesn't exist.") }, { status: 404 });

  const textSeen = creative.qa?.textSeen?.length ? creative.qa.textSeen : (creative.ocr?.lines ?? []).map((l) => l.text ?? "").filter(Boolean);
  const brand = { appName: merged.kit.appName, forbiddenClaims: merged.kit.forbiddenClaims, system: merged.system, profile: merged.profile };
  const ask = copyRequest({
    appName: merged.kit.appName, brand, brief: batch?.brief, prompt: creative.prompt, textSeen,
    awarenessLevel: creative.awareness_level ?? batch?.awareness_level, cta: creative.cta,
    kind: creative.style === "reddit" || creative.style === "tweet" ? "post" : creative.kind === "video" ? "video" : "image",
  });
  // The copy is written in the page's language unless the request names the ad's own (`copyLanguage`: en, zh-TW, ja, ko).
  const copyLanguage = isLocale(body.copyLanguage) ? body.copyLanguage : undefined;
  const result = await creativesBackend(session, "copy", { creativeId: id, ...ask, ...(copyLanguage ? { copyLanguage } : {}) }, { timeoutMs: 55_000 });
  // The backend's English message in the page's language (lib/i18n/server-messages.ts).
  if (!result.ok) return Response.json({ error: serverErrorText(result.data, tr, t("The copy couldn't be written. Try again.")) }, { status: result.status });
  const variants = finishCopy(result.data, { system: merged.system, aiGenerated: isAiGenerated(creative) });
  if (!variants.length) return Response.json({ error: t("OpenAI wrote no usable copy. Try again.") }, { status: 502 });

  const chosen = variants.find((v) => v.label === body.variant) ?? variants[0];
  const { data, error } = await session.supabase.from("creatives")
    .update({ copy_variants: variants, headline: chosen.headline || null, primary_text: chosen.primary_text, description: chosen.description || null })
    .eq("id", id).select(CREATIVE_COLUMNS).single();
  if (error) return dbFailure("creative copy save", error, t("The copy was written but couldn't be saved. Try again."), 400, {}, t);
  return Response.json({ creative: data });
}
