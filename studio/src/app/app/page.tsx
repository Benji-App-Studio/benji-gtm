import { redirect } from "next/navigation";
import { lastAppId } from "@/lib/server/last-app";
import { appHref, NEW_APP_HREF } from "@/lib/nav-model";

/**
 * /app has no page of its own: there is one Home per app, so it opens the last app's Home (what sign-in,
 * "Back to Home" and the G then H shortcut all mean). Every app at once is under All apps (/app/apps).
 */
export default async function AppRoot() {
  const id = await lastAppId();
  redirect(id ? appHref(id) : NEW_APP_HREF);
}
