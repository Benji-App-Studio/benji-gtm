import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth-form";
import { signupOpen } from "@/lib/install/signup";

export const metadata: Metadata = { title: "Sign up" };
export const dynamic = "force-dynamic";

export default function Signup() {
  // Closed installs have no sign-up page: the owner adds people in Settings > Members.
  if (!signupOpen()) redirect("/login");
  return <Suspense><AuthForm mode="signup" signupOpen /></Suspense>;
}
