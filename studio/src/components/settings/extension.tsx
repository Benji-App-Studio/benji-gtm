"use client";
// Settings → Ad Library extension: the free way to bring competitors' ads in. What it is, the zip to
// download, every step from unzipping to dropping the file on Research (with pictures of Meta's Ad
// Library and of the extension), what it can and can't touch, how to update it, and what to do when
// something goes wrong. The Research page's "Get the free extension" links here. The same steps and
// pictures are in release/docs/CHROME-EXTENSION.md; keep the two in step.
//
// Words: Chrome's and Meta's buttons are said in the viewer's language (both translate their pages);
// the extension's own buttons are said as the extension shows them in that language (EXT below, from
// lib/extension-words.ts, which matches the extension's locale files).
import Link from "next/link";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { APP_NAME, repoFileUrl } from "@/lib/brand-config";
import {
  AD_LIBRARY_HOME, EXTENSION_DOWNLOADS_FOLDER, EXTENSION_FOLDER, EXTENSION_NAME, EXTENSION_VERSION, EXTENSION_ZIP, EXTENSION_ZIP_NAME, extensionGuideImage,
} from "@/lib/extension-download";
import { useT } from "@/lib/i18n/client";
import { extensionWords } from "@/lib/extension-words";
import { workspaceHref } from "@/lib/workspace-schema";
import { IconCheck, IconCopy, IconDownload, IconExternal } from "../icons";
import { useWorkspaces } from "../nav/workspaces";
import { rich } from "../rich";
import { Button, buttonClass, cx, SettingsGroup, SettingsRow } from "../ui";
import { SettingsPage } from "./settings-ui";

const codeClass = "rounded-xs bg-control px-1 py-px font-mono text-xs text-ink";
const strong = "font-medium text-label";
/** This dashboard's address, as the extension stores it (an origin). Empty while rendering on the server. */
const useOrigin = () => useSyncExternalStore(() => () => undefined, () => window.location.origin, () => "");

