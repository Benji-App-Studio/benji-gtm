"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/lib/i18n/client";
import type { Translator } from "@/lib/i18n/translate";
import { PLATFORMS, type Platform } from "@/lib/types";
import { Button, Card, cx, Field, inputClass, PlatformBadge, Segmented, Spinner } from "./ui";

type Account = { name: string; handles: Partial<Record<Platform, string>> };
const blank = (): Account => ({ name: "", handles: {} });
const TIMEFRAMES = [30, 60, 90, 180];

/** One account's handles on each channel. */
function HandlesRow({ value, onChange, onRemove, namePlaceholder, nameLabel }: { value: Account; onChange: (a: Account) => void; onRemove?: () => void; namePlaceholder: string; nameLabel: string }) {
  const { t } = useT();
  return (
    <div className="grid gap-2 rounded-inner border border-line bg-raised p-3">
      <div className="flex items-center gap-2">
        <input className={inputClass} aria-label={nameLabel} placeholder={namePlaceholder} value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} />
        {onRemove && <Button variant="ghost" size="sm" onClick={onRemove} aria-label={value.name.trim() ? t("Remove {name}", { name: value.name.trim() }) : t("Remove this row")}>×</Button>}
      </div>
      <div className="grid gap-2 @xl:grid-cols-2">
        {PLATFORMS.map((p) => (
          <label key={p} className="flex items-center gap-2 text-xs">
            <span className="w-32 shrink-0"><PlatformBadge platform={p} showBeta /></span>
            <input className={cx(inputClass, "py-1.5 text-xs")} placeholder={p === "linkedin" ? t("company slug or URL") : t("handle")} value={value.handles[p] ?? ""}
              onChange={(e) => onChange({ ...value, handles: { ...value.handles, [p]: e.target.value } })} />
          </label>
        ))}
      </div>
    </div>
  );
}

function Settings({ sinceDays, setSinceDays, depth, setDepth }: { sinceDays: number; setSinceDays: (d: number) => void; depth: number; setDepth: (d: number) => void }) {
  const { t, tn } = useT();
  return (
    <div className="grid gap-4 @xl:grid-cols-2">
      <div>
        <p className="mb-2 text-sm font-medium">{t("Time frame")}</p>
        <Segmented label={t("Time frame")} value={String(sinceDays)} onChange={(v) => setSinceDays(Number(v))} options={TIMEFRAMES.map((d) => ({ value: String(d), label: tn(d, "{n} day", "{n} days") }))} />
      </div>
      <div>
        <p className="mb-2 text-sm font-medium">{t("Posts per account per channel")}</p>
        <Segmented label={t("Posts per account per channel")} value={String(depth)} onChange={(v) => setDepth(Number(v))} options={[15, 30, 60].map((n) => ({ value: String(n), label: String(n) }))} />
      </div>
    </div>
  );
}

async function create(body: object, t: Translator["t"]): Promise<string> {
  const response = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const data = await response?.json().catch(() => null);
  if (!response?.ok || !data?.id) throw new Error(data?.error ?? t("Couldn't reach the server. Check your connection and try again."));
  return data.id;
}

