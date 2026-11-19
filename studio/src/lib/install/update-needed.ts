// Whether "Apply the update" was skipped: this copy of the app carries a migration newer than the newest
// one applied to the project. Pure, so the browser, the server and the tests share it.

const VERSION = /^\d{14}$/;

export interface UpdateCheck { updateNeeded: boolean; schema: { applied: string | null; bundled: string | null } }

/**
 * `applied`: the install function's `schemaVersion` (undefined when the backend is older than this
 * field, which itself means the update wasn't applied). `bundled`: the newest migration in this copy.
 * An install set up before the setup page existed (no owner, no ledger) is never nagged.
 */
export function updateCheck(applied: string | null | undefined, bundled: string | null, owned: boolean): UpdateCheck {
  const have = typeof applied === "string" && VERSION.test(applied) ? applied : null;
  const want = bundled && VERSION.test(bundled) ? bundled : null;
  const schema = { applied: have, bundled: want };
  if (!want || !owned) return { updateNeeded: false, schema };
  // An older install function doesn't report the field at all: its update wasn't applied.
  if (applied === undefined) return { updateNeeded: true, schema };
  return { updateNeeded: have !== null && have < want, schema };
}

/** The newest version among migration file names (`<14 digits>_<name>.sql`); null when there is none. */
export function newestMigration(names: string[]): string | null {
  return names.map((name) => /^(\d{14})_[a-z0-9_]+\.sql$/.exec(name)?.[1]).filter((v): v is string => Boolean(v)).sort().at(-1) ?? null;
}
