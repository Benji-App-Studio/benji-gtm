// The app's navigation in one place: the journey each app follows (Home → Research → Studio → Launch →
// Measure, then App settings), the tabs inside Research, Studio and App settings, where every old
// address now lives, the G-then-key shortcuts and the words the command menu also answers to.
// Plain TypeScript (no React, no Next.js), so the sidebar, the command menu, the redirect pages and the
// Node tests (nav-model.test.ts) all read the same model. Labels are not here: each screen says them
// with t() (components/nav/nav-labels.tsx), so every language gets them.

// MARK: Places

/** Every app's pages, in the order of the journey. "settings" is the app's own settings page. */
export const APP_SECTIONS = ["home", "research", "studio", "launch", "measure", "settings"] as const;
export type AppSection = (typeof APP_SECTIONS)[number];

export const RESEARCH_TABS = ["ads", "app-store", "social"] as const;
export type ResearchTab = (typeof RESEARCH_TABS)[number];

/** Create is the batch maker; Remix starts from a reference ad; Templates is the library of ready-made styles. */
export const STUDIO_TABS = ["create", "remix", "templates"] as const;
export type StudioTab = (typeof STUDIO_TABS)[number];

export const APP_SETTINGS_TABS = ["profile", "brand", "connections", "advanced"] as const;
export type AppSettingsTab = (typeof APP_SETTINGS_TABS)[number];

/** The overview of every app, with its key numbers and next step. */
export const ALL_APPS_HREF = "/app/apps";
/** Every analysis of social posts, including the ones not tied to an app. */
export const ANALYSES_HREF = "/app/analyses";
/** /app itself opens the last app's Home (app/app/page.tsx); there is one Home per app, not a second one. */
export const HOME_HREF = "/app";
export const NEW_APP_HREF = "/app/product/new";
export const SETTINGS_HREF = "/app/settings";

const base = (id: string) => `/app/w/${id}`;

/** One of an app's pages. */
export function appHref(id: string, section: AppSection = "home"): string {
  return section === "home" ? base(id) : `${base(id)}/${section}`;
}

export function researchHref(id: string, tab: ResearchTab = "ads"): string {
  return tab === "ads" ? `${base(id)}/research` : `${base(id)}/research/${tab}`;
}

export function studioHref(id: string, tab: StudioTab = "create"): string {
  return tab === "create" ? `${base(id)}/studio` : `${base(id)}/studio/${tab}`;
}

/** An app's settings on one tab (Profile has no ?tab=). */
export function appSettingsHref(id: string, tab: AppSettingsTab = "profile"): string {
  return tab === "profile" ? `${base(id)}/settings` : `${base(id)}/settings?tab=${tab}`;
}

/** A new analysis of social posts, tied to an app when one is given. */
export const newAnalysisHref = (appId?: string | null, type?: "competitors" | "account" | "campaign") => {
  const query = new URLSearchParams();
  if (type) query.set("type", type);
  if (appId) query.set("app", appId);
  const text = queryText(query);
  return `/app/new${text ? `?${text}` : ""}`;
};

/** The tab a ?tab= value names on App settings. The Brand page's old tab names still work. */
export function appSettingsTab(value: unknown): AppSettingsTab {
  if (typeof value !== "string") return "profile";
  if ((APP_SETTINGS_TABS as readonly string[]).includes(value)) return value as AppSettingsTab;
  return LEGACY_BRAND_TABS[value] ?? "profile";
}

/** The Brand page's tabs (?tab= on /brand) and where each one went. No ?tab= was its Brand tab. */
const LEGACY_BRAND_TABS: Record<string, AppSettingsTab> = { brand: "brand", product: "profile", assets: "brand", settings: "connections" };

// MARK: Where am I

export interface Location {
  /** The app in the address, if any. */
  appId: string | null;
  section: AppSection | null;
  /** Research's or Studio's tab (App settings keeps its tab in ?tab=, read by the page). */
  tab: ResearchTab | StudioTab | null;
  allApps: boolean;
  analyses: boolean;
}

