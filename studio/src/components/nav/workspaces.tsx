"use client";
// The apps of this install (each one's pages live under /app/w/<app id>/; the code calls one a
// workspace) and the small marks that stand for them and for the install itself.
import { useEffect, useSyncExternalStore } from "react";
import { useCached } from "@/lib/client-cache";
import type { ProductRow } from "@/lib/db";
import { WORKSPACE_COOKIE } from "@/lib/workspace-schema";
import { cx } from "../ui";
import { useAppPath } from "./path";
import { readCookieString, writeCookie } from "@/lib/storage-keys";

export const IN_WORKSPACE = /^\/app\/w\/([0-9a-f-]{36})/i;
const cookieListeners = new Set<() => void>();
const readWorkspaceCookie = () => readCookieString(document.cookie, WORKSPACE_COOKIE);

/** Remembers the app last opened, so sign-in and the sidebar come back to it. */
export function rememberWorkspace(id: string) {
  writeCookie(WORKSPACE_COOKIE, id);
  cookieListeners.forEach((listener) => listener());
}

/** The apps and the one being worked on (the URL's, else the last opened, else the main one). */
export function useWorkspaces() {
  const path = useAppPath();
  const [list] = useCached<ProductRow[]>("/api/products");
  const products = Array.isArray(list) ? list : undefined;
  const remembered = useSyncExternalStore((l) => { cookieListeners.add(l); return () => { cookieListeners.delete(l); }; }, readWorkspaceCookie, () => null);
  const fromPath = path.match(IN_WORKSPACE)?.[1] ?? null;
  useEffect(() => { if (fromPath) rememberWorkspace(fromPath); }, [fromPath]);
  const id = fromPath ?? (products?.some((p) => p.id === remembered) ? remembered : products?.find((p) => p.is_primary)?.id ?? products?.[0]?.id ?? null);
  return { products, current: products?.find((p) => p.id === id), id };
}

// An app's mark takes one of the token tints, picked by its name so it stays the same everywhere.
const TINTS = ["bg-accent-soft text-accent", "bg-win-soft text-win", "bg-caution-soft text-caution-ink", "bg-warn-soft text-warn", "bg-control text-label"];
const tint = (name: string) => TINTS[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % TINTS.length];

/** An app's mark: a small tinted square with its initial. */
export function WorkspaceMark({ name, className }: { name: string; className?: string }) {
  return (
    <span aria-hidden className={cx("grid size-[18px] shrink-0 place-items-center rounded-sm text-[10px] leading-none font-semibold", tint(name || "?"), className)}>
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

/** The install's mark (and the product's, on the entry pages): a dark square with its initial. */
export function InstallMark({ name, className }: { name: string; className?: string }) {
  return (
    <span aria-hidden className={cx("grid size-5 shrink-0 place-items-center rounded-sm bg-primary text-[11px] leading-none font-semibold text-on-ink", className)}>
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}
