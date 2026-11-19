// The pages of Settings, in sidebar order. The settings sidebar and the command menu both read this.
export type SettingsPageKey = "general" | "keys" | "models" | "members" | "runner" | "appearance" | "updates";

export const SETTINGS_PAGES: { key: SettingsPageKey; label: string; href: string; description: string }[] = [
  { key: "general", label: "General", href: "/app/settings", description: "This workspace's name and your account." },
  { key: "keys", label: "API keys", href: "/app/settings/keys", description: "The services this workspace uses. Each key is checked when you save it and stored in your own Supabase project." },
  { key: "models", label: "AI models", href: "/app/settings/models", description: "Which AI reads ads and writes analyses, and the model used for each job." },
  { key: "members", label: "Members", href: "/app/settings/members", description: "The people who can sign in to this workspace." },
  { key: "runner", label: "Desktop runner", href: "/app/settings/runner", description: "An optional program on your own Mac that makes creator-style videos and product cut-outs. Everything else works without it." },
  { key: "appearance", label: "Appearance", href: "/app/settings/appearance", description: "How the app looks on this device." },
  { key: "updates", label: "Updates", href: "/app/settings/updates", description: "How to move this workspace to a newer version." },
];

export const settingsPage = (key: SettingsPageKey) => SETTINGS_PAGES.find((page) => page.key === key)!;

/** One app's settings: its connections and its danger zone. */
export const appSettingsHref = (productId: string) => `/app/settings/apps/${productId}`;

/** The centred column every settings page sits in. */
export const settingsColumnClass = "mx-auto w-full max-w-[720px] px-4 pt-8 pb-16 sm:px-8 lg:pt-14";
