"use client";
// Who is signed in (name and email from the app's layout), for the pieces that name things after the
// person: the workspace's default name ("Ann's workspace", lib/workspace-name.ts).
import { createContext, useContext, type ReactNode } from "react";
import { APP_NAME } from "@/lib/brand-config";
import { useT } from "@/lib/i18n/client";
import { useInstall } from "@/lib/install/use-install";
import { workspaceLabel } from "@/lib/workspace-name";

type Who = { name?: string | null; email?: string | null };

const WhoContext = createContext<Who | null>(null);

export function WhoProvider({ who, children }: { who: Who; children: ReactNode }) {
  return <WhoContext.Provider value={who}>{children}</WhoContext.Provider>;
}

/** The workspace's name as the sidebar shows it, and whether one was saved; `loading` while the install loads. */
export function useWorkspaceLabel(): { label: string; named: boolean; loading: boolean } {
  const { t } = useT();
  const who = useContext(WhoContext);
  const { install, loading } = useInstall();
  return { ...workspaceLabel(install?.name, who, t, APP_NAME), loading };
}
