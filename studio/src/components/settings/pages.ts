// The pages of Settings, in sidebar order. The settings sidebar and the command menu both read this.
export type SettingsPageKey = "general" | "account" | "keys" | "models" | "research" | "members" | "runner" | "extension" | "storage" | "appearance" | "updates";

export const SETTINGS_PAGES: { key: SettingsPageKey; label: string; href: string; description: string }[] = [
  { key: "general", label: "General", href: "/app/settings", description: "This workspace's name." },
  { key: "account", label: "Account", href: "/app/settings/account", description: "Your sign-in: your email, your password, and using the app online." },
  { key: "keys", label: "API keys", href: "/app/settings/keys", description: "The services this workspace uses. Each key is checked when you save it and stored in your own Supabase project." },
  { key: "research", label: "Research sources", href: "/app/settings/research", description: "Where competitors' ads are collected from automatically, what each source covers and costs, and the key it needs." },
  { key: "models", label: "AI models", href: "/app/settings/models", description: "Which AI reads ads and writes analyses, and the model used for each job." },
  { key: "members", label: "Members", href: "/app/settings/members", description: "The people who can sign in to this workspace. People you add sign in on an online copy of the app; a copy running on your computer opens only on that computer." },
  { key: "runner", label: "Desktop runner", href: "/app/settings/runner", description: "An optional program on your own Mac that makes creator-style videos and product cut-outs. Everything else works without it." },
  { key: "extension", label: "Ad Library extension", href: "/app/settings/extension", description: "A free Chrome extension that saves a competitor's ads from Meta's Ad Library into a file. You drop that file on your app's Research page." },
  { key: "storage", label: "Storage", href: "/app/settings/storage", description: "How much of your Supabase plan's storage is used, by app and by kind, and what to delete to free space." },
  { key: "appearance", label: "Appearance", href: "/app/settings/appearance", description: "How the app looks on this device." },
  { key: "updates", label: "Updates", href: "/app/settings/updates", description: "How to move this workspace to a newer version." },
];

export const settingsPage = (key: SettingsPageKey) => SETTINGS_PAGES.find((page) => page.key === key)!;

/** One app's settings: its connections and its danger zone. */
export const appSettingsHref = (productId: string) => `/app/settings/apps/${productId}`;

/** The centred column every settings page sits in. */
export const settingsColumnClass = "mx-auto w-full max-w-[704px] px-4 pt-8 pb-16 sm:px-8 lg:pt-16";
