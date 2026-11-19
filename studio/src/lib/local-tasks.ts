"use client";
// Work this tab runs itself (an import, a competitor being deleted) for the background-tasks box in the
// corner: started, updated and finished by the page that runs it, kept in memory across page changes, so
// closing a dialog or leaving the page still shows its progress. A finished task shows as done (or failed)
// for a few seconds and then goes.
import { useSyncExternalStore } from "react";

export interface LocalTask {
  id: string;
  label: string;
  productName?: string | null;
  done: number | null;
  total: number | null;
  detail?: string | null;
  href?: string | null;
  status: "running" | "done" | "failed";
  finishedAt?: number;
}

export const DONE_SHOWN_MS = 6_000;
const FAILED_SHOWN_MS = 20_000;

let tasks: LocalTask[] = [];
/** Bumped whenever a task starts or finishes: the box checks the server again at once. */
let version = 0;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); };

export function startLocalTask(task: Omit<LocalTask, "status" | "finishedAt">) {
  tasks = [...tasks.filter((t) => t.id !== task.id), { ...task, status: "running" }];
  version++;
  emit();
}

export function updateLocalTask(id: string, patch: Partial<Pick<LocalTask, "label" | "done" | "total" | "detail">>) {
  if (!tasks.some((t) => t.id === id && t.status === "running")) return;
  tasks = tasks.map((t) => (t.id === id ? { ...t, ...patch } : t));
  emit();
}

export function finishLocalTask(id: string, outcome: { ok: boolean; detail?: string | null }) {
  if (!tasks.some((t) => t.id === id)) return;
  tasks = tasks.map((t) => (t.id === id ? { ...t, status: outcome.ok ? "done" : "failed", finishedAt: Date.now(), done: outcome.ok ? t.total ?? t.done : t.done, detail: outcome.detail ?? t.detail } : t));
  version++;
  emit();
  setTimeout(() => {
    tasks = tasks.filter((t) => t.id !== id);
    emit();
  }, outcome.ok ? DONE_SHOWN_MS : FAILED_SHOWN_MS);
}

export const useLocalTasks = () => useSyncExternalStore(subscribe, () => tasks, () => tasks);
export const useLocalTasksVersion = () => useSyncExternalStore(subscribe, () => version, () => version);
