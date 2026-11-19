import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getInstallConfig } from "@/lib/install/config";

const PROTECTED = ["/app", "/onboarding"];
const AUTH_PAGES = ["/login", "/signup"];

/** Keeps the Supabase session fresh on every request and guards the signed-in parts of the app. */
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
  const user = data?.claims?.sub ? data.claims : null;
  const path = request.nextUrl.pathname;
  const redirect = (to: string) => {
    const url = request.nextUrl.clone();
    url.pathname = to;
    url.search = to === "/login" ? `?next=${encodeURIComponent(path)}` : "";
    const out = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => out.cookies.set(cookie));
    return out;
  };
  if (!user && PROTECTED.some((p) => path === p || path.startsWith(`${p}/`))) return redirect("/login");
  if (user && AUTH_PAGES.includes(path)) return redirect("/app/w");
  return response;
}

export const config = {
  // Static files, the generated icons (app/icon.tsx, app/apple-icon.tsx), API routes and the auth links skip this.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon$|apple-icon$|api/|auth/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
