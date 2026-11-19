// Settings > Storage's backend: what is stored (per bucket and per app, against the plan's quota) and the
// cleanups, each previewed first ("deletes N files, frees X") and then run. A cleanup removes the files
// from storage AND the database rows that point at them, so nothing is left pointing at a missing file:
//   rejected_creatives   creatives marked rejected (never one sent to Meta): files and rows
//   unused_creatives     never approved, never sent to Meta, older than N days: files and rows
//   old_media            competitors' saved ad media older than N days: the copies and their rows (the ads
//                        stay and fall back to their original links), and old video key frames
//   app_media            all of one app's saved competitor media (and its key frames)
//   app_files            every file of an app that is being deleted or is gone already
// Built over a database client so the tests run it against fakes (storage_test.ts). The rows of
// storage_usage() go back as they are; the studio sums them (studio/src/lib/storage-usage.ts).
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "../_shared/auth.ts";
import { storageQuotaBytes, uploadMaxBytes, type InstallLimits } from "../_shared/limits.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CLEANUP_ACTIONS = ["rejected_creatives", "unused_creatives", "old_media", "app_media", "app_files"] as const;
export type CleanupAction = typeof CLEANUP_ACTIONS[number];
export interface CleanupInput { action: CleanupAction; appId: string | null; days: number | null; run: boolean; deleting: boolean }

/** The request made safe (twin of cleanCleanup in studio/src/lib/storage-usage.ts), or what is wrong with it. */
export function cleanupInput(input: Record<string, unknown>): CleanupInput | string {
  const action = input.action as CleanupAction;
  if (!CLEANUP_ACTIONS.includes(action)) return "Pick what to delete.";
  const appId = typeof input.appId === "string" && UUID.test(input.appId) ? input.appId.toLowerCase() : null;
  if ((action === "app_media" || action === "app_files") && !appId) return "Pick the app.";
  const fallback = action === "unused_creatives" ? 30 : 90;
  const raw = Number(input.days);
  const days = action === "old_media" || action === "unused_creatives" ? Math.min(3650, Math.max(7, Number.isFinite(raw) && raw > 0 ? Math.round(raw) : fallback)) : null;
  return { action, appId, days, run: input.run === true, deleting: input.deleting === true };
}

export interface StorageDeps { db: SupabaseClient; limits: () => Promise<InstallLimits>; now?: () => Date }
interface ObjectRow { name: string; bytes: number; created_at: string }
interface Target { bucket: string; paths: string[] }
export interface CleanupResult { action: CleanupAction; files: number; bytes: number; items: number; done: boolean }

const BATCH = 500;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