const IN_APP = /^\/app\/w\/([0-9a-f-]{36})(?:\/([^/?#]+))?(?:\/([^/?#]+))?/i;

/** What the navigation should light up for an address (a path, with or without its query). */
export function locate(address: string): Location {
  const path = address.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  const out: Location = { appId: null, section: null, tab: null, allApps: path === ALL_APPS_HREF, analyses: path === ANALYSES_HREF || path === "/app/new" || path.startsWith("/app/p/") };
  const match = IN_APP.exec(path);
  if (!match) return out;
  out.appId = match[1].toLowerCase();
  const [, , first, second] = match;
  // Old page names point at their new section, so a deep link lights up the right row even before it redirects.
  const section = !first ? "home" : first === "market" ? "research" : first === "playground" ? "studio" : first === "brand" ? "settings" : first;
  if (!(APP_SECTIONS as readonly string[]).includes(section)) return out;
  out.section = section as AppSection;
  if (section === "research") out.tab = first === "market" ? "app-store" : (RESEARCH_TABS as readonly string[]).includes(second ?? "") ? second as ResearchTab : "ads";
  if (section === "studio") out.tab = first === "playground" ? "remix" : (STUDIO_TABS as readonly string[]).includes(second ?? "") ? second as StudioTab : "create";
  return out;
}

// MARK: Old addresses

/**
 * A query's text with bare keys kept bare: `?guide`, `?competitors` (URLSearchParams would write
 * `guide=`). Values are encoded as URLSearchParams encodes them.
 */
function queryText(query: URLSearchParams): string {
  return [...query].map(([key, value]) => (value === "" ? encodeURIComponent(key) : new URLSearchParams([[key, value]]).toString())).join("&");
}

/** A query string from a page's searchParams (repeated keys kept, bare keys bare), with its "?" or empty. */
export function searchString(params: Record<string, string | string[] | undefined> | URLSearchParams | string | null | undefined): string {
  if (!params) return "";
  if (typeof params === "string") return params && params !== "?" ? (params.startsWith("?") ? params : `?${params}`) : "";
  const query = params instanceof URLSearchParams ? new URLSearchParams(params) : new URLSearchParams();
  if (!(params instanceof URLSearchParams)) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      for (const v of Array.isArray(value) ? value : [value]) query.append(key, v);
    }
  }
  const text = queryText(query);
  return text ? `?${text}` : "";
}

/** `path` with the query merged in: `extra` first, then whatever the old address carried (minus `drop`). */
function withQuery(path: string, search: string, extra: Record<string, string> = {}, drop: string[] = []): string {
  const old = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const query = new URLSearchParams(extra);
  for (const [key, value] of old) if (!drop.includes(key) && !(key in extra)) query.append(key, value);
  const text = queryText(query);
  return text ? `${path}?${text}` : path;
}

const UUID_PART = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * Where an address from before the journey-ordered navigation now lives, with its query kept (so
 * `?competitors`, `?ad=`, `?template=` and the like still work). null when the address is current.
 * `/app/product` needs the last app opened, so its page works that out itself.
 */
export function legacyRedirect(pathname: string, search = ""): string | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/app/accounts") return withQuery(ANALYSES_HREF, search, { type: "account" });
  if (path === "/app/campaigns") return withQuery(ANALYSES_HREF, search, { type: "campaign" });

  const settingsApp = new RegExp(`^/app/settings/apps/(${UUID_PART})$`, "i").exec(path);
  if (settingsApp) return withQuery(`${base(settingsApp[1])}/settings`, search, { tab: "connections" });

  const app = new RegExp(`^/app/w/(${UUID_PART})/(market|playground|brand)(?:/([^/]+))?$`, "i").exec(path);
  if (!app) return null;
  // The match ignores case (/Market, a capitalised id), so the branches compare the lower-cased words.
  const [id, page] = [app[1].toLowerCase(), app[2].toLowerCase()];
  const rest = app[3];
  if (page === "market") return withQuery(rest ? `${researchHref(id, "app-store")}/${rest}` : researchHref(id, "app-store"), search);
  if (rest) return null;
  const query = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  if (page === "playground") {
    // ?template= opened a template from the Library, and ?tab=library the Library itself: both are Templates now.
    const library = query.has("template") || query.get("tab") === "library";
    return withQuery(studioHref(id, library ? "templates" : "remix"), search, {}, ["tab"]);
  }
  // The Brand page and its tabs are App settings now. Its Assets tab is the Brand tab's pictures section,
  // so the address carries #assets (a browser keeps a fragment given in a redirect's Location).
  const old = (query.get("tab") ?? "brand").toLowerCase();
  const tab = LEGACY_BRAND_TABS[old] ?? "brand";
  return `${withQuery(`${base(id)}/settings`, search, { tab }, ["tab"])}${old === "assets" ? "#assets" : ""}`;
}

