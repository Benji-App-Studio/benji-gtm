import { ACCOUNT_STEPS, installOwned, isEmail, managementApi, provision, type ProgressEvent, type StepId } from "@/lib/server/provision";
import { isResponse } from "@/lib/server/auth";
import { NO_STORE, provisionDeps, readSetupBody, refuse, refuseError, setupCaller, targetRef } from "@/lib/server/provision/request-access";
import { createClient } from "@/lib/supabase/server";

const CONNECT_STEPS: readonly StepId[] = ["project", "keys", "config"];

/**
 * The last step of a first run: creates the owner's account in the person's own project, closes
 * sign-up, turns on the scheduled jobs, saves the connection on this computer and signs the owner in.
 * With `connectOnly` (a project that already has an owner) it only saves the connection.
 * The password goes to the person's Supabase project and nowhere else.
 */
export async function POST(request: Request) {
  const caller = await setupCaller(request);
  if (isResponse(caller)) return caller;
  if (caller.mode !== "first-run") return refuse(409, "This install already has its owner.");
  const input = await readSetupBody(request);
  if (isResponse(input)) return input;
  const ref = targetRef(caller, input.body);
  if (isResponse(ref)) return ref;
  const connectOnly = input.body.connectOnly === true;
  const email = typeof input.body.email === "string" ? input.body.email.trim() : "";
  const password = typeof input.body.password === "string" ? input.body.password : "";
  if (!connectOnly) {
    if (!isEmail(email)) return refuse(400, "That doesn't look like an email address. Check it for typos.");
    if (password.length < 8) return refuse(400, "Use a password with at least 8 characters.");
  }
  let deps;
  try { deps = provisionDeps(); } catch (error) { return refuseError(error); }
  // "Connect only" is for a project that already has its owner. The browser's word isn't enough:
  // without this check a prepared project with no owner would be connected and left ownerless.
  if (connectOnly) {
    try {
      if (!(await installOwned(managementApi(deps.fetch, input.token), ref))) return refuse(409, "This project doesn't have an owner yet. Create your account to finish setup.");
    } catch (error) { return refuseError(error); }
  }

  const events: ProgressEvent[] = [];
  const result = await provision(
    { accessToken: input.token, ref, steps: connectOnly ? CONNECT_STEPS : ACCOUNT_STEPS, owner: connectOnly ? undefined : { email, password }, appOrigin: caller.appOrigin ?? undefined },
    deps,
    (event) => events.push(event),
  );
  if (!result.ok) return Response.json({ error: result.failed?.message ?? "Setup stopped. Try again.", detail: result.failed?.detail, events }, { status: result.failed?.code === "owner_exists" ? 409 : 502, headers: NO_STORE });
  if (connectOnly) return Response.json({ ok: true, signedIn: false, events }, { headers: NO_STORE });

  // The connection now exists, so the owner can be signed in here and land in the app already inside.
  let signedIn = false;
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    signedIn = !error;
  } catch { signedIn = false; }
  return Response.json({ ok: true, signedIn, events }, { headers: NO_STORE });
}
