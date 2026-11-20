// Local mode: a copy run on its owner's own computer opens straight into the app, with no login page.
// A real Supabase session is still made under the hood (row-level security and the edge functions
// need one): the proxy signs the owner in with the sign-in kept in the local config file.
//
// Local mode needs all three:
//   - the install config comes from the local file (a hosted copy uses environment variables),
//   - the app was started on this computer only (release/start.command sets INSTALL_SETUP_LOCAL=1),
//   - the request's Host is a loopback name (so a page from another site can't reach in by DNS rebinding).
// Anything else is online mode, which keeps the normal login.
//
// Pure (no Next.js, no `server-only`), so proxy.ts, the routes and the tests share one set of rules.
import { isLocalRequest } from "../server/provision/guard";

/** True when the app was started bound to this computer only (see release/start.command). */
export function startedLocalOnly(): boolean {
  const env = process.env;
  return env["INSTALL_SETUP_LOCAL"] === "1";
}

export interface LocalModeInput {
  /** Where the install config came from; null before setup. */
  source: "env" | "file" | null | undefined;
  startedLocal: boolean;
  host: string | null | undefined;
  /** The connecting address, when the server reports it. */
  forwardedFor?: string | null;
  /** Sent by browsers on POST requests: when present it must be this computer too. */
  origin?: string | null;
}

export function isLocalMode(input: LocalModeInput): boolean {
  if (input.source !== "file" || !input.startedLocal) return false;
  return isLocalRequest({ host: input.host ?? null, origin: input.origin ?? null, forwardedFor: input.forwardedFor ?? null });
}

/**
 * A path inside this app, or null: "//host" and "/\\host" would leave the site, and so would a tab or
 * line break anywhere ("/<tab>/host": browsers drop them while reading the address) or a "." / ".."
 * segment, plain or as %2e (resolving "/..//host" gives "//host"). The same rules as sanitizeNext in
 * lib/auth/flows.ts.
 */
export function safeNext(value: string | null | undefined): string | null {
  if (!value || !/^\/(?![/\\])/.test(value)) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\s\\\u0000-\u001f\u007f]/.test(value) || /(?:^|\/)(?:\.|%2e){1,2}(?:\/|$|[?#])/i.test(value)) return null;
  return value;
}

// MARK: Signing in with the stored owner

/** Why automatic sign-in didn't happen. Each one has its own screen on /login with a way forward. */
export type LoginReason = "no-owner" | "signin" | "unreachable" | "captcha";
export const LOGIN_REASONS: readonly LoginReason[] = ["no-owner", "signin", "unreachable", "captcha"];
export const isLoginReason = (value: unknown): value is LoginReason => typeof value === "string" && (LOGIN_REASONS as readonly string[]).includes(value);

/** The part of a Supabase auth error this looks at. */
export interface SignInErrorLike { status?: number; code?: string; name?: string; message?: string }

/**
 * Wrong password and deleted account both come back from Supabase as "invalid credentials" (it never
 * says which); a paused or unreachable project comes back as a network error or a 5xx.
 */
export function classifySignInError(error: SignInErrorLike | null | undefined): "signin" | "unreachable" | "captcha" {
  if (!error) return "unreachable";
  // Supabase's CAPTCHA protection (lib/install/captcha.ts) refuses every sign-in without a token, and a
  // copy in local mode signs its owner in on the server, where there is no CAPTCHA to solve.
  if (error.code === "captcha_failed" || /captcha/i.test(error.message ?? "")) return "captcha";
  const status = typeof error.status === "number" ? error.status : 0;
  if (error.name === "AuthRetryableFetchError" || status === 0 || status >= 500) return "unreachable";
  return "signin";
}

export interface PasswordSignIn {
  signInWithPassword(credentials: { email: string; password: string }): Promise<{ error: SignInErrorLike | null }>;
}

/** Signs in with the stored owner. The password is used for this call only and never appears in the result. */
export async function signInStoredOwner(auth: PasswordSignIn, owner: { email: string; password: string }): Promise<{ ok: true } | { ok: false; reason: "signin" | "unreachable" | "captcha" }> {
  try {
    const { error } = await auth.signInWithPassword({ email: owner.email, password: owner.password });
    return error ? { ok: false, reason: classifySignInError(error) } : { ok: true };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}

// MARK: Sign-up

/**
 * Whether people may create their own account: always on a database in accounts mode (public sign-up,
 * each account brings its own keys), otherwise only when the deployment sets ALLOW_SIGNUP=1.
 */
export function signupAllowed(input: { allowSignup: string | undefined | null; accounts: boolean }): boolean {
  return input.accounts || input.allowSignup === "1";
}

// MARK: What the proxy does with a request

export const PROTECTED = ["/app", "/onboarding"];
export const AUTH_PAGES = ["/login", "/signup"];
const under = (path: string, prefixes: string[]) => prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));

