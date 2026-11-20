"use client";
import type { ReactNode } from "react";
import { formatMoney } from "@/lib/i18n/format";

/** Draft statuses that are still on their way to Meta. */
export const IN_PROGRESS = new Set(["queued", "processing", "creating"]);

/** A section of the Launch page with its title row. */
export function Section({ id, title, hint, action, children }: { id?: string; title: string; hint?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="min-w-0 scroll-mt-6">
      <div className="mb-2 flex min-h-7 flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-ink">{title}</h2>
          {hint && <p className="text-xs text-muted">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** An amount in the currency; pass the translator's `intl` for the page's locale (English otherwise). */
export function money(n: number | null | undefined, currency = "USD", intl = "en") {
  return formatMoney(intl, n, currency);
}

/** Posts JSON and returns the answer, throwing the server's error message. */
export async function send<T = Record<string, unknown>>(url: string, body: unknown, method = "POST"): Promise<T> {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `The server answered ${response.status}.`);
  return data as T;
}