export function ExtensionSettings() {
  const { t, locale } = useT();
  const EXT = extensionWords(locale);
  const origin = useOrigin();
  const { products } = useWorkspaces();
  const localDefault = origin === "http://localhost:3000";
  const b = (text: string) => <span className={strong}>{text}</span>;
  const code = (text: string) => <code className={codeClass}>{text}</code>;
  return (
    <SettingsPage page="extension">
      <SettingsGroup>
        <SettingsRow label={EXTENSION_NAME} description={t("Version {version}, for Google Chrome on a Mac or Windows computer. Free, and it needs no key.", { version: EXTENSION_VERSION })}>
          <a href={EXTENSION_ZIP} download className={buttonClass("primary")}><IconDownload />{t("Download the extension")}</a>
        </SettingsRow>
        <SettingsRow label={t("This dashboard's address")} description={rich(t("You give it to the extension once (step 7), so its {link} link comes back here."), { link: b(EXT.openDashboard) })}
          below={<CopyLine value={origin} label={t("This dashboard's address")} className="mt-2.5" />} />
      </SettingsGroup>

      <SettingsGroup title={t("Install it")} description={t("Once per computer, about two minutes.")}>
        <Step n={1} label={t("Download the extension")} description={rich(t("Click {button} above. Chrome saves {zip} in your Downloads folder."), { button: b(t("Download the extension")), zip: code(EXTENSION_ZIP_NAME) })} />
        <Step n={2} label={t("Open the zip and keep the folder")} description={rich(t("Double-click it (on Windows: right-click it, then {extract}). You get a folder called {folder}. Move it somewhere it can stay, such as Documents: Chrome runs the extension from this folder, so don't delete or move it later."), { extract: b(t("Extract All")), folder: code(EXTENSION_FOLDER) })} />
        <Step n={3} label={t("Open Chrome's extensions page")} description={t("Paste this into Chrome's address bar and press Enter (Chrome doesn't let a page link there).")}
          below={<CopyLine value="chrome://extensions" label={t("Chrome's extensions page")} className="mt-2.5" />} />
        <Step n={4} label={t("Turn on Developer mode")} description={t("Use the switch at the top right of that page. Three buttons appear under the title. Leave Developer mode on: Chrome turns the extension off whenever it's off.")}
          below={<Picture image="chrome-load-unpacked.png" width={1709} height={114} alt={t("Chrome's extensions page with Developer mode on, showing the Load unpacked, Pack extension and Update buttons")} caption={t("Chrome's extensions page with Developer mode on. You only need Load unpacked.")} />} />
        <Step n={5} label={t("Click Load unpacked and pick the folder")} description={rich(t("Select the {folder} folder itself (the one with {manifest} directly inside), not the zip, and click {select}. An {name} card with an orange icon appears, switched on."), { folder: code(EXTENSION_FOLDER), manifest: code("manifest.json"), select: b(t("Select")), name: b(EXTENSION_NAME) })} />
        <Step n={6} label={t("Pin it next to the address bar")} description={rich(t("Click the puzzle-piece icon to the right of Chrome's address bar, then the pin next to {name}. Its orange icon now sits beside the address bar."), { name: b(EXTENSION_NAME) })} />
        <Step n={7} label={t("Give it this dashboard's address")} description={localDefault
          ? rich(t("Nothing to do on this computer: the extension already points at {origin}. (On another address you would click the orange icon, then {change} next to Dashboard at the bottom, paste the address and click {save}.)"), { origin: code(origin), change: b(EXT.change), save: b(EXT.save) })
          : rich(t("Click the orange icon. At the bottom, next to {dashboard}, click {change}, paste {origin} (copy it above) and click {save}."), { dashboard: b(EXT.dashboard), change: b(EXT.change), origin: code(origin || t("this page's address")), save: b(EXT.save) })} />
      </SettingsGroup>

      <SettingsGroup title={t("Collect a competitor's ads")} description={t("A few minutes per competitor. Pictures of Meta's Ad Library are from November 2026; Meta changes its page now and then.")}>
        <Step n={8} label={t("Open Meta's Ad Library")} description={rich(t("Choose a country (or {all}), then {category} and {allAds}. You don't need to sign in to Facebook."), { all: b(t("All")), category: b(t("Ad category")), allAds: b(t("All ads")) })}
          action={<a href={AD_LIBRARY_HOME} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "sm")}>{t("Open the Ad Library")}<IconExternal /></a>}
          below={<Picture image="meta-choose-all-ads.jpg" width={800} height={600} alt={t("Meta's Ad Library search box with the country set to All and the Ad category menu open on All ads")} caption={t("Country: All. Ad category: All ads.")} />} />
        <Step n={9} label={t("Search for the competitor and pick it under Advertisers")} description={rich(t("Type its name and click it in the {advertisers} list. The top line, {exact}, is a keyword search: it shows every advertiser's ads that mention the words, not one competitor's."), { advertisers: b(t("Advertisers")), exact: b(t("Search this exact phrase")) })}
          below={<Picture image="meta-search-advertiser.jpg" width={800} height={600} alt={t("The Ad Library search box with a brand name typed, showing a keyword line on top and the brand's Pages under Advertisers")} caption={t("Pick the competitor under Advertisers, not the keyword line on top.")} />} />
        <Step n={10} label={t("Check you're on its page of ads")} description={rich(t("You see its name, about how many results there are and {active}. The address contains {param}. Shortcut: on the Research page, click {open} next to a competitor to land here."), { active: b(t("Active status: Active ads")), param: code("view_all_page_id="), open: b(t("Open")) })}
          below={<Picture image="meta-page-ads.jpg" width={800} height={600} alt={t("A brand's page of ads in the Ad Library: its name, about 290 results, the active ads filter and the first ad cards")} caption={t("An advertiser's page of ads, ready to collect.")} />} />
        <Step n={11} label={t("Click the orange icon, then Collect ads")} description={rich(t("The popup says {useThisPage} and how many ads Meta shows. {adsToRead} starts at {twenty} pages (about 220 ads): Meta lists its most-shown ads first, and shorter runs are less likely to be stopped. Choose {all} only for a small advertiser."), { useThisPage: b(EXT.useThisPage), adsToRead: b(EXT.adsToRead), twenty: b("20"), all: b(EXT.all) })}
          below={<Picture image="popup-collect.png" width={360} height={448} narrow alt={t("The extension's popup on an advertiser's page: Use this page, country, active ads only, ads to read, and the Collect ads button")} caption={t("The extension's popup (an example advertiser).")} />} />
        <Step n={12} label={t("Let it run")} description={rich(t("A small window opens at the right of your screen and scrolls by itself, about 10 ads every 9 seconds. You can keep working in other windows, but keep part of this one visible: Chrome pauses windows that are minimized or fully covered. {stop} ends early and keeps what it has."), { stop: b(EXT.stopAndSave) })}
          below={<Picture image="panel-collecting.png" width={440} height={304} narrow alt={t("The collector panel in the corner of the small window: pages read, ads found and the time to the next scroll")} caption={t("The panel in the collector window's corner.")} />} />
        <Step n={13} label={t("Find the file")} description={rich(t("When it's done, Chrome shows a notification and the file is in {folder}, named after the competitor, its Page ID and the date (for example {example}). {finder} in the popup opens the folder."), { folder: code(`Downloads/${EXTENSION_DOWNLOADS_FOLDER}`), example: code("rival-travel-123456-2026-11-19.json"), finder: b(EXT.showInFinder) })}
          below={<Picture image="popup-done.png" width={360} height={520} narrow alt={t("The extension's popup after a run: 50 ads saved in Downloads/Ad Library, with Show in Finder, Open your dashboard and the next steps")} caption={t("Done: the popup says where the file is and what to do next.")} />} />
      </SettingsGroup>

      <SettingsGroup title={t("Put the file in {app}", { app: APP_NAME })}>
        <Step n={14} label={t("Drop it on the Research page")} description={rich(t("Open your app's Research page and drag the file from Finder anywhere onto it, or click {import} and choose it. Several files at once are fine. Choose whose ads they are, check the summary and confirm."), { import: b(t("Import files")) })}
          below={products && products.length > 0 ? (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {products.slice(0, 4).map((product) => (
                <Link key={product.id} href={workspaceHref(product.id, "research")} className={cx(buttonClass("secondary", "sm"), "max-w-full min-w-0")}>
                  <span className="max-w-60 truncate">{products.length > 1 ? t("{app}: Research", { app: product.name }) : t("Go to Research")}</span>
                </Link>
              ))}
            </div>
          ) : null} />
        <Step n={15} label={t("Let the pictures and videos copy over")} description={t("The ads show at once. Their images and videos are copied into your own storage over the next minutes, because Meta's links stop working after a few days. Collecting the same competitor again later updates its ads in place.")} />
      </SettingsGroup>

      <SettingsGroup title={t("What it can and can't do")}>
        <SettingsRow label={t("It only reads Meta's public Ad Library")} description={t("Chrome lets it open facebook.com/ads/library and nothing else. It doesn't read the rest of Facebook, your other tabs, your cookies or your history.")} />
        <SettingsRow label={t("It never needs a password")} description={t("You don't sign in to anything to use it, and it never asks for a Facebook, Google or dashboard password. If something that says it's this extension asks for one, close it.")} />
        <SettingsRow label={t("It sends nothing anywhere")} description={t("The file stays on your computer until you drop it on Research. The dashboard address is only used to open a tab.")} />
        <SettingsRow label={t("Collect safely")} description={t("Meta limits connections that load too much, too fast. Collect one competitor at a time, at least 30 minutes apart and a handful a day, on your normal connection (no VPN). If Meta pushes back, the extension stops, saves what it has and waits 6 hours before the next run. Meta's terms don't allow automated collection without its permission: keep it to occasional research.")} />
      </SettingsGroup>

      <SettingsGroup title={t("Update to a newer version")} description={t("When {app} is updated, this page offers the newest extension. The version on its card at chrome://extensions should read {version}.", { app: APP_NAME, version: EXTENSION_VERSION })}>
        <Step n={1} label={t("Download it again")} description={rich(t("Click {button} at the top of this page and open the zip."), { button: b(t("Download the extension")) })} />
        <Step n={2} label={t("Replace the files in your folder")} description={rich(t("Copy the new files into your existing {folder} folder, replacing the old ones. Keep the folder where it is, so Chrome keeps the extension's limits and history."), { folder: code(EXTENSION_FOLDER) })} />
        <Step n={3} label={t("Reload it in Chrome")} description={rich(t("At {page}, click the round reload arrow on the {name} card, then reload any open Ad Library tabs."), { page: code("chrome://extensions"), name: EXTENSION_NAME })} />
      </SettingsGroup>

      <SettingsGroup title={t("If something goes wrong")}>
        <Problem label={t("The orange icon isn't next to the address bar")} fix={rich(t("Click the puzzle-piece icon and pin {name}. If its card at {page} is switched off or the icon is grey, Developer mode was turned off: turn it back on and the extension comes back."), { name: EXTENSION_NAME, page: code("chrome://extensions") })} />
        <Problem label={t("“Manifest file is missing or unreadable”")} fix={rich(t("You picked the zip, a file, or the wrong folder. Pick the folder that directly contains {manifest} (if there's a folder of the same name inside another, pick the inner one)."), { manifest: code("manifest.json") })} />
        <Problem label={t("The card at chrome://extensions shows an error")} fix={t("The folder you loaded was moved or deleted. Put it back, or do steps 2 and 5 again.")} />
        <Problem label={t("The popup says “This tab isn't Meta's Ad Library” or “Pick an advertiser first”")} fix={rich(t("The extension only works on an advertiser's page of ads (steps 8 to 10). Click {open} in the popup, pick the competitor under Advertisers, then click the icon again. If the count is missing on the right page, reload the page."), { open: b(EXT.openAdLibrary) })}
          picture={<Picture image="popup-not-ad-library.png" width={360} height={682} narrow alt={t("The extension's popup on another website, explaining that it only works on Meta's Ad Library, with an Open the Ad Library button")} caption={t("What the popup shows on any other page.")} />} />
        <Problem label={t("“Meta limited this connection” and a time")} fix={t("Meta blocks fast or repeated runs for a while. The extension stopped without trying to get around it and kept what it had (that file imports as usual). Wait until the time shown, then collect less often, read fewer pages (10 or 20) and turn off any VPN.")} />
        <Problem label={t("“Paused: the collector window is minimized or covered”")} fix={rich(t("Bring the small window back into view; {show} in the popup does it. It carries on by itself."), { show: b(EXT.showWindow) })} />
        <Problem label={t("Research says the file isn't an ads file, or has no ads")} fix={rich(t("Drop the {json} file from {folder} as the extension saved it: don't open and re-save it, and don't change its name's ending. Files from other tools aren't accepted. A file with no ads means Meta showed none: check you picked the advertiser (not a keyword) and try the country All."), { json: code(".json"), folder: code(`Downloads/${EXTENSION_DOWNLOADS_FOLDER}`) })} />
        <Problem label={t("0 ads, or far fewer than Meta shows")} fix={rich(t("Check the address has {param} and try the country All. A run stopped early says why in the popup; the file still has everything up to there."), { param: code("view_all_page_id=") })} />
        <SettingsRow label={t("More detail")} description={t("Every option, limit and message is in the extension's full guide.")}>
          <a href={repoFileUrl("chrome-extension/README.md")} target="_blank" rel="noopener noreferrer" className={buttonClass("ghost", "sm")}>{t("Full guide")}<IconExternal /></a>
        </SettingsRow>
      </SettingsGroup>
    </SettingsPage>
  );
}

