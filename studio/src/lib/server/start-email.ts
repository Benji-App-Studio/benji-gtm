import "server-only";
// The email typed on the landing page (app/(landing)/actions.ts), for the sign-up or login form to fill in.
import { cookies } from "next/headers";
import { looksLikeEmail } from "@/lib/auth/flows";
import { START_EMAIL_COOKIE } from "@/lib/storage-keys";

export async function startEmail(): Promise<string> {
  const value = (await cookies()).get(START_EMAIL_COOKIE)?.value?.trim() ?? "";
  return looksLikeEmail(value) ? value.slice(0, 200) : "";
}
