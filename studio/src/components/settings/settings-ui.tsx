"use client";
// Pieces every settings page shares: the page heading, the states while the install loads or fails,
// the note shown to people who can't change a page, and one way to call the settings API.
import Link from "next/link";
import type { ReactNode } from "react";
import type { InstallState } from "@/lib/install/types";
import { canManage, useInstall, type UseInstall } from "@/lib/install/use-install";
import { IconLock } from "../icons";
import { Bone, Skeleton, SkeletonLine } from "../skeleton";
import { Button, Card, cx, ErrorNote } from "../ui";
import { useT } from "@/lib/i18n/client";
import { sentenceGap } from "../rich";
import { failedWith, NO_CONNECTION, sayError } from "./say-error";
import { settingsColumnClass, settingsPage, type SettingsPageKey } from "./pages";
import { useSettingsLabels } from "./settings-nav";

export { sayError };

/** A settings page: its title, one muted line, then its groups. */
export function SettingsPage({ page, title, description, children }: { page?: SettingsPageKey; title?: ReactNode; description?: ReactNode; children: ReactNode }) {
  const { t } = useT();
  const labels = useSettingsLabels();
  const known = page ? { label: labels.page[page], description: t(settingsPage(page).description) } : undefined;
  return (
    <div>
      <header className="mb-8">
        <h1 className="text-display font-medium">{title ?? known?.label}</h1>
        <p className="mt-1 max-w-xl text-sm text-muted">{description ?? known?.description}</p>
      </header>
      <div className="grid gap-10">{children}</div>
    </div>
  );
}

/** The shape of a settings page while it loads: a couple of groups of rows. */
export function SettingsRowsSkeleton({ groups = 2, rows = 3 }: { groups?: number; rows?: number }) {
  const { t } = useT();
  return (
    <Skeleton label={t("Loading settings")} className="grid gap-10">
      {Array.from({ length: groups }, (_, g) => (
        <div key={g}>
          <SkeletonLine size="title" width="w-28" className="mb-4" />
          <Card className="divide-y divide-line">
            {Array.from({ length: rows }, (_, r) => (
              <div key={r} className="flex min-h-[66px] items-center justify-between gap-6 px-4 py-3.5">
                <div className="min-w-0 flex-1"><SkeletonLine size="sm" width={r % 2 ? "w-32" : "w-24"} /><SkeletonLine size="sm" width="w-3/4" className="mt-0.5" /></div>
                <Bone className="h-7 w-16 rounded-control" />
              </div>
            ))}
          </Card>
        </div>
      ))}
    </Skeleton>
  );
}

/** A whole settings page while it loads: the heading, then rows. `framed` adds the page's column (for a fallback drawn outside the settings layout). */
export function SettingsLoading({ framed = false }: { framed?: boolean }) {
  const { t } = useT();
  return (
    <div className={framed ? settingsColumnClass : undefined}>
      <Skeleton label={t("Loading settings")} className="mb-8">
        <span className="flex h-[30px] items-center"><Bone className="h-5 w-40" /></span>
        <SkeletonLine size="sm" width="w-80" className="mt-1.5" />
      </Skeleton>
      <SettingsRowsSkeleton />
    </div>
  );
}

/** Loading and failure for pages that need the install; calls `children` once it has loaded. */
export function WithInstall({ children }: { children: (install: InstallState, manage: boolean, refresh: UseInstall["refresh"]) => ReactNode }) {
  const { t } = useT();
  const { install, error, refresh } = useInstall();
  if (install) return <>{children(install, canManage(install), refresh)}</>;
  if (error) {
    return (
      <ErrorNote title={t("These settings didn't load")}>
        <p>{sayError(t, error)}</p>
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => { void refresh(); }}>{t("Try again")}</Button>
      </ErrorNote>
    );
  }
  return <SettingsRowsSkeleton />;
}

/**
 * Why this page can't be changed by the person looking at it: a member (only the owner can), or anyone on
 * an install from before owners existed. Nothing for the owner.
 */
export function ReadOnlyNote({ install, what, legacy }: { install: InstallState; what: string; legacy?: ReactNode }) {
  const { t, locale } = useT();
  const gap = sentenceGap(locale);
  if (canManage(install)) return null;
  return (
    <div className="flex items-start gap-2.5 rounded-small border border-line bg-card px-3 py-2.5 text-sm">
      <IconLock className="mt-[3px] size-3.5 shrink-0 text-muted" />
      {install.owned
        ? <p className="text-label"><span className="font-medium text-ink">{t("Only the owner can change {what}.", { what })}</span>{gap}{t("You can see what is set; ask the owner to change it.")}</p>
        : <p className="text-label">{legacy ?? <><span className="font-medium text-ink">{t("This workspace has no owner yet, so {what} can't be changed here.", { what })}</span>{gap}{t("Run setup to make it yours.")}{gap}<Link href="/setup" className="font-medium text-accent hover:underline">{t("Open setup")}</Link></>}</p>}
    </div>
  );
}

/** A line that reports what just happened (saved, or why not). Announced to screen readers. */
export function Status({ error, ok, className }: { error?: string | null; ok?: string | null; className?: string }) {
  const { t } = useT();
  return <p role="status" className={cx("min-h-5 text-sm", error ? "text-warn" : "text-win", className)}>{(error && sayError(t, error)) || ok || ""}</p>;
}


export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** Calls a settings route. Never throws: a failed request, a bad answer and a refusal all come back as `error`. */
export async function api<T>(url: string, method: "GET" | "PUT" | "POST" | "PATCH" | "DELETE" = "GET", body?: unknown): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, { method, cache: "no-store", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    return { ok: false, error: NO_CONNECTION };
  }
  const data = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !data) return { ok: false, error: (data && typeof data.error === "string" && data.error) || failedWith(response.status) };
  return { ok: true, data };
}
