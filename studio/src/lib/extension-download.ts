// The Chrome extension people install from the Research page: its name, the folder its zip unpacks
// to and where the app serves the zip. chrome-extension/build.mjs writes the zip and
// chrome-extension/manifest.json carries the name (a test keeps all of them in step).
export const EXTENSION_NAME = "Ad Library Collector";
/** The folder the zip unpacks to: the one to choose in Chrome's "Load unpacked". */
export const EXTENSION_FOLDER = "ad-library-extension";
export const EXTENSION_ZIP_NAME = `${EXTENSION_FOLDER}.zip`;
/** The download link (a file in studio/public/downloads). */
export const EXTENSION_ZIP = `/downloads/${EXTENSION_ZIP_NAME}`;
/** Collected files land in ~/Downloads/<this>/. */
export const EXTENSION_DOWNLOADS_FOLDER = "Ad Library";
