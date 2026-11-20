import "server-only";
// Accounts mode (the public service): whether the signed-in person is our staff, and the tab title of a
// Settings page only staff use (an account sees "This page isn't available", so the tab mustn't name the
// Desktop runner or Updates either).
import { getInstallConfig } from "@/lib/install/config";
import { accountsMode } from "@/lib/install/mode";
import { staffOnlyTitle } from "@/lib/install/setup-access";
import type { InstallState } from "@/lib/install/types";
import { isResponse, requireUser } from "@/lib/server/auth";
import { callFunction } from "@/lib/server/functions";

/** Whether the signed-in person is staff (the install function's capabilities say so). */
export async function staffViewer(): Promise<boolean> {
  const session = await requireUser();
  if (isResponse(session)) return false;
  const result = await callFunction<InstallState>("install", session, "capabilities");
  return result.ok && Boolean(result.data.plan?.staff);
}

/** The page's own title, or `fallback` for an account in accounts mode that isn't staff. */
export async function staffPageTitle(title: string, fallback: string): Promise<string> {
  const config = getInstallConfig();
  const accounts = config ? await accountsMode(config) : false;
  return staffOnlyTitle({ accounts, staff: accounts && await staffViewer() }, title, fallback);
}
