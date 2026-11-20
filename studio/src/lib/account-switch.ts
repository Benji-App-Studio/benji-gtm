// Whether the browser's session now belongs to another account than the one a page was loaded for
// (someone signed in as someone else in another tab). Only a change from one known account to another
// counts: signing out is the session check's to handle (components/nav/session.tsx), and a page that
// couldn't read the account at load has nothing to compare. Plain TypeScript (tested in
// studio/src/lib/account-switch.test.ts).
export function accountSwitched(loadedFor: string | null | undefined, now: string | null | undefined): boolean {
  return Boolean(loadedFor && now && loadedFor !== now);
}
