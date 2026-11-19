import type { ReactNode } from "react";
import { BackgroundTasks } from "@/components/background-tasks";
import { DialogHost } from "@/components/dialog";
import { InstantViews } from "@/components/instant";
import { CommandMenu } from "@/components/nav/command-menu";
import { SessionWatch } from "@/components/nav/session";
import { MobileBar, NavKeys, Sidebar } from "@/components/nav/sidebar";
import { UpdateBanner } from "@/components/nav/update-banner";

/**
 * The signed-in app's frame. Wide screens: the sidebar on the pale grey background, and beside it the
 * page in an inset panel (8 px from the window's edges, 12 px corners, a low-contrast hairline and a faint
 * shadow), scrolling inside (<main id="main">); each page's 44 px header bar sticks to its top. Below
 * lg: full-bleed, with a top bar and the sidebar in a drawer, scrolling with the window. In Settings the
 * sidebar shows the settings pages instead (see nav/sidebar.tsx). `local` (a copy in local mode) hides Sign out. `page` is given only where the shell
 * is drawn outside the app's own routes (the development preview).
 */
export function AppShell({ name, email, local, children, page }: { name?: string | null; email?: string; local?: boolean; children: ReactNode; page?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas lg:h-dvh lg:flex-row lg:bg-shell">
      <Sidebar name={name} email={email} local={local} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:py-2 lg:pr-2">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-canvas lg:overflow-hidden lg:rounded-frame lg:border lg:border-line lg:shadow-frame">
          <MobileBar name={name} email={email} local={local} />
          {!page && <UpdateBanner />}
          <main id="main" className="min-w-0 flex-1 lg:overflow-y-auto">
            {/* The container for @container queries and the header bar's full width: inside main, so a scrollbar is not counted. */}
            <div className="@container min-h-full">{page ?? <InstantViews>{children}</InstantViews>}</div>
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
