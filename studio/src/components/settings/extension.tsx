"use client";
// Settings → Ad Library extension: the free way to bring competitors' ads in. What it is, the zip to
// download, every step from unzipping to dropping the file on Research (with pictures of Meta's Ad
// Library and of the extension), what it can and can't touch, how to update it, and what to do when
// something goes wrong. The Research page's "Get the free extension" links here. The same steps and
// pictures are in release/docs/CHROME-EXTENSION.md; keep the two in step.
import Link from "next/link";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { APP_NAME, repoFileUrl } from "@/lib/brand-config";
import {
  AD_LIBRARY_HOME, EXTENSION_DOWNLOADS_FOLDER, EXTENSION_FOLDER, EXTENSION_NAME, EXTENSION_VERSION, EXTENSION_ZIP, EXTENSION_ZIP_NAME, extensionGuideImage,
} from "@/lib/extension-download";
import { workspaceHref } from "@/lib/workspace-schema";
import { IconCheck, IconCopy, IconDownload, IconExternal } from "../icons";
import { useWorkspaces } from "../nav/workspaces";
import { Button, buttonClass, cx, SettingsGroup, SettingsRow } from "../ui";
import { SettingsPage } from "./settings-ui";

const codeClass = "rounded-xs bg-control px-1 py-px font-mono text-xs text-ink";
const strong = "font-medium text-label";
/** This dashboard's address, as the extension stores it (an origin). Empty while rendering on the server. */
const useOrigin = () => useSyncExternalStore(() => () => undefined, () => window.location.origin, () => "");

