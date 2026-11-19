import type { NextRequest } from "next/server";
import { switchJobProvider } from "@/lib/creative-plan";
import { fmtUsd, IMAGE_PROVIDERS, providerOfJob, PROVIDER_NAME, type ImageProvider } from "@/lib/image-provider";
import { confirmedCreditsOf } from "@/lib/playground-templates-plan";
import { isResponse, requireUser } from "@/lib/server/auth";

type JobRow = {
  id: string; status: string; backend: string; model: string; prompt: string; params: Record<string, unknown>; aspect: string; variant: number; kind: string;
  product_id: string; batch_id: string | null; format_card_id: string | null;
};

/**
 * Cancels a queued job, or queues a failed or cancelled one again (on the same provider).
 * `plan-switch` / `switch` ({ provider }): "Try with OpenAI/Higgsfield instead" on a failed or cancelled
 * GPT Image 2.5 job. The price first (free), then, at the price the person confirmed, a new job with the
 * same prompt and images on the other provider joins the batch. Nothing ever moves provider on its own.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/studio/jobs/[id]">) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const { action } = body;
  const { data: job } = await session.supabase.from("creative_jobs").select("id, status, backend, model, prompt, params, aspect, variant, kind, product_id, batch_id, format_card_id").eq("id", id).maybeSingle<JobRow>();
  if (!job) return Response.json({ error: "This job doesn't exist." }, { status: 404 });
  if (action === "cancel") {
    if (job.status !== "queued") return Response.json({ error: job.status === "running" ? "It's already running; it can't be stopped halfway (Higgsfield charges once it starts)." : "Only queued jobs can be cancelled." }, { status: 409 });
    const { error } = await session.supabase.from("creative_jobs").update({ status: "cancelled" }).eq("id", id);
    return error ? Response.json({ error: error.message }, { status: 400 }) : Response.json({ status: "cancelled" });
  }
  if (action === "retry") {
    if (job.status !== "failed" && job.status !== "cancelled") return Response.json({ error: "Only failed or cancelled jobs can be retried." }, { status: 409 });
    if (job.backend === "template") return Response.json({ error: "Posts are rendered when the batch starts; start a new batch instead." }, { status: 409 });
    const { error } = await session.supabase.from("creative_jobs").update({ status: "queued", not_before: null, error: null }).eq("id", id);
    return error ? Response.json({ error: error.message }, { status: 400 }) : Response.json({ status: "queued" });
  }
  if (action === "plan-switch" || action === "switch") {
    if (job.status !== "failed" && job.status !== "cancelled") return Response.json({ error: "Only a failed or cancelled image can be made with the other provider." }, { status: 409 });
    const to = body.provider as ImageProvider;
    if (!IMAGE_PROVIDERS.includes(to) || to === providerOfJob(job.params)) return Response.json({ error: "Pick the other provider." }, { status: 400 });
    const { data: batch } = job.batch_id
      ? await session.supabase.from("creative_batches").select("settings").eq("id", job.batch_id).maybeSingle<{ settings: { brand?: { screenshotUrls?: string[] } } }>()
      : { data: null };
    const switched = switchJobProvider(job, to, batch?.settings?.brand?.screenshotUrls?.length ?? 0);
    if (!switched) return Response.json({ error: "Only GPT Image 2.5 images can be made by either provider." }, { status: 409 });
    const cost = { credits: switched.costEstimate, usd: switched.costUsd ?? 0, provider: to };
    if (action === "plan-switch") return Response.json(cost);
    // Never spend without the price the person saw and confirmed.
    const confirmedCredits = confirmedCreditsOf(body.confirmedCredits);
    const confirmedUsd = confirmedCreditsOf(body.confirmedUsd);
    if (confirmedCredits === undefined || (cost.usd && confirmedUsd === undefined)) return Response.json({ error: "Confirm the estimated cost first." }, { status: 400 });
    if (cost.credits > confirmedCredits + 0.01 || (cost.usd && cost.usd > confirmedUsd! + 0.0005)) {
      return Response.json({ error: `The estimate changed to ${to === "openai" ? fmtUsd(cost.usd) : `${cost.credits} credits`}; check it and confirm again.`, ...cost }, { status: 409 });
    }
    const { data: made, error } = await session.supabase.from("creative_jobs").insert({
      product_id: job.product_id, batch_id: job.batch_id, format_card_id: job.format_card_id, kind: job.kind, model: job.model, prompt: job.prompt,
      params: switched.params, aspect: job.aspect, variant: job.variant, backend: switched.backend, cost_estimate: switched.costEstimate,
    }).select("id").single<{ id: string }>();
    if (error || !made) return Response.json({ error: error?.message ?? `Couldn't queue it for ${PROVIDER_NAME[to]}.` }, { status: 400 });
    return Response.json({ jobId: made.id, status: "queued", ...cost });
  }
  return Response.json({ error: "Cancel or retry?" }, { status: 400 });
}