/** One account (yours or anyone's) on every channel, optionally side by side with others. */
/** `productId`: the app the analysis is for (it then shows under that app's Research › Social posts). */
export function AccountForm({ onBack, productId }: { onBack: () => void; productId?: string | null }) {
  const { t } = useT();
  const router = useRouter();
  const [main, setMain] = useState<Account>(blank());
  const [others, setOthers] = useState<Account[]>([]);
  const [sinceDays, setSinceDays] = useState(90);
  const [depth, setDepth] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const hasHandle = Object.values(main.handles).some((h) => h?.trim());

  async function submit() {
    setBusy(true); setError("");
    try {
      const name = main.name.trim() || `@${Object.values(main.handles).find((h) => h?.trim())?.replace(/^@/, "")}`;
      router.push(`/app/p/${await create({ type: "account", name, accounts: [{ ...main, name }, ...others], sinceDays, limitPerAccount: depth, productId: productId ?? null }, t)}`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }

  return (
    <Card className="p-4">
      <p className="text-sm text-muted">{t("Every post from one brand or creator across the channels it uses: which formats and hooks work for it, and how that changes over time. Add others to compare side by side.")}</p>
      <div className="mt-5 grid gap-4">
        <Field label={t("The account")}><HandlesRow value={main} onChange={setMain} nameLabel={t("Account name")} namePlaceholder={t("Name, e.g. Acme")} /></Field>
        <div>
          <p className="mb-2 text-sm font-medium">{t("Compare with (optional)")}</p>
          <div className="grid gap-2">
            {others.map((o, i) => <HandlesRow key={i} value={o} nameLabel={t("Account {n} name", { n: i + 2 })} namePlaceholder={t("Name")} onChange={(a) => setOthers(others.map((x, j) => (j === i ? a : x)))} onRemove={() => setOthers(others.filter((_, j) => j !== i))} />)}
            {others.length < 5 && <button type="button" onClick={() => setOthers([...others, blank()])} className="rounded-inner border border-dashed border-line p-3 text-left text-sm text-muted hover:text-ink">+ {t("Add an account to compare")}</button>}
          </div>
        </div>
        <Settings sinceDays={sinceDays} setSinceDays={setSinceDays} depth={depth} setDepth={setDepth} />
      </div>
      {error && <p className="mt-4 text-sm text-warn">{error}</p>}
      <div className="mt-6 flex justify-between">
        <Button variant="ghost" onClick={onBack}>{t("Back")}</Button>
        <Button onClick={submit} disabled={busy || !hasHandle}>{busy ? <><Spinner /> {t("Creating…")}</> : t("Continue")}</Button>
      </div>
    </Card>
  );
}

/** Many creators posting for one brand, like a UGC deal. */
export function CampaignForm({ onBack, productId }: { onBack: () => void; productId?: string | null }) {
  const { t } = useT();
  const router = useRouter();
  const [brand, setBrand] = useState("");
  const [brandInstagram, setBrandInstagram] = useState("");
  const [findCreators, setFindCreators] = useState(true);
  const [mentions, setMentions] = useState("");
  const [creators, setCreators] = useState<Account[]>([blank()]);
  const [sinceDays, setSinceDays] = useState(90);
  const [depth, setDepth] = useState(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true); setError("");
    try {
      const words = mentions.split(/[\n,]/).map((w) => w.trim()).filter(Boolean);
      router.push(`/app/p/${await create({ type: "campaign", name: brand.trim(), mentions: words.length ? words : [brand.trim()], accounts: creators, sinceDays, limitPerAccount: depth, brandInstagram, partners: findCreators && Boolean(brandInstagram.trim()), productId: productId ?? null }, t)}`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }

  return (
    <Card className="p-4">
      <p className="text-sm text-muted">{t("Creators posting for one brand: the best UGC videos, the creators worth rebooking, and how the brand is shown in the scripts that work. Only posts that mention the brand (or are marked as paid partnerships) count.")}</p>
      <div className="mt-4 grid gap-4">
        <div className="grid gap-4 @xl:grid-cols-2">
          <Field label={t("Brand")}><input className={inputClass} value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Acme" /></Field>
          <Field label={t("Words that mark a campaign post")} hint={t("Comma separated; defaults to the brand name")}><input className={inputClass} value={mentions} onChange={(e) => setMentions(e.target.value)} placeholder="acme, @acme, acme app" /></Field>
          <Field label={t("Brand's Instagram")} hint={t("Its tagged posts and collabs reveal its creators")}><input className={inputClass} value={brandInstagram} onChange={(e) => setBrandInstagram(e.target.value)} placeholder="@acme" /></Field>
        </div>
        <PartnersSwitch checked={findCreators} onChange={setFindCreators} disabled={!brandInstagram.trim()}
          title={t("Find the brand's creators for me")}
          detail={t("The app reads the brand's tagged posts and collab posts, then checks creators' bios for ties like “athlete @brand”, “ambassador” or a discount code. Posts from those creators count even when they don't tag the brand. Adds about $1.40.")} />
        <div>
          <p className="mb-2 text-sm font-medium">{t("Creators")} {findCreators && brandInstagram.trim() && <span className="font-normal text-muted">{t("(optional: the rest are found for you)")}</span>}</p>
          <div className="grid gap-2">
            {creators.map((c, i) => <HandlesRow key={i} value={c} nameLabel={t("Creator {n} name", { n: i + 1 })} namePlaceholder={t("Creator {n}", { n: i + 1 })} onChange={(a) => setCreators(creators.map((x, j) => (j === i ? a : x)))} onRemove={creators.length > 1 ? () => setCreators(creators.filter((_, j) => j !== i)) : undefined} />)}
            {creators.length < 50 && <button type="button" onClick={() => setCreators([...creators, blank()])} className="rounded-inner border border-dashed border-line p-3 text-left text-sm text-muted hover:text-ink">+ {t("Add a creator")}</button>}
          </div>
        </div>
        <Settings sinceDays={sinceDays} setSinceDays={setSinceDays} depth={depth} setDepth={setDepth} />
      </div>
      {error && <p className="mt-4 text-sm text-warn">{error}</p>}
      <div className="mt-6 flex justify-between">
        <Button variant="ghost" onClick={onBack}>{t("Back")}</Button>
        <Button onClick={submit} disabled={busy || !brand.trim() || !(creators.some((c) => Object.values(c.handles).some((h) => h?.trim())) || (findCreators && brandInstagram.trim()))}>{busy ? <><Spinner /> {t("Creating…")}</> : t("Continue")}</Button>
      </div>
    </Card>
  );
}

/** The advanced partnerships switch, shared by the campaign and competitor forms and the review panel. */
export function PartnersSwitch({ checked, onChange, title, detail, disabled = false }: { checked: boolean; onChange: (on: boolean) => void; title: string; detail: string; disabled?: boolean }) {
  const { t } = useT();
  return (
    <label className={cx("flex items-start gap-3 rounded-inner border border-line bg-raised p-3 text-sm", disabled && "opacity-60")}>
      <input type="checkbox" checked={checked && !disabled} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 accent-accent" />
      <span><span className="flex flex-wrap items-center gap-2 font-medium">{title}<span className="eyebrow">{t("Advanced")}</span></span><span className="mt-0.5 block text-xs text-muted">{detail}</span></span>
    </label>
  );
}
