// The Ad Library extension's own buttons and labels, as the extension shows them in each language
// (chrome-extension/locales/*.json, version 0.6.0 and later). Guides that tell people what to click in
// the extension use these, so the words on the page match the words in the popup.
// lib/i18n/glossary.test.ts checks every value against the extension's locale files.
// Plain TypeScript (no imports), shared by the server, the browser and the Node tests.

type Words = Readonly<Record<
  "change" | "save" | "dashboard" | "useThisPage" | "adsToRead" | "all" | "collectAds" | "stopAndSave" | "showInFinder" | "openAdLibrary" | "showWindow" | "openDashboard",
  string
>>;

/** The English text each word has in the extension (its locale files are keyed by it). */
export const EXTENSION_WORDS_EN: Words = {
  change: "Change", save: "Save", dashboard: "Dashboard", useThisPage: "Use this page", adsToRead: "Ads to read", all: "All",
  collectAds: "Collect ads", stopAndSave: "Stop and save", showInFinder: "Show in Finder", openAdLibrary: "Open the Ad Library",
  showWindow: "Show the window", openDashboard: "Open your dashboard",
};

const BY_LOCALE: Readonly<Record<string, Words>> = {
  en: EXTENSION_WORDS_EN,
  "zh-TW": {
    change: "變更", save: "儲存", dashboard: "儀表板", useThisPage: "使用這個頁面", adsToRead: "要讀取的廣告", all: "全部",
    collectAds: "收集廣告", stopAndSave: "停止並儲存", showInFinder: "在 Finder 中顯示", openAdLibrary: "開啟廣告檔案庫",
    showWindow: "顯示視窗", openDashboard: "開啟你的儀表板",
  },
  ja: {
    change: "変更", save: "保存", dashboard: "ダッシュボード", useThisPage: "このページを使う", adsToRead: "読み込む広告", all: "すべて",
    collectAds: "広告を集める", stopAndSave: "停止して保存", showInFinder: "Finder に表示", openAdLibrary: "広告ライブラリを開く",
    showWindow: "ウィンドウを表示", openDashboard: "ダッシュボードを開く",
  },
  ko: {
    change: "변경", save: "저장", dashboard: "대시보드", useThisPage: "이 페이지 사용", adsToRead: "읽을 광고", all: "전체",
    collectAds: "광고 모으기", stopAndSave: "중지하고 저장", showInFinder: "Finder에서 보기", openAdLibrary: "광고 라이브러리 열기",
    showWindow: "창 보기", openDashboard: "대시보드 열기",
  },
};

/** The extension's words in a language (English for any language the extension doesn't speak). */
export const extensionWords = (locale: string): Words => BY_LOCALE[locale] ?? EXTENSION_WORDS_EN;

/** Every language's words, for the check against the extension's locale files. */
export const EXTENSION_WORDS_BY_LOCALE = BY_LOCALE;
