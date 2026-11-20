// Where the signed-in pages send someone, as plain decisions (the layouts and pages ask the database,
// these say what the answers mean). Kept here so a Node test can follow every redirect together with the
// proxy's (lib/install/local-auth.ts decideProxy) and prove none of them loops
// (studio/src/lib/auth/session-gate.test.ts).
//
// The case that looped: an account deleted (or a session ended) while the browser still holds an access
// token that hasn't expired. The proxy and the app layout check the token locally (getClaims) and see
// someone signed in; the onboarding layout asks Supabase (getUser) and sees no one. So /login sent to
// /app/w, /app/w (no profile any more) to /onboarding, and /onboarding back to /login, forever. Now a
// layout that finds no profile asks Supabase whether the user still exists and, when not, sends the
// browser to SESSION_ENDED_PATH, which clears the dead session's cookies before the login page.

/** A locked account (its deletion started and hasn't finished) carries the deletion on here. */
export const FINISH_DELETION_PATH = "/delete-account";
/** Clears a session whose user no longer exists, then opens the login page (app/auth/ended/route.ts). */
export const SESSION_ENDED_PATH = "/auth/ended";

/** The signed-in app's layout (app/app/layout.tsx). null: show the page. */
export function appLayoutRedirect(input: {
  /** The token in the cookies is valid (getClaims). */
  signedIn: boolean;
  /** The person's profile, or null when it can't be read (locked, deleted, or never made). */
  profile: { onboarded: boolean } | null;
  /** Asked only when there is no profile: the account is being deleted. */
  deletionPending?: boolean;
  /** Asked only when there is no profile and no deletion: Supabase still knows the user (getUser). */
  userExists?: boolean;
}): string | null {
  if (!input.signedIn) return "/login?next=/app/w";
  if (!input.profile) {
    if (input.deletionPending) return FINISH_DELETION_PATH;
    if (input.userExists === false) return SESSION_ENDED_PATH;
    return "/onboarding";
  }
  return input.profile.onboarded ? null : "/onboarding";
}

/** The first run's layout (app/onboarding/layout.tsx). null: show the page. */
export function onboardingLayoutRedirect(input: {
  /** Supabase knows the user behind the session (getUser). */
  userExists: boolean;
  profile: { onboarded: boolean } | null;
  deletionPending?: boolean;
}): string | null {
  // The proxy has already sent anyone with no session to the login page, so a missing user here is a
  // session that outlived its account: clear it (the login page would send it straight back otherwise).
  if (!input.userExists) return SESSION_ENDED_PATH;
  if (input.profile?.onboarded) return "/app/w";
  if (!input.profile && input.deletionPending) return FINISH_DELETION_PATH;
  return null;
}

/** /delete-account. null: show the page. */
export function finishDeletionRedirect(input: { signedIn: boolean; deletionPending: boolean }): string | null {
  if (!input.signedIn) return "/login";
  return input.deletionPending ? null : "/app";
}

/**
 * SESSION_ENDED_PATH: where to go once the dead session is cleared (a live one goes back to the app
 * untouched). `afterDeletion`: the page that was deleting this account asked (?then=goodbye) and Supabase
 * says the account no longer exists, so the deletion finished (in a call whose answer the page never got):
 * the goodbye page, not the login page.
 */
export function sessionEndedRedirect(userExists: boolean, afterDeletion = false): string {
  if (userExists) return "/app/w";
  return afterDeletion ? "/goodbye" : "/login";
}

/**
 * A 303 to `path` on whatever host the browser is on: a relative Location, so a server reached through a
 * proxy (or under several names) never sends the browser to its own bind address, where this site's
 * cookies and language aren't. `Response` is NextResponse (passed in, so this file stays plain TypeScript).
 */
export function sameSiteRedirect<R>(Response: new (body: null, init: ResponseInit) => R, path: string): R {
  if (!/^\/(?![/\\])/.test(path)) throw new Error(`Not a path on this site: ${path}`);
  return new Response(null, { status: 303, headers: { Location: path } });
}

/** Where the deletion page goes when a call answers 401 part way: the account may be gone already. */
export const DELETION_ENDED_PATH = `${SESSION_ENDED_PATH}?then=goodbye`;
