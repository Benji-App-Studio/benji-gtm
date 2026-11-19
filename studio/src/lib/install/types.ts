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
  keys: Record<string, KeyState>;
}

export interface InstallMember { userId: string; email: string | null; role: "owner" | "member"; createdAt: string }

export const EMPTY_KEY: KeyState = { set: false, last4: null, verifiedAt: null, status: "unverified", message: null, source: null };
export const keyState = (install: InstallState | null | undefined, name: string): KeyState => install?.keys[name] ?? EMPTY_KEY;
export const hasKey = (install: InstallState | null | undefined, name: string): boolean => keyState(install, name).set;