export function createStorage({ db, limits, now = () => new Date() }: StorageDeps) {
  /** What is stored, by bucket and app, with the apps' names and the plan's numbers. */
  async function usage() {
    const plan = await limits();
    const { data: rows, error } = await db.rpc("storage_usage");
    // The migration isn't applied yet: say so instead of showing an empty store as "nothing stored".
    if (error) throw new HttpError(503, "Storage can't be measured yet: apply the latest database update (Settings > Updates), then reload.");
    const { data: apps } = await db.from("products").select("id, name").order("created_at", { ascending: true });
    return {
      rows: ((rows ?? []) as { bucket: string; app_id: string | null; files: number; bytes: number }[]).map((r) => ({ bucket: r.bucket, app_id: r.app_id, files: Number(r.files) || 0, bytes: Number(r.bytes) || 0 })),
      apps: ((apps ?? []) as { id: string; name: string }[]).map((a) => ({ id: a.id, name: a.name })),
      quotaBytes: storageQuotaBytes(plan),
      uploadLimitBytes: uploadMaxBytes(plan),
    };
  }

  async function objectsUnder(bucket: string, prefix: string, before?: Date): Promise<ObjectRow[]> {
    const { data, error } = await db.rpc("storage_objects_under", { p_bucket: bucket, p_prefix: prefix, p_before: before?.toISOString() ?? null });
    if (error) throw new HttpError(503, "Storage can't be listed yet: apply the latest database update (Settings > Updates), then try again.");
    return ((data ?? []) as ObjectRow[]).map((o) => ({ name: o.name, bytes: Number(o.bytes) || 0, created_at: o.created_at }));
  }

  async function remove(targets: Target[]) {
    for (const t of targets) {
      for (let i = 0; i < t.paths.length; i += BATCH) {
        const { error } = await db.storage.from(t.bucket).remove(t.paths.slice(i, i + BATCH));
        if (error) throw new Error(`Couldn't delete the files: ${error.message}`);
      }
    }
  }

  async function appIds(appId: string | null): Promise<string[]> {
    if (appId) return [appId];
    const { data } = await db.from("products").select("id");
    return ((data ?? []) as { id: string }[]).map((r) => r.id);
  }

  async function launched(): Promise<Set<string>> {
    const { data } = await db.from("launch_drafts").select("creative_ref");
    return new Set(((data ?? []) as { creative_ref: string }[]).map((r) => r.creative_ref));
  }

  /** Creatives to delete, their files (each one's own files; a job folder left with no creative goes whole). */
  async function creativesPlan(input: CleanupInput) {
    const keep = await launched();
    const targets: Target[] = [];
    const ids: string[] = [];
    let files = 0, bytes = 0;
    for (const app of await appIds(input.appId)) {
      let query = db.from("creatives").select("id, storage_path, poster_path, approval, created_at").eq("product_id", app);
      if (input.action === "rejected_creatives") query = query.eq("approval", "rejected");
      else query = query.neq("approval", "approved").lt("created_at", new Date(now().getTime() - (input.days ?? 30) * 86_400_000).toISOString());
      const { data, error } = await query.limit(5000);
      if (error) throw new Error(`Couldn't read the creatives: ${error.message}`);
      const doomed = ((data ?? []) as { id: string; storage_path: string; poster_path: string | null }[]).filter((c) => !keep.has(c.id));
      if (!doomed.length) continue;
      const { data: all } = await db.from("creatives").select("id, storage_path").eq("product_id", app).limit(20000);
      const going = new Set(doomed.map((c) => c.id));
      const kept = ((all ?? []) as { id: string; storage_path: string }[]).filter((c) => !going.has(c.id));
      const folder = (p: string) => p.slice(0, p.lastIndexOf("/") + 1);
      const keptFolders = new Set(kept.map((c) => folder(c.storage_path)));
      const objects = await objectsUnder("creatives", `${app}/`);
      // Each file belongs to the creative whose name is its longest prefix ("image-v1" owns "image-v1-logo-…",
      // but "image-v1-1.png" belongs to the creative stored as "image-v1-1"); a file nobody owns goes with
      // its folder when no kept creative is left in it.
      const owners = [...doomed.map((c) => ({ ...c, going: true })), ...kept.map((c) => ({ ...c, poster_path: null, going: false }))]
        .map((c) => ({ ...c, stem: c.storage_path.replace(/\.[^./]+$/, "") }));
      const ownerOf = (name: string) => owners
        .filter((c) => name === c.storage_path || name === c.poster_path || name.startsWith(`${c.stem}-`) || name.startsWith(`${c.stem}.`))
        .sort((a, b) => b.stem.length - a.stem.length)[0];
      const doomedFolders = new Set(doomed.map((c) => folder(c.storage_path)));
      const paths = new Set<string>();
      for (const o of objects) {
        const owner = ownerOf(o.name);
        const dir = folder(o.name);
        if (owner ? owner.going : doomedFolders.has(dir) && !keptFolders.has(dir)) paths.add(o.name);
      }
      for (const o of objects) if (paths.has(o.name)) { files++; bytes += o.bytes; }
      targets.push({ bucket: "creatives", paths: [...paths] });
      ids.push(...doomed.map((c) => c.id));
    }
    return { targets, ids, files, bytes, items: ids.length };
  }

  /** Saved competitor media (and video key frames) to delete: an app's, or every app's, older than `before` when given. */
  async function mediaPlan(appId: string | null, before?: Date) {
    const targets: Target[] = [];
    const rowIds: string[] = [];
    const frameAds = new Set<string>();
    let files = 0, bytes = 0;
    for (const app of await appIds(appId)) {
      const objects = await objectsUnder("ad-media", `${app}/`, before);
      if (!objects.length) continue;
      const paths = objects.map((o) => o.name);
      for (const o of objects) { files++; bytes += o.bytes; }
      for (const p of paths) { const m = /^[^/]+\/scan-frames\/([^/]+)\//.exec(p); if (m) frameAds.add(m[1]); }
      targets.push({ bucket: "ad-media", paths });
      for (let i = 0; i < paths.length; i += 200) {
        const { data } = await db.from("paid_ad_media").select("id").eq("product_id", app).in("storage_path", paths.slice(i, i + 200));
        rowIds.push(...((data ?? []) as { id: string }[]).map((r) => r.id));
      }
    }
    return { targets, rowIds, frameAds: [...frameAds], files, bytes, items: rowIds.length };
  }

  /** Every file of one app: creatives, saved ad media, and each member's uploads and brand files for it. */
  async function appFilesPlan(appId: string) {
    const { data: members } = await db.from("install_members").select("user_id");
    const { data: product } = await db.from("products").select("user_id").eq("id", appId).maybeSingle();
    const users = new Set<string>([...((members ?? []) as { user_id: string }[]).map((m) => m.user_id), ...(product?.user_id ? [product.user_id as string] : [])]);
    const lists: [string, string][] = [["creatives", `${appId}/`], ["ad-media", `${appId}/`], ...[...users].map((u): [string, string] => ["workspace", `${u}/${appId}/`])];
    const targets: Target[] = [];
    let files = 0, bytes = 0;
    for (const [bucket, prefix] of lists) {
      const objects = await objectsUnder(bucket, prefix);
      if (!objects.length) continue;
      for (const o of objects) { files++; bytes += o.bytes; }
      targets.push({ bucket, paths: objects.map((o) => o.name) });
    }
    return { targets, files, bytes, items: files, exists: Boolean(product) };
  }

  /** Clears the key frames a cleanup deleted from each ad's stored scan, so no ad shows a missing frame. */
  async function clearFrames(adIds: string[]) {
    for (let i = 0; i < adIds.length; i += 100) {
      const { data } = await db.from("paid_ads").select("id, scan").in("id", adIds.slice(i, i + 100));
      for (const row of (data ?? []) as { id: string; scan: Record<string, unknown> | null }[]) {
        const video = row.scan?.video as Record<string, unknown> | null | undefined;
        if (!video || !Array.isArray(video.frames) || !video.frames.length) continue;
        await db.from("paid_ads").update({ scan: { ...row.scan, video: { ...video, frames: [] } } }).eq("id", row.id);
      }
    }
  }

  async function deleteRows(table: string, ids: string[]) {
    for (let i = 0; i < ids.length; i += 200) {
      const { error } = await db.from(table).delete().in("id", ids.slice(i, i + 200));
      if (error) throw new Error(`Couldn't clear the database rows: ${error.message}`);
    }
  }

  /** Previews (`run` false) or runs a cleanup. */
  async function cleanup(raw: Record<string, unknown>): Promise<CleanupResult> {
    const input = cleanupInput(raw);
    if (typeof input === "string") throw new HttpError(400, input);
    const result = (files: number, bytes: number, items: number): CleanupResult => ({ action: input.action, files, bytes, items, done: input.run });
    try {
      if (input.action === "rejected_creatives" || input.action === "unused_creatives") {
        const plan = await creativesPlan(input);
        if (input.run) {
          await remove(plan.targets);
          await deleteRows("creatives", plan.ids);
        }
        return result(plan.files, plan.bytes, plan.items);
      }
      if (input.action === "old_media" || input.action === "app_media") {
        const before = input.action === "old_media" ? new Date(now().getTime() - (input.days ?? 90) * 86_400_000) : undefined;
        const plan = await mediaPlan(input.appId, before);
        if (input.run) {
          // Rows first: an ad never points at a copy that is about to go; then the files and the frames.
          await deleteRows("paid_ad_media", plan.rowIds);
          await remove(plan.targets);
          await clearFrames(plan.frameAds);
        }
        return result(plan.files, plan.bytes, plan.items);
      }
      const plan = await appFilesPlan(input.appId!);
      // An app that still exists loses its files only as part of being deleted (the studio deletes it next).
      if (input.run && plan.exists && !input.deleting) throw new HttpError(409, "This app still exists. Delete it in its settings, which removes its files too.");
      if (input.run) await remove(plan.targets);
      return result(plan.files, plan.bytes, plan.items);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(500, `${input.run ? "The cleanup stopped" : "Couldn't work out what would be deleted"}: ${errorText(error)}`);
    }
  }

  return { usage, cleanup };
}
