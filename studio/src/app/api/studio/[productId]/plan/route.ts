import type { NextRequest } from "next/server";
import { cleanMustAvoid, cleanProductReferences, cleanStyleReferences, DEFAULT_REQUEST, type BatchRequest } from "@/lib/creative-plan";
import { cleanLogo } from "@/lib/logo-overlay";
import { normalizeImageProvider } from "@/lib/image-provider";
import { isResponse, requireUser } from "@/lib/server/auth";
import { brandFor } from "@/lib/server/brand";
import { planFor } from "@/lib/server/creative-batches";
import { loadWorkspace } from "@/lib/server/workspaces";
import { getTranslator } from "@/lib/i18n/server";

/**
 * The plan for a request, priced, without starting anything: what "Make this for <app>" shows before
 * "Generate here" (the batch route then charges exactly this, or refuses when it moved).
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/studio/[productId]/plan">) {
  const { t } = await getTranslator();
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { productId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(productId)) return Response.json({ error: t("This workspace doesn't exist.") }, { status: 404 });
  const workspace = await loadWorkspace(productId, session.supabase);
  if (isResponse(workspace)) return workspace;
  const input = ((await request.json().catch(() => ({}))).request ?? {}) as Partial<BatchRequest>;
  const req: BatchRequest = {
    ...DEFAULT_REQUEST, ...input,
    brief: String(input.brief ?? ""),
    video: { ...DEFAULT_REQUEST.video, ...(input.video ?? {}) },
    image: { ...DEFAULT_REQUEST.image, ...(input.image ?? {}), provider: normalizeImageProvider(input.image?.provider) },
    reddit: [], tweets: [],
    mustAvoid: cleanMustAvoid(input.mustAvoid),
    styleReferences: cleanStyleReferences(input.styleReferences),
    productReferences: cleanProductReferences(input.productReferences),
    referencesInBrief: input.referencesInBrief === true, brandInBrief: input.brandInBrief === true, fromRecreate: input.fromRecreate === true, exactRecreate: input.exactRecreate === true,
    logo: cleanLogo(input.logo),
  };
  const merged = await brandFor(session, productId);
  const plan = planFor(req, { ...workspace, brandKit: merged.kit }, merged.profile, merged.system, t);
  return Response.json({ credits: plan.credits, usd: plan.usd ?? 0, jobs: plan.jobs.length, warnings: plan.warnings, errors: plan.errors });
}
