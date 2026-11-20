// A plan's name as shown (Settings > General's badge): the database keeps it in English ("Free"), so the
// plans we ship are named in the viewer's language; Pro stays Pro, and a plan added later shows its own
// name. Plain TypeScript (tested in setup-access.test.ts).
import { m } from "../i18n/translate";

const SHIPPED: Record<string, string> = { free: m("Free"), staff: m("Staff") };

/** `t` is the translator's; a plan we don't know keeps the name the database gave it. */
export function planName(plan: { id: string; name: string }, t: (text: string) => string): string {
  const known = SHIPPED[plan.id];
  return known ? t(known) : plan.name;
}
