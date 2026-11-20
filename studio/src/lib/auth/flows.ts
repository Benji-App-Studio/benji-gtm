// Sign-in, sign-up and password-reset rules that need no browser and no Next.js: which providers the
// Supabase project has switched on, where a link may send someone afterwards, and what each Supabase
// refusal means for the person in front of the screen. Shared by the forms, the /auth/confirm route,
// the server and the Node tests (studio/src/lib/auth/flows.test.ts).

// MARK: Which ways to sign in the project offers

export interface AuthProviders {
  /** "Continue with Google" works: the Google provider is switched on in the Supabase dashboard. */
  google: boolean;
  /** Email and password sign-in is switched on. */
  email: boolean;
  /** The project refuses new accounts (Authentication > Sign In / Providers > Allow new users to sign up). */
  signupDisabled: boolean;
}

/** What to assume when the settings can't be read: email only, as every project starts. */
export const DEFAULT_PROVIDERS: AuthProviders = { google: false, email: true, signupDisabled: false };

/**
 * Reads Supabase Auth's public settings (`GET /auth/v1/settings`), e.g.
 * `{ "external": { "google": true, "email": true, … }, "disable_signup": false }`.
 * Anything unexpected counts as "not switched on", so a button never shows for a provider that would fail.
 */
export function parseAuthProviders(body: unknown): AuthProviders {
  if (!body || typeof body !== "object") return DEFAULT_PROVIDERS;
  const settings = body as { external?: unknown; disable_signup?: unknown };
  const external = settings.external && typeof settings.external === "object" ? settings.external as Record<string, unknown> : {};
  return {
    google: external.google === true,
    email: external.email !== false,
    signupDisabled: settings.disable_signup === true,
  };
}

// MARK: Where to go after a link

const LEADS_INSIDE = /^\/(?![/\\])/;
/** A "." or ".." path segment, written plainly or as %2e. */
const DOT_SEGMENT = /(?:^|\/)(?:\.|%2e){1,2}(?:\/|$|[?#])/i;

/**
 * A path inside this app, or null. Refused: "//host" and "/\host"; a tab, line break or backslash
 * anywhere (browsers drop or rewrite them while reading an address, so "/<tab>/host" would become
 * "//host"); and any "." or ".." segment, plain or encoded, because resolving "/..//host" also yields
 * "//host". The result is checked again after the address is normalised, so what comes out can only
 * ever stay on this site.
 */
export function sanitizeNext(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !LEADS_INSIDE.test(value)) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\s\\\u0000-\u001f\u007f]/.test(value) || DOT_SEGMENT.test(value)) return null;
  try {
    const base = "https://app.invalid";
    const url = new URL(value, base);
    const path = `${url.pathname}${url.search}${url.hash}`;
    return url.origin === base && LEADS_INSIDE.test(url.pathname) ? path : null;
  } catch {
    return null;
  }
}

/** Where the login form goes after signing in: the page that was asked for, when it is safe, else the app. */
export const loginNext = (value: string | null | undefined): string => sanitizeNext(value) ?? "/app/w";

/** Where "Choose a new password" lives; the reset email's link comes back through /auth/confirm to it. */
export const UPDATE_PASSWORD_PATH = "/update-password";
export const FORGOT_PASSWORD_PATH = "/forgot-password";

/**
 * `/auth/confirm?next=…` on this site: the address the emails and Google send people back to. Google's
 * carries `via=google`, so a failure there is explained as a Google problem, not an expired email link.
 */
export function confirmUrl(origin: string, next: string, via?: "google"): string {
  return `${origin}/auth/confirm?next=${encodeURIComponent(sanitizeNext(next) ?? "/app")}${via ? `&via=${via}` : ""}`;
}

/** The ?error= values the login page explains; anything else gets a general message. */
export type LoginError = "confirm" | "oauth" | "signup_disabled" | "unknown";
export const loginError = (value: string | null | undefined): LoginError | null =>
  !value ? null : value === "confirm" || value === "oauth" || value === "signup_disabled" ? value : "unknown";

/**
 * Where /auth/confirm sends someone whose link or Google sign-in didn't work, so each case has its own
 * explanation and a way forward:
 *   new accounts are refused          → the login page, "this workspace doesn't take new sign-ups"
 *   a reset link                      → "Forgot your password?" again, with "that link expired"
 *   Google refused, cancelled or failed → the login page, "Google sign-in didn't finish"
 *   an email link                     → the login page, "that link expired or was used"
 */
