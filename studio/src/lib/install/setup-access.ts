// Who may see /setup. On an install (an owner and members) it is the first-run checklist and then the
// owner's Updates view. On a database that hosts separate accounts (accounts mode, the public service)
// there is no install of anyone's to set up or update: the updates are ours to apply, so only staff see
// the Updates view, and everyone else, signed in or not, is sent to the front page.
//
// The desktop runner is the same: the platform's in accounts mode, so only staff are asked to set it up.
//
// No Next.js imports, so the Node tests share it (setup-access.test.ts).

import { isAccountsMode, isStaff, type InstallState } from "./types";

export type SetupAccess = { view: "install" } | { view: "updates" } | { view: "redirect"; to: string };

export function setupAccess({ accounts, staff }: { accounts: boolean; staff: boolean }): SetupAccess {
  if (!accounts) return { view: "install" };
  return staff ? { view: "updates" } : { view: "redirect", to: "/" };
}

/**
 * The tab title of a Settings page only staff use in accounts mode (Desktop runner, Updates): an account
 * that isn't staff sees "This page isn't available", so its tab shows `fallback` instead of the page's name.
 */
export const staffOnlyTitle = ({ accounts, staff }: { accounts: boolean; staff: boolean }, title: string, fallback: string): string =>
  accounts && !staff ? fallback : title;

/** Whether the desktop runner is this person's to set up: anywhere but an account other than staff in accounts mode. */
export const runnerOffered = (install: InstallState | null | undefined): boolean => !(isAccountsMode(install) && !isStaff(install));
