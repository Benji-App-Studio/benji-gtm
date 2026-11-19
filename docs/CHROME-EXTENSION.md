# The Ad Library extension (Chrome)

> **What this file is for:** installing the free Chrome extension that collects one competitor's ads
> from the Meta Ad Library, and bringing them into Benji GTM.
>
> **When to use it:** when you want a competitor's Meta ads (videos, images, copy, how long each has
> run) without paying for automatic collection. It needs no key. Allow two minutes to install it,
> then a few minutes per competitor.

The full reference (every option, the limits, all error messages) is in
[chrome-extension/README.md](../chrome-extension/README.md). This page is the short path.

## Before you start

- **Google Chrome** on your Mac (version 116 or newer). Other Chromium browsers usually work but aren't tested.
- Benji GTM running (`bash start.command`), signed in, with the app you're researching.
- Your normal internet connection. Avoid VPNs: Meta limits them much sooner.

## Install it (once)

1. **Get the extension file.** In Benji GTM, open your app's **Research** page, click
   **How to get ads in, and stored media**, find **The Ad Library extension** and click **Download**.
   The same file is in your copy of the repository at `studio/public/downloads/ad-library-extension.zip`.
2. **Open it.** Double-click `ad-library-extension.zip` in Finder. macOS puts a folder called
   `ad-library-extension` next to it, with `manifest.json` inside.
3. **Move that folder somewhere it can stay**, for example your Documents folder (not inside the
   app's folder). Chrome runs the extension from this folder every time it starts; if the folder is
   moved or deleted, the extension stops working.
4. **Open Chrome's extensions page.** Type `chrome://extensions` in Chrome's address bar and press Return.
5. **Turn on Developer mode** with the switch at the top right. Leave it on: Chrome turns the
   extension off whenever Developer mode is off.
6. **Load it.** Click **Load unpacked**, select the `ad-library-extension` folder itself (the one with
   `manifest.json` inside, not the zip) and click **Select**.
7. **Pin it.** Click the puzzle-piece icon to the right of the address bar, then the pin next to
   **Ad Library Collector**.

✅ **Checkpoint:** an **Ad Library Collector** card with an orange icon is on the extensions page,
switched on, and the orange icon is next to the address bar.

## Tell it where your dashboard is (only if it isn't on this Mac)

The extension's popup has an **Open your dashboard** link that starts as `http://localhost:3000`,
your copy on this Mac. If you use a copy on Vercel instead:

1. Click the orange icon.
2. At the bottom, next to **Dashboard**, click **Change**.
3. Type your address (for example `https://your-app.vercel.app`) and click **Save**.

Leave the field empty to go back to `http://localhost:3000`. The extension only opens this address in
a tab; it never sends anything to it.

## Collect a competitor's ads

1. Open https://www.facebook.com/ads/library/, choose a country (or "All") and "All ads", search for
   the competitor and pick it from the suggestions. Or click **Open** next to a competitor on the
   Research page. You're on the right page when the address contains `view_all_page_id=`.
2. Click the orange icon. The popup shows **Use this page** and about how many ads Meta has for it.
   Click **Collect ads**.
3. A small collector window opens at the right of your screen and scrolls by itself. Keep part of it
   visible until it finishes (Chrome pauses windows that are minimized or fully covered). You can
   keep working in other windows.

✅ **Checkpoint:** a Chrome notification says the run is done, and the file is in your Downloads
folder under `Ad Library` (named after the competitor, its Page ID and the date).

## Import the file

1. In Benji GTM, open your app's **Research** page.
2. Drag the file from Finder onto the page, or click **Import file** and choose it.
3. Choose **Competitors** (or **Our ads** for your own), check the summary and confirm.

✅ **Checkpoint:** the competitor's ads appear on the Research page. Their images and videos are copied
into your own storage in the background over the next minutes.

## Troubleshooting

- **"Manifest file is missing or unreadable":** you picked the zip or the wrong folder. Pick the
  folder that directly contains `manifest.json`.
- **The icon is gone or greyed out:** Developer mode was turned off. Turn it back on at
  `chrome://extensions` and the extension comes back.
- **"Paused: the collector window is minimized or covered":** bring the small window back into view.
- **"Meta limited this connection" and a cooldown time:** wait until that time. Run less often and
  turn off any VPN.
- **0 ads:** check you're on the competitor's own Ad Library page (`view_all_page_id=` in the
  address) and try the country "All".
- More in [chrome-extension/README.md](../chrome-extension/README.md#troubleshooting).

💡 **Beginner tip:** after you update Benji GTM, the Research page offers the newest extension. To
update it, replace the contents of your `ad-library-extension` folder with the new files and click
the reload arrow on its card at `chrome://extensions`.

⚠️ Meta's terms don't allow automated collection without its permission. The extension behaves like
one person browsing and stops at the first sign Meta pushes back, but keep runs small and occasional.