export function confirmFailureTarget(input: { next: string | null; errorCode?: string | null; via?: string | null }): string {
  if (input.errorCode === "signup_disabled") return "/login?error=signup_disabled";
  if (input.next === UPDATE_PASSWORD_PATH) return `${FORGOT_PASSWORD_PATH}?error=expired`;
  if (input.via === "google") return "/login?error=oauth";
  return "/login?error=confirm";
}

const EMAIL_TYPES = ["signup", "invite", "magiclink", "recovery", "email_change", "email"] as const;
export type EmailLinkType = (typeof EMAIL_TYPES)[number];

export interface ConfirmQuery {
  next: string | null; code: string | null; tokenHash: string | null; type: string | null;
  error: string | null; errorCode: string | null; via: string | null;
  /** The person already chose "Sign out and continue" on /switch-account. */
  switchAccount: boolean;
}

export type ConfirmStep =
  | { action: "fail"; to: string }
  /** Someone else is signed in in this browser: ask before their session is replaced. */
  | { action: "ask"; to: string }
  | { action: "exchange"; code: string; then: string; failTo: string }
  | { action: "verify"; tokenHash: string; type: EmailLinkType; signOutFirst: boolean; then: string; failTo: string };

/**
 * What /auth/confirm does with one request (pure, so the tests can walk every case). `signedIn` is
 * whether a session already exists in this browser. A PKCE `code` belongs to this browser's own
 * request, so it never asks; an emailed `token_hash` link may be for another account.
 */
export function confirmStep(query: ConfirmQuery, signedIn: boolean): ConfirmStep {
  const next = sanitizeNext(query.next);
  const then = next ?? "/onboarding";
  const failTo = confirmFailureTarget({ next, errorCode: query.errorCode, via: query.via });
  if (query.error || query.errorCode) return { action: "fail", to: failTo };
  if (query.code) return { action: "exchange", code: query.code, then, failTo };
  const type = EMAIL_TYPES.find((known) => known === query.type);
  if (!query.tokenHash || !type) return { action: "fail", to: failTo };
  // Confirming a new address is done while signed in to that same account: no question.
  if (signedIn && type !== "email_change" && !query.switchAccount) {
    const params = new URLSearchParams({ token_hash: query.tokenHash, type, ...(next ? { next } : {}) });
    return { action: "ask", to: `/switch-account?${params.toString()}` };
  }
  return { action: "verify", tokenHash: query.tokenHash, type, signOutFirst: signedIn && type !== "email_change", then, failTo };
}

// MARK: What a Supabase refusal means

/** The part of a Supabase auth error this looks at (AuthError and friends). */
export interface AuthErrorLike { status?: number; code?: string; name?: string; message?: string }

export type AuthProblem =
  | "invalid_credentials"   // wrong email or password (or an account made with Google, which has no password)
  | "email_not_confirmed"   // signed up, link not clicked yet
  | "rate_limited"          // too many tries or too many emails: wait
  | "weak_password"
  | "same_password"         // the new password is the old one
  | "email_exists"          // sign-up with an address that already has an account
  | "link_expired"          // a confirmation or reset link that expired, was used, or was opened in another browser
  | "signup_disabled"
  | "invalid_email"         // the address isn't complete (checked in the form before anything is sent)
  | "email_rejected"        // a complete address the project refused (a blocked or test domain such as example.com)
  | "email_send_failed"     // the project couldn't send the email (no email server set up, or it refused this address)
  | "provider_disabled"     // Google (or email) is switched off on the project
  | "session_missing"       // the reset session is gone: ask for a new link
  | "captcha"               // the security check (lib/install/captcha.ts) wasn't done, or failed
  | "network"
  | "unknown";

