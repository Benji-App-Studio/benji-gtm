// The pages of Settings, in sidebar order and grouped: Workspace (the plan, keys and storage everyone
// shares), You (your sign-in, language and look) and Advanced (the finer controls). The settings sidebar
// and the command menu both read this; the labels shown are said with t() in settings-nav.tsx.
import { m } from "@/lib/i18n/translate";
export type SettingsPageKey = "general" | "account" | "language" | "keys" | "models" | "research" | "members" | "runner" | "extension" | "storage" | "appearance" | "updates";
export type SettingsGroupKey = "workspace" | "you" | "advanced";

export const SETTINGS_GROUPS: SettingsGroupKey[] = ["workspace", "you", "advanced"];

export const SETTINGS_PAGES: { key: SettingsPageKey; group: SettingsGroupKey; label: string; href: string; description: string }[] = [
  { key: "general", group: "workspace", label: m("General & plan"), href: "/app/settings", description: m("This workspace's name, your plan and how much of it is used.") },
  { key: "keys", group: "workspace", label: m("Your keys"), href: "/app/settings/keys", description: m("The services this workspace uses. Each key is checked when you save it and kept in your own Supabase project.") },
  { key: "storage", group: "workspace", label: m("Storage"), href: "/app/settings/storage", description: m("How much of your storage is used, by app and by kind, and what to delete to free space.") },
  { key: "members", group: "workspace", label: m("Members"), href: "/app/settings/members", description: m("The people who can sign in to this workspace. People you add sign in on an online copy of the app; a copy running on your computer opens only on that computer.") },
  { key: "account", group: "you", label: m("Account"), href: "/app/settings/account", description: m("Your sign-in: your email, your password, and using the app online.") },
  { key: "language", group: "you", label: m("Language"), href: "/app/settings/language", description: m("The language the app speaks to you.") },
  { key: "appearance", group: "you", label: m("Appearance"), href: "/app/settings/appearance", description: m("How the app looks on this device.") },
  { key: "models", group: "advanced", label: m("AI models"), href: "/app/settings/models", description: m("Which AI reads ads and writes analyses, and the model used for each job.") },
  { key: "research", group: "advanced", label: m("Research sources"), href: "/app/settings/research", description: m("Where competitors' ads are collected from automatically, what each source covers and costs, and the key it needs.") },
  { key: "extension", group: "advanced", label: m("Ad Library extension"), href: "/app/settings/extension", description: m("A free Chrome extension that saves a competitor's ads from Meta's Ad Library into a file. You drop that file on your app's Research page.") },
  { key: "runner", group: "advanced", label: m("Desktop runner"), href: "/app/settings/runner", description: m("An optional program on your own Mac that makes creator-style videos and product cut-outs. Everything else works without it.") },
  { key: "updates", group: "advanced", label: m("Updates"), href: "/app/settings/updates", description: m("How to move this workspace to a newer version.") },
];

export const settingsPage = (key: SettingsPageKey) => SETTINGS_PAGES.find((page) => page.key === key)!;

/** Pages an account never sees in accounts mode (each account is its own; updates and the runner are ours). */
const ACCOUNTS_HIDDEN: SettingsPageKey[] = ["members", "updates", "runner"];

/** Whether a page is shown: all of them in install and legacy mode; in accounts mode no Members, and Updates and the Desktop runner for staff only. */
export function pageVisible(key: SettingsPageKey, install: { mode?: string; plan?: { staff?: boolean } | null } | null | undefined): boolean {
  if (install?.mode !== "accounts") return true;
  if (key === "members") return false;
  return !ACCOUNTS_HIDDEN.includes(key) || Boolean(install.plan?.staff);
}

/** The pages this person sees, in sidebar order. */
export const visibleSettingsPages = (install: Parameters<typeof pageVisible>[1]) => SETTINGS_PAGES.filter((page) => pageVisible(page.key, install));

/** One app's settings live on the app itself now (its App settings page, lib/nav-model.ts). */
export { appSettingsHref } from "@/lib/nav-model";

/** The centred column every settings page sits in. */
export const settingsColumnClass = "mx-auto w-full max-w-[704px] px-4 pt-8 pb-16 sm:px-8 lg:pt-16";
