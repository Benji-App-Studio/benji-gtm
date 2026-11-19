// The Chrome extension people install from the Research page: its name, version, the folder its zip
// unpacks to, where the app serves the zip and where its guide lives. chrome-extension/build.mjs writes
// the zip and chrome-extension/manifest.json carries the name and version (a test keeps all of them in step).
export const EXTENSION_NAME = "Ad Library Collector";
/** The version in the zip (chrome-extension/manifest.json). */
export const EXTENSION_VERSION = "0.5.1";
/** The folder the zip unpacks to: the one to choose in Chrome's "Load unpacked". */
export const EXTENSION_FOLDER = "ad-library-extension";
export const EXTENSION_ZIP_NAME = `${EXTENSION_FOLDER}.zip`;
/** The download link (a file in studio/public/downloads). */
export const EXTENSION_ZIP = `/downloads/${EXTENSION_ZIP_NAME}`;
/** Collected files land in ~/Downloads/<this>/. */
export const EXTENSION_DOWNLOADS_FOLDER = "Ad Library";
/** The step-by-step guide (Settings → Ad Library extension). */
export const EXTENSION_GUIDE = "/app/settings/extension";
/** The guide's pictures (studio/public/guides/extension; release/docs/CHROME-EXTENSION.md shows the same files). */
export const extensionGuideImage = (file: string) => `/guides/extension/${file}`;
/** Meta's Ad Library with every country and "All ads" chosen. */
export const AD_LIBRARY_HOME = "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&media_type=all";
