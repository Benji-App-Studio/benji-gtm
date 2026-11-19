import "server-only";
// Whether people may create their own account. An install set up through /setup has one owner and is
// closed: the owner adds people in Settings > Members. A hosted deployment that wants open sign-up
// sets ALLOW_SIGNUP=1 (its Supabase project must allow sign-ups too).
export function signupOpen(): boolean {
  const env = process.env;
  return env["ALLOW_SIGNUP"] === "1";
}
