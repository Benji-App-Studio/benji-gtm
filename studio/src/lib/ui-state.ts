// Per-account UI choices kept on the account (profiles.ui_state, migration 20261120400000), so they
// survive sign-out (which clears the browser's storage) and other browsers: a closed getting-started guide
// per app, a closed first-visit explainer per page, the app the first run created, and the app a "New
// app" run (the same three steps, started from the app) created, kept apart so it never touches the first run's. The browser keeps
// a copy in localStorage for an instant first paint. Plain TypeScript, no imports; tested in
// ui-state.test.ts. The route is app/api/account/ui-state; the hook is lib/use-ui-state.ts.

/** The keys the app may store, and what each may hold. Anything else is refused. */
const KEYS: { pattern: RegExp; value: RegExp }[] = [
  { pattern: /^guide\.[0-9a-f-]{36}$/i, value: /^closed$/ },
  { pattern: /^explain\.(research|app-store|studio|launch|measure)$/, value: /^closed$/ },
  { pattern: /^onboarding\.draft$/, value: /^[0-9a-f-]{36}$/i },
  { pattern: /^newapp\.draft$/, value: /^[0-9a-f-]{36}$/i },
];

/** At most this many keys are kept (oldest guides go first). */
export const MAX_KEYS = 200;

export type UiState = Record<string, string>;

/** Whether `key` may hold `value` (null removes it). */
export function validUiEntry(key: unknown, value: unknown): key is string {
  if (typeof key !== "string" || key.length > 80) return false;
  const rule = KEYS.find((k) => k.pattern.test(key));
  if (!rule) return false;
  return value === null || (typeof value === "string" && rule.value.test(value));
}

/** A stored state, cleaned: only known keys with valid values. */
export function cleanUiState(raw: unknown): UiState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: UiState = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) if (validUiEntry(key, value) && typeof value === "string") out[key] = value;
  return out;
}

/** The state with one change applied (null removes the key), kept within MAX_KEYS. */
export function applyUiChange(state: UiState, key: string, value: string | null): UiState {
  const next = { ...state };
  delete next[key];
  if (value !== null) next[key] = value;
  const keys = Object.keys(next);
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_KEYS))) delete next[old];
  return next;
}

export const guideKey = (productId: string) => `guide.${productId}`;
export const explainKey = (page: string) => `explain.${page}`;
export const DRAFT_KEY = "onboarding.draft";
/** The app the "New app" run created (a second, third… app): its own key, so the first run's draft stays as it is. */
export const NEW_APP_DRAFT_KEY = "newapp.draft";
