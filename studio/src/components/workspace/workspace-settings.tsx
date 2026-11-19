"use client";
// An app's connections now live in Settings (components/settings/app-settings.tsx). The Brand page's
// Settings tab still renders this, so it sends the person there, with a link in case the move is slow.
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { appSettingsHref } from "../settings/pages";
import { ConnectState } from "../ui";

export function WorkspaceConnections({ id }: { id: string }) {
  const router = useRouter();
  useEffect(() => { router.replace(appSettingsHref(id)); }, [router, id]);
  return <ConnectState title="Connections are in Settings" body="This app's Meta, RevenueCat, AppStack and storage IDs are set there." href={appSettingsHref(id)} action="Open connections" />;
}
