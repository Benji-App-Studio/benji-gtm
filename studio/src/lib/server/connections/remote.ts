import "server-only";
// Meta, RevenueCat and AppStack keys live only in Supabase (Edge Functions → Secrets), so their checks
// run in the `metrics` edge function (/verify): real read calls with the team's keys, as the signed-in
// user. It answers { ok, message, pending? } and never returns a key.
import { metricsFunction } from "@/lib/server/measure";
import type { VerifyContext, VerifyResult } from "./verifier";

export async function verifyRemote(ctx: VerifyContext, connection: "meta" | "revenuecat" | "appstack" | "mixpanel" | "superwall", provider: string): Promise<VerifyResult> {
  const session = { supabase: ctx.supabase, user: { id: ctx.userId } };
  const result = await metricsFunction<VerifyResult>(session, "verify", { productId: ctx.workspace.id, connection }, 45_000);
  const data = result.data;
  if (result.ok && typeof data.ok === "boolean" && typeof data.message === "string") {
    return { ok: data.ok, message: data.message, ...(data.pending ? { pending: true } : {}) };
  }
  // The check couldn't run (not on the allowlist, the function not deployed yet, a network error):
  // that says nothing about the IDs, so nothing is recorded.
  if (result.status === 404 && data.error === "Not found") {
    return { ok: false, pending: true, message: `Checking ${provider} needs the latest metrics function deployed. The IDs are saved.` };
  }
  return { ok: false, pending: true, message: data.error ?? `Checking ${provider} failed (${result.status}). The IDs are saved.` };
}