/**
 * Every redirect the proxy makes before rendering: /app itself opens the last app's Home (/app/w, which
 * reads the cookie), and every old address goes to its new place. null when the address is current.
 */
export function navRedirect(pathname: string, search = ""): string | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === HOME_HREF) return `/app/w${search && search !== "?" ? (search.startsWith("?") ? search : `?${search}`) : ""}`;
  return legacyRedirect(path, search);
}

// MARK: Shortcuts

/** G then a key. Each goes to a page of the app being worked on (or a page of the whole workspace). */
export const SHORTCUTS = [
  { key: "h", to: "home" },
  { key: "r", to: "research" },
  { key: "c", to: "studio" },
  { key: "l", to: "launch" },
  { key: "m", to: "measure" },
  { key: "a", to: "all-apps" },
  { key: "s", to: "workspace-settings" },
] as const;
export type ShortcutTarget = (typeof SHORTCUTS)[number]["to"];

/** Where a shortcut goes. Without a known app, an app's page falls back to /app/w (the last app opened). */
export function shortcutHref(to: ShortcutTarget, appId: string | null): string {
  if (to === "all-apps") return ALL_APPS_HREF;
  if (to === "workspace-settings") return SETTINGS_HREF;
  if (!appId) return "/app/w";
  return appHref(appId, to);
}

// MARK: Command menu search

/**
 * The words each destination also answers to, in English whatever the language: old page names
 * (Market, Playground, Brand, Accounts, Campaigns…) and the things people look for there.
 */
export const DESTINATION_KEYWORDS: Record<string, string> = {
  "all-apps": "all apps overview workspace dashboard home switch",
  home: "home dashboard overview business summary today",
  research: "research competitors ads",
  "research:ads": "ads ad library competitors meta facebook instagram paid get ads collect import",
  "research:app-store": "market app store play store charts reviews ratings top charts competitors apps",
  "research:social": "social posts organic accounts campaigns analyses analysis my competitors instagram tiktok youtube creators ugc",
  studio: "studio create creatives make",
  "studio:create": "create batch generate creatives ugc video image formats brief",
  "studio:remix": "playground remix reference copy style",
  "studio:templates": "playground templates library styles",
  launch: "launch send to meta paused drafts publish campaign ad set",
  "launch:ads": "ads sent results performance launched",
  measure: "measure metrics cac ltv roas cpi payback revenue spend unit economics",
  settings: "app settings",
  "settings:profile": "profile product about audience description",
  "settings:brand": "brand kit colours colors logo icon fonts voice tone assets screenshots forbidden claims",
  "settings:connections": "connections meta revenuecat superwall mixpanel appstack ad account page pixel ids",
  "settings:advanced": "advanced storage folder google drive delete app danger",
  analyses: "analyses analysis accounts campaigns other social posts organic",
  "new-analysis": "new analysis start competitor account campaign social",
  "new-app": "new app create add product",
  help: "help guide shortcuts keys contact support getting started",
  guide: "get started guide setup checklist onboarding",
};

/**
 * The same words in each language, so a Japanese or Korean viewer who types the old page name they knew
 * (マーケット, 플레이그라운드, 市場…) lands on the new place too. Added to the English words, never instead.
 */
