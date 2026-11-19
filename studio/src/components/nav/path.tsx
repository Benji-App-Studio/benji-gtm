"use client";
// The path the navigation treats as current. It is the URL's, except where a screen is drawn outside
// its own route (the development preview), which supplies the path it stands in for.
import { usePathname } from "next/navigation";
import { createContext, useContext, type ReactNode } from "react";

const PathContext = createContext<string | null>(null);
export function PathOverride({ value, children }: { value: string; children: ReactNode }) {
  return <PathContext.Provider value={value}>{children}</PathContext.Provider>;
}

export function useAppPath(): string {
  const real = usePathname() ?? "/app";
  return useContext(PathContext) ?? real;
}

export const SETTINGS_ROOT = "/app/settings";
export const inSettings = (path: string) => path === SETTINGS_ROOT || path.startsWith(`${SETTINGS_ROOT}/`);

// Where "Back to app" in Settings returns to: the last page opened outside Settings.
let lastAppPath: string | null = null;
export const rememberAppPath = (path: string) => { if (!inSettings(path)) lastAppPath = path; };
export const backToAppHref = () => lastAppPath ?? "/app";
