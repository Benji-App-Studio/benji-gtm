// The workspace's name at the top of the sidebar. A new account's workspace has no name yet: instead of
// the product's name ("Benji GTM") it is called after the person, "Ann's workspace", in their language,
// until they name it in Settings › General. Setup's "My workspace" is said in the viewer's language too.
// Plain TypeScript (workspace-name.test.ts).
import { m } from "./i18n/translate";

type T = (text: string, vars?: Record<string, string | number>) => string;

/** The first name to call the workspace after: the first word of the person's name, else the email's first part ("ann.lee@x" → "Ann"). */
export function ownerFirstName(who: { name?: string | null; email?: string | null } | null | undefined): string {
  const name = who?.name?.trim().split(/\s+/)[0] ?? "";
  if (name) return name.slice(0, 30);
  const local = who?.email?.split("@")[0]?.split(/[._+-]/).find(Boolean) ?? "";
  if (!local || /^\d+$/.test(local)) return "";
  return (local.charAt(0).toUpperCase() + local.slice(1)).slice(0, 30);
}

/**
 * What the sidebar calls the workspace: its saved name; setup's "My workspace" translated; with no name,
 * "{name}'s workspace" after the person; and the product's name only when nothing else is known.
 * `named` says whether a name was saved (Settings › General shows the default as a suggestion otherwise).
 */
export function workspaceLabel(saved: string | null | undefined, who: { name?: string | null; email?: string | null } | null | undefined, t: T, fallback: string): { label: string; named: boolean } {
  const name = saved?.trim();
  if (name === "My workspace") return { label: t(m("My workspace")), named: true };
  if (name) return { label: name, named: true };
  const first = ownerFirstName(who);
  return { label: first ? t("{name}'s workspace", { name: first }) : fallback, named: false };
}
