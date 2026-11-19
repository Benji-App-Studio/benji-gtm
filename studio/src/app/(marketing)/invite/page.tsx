import type { Metadata } from "next";
import { InviteForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Choose your password" };

/** Where the invite link from Settings > Members lands: the new member chooses a password and is signed in. */
export default function Invite() {
  return <InviteForm />;
}
