// An in-memory stand-in for the Supabase client's query builder, for the route tests (Node only). It
// understands the calls the onboarding routes make (select, insert, update, delete; eq, is, in, not-null,
// gt, order, limit; single, maybeSingle, head counts) and nothing more, so a new call has to be added here
// on purpose. `fail` returns an error for a table and operation (a plan guard, a missing column).
import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;
type Op = "select" | "insert" | "update" | "delete";
export type FakeTables = Record<string, Row[]>;
export interface FakeOptions {
  fail?: (table: string, op: Op, rows: Row[], columns: string) => { code?: string; message: string; details?: string } | null;
  defaults?: Record<string, () => Row>;
}

let counter = 0;
export const fakeId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;

export function fakeDb(tables: FakeTables, options: FakeOptions = {}): SupabaseClient {
  const client = {
    from(table: string) {
      tables[table] ??= [];
      let op: Op = "select";
      let payload: Row | Row[] | null = null;
      let columns = "*";
      let head = false;
      let wantCount = false;
      let returning = false;
      let limit: number | null = null;
      const filters: ((row: Row) => boolean)[] = [];
      const builder = {
        select(cols = "*", opts?: { count?: string; head?: boolean }) {
          if (op === "select") columns = cols; else returning = true;
          head = Boolean(opts?.head); wantCount = Boolean(opts?.count);
          return builder;
        },
        insert(rows: Row | Row[]) { op = "insert"; payload = rows; return builder; },
        update(patch: Row) { op = "update"; payload = patch; return builder; },
        delete() { op = "delete"; return builder; },
        eq(col: string, value: unknown) { filters.push((r) => r[col] === value); return builder; },
        is(col: string, value: unknown) { filters.push((r) => (r[col] ?? null) === value); return builder; },
        in(col: string, values: unknown[]) { filters.push((r) => values.includes(r[col])); return builder; },
        not(col: string, _op: string, value: unknown) { filters.push((r) => (r[col] ?? null) !== value); return builder; },
        gt(col: string, value: number) { filters.push((r) => Number(r[col]) > value); return builder; },
        order() { return builder; },
        limit(n: number) { limit = n; return builder; },
        returns() { return builder; },
        async single() { const out = await run(); return { ...out, data: Array.isArray(out.data) ? out.data[0] ?? null : out.data, error: out.error ?? (Array.isArray(out.data) && !out.data.length ? { message: "no rows" } : null) }; },
        async maybeSingle() { const out = await run(); return { ...out, data: Array.isArray(out.data) ? out.data[0] ?? null : out.data }; },
        then(resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) { return run().then(resolve, reject); },
      };
      const matching = () => tables[table].filter((r) => filters.every((f) => f(r)));
      const pick = (row: Row) => (columns === "*" ? { ...row } : Object.fromEntries(columns.split(",").map((c) => c.trim()).map((c) => [c, row[c]])));
      async function run(): Promise<{ data: unknown; error: unknown; count?: number | null }> {
        const rows = op === "insert" ? (Array.isArray(payload) ? payload : [payload as Row]) : matching();
        const error = options.fail?.(table, op, rows, columns) ?? null;
        if (error) return { data: null, error, count: null };
        if (op === "select") {
          const found = matching();
          if (head) return { data: null, error: null, count: found.length };
          const list = (limit == null ? found : found.slice(0, limit)).map(pick);
          return { data: list, error: null, count: wantCount ? found.length : null };
        }
        if (op === "insert") {
          const made = rows.map((r) => ({ id: fakeId(), created_at: new Date(Date.now() + counter).toISOString(), ...(options.defaults?.[table]?.() ?? {}), ...r }));
          tables[table].push(...made);
          return { data: returning ? made.map((r) => ({ ...r })) : null, error: null };
        }
        if (op === "update") {
          for (const r of rows) Object.assign(r, payload);
          return { data: returning ? rows.map((r) => ({ ...r })) : null, error: null };
        }
        tables[table] = tables[table].filter((r) => !rows.includes(r));
        return { data: null, error: null };
      }
      return builder;
    },
  };
  return client as unknown as SupabaseClient;
}
