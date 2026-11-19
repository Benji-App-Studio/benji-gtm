"use client";
// Notices a session that ended while the app was open (it expired, or the person signed out in another
// tab). Every request then answers "sign in", and the pages sat on their placeholders with nothing
// saying why. This sends the person to the log-in page, and back to where they were afterwards.
// It asks when the install can't be read, when the tab is looked at again, and on moving to another
// page, at most once every half minute.
import { useEffect, useRef } from "react";
import { INSTALL_URL, useInstall } from "@/lib/install/use-install";
import { useAppPath } from "./path";

const EVERY_MS = 30_000;

export function SessionWatch() {
  const { error } = useInstall();
  const path = useAppPath();
  const last = useRef(0);
  const leaving = useRef(false);

  useEffect(() => {
    const check = (force = false) => {
      if (leaving.current || (!force && Date.now() - last.current < EVERY_MS)) return;
      last.current = Date.now();
      // Only a 401 means "signed out"; anything else is the page's own to explain.
      fetch(INSTALL_URL, { cache: "no-store" }).then((response) => {
        if (response.status !== 401 || leaving.current) return;
        leaving.current = true;
        const here = `${window.location.pathname}${window.location.search}`;
        // A full page load, not a client-side move: nothing of the ended session's data should stay in memory.
        window.location.href = new URL(`/login?next=${encodeURIComponent(here)}`, window.location.origin).href;
      }).catch(() => { /* offline: nothing to conclude */ });
    };
    // The first render of a page load has just been checked by the server.
    if (last.current === 0) last.current = Date.now(); else check(Boolean(error));
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [error, path]);
  return null;
}
