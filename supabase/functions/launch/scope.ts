// Which ads Launch may promote or pause. Both writes leave things paused (a promoted copy is created
// PAUSED; pausing only stops delivery), and both are confirmed on the page first.
//
// KEEP IN SYNC: studio/src/lib/launch/scope.ts is a byte-for-byte copy (a Deno test checks it), so
// the Ads view offers exactly the actions the launch function accepts.
//
// Launch used to act only on the two ad sets its simple flow creates. The "Send to Meta" sheet sends
// ads into any ad set, and Launch's Ads view judges every ad it sent, so an ad Launch made (it has a
// draft with this ad's id in the workspace) counts wherever it runs: a testing ad can be copied to the
// scaling ad set, and any of them can be paused. Ads Launch didn't make stay out of reach, and so do
// ads in any other ad account than the workspace's (after the workspace switches accounts, an ad in
// the old one is no longer this workspace's to change).

export interface ScopeSettings {
  testing_adset_id: string | null;
  scaling_adset_id: string | null;
  /** The workspace's ad account (act_123 or 123). */
  adAccountId: string | null | undefined;
}

export interface ScopeAd {
  adset_id: string;
  /** The ad's account as Meta reports it; undefined when it isn't known (the page, for older rows). */
  account_id?: string | null;
}

/** The workspace's draft for this ad, when Launch made it. */
export interface OwnDraft { stage: "TEST" | "SCALE" | string; status: string }

export type Refusal = "other_account" | "no_scaling_adset" | "already_scaling" | "not_a_test" | "not_launched";

export const REFUSAL_TEXT: Record<Refusal, string> = {
  other_account: "This ad isn't in this workspace's ad account.",
  no_scaling_adset: "Choose (or create) the scaling ad set first.",
  already_scaling: "This ad is already in the scaling ad set.",
  not_a_test: "Only testing ads Launch sent (in the testing ad set, or sent as a test through Send to Meta) can be promoted.",
  not_launched: "Launch only pauses ads it sent, or ads in this workspace's testing or scaling ad set.",
};

const act = (id: unknown) => String(id ?? "").trim().replace(/^act_/, "");
const made = (draft: OwnDraft | null | undefined) => Boolean(draft && draft.status !== "cancelled" && draft.status !== "error");

/** The ad is in the workspace's ad account (an unknown account passes; an empty one doesn't). */
function otherAccount(ad: ScopeAd, settings: ScopeSettings): boolean {
  const mine = act(settings.adAccountId);
  if (!mine) return true;
  return ad.account_id !== undefined && act(ad.account_id) !== mine;
}

/** null when the ad may be copied to the scaling ad set, else why not. */
export function promoteRefusal(ad: ScopeAd, settings: ScopeSettings, draft: OwnDraft | null | undefined): Refusal | null {
  if (otherAccount(ad, settings)) return "other_account";
  if (!settings.scaling_adset_id) return "no_scaling_adset";
  if (ad.adset_id === settings.scaling_adset_id) return "already_scaling";
  if (ad.adset_id && ad.adset_id === settings.testing_adset_id) return null;
  if (made(draft) && draft!.stage === "TEST") return null;
  return "not_a_test";
}

/** null when Launch may pause the ad, else why not. */
export function pauseRefusal(ad: ScopeAd, settings: ScopeSettings, draft: OwnDraft | null | undefined): Refusal | null {
  if (otherAccount(ad, settings)) return "other_account";
  if (ad.adset_id && (ad.adset_id === settings.testing_adset_id || ad.adset_id === settings.scaling_adset_id)) return null;
  if (made(draft)) return null;
  return "not_launched";
}
