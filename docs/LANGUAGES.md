# Languages

Benji GTM speaks English, Traditional Chinese (Taiwan), Japanese and Korean. Choose one in
**Settings › Language**, or from the menu at the foot of the public pages. The choice is saved on
your account, so it follows you to another browser.

## What follows your language

- **Menus, pages and messages**, including most messages from the backend (missing keys, plan
  limits, storage, sign-in problems).
- **What the AI writes for you to read**: your app's profile, competitors' descriptions, an ad's
  analysis, template names and notes, review and chart summaries, and the note after **Improve with
  AI**. Names, links, @handles, numbers, and words quoted from an ad or a review stay as they were
  written.
- **Ad copy the AI writes for your own ads** is in the language your audience reads. Until you choose
  one for an ad, that is your language.
- **The sign-in emails**, once the templates are pasted into Supabase
  ([email-templates](email-templates/README.md)).
- **The Chrome extension** follows your browser's language, not the app's.

## Good to know

- **AI text that is already saved stays in the language it was written in.** Market summaries,
  competitors' descriptions, ad analyses and template names aren't marked with a language: change the
  language and they keep the old one until you make them again (refresh the summary, read the ad again,
  find competitors again).
- **Work that runs while you're away follows the language saved on your account.** Something you start
  from a page (reading your app's links, an ad analysis, a summary) uses the language of that page. A
  competitor search and other runs that finish in the background use the language in Settings ›
  Language. Choosing a language from the menu on a public page, or opening a page with `?lang=ja`, only
  changes it for this browser until you sign in and choose it in Settings.
- **Search engines** see the public page in each language at its own address: `/?lang=zh-TW`,
  `/?lang=ja` and `/?lang=ko` (plain `/` is English). Opening one of these also switches your browser
  to that language.

## Chinese, Japanese and Korean on composed ads

Composed ads set your words in your brand's fonts. When those fonts have no Chinese, Japanese or Korean
characters, the app uses **Noto Sans TC, JP or KR**, which come with the app (in
`studio/assets/fonts/cjk`, under the SIL Open Font License: see `OFL.txt` there). They hold the common
characters, regular and bold:

- Japanese: kana and the 2,136 jōyō kanji
- Traditional Chinese: the 5,401 frequently used characters of Big5
- Korean: the 2,350 everyday Hangul syllables of KS X 1001

Nothing is fetched to set these characters, so the words of your ads stay on your server. A rare
character outside these sets shows as an empty box, and the ad's card says which ones: change the
word, or upload a brand font that has it on the Brand page.

**Optional:** set the environment variable `CJK_FONT_FALLBACK=google` (on Vercel, or before `npm run
start`) to fill those rare characters from Google Fonts instead. This sends the missing characters (not
the whole ad) to Google. It is off unless you set it.
