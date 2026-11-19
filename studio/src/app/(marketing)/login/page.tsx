import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth-form";
import { signupOpen } from "@/lib/install/signup";

export const metadata: Metadata = { title: "Log in" };
export const dynamic = "force-dynamic";

export default function Login() {
  return <Suspense><AuthForm mode="login" signupOpen={signupOpen()} /></Suspense>;
}
