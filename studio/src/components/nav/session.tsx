"use client";
// Notices a session that ended while the app was open (it expired, or the person signed out in another
// tab). Every request then answers "sign in", and the pages sat on their placeholders with nothing
// saying why. This sends the person to the log-in page, and back to where they were afterwards.
// It asks when the install can't be read, when the tab is looked at again, and on moving to another
// page, at most once every half minute, and every five minutes while the tab is in view. The question is
// the shared install request (lib/install/use-install.ts), so it also keeps that answer fresh: no request
// of its own when another screen asked a moment ago.
// It also notices another account signing in on this browser (in another tab: the session cookie is
// shared). This page still holds the first account's lists in memory, so it reloads at the app's root,
// which opens the new account's own Home with nothing of the old one left (lib/account-switch.ts).
import { useEffect, useRef } from "react";
import { sessionAccountId } from "@/lib/account-id";
import { accountSwitched } from "@/lib/account-switch";
import { clearPersisted, lastStatus, refresh, revalidate } from "@/lib/client-cache";
import { INSTALL_URL, useInstall } from "@/lib/install/use-install";
import { useAppPath } from "./path";

const EVERY_MS = 30_000;
const IN_VIEW_MS = 5 * 60_000;

export function SessionWatch() {
  const { error } = useInstall();
  const path = useAppPath();
  const last = useRef(0);
  const leaving = useRef(false);
  // The account this page was loaded for (undefined until read).
  const loadedFor = useRef<string | null | undefined>(undefined);
  useEffect(() => { void sessionAccountId().then((id) => { if (loadedFor.current === undefined) loadedFor.current = id; }); }, []);

  useEffect(() => {
    const switched = () => {
      if (leaving.current || loadedFor.current === undefined) return;
      void sessionAccountId().then((now) => {
        if (leaving.current || !accountSwitched(loadedFor.current, now)) return;
        leaving.current = true;
        window.location.href = new URL("/app", window.location.origin).href;
      });
    };
    const check = (force = false) => {
      // Cheap (the cookie, no request): asked on every look, not only every half minute.
      switched();
      if (leaving.current || (!force && Date.now() - last.current < EVERY_MS)) return;
      last.current = Date.now();
      // Only a 401 means "signed out"; anything else is the page's own to explain.
      const signedOut = () => {
        if (lastStatus(INSTALL_URL) !== 401 || leaving.current) return;
        leaving.current = true;
        const here = `${window.location.pathname}${window.location.search}`;
        // A full page load, not a client-side move: nothing of the ended session's data should stay in memory.
        // The lists kept for fast reloads (IndexedDB) go with the session, as on Sign out: whoever signs in next
        // may be someone else. At most a second's wait, so a stuck store never keeps the page here.
        const go = () => { window.location.href = new URL(`/login?next=${encodeURIComponent(here)}`, window.location.origin).href; };
        void Promise.race([clearPersisted(), new Promise((resolve) => setTimeout(resolve, 1000))]).finally(go);
      };
      (force ? refresh(INSTALL_URL) : revalidate(INSTALL_URL, EVERY_MS)).then(signedOut, signedOut);
    };
    // The first render of a page load has just been checked by the server.
    if (last.current === 0) last.current = Date.now(); else check(Boolean(error));
    // Another tab signing in or out changes the session cookie; focus is when this tab is looked at again.
    window.addEventListener("focus", switched);
    const onVisible = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") check(); }, IN_VIEW_MS);
    return () => { document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", switched); window.clearInterval(timer); };
  }, [error, path]);
  return null;
}
