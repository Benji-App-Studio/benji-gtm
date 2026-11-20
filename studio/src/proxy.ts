import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getInstallConfig, readStoredOwner } from "@/lib/install/config";
import { decideProxy, isLocalMode, loginFor, signInStoredOwner, signupAllowed, startedLocalOnly } from "@/lib/install/local-auth";
import { accountsMode } from "@/lib/install/mode";
import { navRedirect } from "@/lib/nav-model";
import { LANG_PARAM, localeFromQuery, queryLocaleCookie } from "@/lib/i18n/query-locale";
import { needsSavedLocale, savedLocaleCookies } from "@/lib/i18n/saved-locale";
import { LOCALE_COOKIE } from "@/lib/storage-keys";

/**
 * Keeps the Supabase session fresh on every request and guards the signed-in parts of the app. On a copy
 * run on its owner's own computer (local mode, lib/install/local-auth.ts) it also signs the owner in by
 * itself, so there is no login page there.
 */
export async function proxy(request: NextRequest) {
  // A fresh copy has no Supabase project yet: everything leads to the setup checklist.
  const config = getInstallConfig();
  const onSetup = request.nextUrl.pathname === "/setup" || request.nextUrl.pathname.startsWith("/setup/");
  if (!config) {
    if (onSetup) return NextResponse.next({ request });
    const url = request.nextUrl.clone();
    url.pathname = "/setup";
    url.search = "";
    return NextResponse.redirect(url);
  }
  // Confirmation links can land on the site root (Supabase's Site URL) with a code: finish sign-in.
  if (request.nextUrl.pathname === "/" && request.nextUrl.searchParams.has("code")) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/confirm";
    if (!url.searchParams.has("next")) url.searchParams.set("next", "/onboarding");
    return NextResponse.redirect(url);
  }
  // Addresses from before the journey-ordered navigation (lib/nav-model.ts) go to their new place with
  // their query, as a real redirect before anything renders. /app itself opens the last app's Home.
  const moved = navRedirect(request.nextUrl.pathname, request.nextUrl.search);
  if (moved) return NextResponse.redirect(new URL(moved, request.nextUrl.origin));
  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.supabaseUrl, config.publishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  // getClaims checks the session's signed JWT locally (no round trip to Supabase on every click);
  // it only goes to the network to refresh an expired session.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const path = request.nextUrl.pathname;
  const local = isLocalMode({
    source: config.source, startedLocal: startedLocalOnly(),
    host: request.headers.get("host"), forwardedFor: request.headers.get("x-forwarded-for"),
  });
  // The stored sign-in is read only when it may be used: local mode, nobody signed in.
  const owner = local && !signedIn ? readStoredOwner() : null;

  // The language saved on the profile follows the person to a browser with no language cookie yet: read
  // once, then the cookie (or a session-long "checked" marker) means no further reads.
  const userId = data?.claims?.sub;
  if (userId && needsSavedLocale({ signedIn, path, cookies: request.cookies })) {
    const { data: profile, error } = await supabase.from("profiles").select("locale").eq("id", userId).maybeSingle<{ locale: string | null }>();
    const { cookies: toSet } = savedLocaleCookies(error ? null : profile?.locale);
    const kept = response.cookies.getAll();
    // On the request too, so this very page renders in the saved language.
    toSet.forEach(({ name, value }) => request.cookies.set(name, value));
    response = NextResponse.next({ request });
    kept.forEach((cookie) => response.cookies.set(cookie));
    toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
  }

  // A language in the address (/?lang=ja, the landing page's hreflang links) becomes the language cookie:
  // on the request so this page renders in it, and on the response so it sticks (lib/i18n/query-locale.ts).
  const asked = localeFromQuery(request.nextUrl.searchParams.get(LANG_PARAM));
  if (asked && request.cookies.get(LOCALE_COOKIE)?.value !== asked) {
    const cookie = queryLocaleCookie(asked);
    const kept = response.cookies.getAll();
    request.cookies.set(cookie.name, cookie.value);
    response = NextResponse.next({ request });
    kept.forEach((c) => response.cookies.set(c));
    response.cookies.set(cookie.name, cookie.value, cookie.options);
  }

  const redirect = (to: string) => {
    const url = new URL(to, request.nextUrl.origin);
    const out = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => out.cookies.set(cookie));
    return out;
  };

  // Asked only for the sign-up page, by someone signed out (one cached request a minute).
  const env = process.env;
  const signupOpen = path === "/signup" && !signedIn && !local
    ? signupAllowed({ allowSignup: env["ALLOW_SIGNUP"], accounts: env["ALLOW_SIGNUP"] === "1" ? false : await accountsMode(config) })
    : undefined;
  const decision = decideProxy({
    path, local, signedIn, storedOwner: Boolean(owner), signupOpen,
    next: request.nextUrl.searchParams.get("next"), reason: request.nextUrl.searchParams.get("reason"),
  });
  if (decision.action === "next") return response;
  if (decision.action === "redirect") return redirect(decision.to);
  // Automatic sign-in: the same client, so the session cookies land on this response.
  const result = owner ? await signInStoredOwner(supabase.auth, owner) : { ok: false as const, reason: "signin" as const };
  if (result.ok) return decision.then.action === "next" ? response : redirect(decision.then.to);
  if (decision.quiet) return response;
  return redirect(loginFor(result.reason, decision.failNext === "/app" ? null : decision.failNext));
}

export const config = {
  // Static files, the generated icons (app/icon.tsx, app/apple-icon.tsx), the share picture (app/og-image) and
  // robots.txt, API routes and the auth links skip this.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon$|apple-icon$|og-image$|robots\\.txt$|api/|auth/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