export function ExtensionSettings() {
  const origin = useOrigin();
  const { products } = useWorkspaces();
  const localDefault = origin === "http://localhost:3000";
  return (
    <SettingsPage page="extension">
      <SettingsGroup>
        <SettingsRow label={EXTENSION_NAME} description={<>Version {EXTENSION_VERSION}, for Google Chrome on a Mac or Windows computer. Free, and it needs no key.</>}>
          <a href={EXTENSION_ZIP} download className={buttonClass("primary")}><IconDownload />Download the extension</a>
        </SettingsRow>
        <SettingsRow label="This dashboard's address" description="You give it to the extension once (step 7), so its Open your dashboard link comes back here."
          below={<CopyLine value={origin} label="This dashboard's address" className="mt-2.5" />} />
      </SettingsGroup>

      <SettingsGroup title="Install it" description="Once per computer, about two minutes.">
        <Step n={1} label="Download the extension" description={<>Click <span className={strong}>Download the extension</span> above. Chrome saves <code className={codeClass}>{EXTENSION_ZIP_NAME}</code> in your Downloads folder.</>} />
        <Step n={2} label="Open the zip and keep the folder" description={<>Double-click it (on Windows: right-click it, then <span className={strong}>Extract All</span>). You get a folder called <code className={codeClass}>{EXTENSION_FOLDER}</code>. Move it somewhere it can stay, such as Documents: Chrome runs the extension from this folder, so don&apos;t delete or move it later.</>} />
        <Step n={3} label="Open Chrome's extensions page" description="Paste this into Chrome's address bar and press Enter (Chrome doesn't let a page link there)."
          below={<CopyLine value="chrome://extensions" label="Chrome's extensions page" className="mt-2.5" />} />
        <Step n={4} label="Turn on Developer mode" description={<>Use the switch at the top right of that page. Three buttons appear under the title. Leave Developer mode on: Chrome turns the extension off whenever it&apos;s off.</>}
          below={<Picture image="chrome-load-unpacked.png" width={1709} height={114} alt="Chrome's extensions page with Developer mode on, showing the Load unpacked, Pack extension and Update buttons" caption="Chrome's extensions page with Developer mode on. You only need Load unpacked." />} />
        <Step n={5} label="Click Load unpacked and pick the folder" description={<>Select the <code className={codeClass}>{EXTENSION_FOLDER}</code> folder itself (the one with <code className={codeClass}>manifest.json</code> directly inside), not the zip, and click <span className={strong}>Select</span>. An <span className={strong}>{EXTENSION_NAME}</span> card with an orange icon appears, switched on.</>} />
        <Step n={6} label="Pin it next to the address bar" description={<>Click the puzzle-piece icon to the right of Chrome&apos;s address bar, then the pin next to <span className={strong}>{EXTENSION_NAME}</span>. Its orange icon now sits beside the address bar.</>} />
        <Step n={7} label="Give it this dashboard's address" description={localDefault
          ? <>Nothing to do on this computer: the extension already points at <code className={codeClass}>{origin}</code>. (On another address you would click the orange icon, then <span className={strong}>Change</span> next to Dashboard at the bottom, paste the address and click <span className={strong}>Save</span>.)</>
          : <>Click the orange icon. At the bottom, next to <span className={strong}>Dashboard</span>, click <span className={strong}>Change</span>, paste <code className={codeClass}>{origin || "this page's address"}</code> (copy it above) and click <span className={strong}>Save</span>.</>} />
      </SettingsGroup>

      <SettingsGroup title="Collect a competitor's ads" description="A few minutes per competitor. Pictures of Meta's Ad Library are from November 2026; Meta changes its page now and then.">
        <Step n={8} label="Open Meta's Ad Library" description={<>Choose a country (or <span className={strong}>All</span>), then <span className={strong}>Ad category</span> and <span className={strong}>All ads</span>. You don&apos;t need to sign in to Facebook.</>}
          action={<a href={AD_LIBRARY_HOME} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "sm")}>Open the Ad Library<IconExternal /></a>}
          below={<Picture image="meta-choose-all-ads.jpg" width={800} height={600} alt="Meta's Ad Library search box with the country set to All and the Ad category menu open on All ads" caption="Country: All. Ad category: All ads." />} />
        <Step n={9} label="Search for the competitor and pick it under Advertisers" description={<>Type its name and click it in the <span className={strong}>Advertisers</span> list. The top line, <span className={strong}>Search this exact phrase</span>, is a keyword search: it shows every advertiser&apos;s ads that mention the words, not one competitor&apos;s.</>}
          below={<Picture image="meta-search-advertiser.jpg" width={800} height={600} alt="The Ad Library search box with a brand name typed, showing a keyword line on top and the brand's Pages under Advertisers" caption="Pick the competitor under Advertisers, not the keyword line on top." />} />
        <Step n={10} label="Check you're on its page of ads" description={<>You see its name, about how many results there are and <span className={strong}>Active status: Active ads</span>. The address contains <code className={codeClass}>view_all_page_id=</code>. Shortcut: on the Research page, click <span className={strong}>Open</span> next to a competitor to land here.</>}
          below={<Picture image="meta-page-ads.jpg" width={800} height={600} alt="A brand's page of ads in the Ad Library: its name, about 290 results, the active ads filter and the first ad cards" caption="An advertiser's page of ads, ready to collect." />} />
        <Step n={11} label="Click the orange icon, then Collect ads" description={<>The popup says <span className={strong}>Use this page</span> and how many ads Meta shows. <span className={strong}>Ads to read</span> starts at <span className={strong}>20</span> pages (about 220 ads): Meta lists its most-shown ads first, and shorter runs are less likely to be stopped. Choose <span className={strong}>All</span> only for a small advertiser.</>}
          below={<Picture image="popup-collect.png" width={360} height={448} narrow alt="The extension's popup on an advertiser's page: Use this page, country, active ads only, ads to read, and the Collect ads button" caption="The extension's popup (an example advertiser)." />} />
        <Step n={12} label="Let it run" description={<>A small window opens at the right of your screen and scrolls by itself, about 10 ads every 9 seconds. You can keep working in other windows, but keep part of this one visible: Chrome pauses windows that are minimized or fully covered. <span className={strong}>Stop and save</span> ends early and keeps what it has.</>}
          below={<Picture image="panel-collecting.png" width={440} height={304} narrow alt="The collector panel in the corner of the small window: pages read, ads found and the time to the next scroll" caption="The panel in the collector window's corner." />} />
        <Step n={13} label="Find the file" description={<>When it&apos;s done, Chrome shows a notification and the file is in <code className={codeClass}>Downloads/{EXTENSION_DOWNLOADS_FOLDER}</code>, named after the competitor, its Page ID and the date (for example <code className={codeClass}>rival-travel-123456-2026-11-19.json</code>). <span className={strong}>Show in Finder</span> in the popup opens the folder.</>}
          below={<Picture image="popup-done.png" width={360} height={520} narrow alt="The extension's popup after a run: 50 ads saved in Downloads/Ad Library, with Show in Finder, Open your dashboard and the next steps" caption="Done: the popup says where the file is and what to do next." />} />
      </SettingsGroup>

      <SettingsGroup title={`Put the file in ${APP_NAME}`}>
        <Step n={14} label="Drop it on the Research page" description={<>Open your app&apos;s Research page and drag the file from Finder anywhere onto it, or click <span className={strong}>Import files</span> and choose it. Several files at once are fine. Choose whose ads they are, check the summary and confirm.</>}
          below={products && products.length > 0 ? (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {products.slice(0, 4).map((product) => (
                <Link key={product.id} href={workspaceHref(product.id, "research")} className={cx(buttonClass("secondary", "sm"), "max-w-full min-w-0")}>
                  <span className="max-w-60 truncate">{products.length > 1 ? `${product.name}: Research` : "Go to Research"}</span>
                </Link>
              ))}
            </div>
          ) : null} />
        <Step n={15} label="Let the pictures and videos copy over" description="The ads show at once. Their images and videos are copied into your own storage over the next minutes, because Meta's links stop working after a few days. Collecting the same competitor again later updates its ads in place." />
      </SettingsGroup>

      <SettingsGroup title="What it can and can't do">
        <SettingsRow label="It only reads Meta's public Ad Library" description="Chrome lets it open facebook.com/ads/library and nothing else. It doesn't read the rest of Facebook, your other tabs, your cookies or your history." />
        <SettingsRow label="It never needs a password" description="You don't sign in to anything to use it, and it never asks for a Facebook, Google or dashboard password. If something that says it's this extension asks for one, close it." />
        <SettingsRow label="It sends nothing anywhere" description={<>The file stays on your computer until you drop it on Research. The dashboard address is only used to open a tab.</>} />
        <SettingsRow label="Collect safely" description="Meta limits connections that load too much, too fast. Collect one competitor at a time, at least 30 minutes apart and a handful a day, on your normal connection (no VPN). If Meta pushes back, the extension stops, saves what it has and waits 6 hours before the next run. Meta's terms don't allow automated collection without its permission: keep it to occasional research." />
      </SettingsGroup>

      <SettingsGroup title="Update to a newer version" description={`When ${APP_NAME} is updated, this page offers the newest extension. The version on its card at chrome://extensions should read ${EXTENSION_VERSION}.`}>
        <Step n={1} label="Download it again" description={<>Click <span className={strong}>Download the extension</span> at the top of this page and open the zip.</>} />
        <Step n={2} label="Replace the files in your folder" description={<>Copy the new files into your existing <code className={codeClass}>{EXTENSION_FOLDER}</code> folder, replacing the old ones. Keep the folder where it is, so Chrome keeps the extension&apos;s limits and history.</>} />
        <Step n={3} label="Reload it in Chrome" description={<>At <code className={codeClass}>chrome://extensions</code>, click the round reload arrow on the {EXTENSION_NAME} card, then reload any open Ad Library tabs.</>} />
      </SettingsGroup>

      <SettingsGroup title="If something goes wrong">
        <Problem label="The orange icon isn't next to the address bar" fix={<>Click the puzzle-piece icon and pin {EXTENSION_NAME}. If its card at <code className={codeClass}>chrome://extensions</code> is switched off or the icon is grey, Developer mode was turned off: turn it back on and the extension comes back.</>} />
        <Problem label="&ldquo;Manifest file is missing or unreadable&rdquo;" fix={<>You picked the zip, a file, or the wrong folder. Pick the folder that directly contains <code className={codeClass}>manifest.json</code> (if there&apos;s a folder of the same name inside another, pick the inner one).</>} />
        <Problem label="The card at chrome://extensions shows an error" fix="The folder you loaded was moved or deleted. Put it back, or do steps 2 and 5 again." />
        <Problem label="The popup says &ldquo;This tab isn't Meta's Ad Library&rdquo; or &ldquo;Pick an advertiser first&rdquo;" fix={<>The extension only works on an advertiser&apos;s page of ads (steps 8 to 10). Click <span className={strong}>Open the Ad Library</span> in the popup, pick the competitor under Advertisers, then click the icon again. If the count is missing on the right page, reload the page.</>}
          picture={<Picture image="popup-not-ad-library.png" width={360} height={682} narrow alt="The extension's popup on another website, explaining that it only works on Meta's Ad Library, with an Open the Ad Library button" caption="What the popup shows on any other page." />} />
        <Problem label="&ldquo;Meta limited this connection&rdquo; and a time" fix="Meta blocks fast or repeated runs for a while. The extension stopped without trying to get around it and kept what it had (that file imports as usual). Wait until the time shown, then collect less often, read fewer pages (10 or 20) and turn off any VPN." />
        <Problem label="&ldquo;Paused: the collector window is minimized or covered&rdquo;" fix={<>Bring the small window back into view; <span className={strong}>Show the window</span> in the popup does it. It carries on by itself.</>} />
        <Problem label="Research says the file isn't an ads file, or has no ads" fix={<>Drop the <code className={codeClass}>.json</code> file from <code className={codeClass}>Downloads/{EXTENSION_DOWNLOADS_FOLDER}</code> as the extension saved it: don&apos;t open and re-save it, and don&apos;t change its name&apos;s ending. Files from other tools aren&apos;t accepted. A file with no ads means Meta showed none: check you picked the advertiser (not a keyword) and try the country All.</>} />
        <Problem label="0 ads, or far fewer than Meta shows" fix={<>Check the address has <code className={codeClass}>view_all_page_id=</code> and try the country All. A run stopped early says why in the popup; the file still has everything up to there.</>} />
        <SettingsRow label="More detail" description="Every option, limit and message is in the extension's full guide.">
          <a href={repoFileUrl("chrome-extension/README.md")} target="_blank" rel="noopener noreferrer" className={buttonClass("ghost", "sm")}>Full guide<IconExternal /></a>
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
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { /* no clipboard access: one click on the text selects it for copying by hand */ }
  }
  return (
    <div className={cx("flex flex-wrap items-center gap-2", className)}>
      <code aria-label={label} className="min-h-7 min-w-0 flex-[1_1_220px] rounded-control border border-hairline bg-raised px-2.5 py-1 font-mono text-xs leading-5 break-all text-ink select-all">{value || " "}</code>
      <Button type="button" variant="secondary" onClick={() => { void copy(); }} disabled={!value}>{copied ? <IconCheck /> : <IconCopy />}{copied ? "Copied" : "Copy"}</Button>
    </div>
  );
}
