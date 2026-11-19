// What the app knows about this install: who the caller is, which keys are set, and the settings.
// The `install` edge function answers this (route `capabilities`); the studio relays it at GET /api/install.
// Never contains a key's value.

export type InstallRole = "owner" | "member" | "legacy";
export type AiProvider = "openai" | "typesafe";
export type KeyStatus = "ok" | "failed" | "unverified";

export interface KeyState {
  set: boolean;
  /** The last 4 characters, to recognise which key is stored. null for a key from the environment. */
  last4: string | null;
  verifiedAt: string | null;
  status: KeyStatus;
  /** Why the last check failed, in plain words. */
  message: string | null;
  /** `env`: set as an edge function secret on the project (it can't be changed from the app). */
  source: "vault" | "env" | null;
}

export interface InstallModels { text: string; vision: string; transcribe: string; image: string }
export interface InstallLimits { wallClockSec: number; uploadLimitMb: number; storageQuotaGb: number }
/** Settings > Research sources: each source on, off or automatic (null, follows its key), and the Meta actor. Twin: lib/research-sources.ts. */
export interface InstallResearch {
  metaApify: boolean | null; metaActor: "community" | "official"; google: boolean | null; metaApi: boolean | null;
  tiktokLibrary: boolean | null; tiktokEu: boolean | null; tiktokTopAds: boolean | null;
}

export interface InstallState {
  role: InstallRole;
  /** False on an install from before setup existed: no owner, keys come from the environment. */
  owned: boolean;
  name: string | null;
  aiProvider: AiProvider;
  /** The stored, editable model names. */
  models: InstallModels;
  /** What actually runs, once the server's environment overrides apply. Absent on an older backend. */
  resolvedModels?: InstallModels;
  limits: InstallLimits;
  /** Absent on an older backend (every source automatic then). */
  research?: InstallResearch;
  keys: Record<string, KeyState>;
  /** The older research switches set on the project (RESEARCH_TIKTOK, RESEARCH_META_APIFY_ACTOR): they win over `research`. */
  researchEnv?: { tiktok: string | null; metaActor: string | null };
  /**
   * True when this copy of the app carries database changes the project doesn't have yet: the code was
   * updated (git pull, Sync fork) but /setup's "Apply the update" wasn't run. Added by the studio's
   * GET /api/install (lib/install/update-needed.ts); false when it can't tell.
   */
  updateNeeded?: boolean;
  /** What updateNeeded compared: the newest migration applied to the project and the newest one in this copy (14-digit versions). */
  schema?: { applied: string | null; bundled: string | null };
  /** From the install function: the newest version in public.install_migrations (null without a ledger). The studio turns it into `schema`. */
  schemaVersion?: string | null;
}

export interface InstallMember { userId: string; email: string | null; role: "owner" | "member"; createdAt: string }

export const EMPTY_KEY: KeyState = { set: false, last4: null, verifiedAt: null, status: "unverified", message: null, source: null };
export const keyState = (install: InstallState | null | undefined, name: string): KeyState => install?.keys[name] ?? EMPTY_KEY;
export const hasKey = (install: InstallState | null | undefined, name: string): boolean => keyState(install, name).set;
