import "server-only";
// Whether people may create their own account. An install set up through /setup has one owner and is
// closed: the owner adds people in Settings > Members. A database in accounts mode (each account its
// own, lib/install/mode.ts) is open to everyone. A hosted deployment that wants open sign-up otherwise
// sets ALLOW_SIGNUP=1 (its Supabase project must allow sign-ups too).
import { getInstallConfig } from "./config";
import { signupAllowed } from "./local-auth";
import { accountsMode } from "./mode";

export async function signupOpen(): Promise<boolean> {
  const env = process.env;
  if (signupAllowed({ allowSignup: env["ALLOW_SIGNUP"], accounts: false })) return true;
  return signupAllowed({ allowSignup: undefined, accounts: await accountsMode(getInstallConfig()) });
}
