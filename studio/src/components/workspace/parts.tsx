"use client";
// Small pieces the workspace pages share: the app icon, a connection's status, the workspace data.
import { useCached } from "@/lib/client-cache";
import { useT } from "@/lib/i18n/client";
import type { ConnectionStatus, WorkspaceView } from "@/lib/workspace-schema";
import { Badge, cx } from "../ui";

/** One workspace, from the client cache: undefined while loading the first time, an error object if it failed. */
export function useWorkspace(id: string) {
  return useCached<WorkspaceView | { error: string }>(`/api/workspaces/${id}`);
}

export const isWorkspace = (value: unknown): value is WorkspaceView => Boolean(value && typeof value === "object" && "brandKit" in value);

/** The app's icon, or its initial on a plain tile until one is uploaded. */
export function WorkspaceIcon({ name, url, className }: { name: string; url?: string; className?: string }) {
  return url
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={url} alt="" className={cx("shrink-0 rounded-[22%] object-cover", className)} />
    : <span aria-hidden className={cx("grid shrink-0 place-items-center rounded-[22%] bg-control font-semibold text-muted", className)}>{name.trim().charAt(0).toUpperCase() || "?"}</span>;
}

export function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  const { t } = useT();
  if (status.state === "verified") return <Badge tone="win">{t("Verified")}</Badge>;
  if (status.state === "set") return status.failed ? <Badge tone="warn">{t("Check failed")}</Badge> : <Badge tone="accent">{t("Set")}</Badge>;
  return <Badge>{t("Not set")}</Badge>;
}

/** A dot for compact lists: green verified, accent set, faint not set. */
export function ConnectionDot({ status }: { status: ConnectionStatus }) {
  return <span aria-hidden className={cx("size-1.5 shrink-0 rounded-full", status.state === "verified" ? "bg-win" : status.state === "set" ? (status.failed ? "bg-warn" : "bg-accent") : "bg-ink/20")} />;
}