export const LOCAL_DESTINATION_KEYWORDS: Record<"zh-TW" | "ja" | "ko", Partial<Record<string, string>>> = {
  "zh-TW": {
    "all-apps": "所有 app 總覽 工作區 儀表板 首頁 切換",
    home: "首頁 儀表板 總覽 業務 摘要 今天",
    research: "研究 競品 廣告",
    "research:ads": "廣告 廣告檔案庫 競品 付費 收集 匯入 取得廣告",
    "research:app-store": "市場 應用程式商店 排行榜 熱門排行榜 評論 評分 競品 app",
    "research:social": "社群 貼文 自然觸及 帳號 行銷活動 分析 我的競品 創作者",
    studio: "studio 製作 素材 創作",
    "studio:create": "製作 批次 生成 素材 影片 圖片 格式 簡報",
    "studio:remix": "遊樂場 playground 混搭 參考 複製 風格",
    "studio:templates": "遊樂場 playground 範本 範本庫 風格",
    launch: "投放 傳送到 meta 已暫停 草稿 發布 行銷活動 廣告組合",
    "launch:ads": "廣告 已傳送 成效 表現 已投放",
    measure: "衡量 指標 花費 營收 回本時間 單位經濟",
    settings: "app 設定",
    "settings:profile": "簡介 產品 關於 受眾 說明",
    "settings:brand": "品牌 品牌素材 顏色 標誌 圖示 字型 語氣 截圖 禁用說法",
    "settings:connections": "連接 廣告帳號 粉絲專頁 像素 id",
    "settings:advanced": "進階 儲存空間 資料夾 刪除 app 危險",
    analyses: "分析 帳號 行銷活動 社群 貼文",
    "new-analysis": "新的分析 開始 競品 帳號 行銷活動 社群",
    "new-app": "新增 app 建立 產品",
    help: "說明 指南 快捷鍵 金鑰 聯絡 支援 開始使用",
    guide: "開始使用 指南 設定 檢查清單 新手引導",
  },
  ja: {
    "all-apps": "すべてのアプリ 一覧 概要 ワークスペース ダッシュボード ホーム 切り替え",
    home: "ホーム ダッシュボード 概要 ビジネス サマリー 今日",
    research: "リサーチ 競合 広告",
    "research:ads": "広告 広告ライブラリ 競合 有料 収集 インポート 広告を取得",
    "research:app-store": "マーケット 市場 アプリストア ランキング トップチャート レビュー 評価 競合 アプリ",
    "research:social": "sns ソーシャル 投稿 オーガニック アカウント キャンペーン 分析 自分の競合 クリエイター",
    studio: "studio スタジオ 制作 クリエイティブ",
    "studio:create": "制作 一括 生成 クリエイティブ 動画 画像 フォーマット ブリーフ",
    "studio:remix": "プレイグラウンド playground リミックス 参考 コピー スタイル",
    "studio:templates": "プレイグラウンド playground テンプレート ライブラリ スタイル",
    launch: "出稿 meta に送信 停止中 下書き 公開 キャンペーン 広告セット",
    "launch:ads": "広告 送信済み 成果 パフォーマンス 出稿済み",
    measure: "測定 指標 消化金額 売上 回収期間 ユニットエコノミクス",
    settings: "アプリ設定 設定",
    "settings:profile": "プロフィール 製品 概要 オーディエンス 説明",
    "settings:brand": "ブランド ブランドキット 色 カラー ロゴ アイコン フォント トーン スクリーンショット 禁止表現",
    "settings:connections": "連携 接続 広告アカウント ページ ピクセル id",
    "settings:advanced": "詳細設定 ストレージ フォルダ アプリを削除 危険",
    analyses: "分析 アカウント キャンペーン sns 投稿",
    "new-analysis": "新しい分析 開始 競合 アカウント キャンペーン sns",
    "new-app": "新しいアプリ 作成 追加 製品",
    help: "ヘルプ ガイド ショートカット キー 問い合わせ サポート はじめる",
    guide: "はじめる ガイド セットアップ チェックリスト オンボーディング",
  },
  ko: {
    "all-apps": "모든 앱 개요 워크스페이스 대시보드 홈 전환",
    home: "홈 대시보드 개요 비즈니스 요약 오늘",
    research: "리서치 경쟁사 광고",
    "research:ads": "광고 광고 라이브러리 경쟁사 유료 수집 가져오기",
    "research:app-store": "마켓 시장 앱스토어 차트 인기 차트 리뷰 평점 경쟁사 앱",
    "research:social": "소셜 게시물 오가닉 계정 캠페인 분석 내 경쟁사 크리에이터",
    studio: "studio 스튜디오 제작 크리에이티브",
    "studio:create": "제작 일괄 생성 크리에이티브 동영상 이미지 포맷 브리프",
    "studio:remix": "플레이그라운드 playground 리믹스 참고 복사 스타일",
    "studio:templates": "플레이그라운드 playground 템플릿 라이브러리 스타일",
    launch: "게재 meta로 보내기 일시 중지됨 초안 게시 캠페인 광고 세트",
    "launch:ads": "광고 보낸 광고 성과 실적 게재됨",
    measure: "측정 지표 지출 매출 회수 기간 유닛 이코노믹스",
    settings: "앱 설정 설정",
    "settings:profile": "프로필 제품 소개 타깃 설명",
    "settings:brand": "브랜드 브랜드 키트 색상 로고 아이콘 글꼴 톤 스크린샷 금지 표현",
    "settings:connections": "연결 광고 계정 페이지 픽셀 id",
    "settings:advanced": "고급 저장 공간 폴더 앱 삭제 위험",
    analyses: "분석 계정 캠페인 소셜 게시물",
    "new-analysis": "새 분석 시작 경쟁사 계정 캠페인 소셜",
    "new-app": "새 앱 만들기 추가 제품",
    help: "도움말 가이드 단축키 키 문의 지원 시작하기",
    guide: "시작하기 가이드 설정 체크리스트 온보딩",
  },
};

