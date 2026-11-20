import { redirect } from "next/navigation";
import { lastAppId } from "@/lib/server/last-app";
import { appSettingsHref, NEW_APP_HREF } from "@/lib/nav-model";

/** The product profile is the Profile tab of App settings now. Old links land on it for the app last opened. */
export default async function ProductPage() {
  const id = await lastAppId();
  redirect(id ? appSettingsHref(id, "profile") : NEW_APP_HREF);
}
