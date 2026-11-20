// The sign-up throttle seam: an optional CAPTCHA on the forms that create or use an account. Off unless a
// deployment turns it on, so nothing changes for installs and local copies.
//
// To turn it on (accounts mode, public sign-up):
//   1. Supabase Dashboard > Authentication > Attack Protection: enable CAPTCHA protection with hCaptcha or
//      Cloudflare Turnstile and paste that provider's SECRET key there (Supabase checks every token).
//   2. Set CAPTCHA_PROVIDER (hcaptcha | turnstile) and CAPTCHA_SITE_KEY (the provider's public site key) on
//      the studio's deployment.
//   3. The auth form renders the provider's widget from `captchaConfig()` (handed down by the server page)
//      and passes the token with `withCaptcha(options, token)` to supabase.auth.signUp,
//      signInWithPassword and resetPasswordForEmail.
// Supabase Auth also rate-limits sign-ups and emails per IP on its own (Authentication > Rate Limits).
//
// Not for a copy in local mode: CAPTCHA protection in Supabase refuses EVERY password sign-in without a
// token, including the ones the server makes for the owner of a local copy (proxy.ts signInStoredOwner,
// lib/server/owner-session.ts serverSignIn, /api/local/sign-in), where nobody can solve a CAPTCHA. Such a
// copy then stops at its login page with "Turn off CAPTCHA for this project" (classifySignInError says
// "captcha"; components/local-login.tsx explains it). Turn it on only for an online deployment.
//
// Plain TypeScript with no imports: the server, the browser and the Node tests share it.

export type CaptchaProvider = "hcaptcha" | "turnstile";
export interface CaptchaConfig { provider: CaptchaProvider; siteKey: string }

/** The CAPTCHA to show, or null when the deployment hasn't configured one (read by name at run time). */
export function captchaConfig(env: Record<string, string | undefined> = process.env): CaptchaConfig | null {
  const provider = env["CAPTCHA_PROVIDER"]?.trim().toLowerCase();
  const siteKey = env["CAPTCHA_SITE_KEY"]?.trim();
  if ((provider !== "hcaptcha" && provider !== "turnstile") || !siteKey) return null;
  return { provider, siteKey };
}

/** Auth call options with the CAPTCHA token added when there is one (the options unchanged otherwise). */
export function withCaptcha<T extends object>(options: T | undefined, token: string | null | undefined): T & { captchaToken?: string } {
  const base = (options ?? {}) as T;
  const clean = typeof token === "string" ? token.trim() : "";
  return clean ? { ...base, captchaToken: clean } : base;
}
