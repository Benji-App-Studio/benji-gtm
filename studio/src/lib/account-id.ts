"use client";
// The signed-in account's id in the browser, read from the session Supabase keeps in a cookie (no request).
// Used to keep per-account choices in localStorage (a closed guide or explainer), so another account on
// the same browser still sees them. null while reading, signed out, or outside the app (the example).
import { useEffect, useState } from "react";
import { publicInstall } from "./install/public";
import { createClient } from "./supabase/client";

let known: Promise<string | null> | null = null;

/** The account the session cookie names right now (read afresh, no request): another tab may have changed it. */
export async function sessionAccountId(): Promise<string | null> {
  try {
    if (!publicInstall()) return null;
    const { data } = await createClient().auth.getSession();
    return data.session?.user.id ?? null;
  } catch {
    return null;
  }
}

function readAccountId(): Promise<string | null> {
  if (!known) known = sessionAccountId();
  return known;
}

/** undefined while reading; then the id, or null. */
export function useAccountId(): string | null | undefined {
  const [id, setId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void readAccountId().then((value) => { if (live) setId(value); });
    return () => { live = false; };
  }, []);
  return id;
}
