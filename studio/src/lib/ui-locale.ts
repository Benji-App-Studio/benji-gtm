// One locale for every date and number the app formats. The server renders a page first and the
// browser then takes it over; if the two formatted "19 Nov" and "Nov 19" (or 1,00,000 and 100,000)
// differently, React would throw a hydration error. So both always use this one.
//
// @deprecated Format in the page's language instead: the translator's `intl` (useT() / getTranslator())
// with lib/i18n/format.ts (formatDate, formatMoney, formatRelative…), which is the same on the server
// and in the browser for a given language. Kept until the last English-only callers move over.
export const UI_LOCALE = "en-US";
