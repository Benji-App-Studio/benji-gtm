// Fair claims between accounts (accounts mode): which queued jobs a worker takes, and grouping jobs by
// their account so each is worked with that account's own keys. Pure: no database, no environment.
//
// The Higgsfield API worker claims in SQL (creatives_claim_jobs with p_user / p_per_user / p_staff_only,
// 20261120140000_fair_claims.sql); OpenAI's image jobs are taken here with a conditional update, so the
// same rule lives in planClaims: each account's oldest job first, then each account's second, and so on,
// never more of one account's jobs than its plan's concurrency minus the jobs it has running already,
// and never more in all than the tick's budget.

export interface QueuedJob { id: string; user_id: string; created_at: string }

/** Rows by account, each account's rows in the order given (accounts in the order first seen). */
export function groupByUser<T extends { user_id: string }>(rows: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const list = out.get(row.user_id);
    if (list) list.push(row); else out.set(row.user_id, [row]);
  }
  return out;
}

export interface ClaimPlan {
  /** How many jobs this tick may take in all. */
  budget: number;
  /** Jobs each account has running (or finalizing) already. Missing: none. */
  running: Readonly<Record<string, number>>;
  /** The most jobs one account may have running at once (its plan's jobConcurrency). */
  cap: (userId: string) => number;
}

/** The ids to claim, in the order to claim them (round-robin by account, oldest first within each turn). */
export function planClaims(queued: readonly QueuedJob[], plan: ClaimPlan): string[] {
  const budget = Math.max(0, Math.floor(plan.budget));
  if (!budget || !queued.length) return [];
  const turns: { id: string; turn: number; created_at: string }[] = [];
  for (const [user, jobs] of groupByUser(queued)) {
    const room = Math.max(0, Math.floor(plan.cap(user)) - Math.max(0, plan.running[user] ?? 0));
    [...jobs].sort((a, b) => a.created_at.localeCompare(b.created_at)).slice(0, room)
      .forEach((job, turn) => turns.push({ id: job.id, turn, created_at: job.created_at }));
  }
  turns.sort((a, b) => a.turn - b.turn || a.created_at.localeCompare(b.created_at));
  return turns.slice(0, budget).map((t) => t.id);
}

/** Running jobs counted per account. */
export function runningByUser(rows: readonly { user_id: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) out[row.user_id] = (out[row.user_id] ?? 0) + 1;
  return out;
}

/** A submitted job whose account's key is gone (removed, or the account suspended): it is failed with this. */
export const keyGoneNote = (provider: "Higgsfield" | "OpenAI", suspended = false) => suspended
  ? `This account is suspended, so the ${provider} result can't be collected.`
  : `Your ${provider} key was removed after this job was sent, so its result can't be collected. Add the key again in Settings > API keys, then make it again.`;
