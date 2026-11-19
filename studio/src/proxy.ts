import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getInstallConfig, readStoredOwner } from "@/lib/install/config";
import { decideProxy, isLocalMode, loginFor, signInStoredOwner, startedLocalOnly } from "@/lib/install/local-auth";

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

  const redirect = (to: string) => {
    const url = new URL(to, request.nextUrl.origin);
    const out = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => out.cookies.set(cookie));
    return out;
  };

  const decision = decideProxy({
    path, local, signedIn, storedOwner: Boolean(owner),
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
  // Static files, the generated icons (app/icon.tsx, app/apple-icon.tsx), API routes and the auth links skip this.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon$|apple-icon$|api/|auth/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
