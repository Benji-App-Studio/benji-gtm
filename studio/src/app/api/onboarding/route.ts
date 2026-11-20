import { getTranslator } from "@/lib/i18n/server";
import { isResponse, requireUser } from "@/lib/server/auth";
import { startInsight } from "@/lib/server/insight";
import { onboardingAction } from "@/lib/server/onboarding";

/** Apple's free, keyless endpoints: one try, eight seconds at most. */
async function apple(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; AppResearch/1.0)" }, signal: AbortSignal.timeout(8_000), cache: "no-store" }).catch(() => null);
  if (!response?.ok) return null;
  return response.json().catch(() => null);
}

/** The three-step first run (components/onboarding): lookup, create, suggest and finish (lib/server/onboarding.ts). */
export async function POST(request: Request) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { t } = await getTranslator();
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return onboardingAction(session, body, t, { apple, startInsight: (s, id) => startInsight(s as Parameters<typeof startInsight>[0], id) });
}
