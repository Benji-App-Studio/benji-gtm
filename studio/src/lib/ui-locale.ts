// One locale for every date and number the app formats. The server renders a page first and the
// browser then takes it over; if the two formatted "19 Nov" and "Nov 19" (or 1,00,000 and 100,000)
// differently, React would throw a hydration error. So both always use this one.
export const UI_LOCALE = "en-US";
