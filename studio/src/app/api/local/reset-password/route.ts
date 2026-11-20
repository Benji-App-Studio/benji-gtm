import { getTranslator } from "@/lib/i18n/server";
import { getInstallConfig, projectRef, readStoredOwner, writeStoredOwner } from "@/lib/install/config";
import { isEmail, localReset, ProvisionError } from "@/lib/server/provision";
import { appOriginOf } from "@/lib/server/provision/guard";
import { NO_STORE, localModeRequest, readSetupBody, refuse, requestOrigin } from "@/lib/server/provision/request-access";
import { serverSignIn } from "@/lib/server/owner-session";

/**
 * "Forgot your password?" on a copy in local mode: with a fresh Supabase access token (used for this
 * call only, never stored), sets the owner's password to the new one through the project's Auth admin
 * API, keeps it in the local config and signs the owner in. Works without a stored sign-in, or with a
 * wrong one, as long as the local config still points at the project. When the owner's account is gone
 * it answers `no_account`, and the page offers to create it again (`recreateEmail`).
 */
export async function POST(request: Request) {
  const { t } = await getTranslator();
  if (!localModeRequest(request)) return refuse(403, t("Resetting the password works only in the app on the computer it runs on."));
  const config = getInstallConfig();
  const ref = config ? projectRef(config.supabaseUrl) : null;
  if (!config || !ref) return refuse(409, t("This computer isn't connected to a hosted Supabase project. Open the setup page to connect it."));
  const input = await readSetupBody(request);
  if (input instanceof Response) return input;
  const password = typeof input.body.password === "string" ? input.body.password : "";
  if (password.length < 8) return refuse(400, t("Use a password with at least 8 characters."));
  const recreate = typeof input.body.recreateEmail === "string" ? input.body.recreateEmail.trim() : "";
  if (recreate && !isEmail(recreate)) return refuse(400, t("That doesn't look like an email address. Check it for typos."));

  let email: string;
  let recreated = false;
  try {
    ({ email, recreated } = await localReset(
      { accessToken: input.token, ref, password, storedEmail: readStoredOwner()?.email ?? null, recreateEmail: recreate || null, appOrigin: appOriginOf(requestOrigin(request)) ?? "http://localhost:3000" },
      { fetch: (url, init) => fetch(url, init) },
    ));
  } catch (error) {
    if (error instanceof ProvisionError) {
      const status = error.code === "no_account" ? 409 : error.code === "not_ready" || error.code === "no_project" || error.code === "not_prepared" ? 409 : error.status === 401 ? 401 : 400;
      return Response.json({ error: error.message, detail: error.detail, code: error.code }, { status, headers: NO_STORE });
    }
    return refuse(500, t("Something unexpected went wrong. Try again."));
  }
  try { writeStoredOwner({ email, password }); } catch { /* signing in still works; the login page asks once */ }
  const signedIn = (await serverSignIn(email, password)).ok;
  return Response.json({ ok: true, email, signedIn, recreated }, { headers: NO_STORE });
}
