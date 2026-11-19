// The install's settings and the state the app shows about it. Pure: no database, no environment.
//
// Twin of studio/src/lib/install/types.ts (InstallState, KeyState, InstallMember) and of the key list in
// studio/src/lib/install/key-catalog.ts; settings_test.ts fails when the key lists drift apart.
import { MODEL_DEFAULTS, type ModelEnv, type Models, resolveModels } from "../_shared/ai/models.ts";
import { DEFAULT_LIMITS, type InstallLimits } from "../_shared/limits.ts";

export { DEFAULT_LIMITS, type InstallLimits };

export type InstallRole = "owner" | "member" | "legacy";
export type AiProvider = "openai" | "typesafe";
export type KeyStatus = "ok" | "failed" | "unverified";

export interface KeyState {
  set: boolean;
  /** The last 4 characters of a key stored here; null for one that comes from the environment. */
  last4: string | null;
  verifiedAt: string | null;
  status: KeyStatus;
  message: string | null;
  /** `env`: an edge function secret on the project (it wins, and can't be changed from the app). */
  source: "vault" | "env" | null;
}

export interface InstallModels { text: string; vision: string; transcribe: string; image: string }
export interface InstallSettings { name: string | null; aiProvider: AiProvider; models: InstallModels; limits: InstallLimits }

export interface InstallState extends InstallSettings {
  /**
   * The model every step actually runs on: `models` above is what Settings hold (with defaults); this
   * also applies environment variables, which win (OPENAI_MODEL and its kin), and adds the steps that
   * follow `text` unless set apart (ad copy, the judge) and the image-editing model.
   */
  resolvedModels: Models;
  role: InstallRole;
  /** False on an install from before setup existed: no owner, keys come from the environment. */
  owned: boolean;
  keys: Record<string, KeyState>;
}

export interface InstallMember { userId: string; email: string | null; role: "owner" | "member"; createdAt: string }

/** What each model setting is when nothing is stored: the defaults every function uses (_shared/ai/models.ts). */
export const DEFAULT_MODELS: InstallModels = { text: MODEL_DEFAULTS.text, vision: MODEL_DEFAULTS.vision, transcribe: MODEL_DEFAULTS.transcribe, image: MODEL_DEFAULTS.image };
export const DEFAULT_AI_PROVIDER: AiProvider = "openai";

const MODEL_FIELDS = ["text", "vision", "transcribe", "image"] as const;
const LIMIT_FIELDS = ["wallClockSec", "uploadLimitMb", "storageQuotaGb"] as const;
const LIMIT_LABELS: Record<(typeof LIMIT_FIELDS)[number], string> = { wallClockSec: "The time limit", uploadLimitMb: "The upload limit", storageQuotaGb: "The storage quota" };
const NAME_MAX = 80;
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,99}$/;

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isProvider = (value: unknown): value is AiProvider => value === "openai" || value === "typesafe";
const isModel = (value: unknown): value is string => typeof value === "string" && MODEL_NAME.test(value.trim());
const isLimit = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

/** What is stored in `install.settings`, with a default for everything that is unset or unreadable. */
export function readSettings(raw: unknown): InstallSettings {
  const source = isObject(raw) ? raw : {};
  const models = isObject(source.models) ? source.models : {};
  const limits = isObject(source.limits) ? source.limits : {};
  const name = typeof source.name === "string" ? source.name.trim().slice(0, NAME_MAX) : "";
  const out: InstallSettings = { name: name || null, aiProvider: isProvider(source.aiProvider) ? source.aiProvider : DEFAULT_AI_PROVIDER, models: { ...DEFAULT_MODELS }, limits: { ...DEFAULT_LIMITS } };
  for (const field of MODEL_FIELDS) if (isModel(models[field])) out.models[field] = (models[field] as string).trim();
  for (const field of LIMIT_FIELDS) if (isLimit(limits[field])) out.limits[field] = limits[field] as number;
  return out;
}

/** `models: null` and `limits: null` clear what is stored, so the defaults apply again. */
export interface SettingsPatch { name?: string | null; aiProvider?: AiProvider; models?: Partial<InstallModels> | null; limits?: Partial<InstallLimits> | null }

/**
 * Checks what the owner sent. Answers the part to merge (only the fields that were sent), or a
 * sentence saying what to fix. Unknown fields are refused, so a typo never looks like a saved change.
 */
