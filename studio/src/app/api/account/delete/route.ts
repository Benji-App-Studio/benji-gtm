import { getTranslator } from "@/lib/i18n/server";
import { translateServerMessage } from "@/lib/i18n/server-messages";
import { isResponse, requireUser } from "@/lib/server/auth";
import { callFunction } from "@/lib/server/functions";
import { NO_STORE, refuse } from "@/lib/server/provision/request-access";
import { forgetStorage } from "@/lib/server/storage";

export const maxDuration = 150;

/** The word the install function wants once the person typed the (translated) confirmation word. */
const CONFIRM = "delete-my-account";

/**
 * Settings > Account > Delete my account, through the person's own session: the install function deletes
 * their own account (every app, file, key and row, then the sign-in: supabase/functions/install/account.ts).
 * One call works for up to 90 seconds; while it answers `done: false` the page calls again. When it is
 * done, the session cookies are cleared here and the page moves to /goodbye.
 */
export async function POST(request: Request) {
  const session = await requireUser();
  if (isResponse(session)) return session;
  const { t, ...tr } = await getTranslator();
  // Browsers send Origin on this POST: it must be this app, so another site can't delete the account.
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host) {
    try { if (new URL(origin).host !== host) return refuse(403, t("Open Settings in the app and try again.")); } catch { return refuse(403, t("Open Settings in the app and try again.")); }
  }
  // { confirm: true } starts a deletion (the person typed the word); { resume: true } carries one on.
  const body = (await request.json().catch(() => null)) as { confirm?: unknown; resume?: unknown } | null;
  if (body?.confirm !== true && body?.resume !== true) return refuse(400, t("Type the confirmation word to delete your account."));

  const result = await callFunction<{ deleted?: boolean; done?: boolean; apps?: number; files?: number; bytes?: number; code?: string }>("install", session, "account/delete", {
    body: body?.confirm === true ? { confirm: CONFIRM } : {}, timeoutMs: 140_000,
    messages: {
      unreachable: t("Couldn't reach the backend. Nothing more was deleted; try again in a moment."),
      notDeployed: t("This workspace's backend is too old to delete accounts. Ask whoever runs it to apply the latest update."),
    },
  });
  forgetStorage();
  if (!result.ok) {
    const byCode: Record<string, string> = {
      owner: t("The owner can't delete their account here. Give the workspace to someone else first, or delete the whole workspace (its Supabase project)."),
      not_available: t("Accounts can't be deleted in this workspace. Ask whoever runs it."),
      confirm: t("Type the confirmation word to delete your account."),
      stopped: t("Your account wasn't fully deleted yet. Try again: it carries on where it stopped."),
      last_staff: t("The last staff account can't be deleted. Make another account staff first."),
      busy: t("Your account is being deleted right now. Wait a moment: this page carries on by itself."),
    };
    const code = result.data.code;
    const error = (code && byCode[code]) || translateServerMessage(result.data.error ?? "", { t, ...tr }) || t("Your account couldn't be deleted. Try again in a moment.");
    return Response.json({ error, code: code ?? null }, { status: result.status, headers: NO_STORE });
  }
  const { deleted = false, done = false, apps = 0, files = 0, bytes = 0 } = result.data;
  if (!deleted) return Response.json({ deleted, done, apps, files, bytes }, { headers: NO_STORE });
  // The sign-in is gone: clear this browser's session (locally; there is no session left to end on the server).
  await session.supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  return Response.json({ deleted, done: true, apps, files, bytes }, { headers: { ...NO_STORE, "Clear-Site-Data": '"storage"' } });
}