const BY_CODE: Record<string, AuthProblem> = {
  invalid_credentials: "invalid_credentials",
  email_not_confirmed: "email_not_confirmed",
  over_email_send_rate_limit: "rate_limited",
  over_request_rate_limit: "rate_limited",
  over_sms_send_rate_limit: "rate_limited",
  weak_password: "weak_password",
  same_password: "same_password",
  user_already_exists: "email_exists",
  email_exists: "email_exists",
  identity_already_exists: "email_exists",
  otp_expired: "link_expired",
  flow_state_not_found: "link_expired",
  flow_state_expired: "link_expired",
  bad_code_verifier: "link_expired",
  signup_disabled: "signup_disabled",
  email_address_invalid: "email_rejected",
  email_address_not_authorized: "email_send_failed",
  provider_disabled: "provider_disabled",
  email_provider_disabled: "provider_disabled",
  session_not_found: "session_missing",
  session_expired: "session_missing",
  captcha_failed: "captcha",
};

/** Older Supabase servers send no code: the message decides. */
const BY_MESSAGE: [RegExp, AuthProblem][] = [
  [/invalid login credentials/i, "invalid_credentials"],
  [/email not confirmed/i, "email_not_confirmed"],
  [/rate limit|only request this after|too many requests/i, "rate_limited"],
  [/password should|weak password|password is known/i, "weak_password"],
  [/different from the old password/i, "same_password"],
  [/already registered|already exists|already been registered/i, "email_exists"],
  [/expired|invalid or has expired|code verifier|flow state/i, "link_expired"],
  [/signups not allowed|sign ?ups? (are )?disabled/i, "signup_disabled"],
  [/error sending|sending (confirmation|recovery|magic link) email|not authorized/i, "email_send_failed"],
  [/invalid.*email|email.*invalid|unable to validate email/i, "email_rejected"],
  [/provider is not enabled|unsupported provider/i, "provider_disabled"],
  [/auth session missing/i, "session_missing"],
  [/captcha/i, "captcha"],
  [/failed to fetch|network|load failed/i, "network"],
];

export function classifyAuthError(error: AuthErrorLike | null | undefined): AuthProblem {
  if (!error) return "unknown";
  if (error.code && BY_CODE[error.code]) return BY_CODE[error.code];
  if (error.status === 429) return "rate_limited";
  if (error.name === "AuthSessionMissingError") return "session_missing";
  if (error.name === "AuthRetryableFetchError") return "network";
  const message = error.message ?? "";
  for (const [pattern, problem] of BY_MESSAGE) if (pattern.test(message)) return problem;
  if (error.code === "unexpected_failure" && /email/i.test(message)) return "email_send_failed";
  return "unknown";
}

/**
 * How long to wait before asking again, from Supabase's "you can only request this after 42 seconds".
 * null when the error doesn't say; callers then wait their own default.
 */
export function retryAfterSeconds(error: AuthErrorLike | null | undefined): number | null {
  const match = /after\s+(\d+)\s*seconds?/i.exec(error?.message ?? "");
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) : null;
}

/** Seconds between two emails sent from the same screen (Supabase's own default is 60). */
export const RESEND_COOLDOWN = 60;

// MARK: Sign-up's answer

export interface SignUpData {
  session: unknown;
  user: { identities?: unknown[] | null } | null;
}

/**
 * What a successful sign-up call means:
 *   "signed-in"  no email confirmation on the project: carry on to onboarding
 *   "confirm"    show "Check your inbox". That includes an address that already has an account: Supabase
 *                answers it like a new sign-up (with no identities) so nobody can test which addresses
 *                exist, and the screen says the same thing either way.
 */
export function signUpOutcome(data: SignUpData | null | undefined): "signed-in" | "confirm" {
  return data?.session ? "signed-in" : "confirm";
}

// MARK: Which ways in to offer

/**
 * "Continue with Google" shows when the project has Google switched on and this install takes new
 * accounts (signupOpen(), the one switch). Google signs new people up as it signs them in, so a closed
 * install, where the owner adds people, offers email and password only.
 */
export const showGoogle = (providers: Pick<AuthProviders, "google">, signupOpen: boolean): boolean => providers.google && signupOpen;

// MARK: The profile's name

/** The name Google (or the sign-up form) gave: `full_name`, then `name`, then given + family name. */
export function nameFromMetadata(meta: Record<string, unknown> | null | undefined): string {
  const pick = (key: string) => (typeof meta?.[key] === "string" ? (meta[key] as string).trim() : "");
  return pick("full_name") || pick("name") || [pick("given_name"), pick("family_name")].filter(Boolean).join(" ");
}

/** A simple check before sending a form, so an obvious typo gets a clear message instead of a server error. */
export const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
