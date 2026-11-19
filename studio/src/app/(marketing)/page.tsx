import { redirect } from "next/navigation";

/** There is no public site: the root goes to the app, and the proxy sends signed-out people to /login. */
export default function Root() {
  redirect("/app");
}
