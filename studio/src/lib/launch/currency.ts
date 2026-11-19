// Meta counts budgets in a currency's minor unit (cents), except for the currencies with no cents,
// which it counts in whole units. The one list the studio uses, a copy of NO_OFFSET in
// supabase/functions/launch/meta.ts (currency.test.ts checks they match).

/** Currencies Meta counts in whole units (no cents); everything else is in hundredths. */
export const NO_OFFSET: readonly string[] = ["CLP", "COP", "CRC", "HUF", "ISK", "IDR", "JPY", "KRW", "PYG", "TWD", "VND"];

const whole = new Set(NO_OFFSET);
/** 1 for a currency without cents, else 100. */
export const minorPerUnit = (currency: string) => (whole.has(currency.toUpperCase()) ? 1 : 100);
/** A budget as Meta stores it (minor units) in major units, as people read it. */
export const fromMinor = (minor: number, currency: string) => minor / minorPerUnit(currency);
/** Major units to Meta's minor units. */
export const toMinor = (amount: number, currency: string) => Math.round(amount * minorPerUnit(currency));
