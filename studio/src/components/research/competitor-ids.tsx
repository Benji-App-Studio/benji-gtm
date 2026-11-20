"use client";
// What each ad source finds a competitor by, in the competitor's "Add or edit" form: its Facebook Page,
// its website or Google advertiser, and its TikTok business. Each field takes whatever people paste (a
// link, an id or a name), shows what will be saved, and says where to find it. Cleaning is shared with
// the watch route (lib/ad-sources.ts), which cleans again before saving.
import { cleanGoogle, cleanMetaPage, cleanTikTok, type Cleaned } from "@/lib/ad-sources";
import { useT } from "@/lib/i18n/client";
import type { Translator } from "@/lib/i18n/translate";
import { cx, Field, inputClass } from "../ui";

export interface CompetitorIds { page: string; google: string; tiktok: string }

export const EMPTY_IDS: CompetitorIds = { page: "", google: "", tiktok: "" };

/** The form's starting values for an entry already on the list. */
export function idsOf(w: { page_id: string | null; page_url: string | null; website?: string | null; google_advertiser_id?: string | null; tiktok_advertiser_id: string | null; tiktok_business_name?: string | null }): CompetitorIds {
  return { page: w.page_id ?? w.page_url ?? "", google: w.google_advertiser_id ?? w.website ?? "", tiktok: w.tiktok_advertiser_id ?? w.tiktok_business_name ?? "" };
}

/** The first field that can't be saved, as a sentence (in `t`'s language, English without it), or null. */
export function idsError(ids: CompetitorIds, t?: Translator["t"]): string | null {
  for (const cleaned of [cleanMetaPage(ids.page, t), cleanGoogle(ids.google, t), cleanTikTok(ids.tiktok, t)] as Cleaned<unknown>[]) if (!cleaned.ok) return cleaned.error;
  return null;
}

/** Only the fields that changed from `from` (so an older database without the new columns is never sent them). */
export function changedIds(ids: CompetitorIds, from: CompetitorIds): Partial<CompetitorIds> {
  return Object.fromEntries((Object.keys(ids) as (keyof CompetitorIds)[]).filter((k) => ids[k].trim() !== from[k].trim()).map((k) => [k, ids[k].trim()]));
}

function Shown({ cleaned }: { cleaned: Cleaned<unknown> }) {
  const { t } = useT();
  if (!cleaned.ok) return <span className="block text-warn">{cleaned.error}</span>;
  return cleaned.shown ? <span className="block text-label">{t("Saved as {value}", { value: cleaned.shown })}</span> : null;
}

export function CompetitorIdFields({ ids, onChange, metaOnly = false, className }: { ids: CompetitorIds; onChange: (ids: CompetitorIds) => void; metaOnly?: boolean; className?: string }) {
  const { t } = useT();
  const page = cleanMetaPage(ids.page, t), google = cleanGoogle(ids.google, t), tiktok = cleanTikTok(ids.tiktok, t);
  return (
    <div className={cx("grid gap-3 sm:grid-cols-2", className)}>
      <Field label={t("Facebook Page (Meta ads)")} hint={<>
        <Shown cleaned={page} />
        {t("Open the brand's Facebook Page or its page in the Meta Ad Library and copy the link. Without one, its name is searched.")}
      </>}>
        <input className={inputClass} value={ids.page} onChange={(e) => onChange({ ...ids, page: e.target.value })} placeholder="facebook.com/ads/library/?view_all_page_id=…" spellCheck={false} />
      </Field>
      {!metaOnly && (
        <Field label={t("Website or Google advertiser (Google ads)")} hint={<>
          <Shown cleaned={google} />
          {t("Its website finds every Google ad that links to it. For one exact account, search the brand on adstransparency.google.com, open the advertiser and copy the link (it has AR… in it).")}
        </>}>
          <input className={inputClass} value={ids.google} onChange={(e) => onChange({ ...ids, google: e.target.value })} placeholder="notion.so" spellCheck={false} />
        </Field>
      )}
      {!metaOnly && (
        <Field label={t("TikTok business (TikTok ads)")} hint={<>
          <Shown cleaned={tiktok} />
          {t("Search the brand on library.tiktok.com with a European country picked, then paste the advertiser name it shows, or the link. TikTok lists ads shown in Europe only.")}
        </>}>
          <input className={inputClass} value={ids.tiktok} onChange={(e) => onChange({ ...ids, tiktok: e.target.value })} placeholder={t("The advertiser name in TikTok's Ad Library")} spellCheck={false} />
        </Field>
      )}
    </div>
  );
}