export interface ProxyInput {
  path: string;
  /** The query string's `next` and `reason`. */
  next: string | null;
  reason: string | null;
  local: boolean;
  signedIn: boolean;
  /** Whether the local config holds the owner's sign-in. */
  storedOwner: boolean;
  /**
   * Whether sign-up is open (signupAllowed). Asked only for /signup by someone signed out; undefined when
   * not asked, which leaves the page to decide (it checks again).
   */
  signupOpen?: boolean;
}

export type ProxyDecision =
  | { action: "next" }
  | { action: "redirect"; to: string }
  /** Sign in with the stored owner; on success do `then`, on failure redirect to `/login` with the reason (or, with `quiet`, carry on). */
  | { action: "sign-in"; then: { action: "next" } | { action: "redirect"; to: string }; failNext: string; quiet?: boolean };

/** `/login?reason=…&next=…`: the screen for a sign-in that couldn't happen by itself. */
export function loginFor(reason: LoginReason | null, next: string | null): string {
  const params = new URLSearchParams();
  if (reason) params.set("reason", reason);
  if (next) params.set("next", next);
  const query = params.toString();
  return `/login${query ? `?${query}` : ""}`;
}

/**
 * The proxy's decision for one request (the install is connected). Online mode is the normal login;
 * local mode signs the owner in by itself and only shows /login when that can't happen.
 */
export function decideProxy(input: ProxyInput): ProxyDecision {
  const { path, local, signedIn } = input;
  const next = safeNext(input.next);
  const isAuthPage = AUTH_PAGES.includes(path);
  const isProtected = under(path, PROTECTED);

  if (!local) {
    // The site root is the public landing page; someone signed in goes straight to the app.
    if (path === "/") return signedIn ? { action: "redirect", to: "/app" } : { action: "next" };
    if (!signedIn && isProtected) return { action: "redirect", to: loginFor(null, path) };
    if (signedIn && isAuthPage) return { action: "redirect", to: "/app/w" };
    // A closed install has no sign-up page: straight to the login (keeping where they were going).
    if (!signedIn && path === "/signup" && input.signupOpen === false) return { action: "redirect", to: loginFor(null, next) };
    return { action: "next" };
  }

  if (signedIn) return isAuthPage ? { action: "redirect", to: next ?? "/app" } : { action: "next" };
  // A login screen that explains a failed automatic sign-in is shown as it is (its Try again button
  // goes back through here).
  if (isAuthPage && isLoginReason(input.reason)) return { action: "next" };
  const isSetup = path === "/setup" || path.startsWith("/setup/");
  const wanted = isAuthPage || path === "/" ? next ?? "/app" : path;
  if (isAuthPage || path === "/" || isProtected) {
    if (!input.storedOwner) return { action: "redirect", to: loginFor("no-owner", wanted === "/app" ? null : wanted) };
    return { action: "sign-in", then: isProtected ? { action: "next" } : { action: "redirect", to: wanted }, failNext: wanted };
  }
  // The setup page signs the owner in when it can, and otherwise explains what to do itself.
  if (isSetup && input.storedOwner) return { action: "sign-in", then: { action: "next" }, failNext: path, quiet: true };
  return { action: "next" };
}