/** The words a destination answers to in this language: the English ones, plus the language's own. */
export function destinationKeywords(key: string, locale: string): string {
  const local = (LOCAL_DESTINATION_KEYWORDS as Record<string, Partial<Record<string, string>>>)[locale]?.[key];
  return [DESTINATION_KEYWORDS[key] ?? "", local ?? ""].filter(Boolean).join(" ");
}

/** Whether a command matches what was typed: every word appears in its label, hint, group or keywords. */
export function commandMatches(command: { label: string; hint?: string; group?: string; keywords?: string }, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = `${command.label} ${command.hint ?? ""} ${command.group ?? ""} ${command.keywords ?? ""}`.toLowerCase();
  return words.every((word) => text.includes(word));
}

// MARK: Help

/** The key guides in the public repository (release/docs/keys/*), in the order the Help panel lists them. */
export const KEY_GUIDES = [
  { name: "OpenAI", file: "release/docs/keys/openai.md" },
  { name: "Meta Ad Library", file: "release/docs/keys/meta-ad-library.md" },
  { name: "Meta ads", file: "release/docs/keys/meta-ads.md" },
  { name: "Apify", file: "release/docs/keys/apify.md" },
  { name: "RevenueCat", file: "release/docs/keys/revenuecat.md" },
  { name: "Superwall", file: "release/docs/keys/superwall.md" },
  { name: "Mixpanel", file: "release/docs/keys/mixpanel.md" },
  { name: "AppStack", file: "release/docs/keys/appstack.md" },
  { name: "Higgsfield", file: "release/docs/keys/higgsfield.md" },
  { name: "Google Drive", file: "release/docs/keys/google-drive.md" },
] as const;

/**
 * The app Home with the getting-started guide open: `/app/w/{id}?guide`, a bare `?guide` with no value
 * (or `/app/w?guide`, which keeps the query on its way to the last app's Home).
 *
 * Contract with the getting-started guide (workstream E1, components/getting-started.tsx): a bare `?guide`
 * always reopens the guide, clearing any earlier "dismiss", at the person's next unfinished step. The Help
 * panel's "Get started" and the command menu's "Get started" link here and rely on that. Keep the
 * parameter bare (no `=1`, no step name) so both sides agree on one address.
 */
export const guideHref = (appId: string | null) => (appId ? `${appHref(appId)}?guide` : "/app/w?guide");
