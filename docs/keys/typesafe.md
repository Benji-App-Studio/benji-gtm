# TypeSafe (Jev) API key

> **What this key does in the app:** TypeSafe is an optional, alternative AI. Its model is called
> **Jev**: instead of writing text, it answers fixed questions (yes or no, pick one, give a score)
> very cheaply. Benji GTM can use it to read ads and check creatives once you switch to it in
> **Settings > AI models**. Without it, nothing stops working: OpenAI does these jobs.
>
> **Required or optional:** Optional (Advanced).
>
> **What it costs:** TypeSafe's site lists Jev at $42 per billion input tokens (that is $0.042 per
> million). Its official docs don't describe free credit or how billing is set up. Checked on
> typesafe.ai on 19 November 2026.

⚠️ **Access may be limited.** Jev is in **early access**. TypeSafe has opened and paused new
sign-ups more than once since September 2026. If you can't get an account, skip this key: you lose
nothing, OpenAI covers the same jobs.

## Before you start

- A Google account or an email address.
- Your OpenAI key already saved in Benji GTM (TypeSafe is an extra, not a replacement for setup).

## Steps

### Part 1. Sign in to the TypeSafe console

1. Open https://console.typesafe.ai.
2. Click **Continue with Google**, or choose **Email me a code instead**, type your email, and
   enter the code TypeSafe emails you. There is no password.
3. If you see a welcome page, click **Enter console**.
   ✅ You see the console, with a menu on the left (Home, Playground, Usage, API Keys,
   Documentation).
4. If instead you see a waitlist, "Contact sales" or "sign-ups are paused", stop here: you can't get
   a key yet. Come back later.

### Part 2. Create the key

1. Click **API Keys** in the left menu (or open https://console.typesafe.ai/keys directly).
2. Click the button that creates a new key.
3. If it asks for a name, type `Benji GTM`.
4. Confirm.
   ✅ The new key is shown. Copy it now; assume it is shown only once.
5. Click the copy button next to the key.

### Part 3. Paste it into Benji GTM

1. Open **Settings > API keys**.
2. Scroll to **Advanced** and find the **TypeSafe** row.
3. Click **Add** (or **Replace**).
4. Paste the key into the box.
5. Click **Save and check**.
   ✅ The row says "Saved." and then "Set, ending …. TypeSafe has no quick way to check a key. It's
   saved and is used the next time an ad is read." That is normal: the app can't test a TypeSafe
   key until it uses it.

### Part 4. Switch the app to TypeSafe

1. Open **Settings > AI models**.
2. Under **Provider**, in the **AI provider** row, choose **TypeSafe**.
3. Click **Save** (at the bottom of the page). Leave the model names as they are.
   ✅ The page says "Saved." The yes/no and scoring checks now run on Jev; OpenAI still writes
   the long analyses, so keep your OpenAI key. To go back, choose **OpenAI** and click **Save**.

## What the key looks like

TypeSafe doesn't document the format. Treat whatever the console gives you as the whole key, and
copy all of it. It is sent to TypeSafe as `Authorization: Bearer <key>`.

## If it doesn't work

- **Reading ads fails with "Missing or invalid API key" (401).** The key was copied with a space or
  a missing piece, or it was deleted in the console. Create a new key and use **Replace**.
- **"Too many requests" (429).** You hit TypeSafe's rate limit. Wait a minute; the app retries.
- **You can't sign in or create a key.** Access is still limited (see the warning at the top).
  Switch **Settings > AI models > AI provider** back to **OpenAI** and carry on.
- **Results look wrong for a job.** Switch back to **OpenAI** for now. TypeSafe answers fixed
  questions well; it does not write long analyses.

## Keep it safe

- Never paste the key into a chat with an AI helper, an email, a screenshot or a file in your
  GitHub copy.
- To delete a key: open https://console.typesafe.ai/keys and remove it there, then remove it in
  Benji GTM too (**Settings > API keys > TypeSafe > ⋯ > Remove**).

---

Checked against (19 November 2026): https://typesafe.ai, https://docs.typesafe.ai/,
https://docs.typesafe.ai/introduction/quickstart (links "Get an API key from the TypeSafe console"
to https://console.typesafe.ai/keys), https://docs.typesafe.ai/api/errors, the SDK the app uses
(`@typesafe-ai/sdk` 0.6.0: key from `TYPESAFE_API_KEY`, sent as a Bearer token to
https://api.typesafe.ai, default model `jev-latest`, homepage https://docs.typesafe.ai/sdk/javascript).

**Not confirmed:** the console (console.typesafe.ai) blocks automated visits, so the sign-in
choices, the menu names and the early-access status come from an independent guide
(https://flaviocopes.com/jev-api-key/, updated 9 October 2026), not from TypeSafe. The exact name
of the "create key" button, whether the key is shown only once, the key's format, and any free
credit or billing setup are not documented anywhere official.
