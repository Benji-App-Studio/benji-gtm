"use server";
// The landing page's "Get started": the email goes to sign-up in a short-lived httpOnly cookie, not in
// the address, so it never lands in browser history, server logs or a referrer.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { looksLikeEmail } from "@/lib/auth/flows";
import { signupOpen } from "@/lib/install/signup";
import { START_EMAIL_COOKIE } from "@/lib/storage-keys";

export async function startWithEmail(form: FormData) {
  const email = String(form.get("email") ?? "").trim().slice(0, 200);
  if (looksLikeEmail(email)) {
    (await cookies()).set(START_EMAIL_COOKIE, email, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 });
  }
  redirect((await signupOpen()) ? "/signup" : "/login");
}