/** A numbered step: its number and name, one muted paragraph, an optional button and a picture under it. */
function Step({ n, label, description, action, below }: { n: number; label: string; description: ReactNode; action?: ReactNode; below?: ReactNode }) {
  return (
    <SettingsRow label={<span className="flex items-center gap-2"><span className="grid size-[18px] shrink-0 place-items-center rounded-full bg-control text-[11px] leading-none font-medium text-label tabular-nums">{n}</span>{label}</span>}
      description={<span className="block max-w-xl">{description}</span>} below={below}>
      {action}
    </SettingsRow>
  );
}

function Problem({ label, fix, picture }: { label: ReactNode; fix: ReactNode; picture?: ReactNode }) {
  return <SettingsRow label={label} description={<span className="block max-w-xl">{fix}</span>} below={picture} />;
}

/** A screenshot under a step, with a short caption. `narrow` ones (the extension's popup) keep their small size. */
function Picture({ image, width, height, alt, caption, narrow = false }: { image: string; width: number; height: number; alt: string; caption: string; narrow?: boolean }) {
  return (
    <figure className="mt-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={extensionGuideImage(image)} width={width} height={height} alt={alt} loading="lazy" decoding="async"
        className={cx("h-auto rounded-small border border-line bg-raised", narrow ? "w-full max-w-[300px]" : "w-full max-w-[560px]")} />
      <figcaption className="mt-1.5 text-xs text-muted">{caption}</figcaption>
    </figure>
  );
}

/** One line to copy (this dashboard's address, chrome://extensions), in the mono face, with a copy button. */
function CopyLine({ value, label, className }: { value: string; label: string; className?: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { /* no clipboard access: one click on the text selects it for copying by hand */ }
  }
  return (
    <div className={cx("flex flex-wrap items-center gap-2", className)}>
      <code aria-label={label} className="min-h-7 min-w-0 flex-[1_1_220px] rounded-control border border-hairline bg-raised px-2.5 py-1 font-mono text-xs leading-5 break-all text-ink select-all">{value || " "}</code>
      <Button type="button" variant="secondary" onClick={() => { void copy(); }} disabled={!value}>{copied ? <IconCheck /> : <IconCopy />}{copied ? t("Copied") : t("Copy")}</Button>
    </div>
  );
}