export function settingsPatch(input: unknown): SettingsPatch | string {
  if (!isObject(input)) return "Send the settings to change.";
  const unknown = Object.keys(input).filter((key) => !["name", "aiProvider", "models", "limits"].includes(key));
  if (unknown.length) return `Unknown setting: ${unknown[0]}.`;
  const patch: SettingsPatch = {};
  if (input.name !== undefined) {
    if (input.name !== null && typeof input.name !== "string") return "The name must be text.";
    const name = (input.name ?? "").trim();
    if (name.length > NAME_MAX) return `Keep the name under ${NAME_MAX} characters.`;
    patch.name = name || null;
  }
  if (input.aiProvider !== undefined) {
    if (!isProvider(input.aiProvider)) return "Choose OpenAI or TypeSafe as the AI provider.";
    patch.aiProvider = input.aiProvider;
  }
  if (input.models === null) {
    patch.models = null;
  } else if (input.models !== undefined) {
    if (!isObject(input.models)) return "Models must be a set of model names.";
    const models: Partial<InstallModels> = {};
    for (const [field, value] of Object.entries(input.models)) {
      if (!(MODEL_FIELDS as readonly string[]).includes(field)) return `Unknown model setting: ${field}.`;
      if (!isModel(value)) return `The ${field} model must be a model name (letters, numbers, dots and dashes).`;
      models[field as keyof InstallModels] = value.trim();
    }
    patch.models = models;
  }
  if (input.limits === null) {
    patch.limits = null;
  } else if (input.limits !== undefined) {
    if (!isObject(input.limits)) return "Limits must be a set of numbers.";
    const limits: Partial<InstallLimits> = {};
    for (const [field, value] of Object.entries(input.limits)) {
      if (!(LIMIT_FIELDS as readonly string[]).includes(field)) return `Unknown limit: ${field}.`;
      if (!isLimit(value)) return `${LIMIT_LABELS[field as keyof InstallLimits]} must be a number above zero.`;
      limits[field as keyof InstallLimits] = value;
    }
    patch.limits = limits;
  }
  if (!Object.keys(patch).length) return "Send the settings to change.";
  return patch;
}

/**
 * The new `install.settings`: the stored object with the patch laid over it. Only what was sent
 * changes; models and limits merge field by field; anything else stored there is kept.
 */
export function mergeSettings(current: unknown, patch: SettingsPatch): Record<string, unknown> {
  const base = isObject(current) ? { ...current } : {};
  if (patch.name !== undefined) {
    if (patch.name) base.name = patch.name; else delete base.name;
  }
  if (patch.aiProvider !== undefined) base.aiProvider = patch.aiProvider;
  if (patch.models === null) delete base.models;
  else if (patch.models) base.models = { ...(isObject(base.models) ? base.models : {}), ...patch.models };
  if (patch.limits === null) delete base.limits;
  else if (patch.limits) base.limits = { ...(isObject(base.limits) ? base.limits : {}), ...patch.limits };
  return base;
}

// MARK: Key state

/** A row of `install_secrets_meta`. */
export interface KeyMeta { name: string; last4: string | null; verified_at: string | null; status: string | null; message: string | null }

export const EMPTY_KEY: KeyState = { set: false, last4: null, verifiedAt: null, status: "unverified", message: null, source: null };

const status = (value: string | null | undefined): KeyStatus => (value === "ok" || value === "failed" ? value : "unverified");

/**
 * What the app may show about one key: never its value. `source` is where the value in use comes from
 * (_shared/keys.ts). A key from the environment has no last 4 characters; its check result is the meta
 * row's only when that row is about the environment's value (a row with last 4 characters describes a
 * copy stored in Vault, which the environment's value is hiding).
 */
export function keyState(source: "env" | "vault" | null, meta: KeyMeta | undefined): KeyState {
  if (!source) return { ...EMPTY_KEY };
  if (source === "env") {
    const mine = meta && meta.last4 === null ? meta : undefined;
    return { set: true, last4: null, verifiedAt: mine?.verified_at ?? null, status: status(mine?.status), message: mine?.message ?? null, source };
  }
  return { set: true, last4: meta?.last4 ?? null, verifiedAt: meta?.verified_at ?? null, status: status(meta?.status), message: meta?.message ?? null, source };
}

/**
 * The answer to `capabilities`. `modelEnv` holds the model names set as environment variables or
 * stored keys (`modelOverrides` in _shared/ai/models.ts); they win over the settings.
 */
export function installState(o: { role: InstallRole; owned: boolean; settings: unknown; keys: Record<string, KeyState>; modelEnv?: ModelEnv }): InstallState {
  const settings = readSettings(o.settings);
  return { role: o.role, owned: o.owned, ...settings, resolvedModels: resolveModels(settings.models, o.modelEnv ?? {}), keys: o.keys };
}

// MARK: Members

export const isEmail = (value: unknown): value is string => typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
export const isUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** A fresh secret for the desktop runner: 32 random bytes, URL-safe. */
export function newRunnerSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let raw = "";
  for (const b of bytes) raw += String.fromCharCode(b);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
