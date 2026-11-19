// The decisions behind the account routes, with Supabase passed in, so they are tested without a server:
//   localSignIn        the one-time login on a local copy that has no (working) stored sign-in
//   changeOwnPassword  Settings > Account > Change password
// Neither ever puts a password in what it returns.
import { classifySignInError, type SignInErrorLike } from "../install/local-auth";

export interface FlowAnswer { status: number; body: Record<string, unknown> }

const SIGN_IN_ERRORS: Record<string, string> = {
  "Email not confirmed": "Confirm your email first: check your inbox for the link.",
  "Invalid login credentials": "That email and password don't match. Check both and try again, or press Forgot your password.",
};

/** Supabase's sign-in refusal in plain words. */
export function signInMessage(error: SignInErrorLike): string {
  if (classifySignInError(error) === "unreachable") return "Couldn't reach your Supabase project. It may be paused: open your Supabase dashboard, restore the project if it asks, then try again.";
  return SIGN_IN_ERRORS[error.message ?? ""] ?? "That email and password don't match. Check both and try again, or press Forgot your password.";
}

export interface LocalSignInDeps {
  signIn: (email: string, password: string) => Promise<{ error: SignInErrorLike | null }>;
  /** The signed-in person's role in this install ("owner", "member") or null. */
  role: () => Promise<string | null>;
  signOut: () => Promise<void>;
  remember: (owner: { email: string; password: string }) => void;
}

/**
 * Signs in on a local copy and, when it is the owner, keeps the sign-in so the app signs in by itself
 * from then on. A local copy opens with the owner's account only.
 */
export async function localSignIn(input: { email: string; password: string }, deps: LocalSignInDeps): Promise<FlowAnswer> {
  const email = input.email.trim().toLowerCase();
  if (!email || !input.password) return { status: 400, body: { error: "Type your email and password." } };
  let error: SignInErrorLike | null;
  try { ({ error } = await deps.signIn(email, input.password)); } catch { error = { status: 0, message: "network" }; }
  if (error) return { status: classifySignInError(error) === "unreachable" ? 503 : 400, body: { error: signInMessage(error), reason: classifySignInError(error) } };
  if ((await deps.role()) !== "owner") {
    await deps.signOut().catch(() => {});
    return { status: 403, body: { error: "This copy runs on the owner's computer and opens with the owner's account only. Members sign in on an online copy." } };
  }
  try { deps.remember({ email, password: input.password }); } catch {
    return { status: 200, body: { ok: true, remembered: false } };
  }
  return { status: 200, body: { ok: true, remembered: true } };
}

export interface ChangePasswordDeps {
  /** supabase.auth.updateUser({ password }) through the person's own session. */
  updatePassword: (password: string) => Promise<{ error: { message?: string } | null }>;
  remember: (owner: { email: string; password: string }) => void;
}

/** Changes the signed-in person's password; on a local copy the owner's stored sign-in follows. */
export async function changeOwnPassword(input: { password: string; email: string | null; local: boolean; role: string | null }, deps: ChangePasswordDeps): Promise<FlowAnswer> {
  if (input.password.length < 8) return { status: 400, body: { error: "Use a password with at least 8 characters." } };
  let error: { message?: string } | null;
  try { ({ error } = await deps.updatePassword(input.password)); } catch { error = { message: "network" }; }
  if (error) {
    const said = (error.message ?? "").toLowerCase();
    const message = said.includes("different from the old") ? "That is already your password. Choose a new one."
      : said.includes("network") || said.includes("fetch") ? "Couldn't reach your Supabase project. Check your connection, then try again."
      : said.includes("password") ? "Supabase didn't accept that password. Use at least 8 characters, with letters and numbers."
      : "Your password wasn't changed. Try again.";
    return { status: 400, body: { error: message } };
  }
  let remembered = false;
  if (input.local && input.role === "owner" && input.email) {
    try { deps.remember({ email: input.email, password: input.password }); remembered = true; } catch { remembered = false; }
  }
  return { status: 200, body: { ok: true, email: input.email, remembered } };
}
