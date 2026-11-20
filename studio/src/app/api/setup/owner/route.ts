import { getTranslator } from "@/lib/i18n/server";
import { writeStoredOwner } from "@/lib/install/config";
import { completeAccountStep, isEmail } from "@/lib/server/provision";
import { isResponse } from "@/lib/server/auth";
import { NO_STORE, provisionDeps, readSetupBody, refuse, refuseError, setupCaller, targetRef } from "@/lib/server/provision/request-access";
import { serverSignIn } from "@/lib/server/owner-session";

/**
 * The account step of a first run: creates the owner's account in the person's own project with the
 * email and password they typed, closes sign-up, turns on the scheduled jobs, saves the connection on
 * this computer, signs the owner in and keeps the sign-in in the local config, so the app signs them in
 * by itself on this computer from then on.
 * With `connectOnly` (a project that already has an owner, e.g. on a new computer) it saves the
 * connection and sets the owner's password to the one typed, with the same token.
 * The password goes to the person's Supabase project and the local config file, and nowhere else.
 */
export async function POST(request: Request) {
  const caller = await setupCaller(request);
  if (isResponse(caller)) return caller;
  const { t } = await getTranslator();
  if (caller.mode !== "first-run") return refuse(409, t("This install already has its owner."));
  const input = await readSetupBody(request);
  if (isResponse(input)) return input;
  const ref = targetRef(caller, input.body);
  if (isResponse(ref)) return ref;
  const connectOnly = input.body.connectOnly === true;
  const email = typeof input.body.email === "string" ? input.body.email.trim() : "";
  const password = typeof input.body.password === "string" ? input.body.password : "";
  if (!connectOnly && !isEmail(email)) return refuse(400, t("That doesn't look like an email address. Check it for typos."));
  if (password.length < 8) return refuse(400, t("Use a password with at least 8 characters."));
  let deps;
  try { deps = provisionDeps(); } catch (error) { return refuseError(error); }

  const result = await completeAccountStep(
    { accessToken: input.token, ref, connectOnly, email, password, appOrigin: caller.appOrigin ?? undefined },
    { provision: deps, signIn: async (who, secret) => (await serverSignIn(who, secret)).ok, rememberOwner: writeStoredOwner },
  );
  if (!result.ok) return Response.json({ error: result.error, detail: result.detail, code: result.code, events: result.events }, { status: result.status, headers: NO_STORE });
  // The email only: the page already has the password it sent, and shows both once.
  return Response.json({ ok: true, signedIn: result.signedIn, email: result.email, events: result.events }, { headers: NO_STORE });
}
