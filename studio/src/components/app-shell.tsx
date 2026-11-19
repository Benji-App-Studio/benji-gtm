import type { ReactNode } from "react";
import { BackgroundTasks } from "@/components/background-tasks";
import { DialogHost } from "@/components/dialog";
import { InstantViews } from "@/components/instant";
import { CommandMenu } from "@/components/nav/command-menu";
import { SessionWatch } from "@/components/nav/session";
import { MobileBar, NavKeys, Sidebar } from "@/components/nav/sidebar";

/**
 * The signed-in app's frame. Wide screens: the sidebar on the pale grey background, and beside it the
 * page in a slightly lighter panel with a hairline border, scrolling inside (<main id="main">). Below
 * lg: full-bleed, with a top bar and the sidebar in a drawer, scrolling with the window. In Settings the
 * sidebar shows the settings pages instead (see nav/sidebar.tsx). `page` is given only where the shell
 * is drawn outside the app's own routes (the development preview).
 */
export function AppShell({ name, email, children, page }: { name?: string | null; email?: string; children: ReactNode; page?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas lg:h-dvh lg:flex-row lg:bg-shell">
      <Sidebar name={name} email={email} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:py-2 lg:pr-2">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-canvas lg:overflow-hidden lg:rounded-frame lg:border lg:border-hairline">
          <MobileBar name={name} email={email} />
          <main id="main" className="@container min-w-0 flex-1 lg:overflow-y-auto">
            {page ?? <InstantViews>{children}</InstantViews>}
          </main>
        </div>
      </div>
      <BackgroundTasks />
      <DialogHost />
      <CommandMenu />
      <NavKeys />
      <SessionWatch />
    </div>
  );
}
