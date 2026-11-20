"use client";
// The optional CAPTCHA on the sign-up, log-in and password-reset forms (lib/install/captcha.ts): hCaptcha
// or Cloudflare Turnstile, whichever the deployment configured. The provider's script is loaded only when
// one is configured; with none, nothing renders and the forms work as before. A token is good for one
// try: bump `reset` after each attempt for a fresh one.
import { useEffect, useRef, useState } from "react";
import type { CaptchaConfig } from "@/lib/install/captcha";
import { useT } from "@/lib/i18n/client";

type Widget = { render: (el: HTMLElement, options: Record<string, unknown>) => string | number; reset: (id?: string | number) => void; remove?: (id?: string | number) => void };
type Globals = { hcaptcha?: Widget; turnstile?: Widget };

const SCRIPTS: Record<CaptchaConfig["provider"], string> = {
  hcaptcha: "https://js.hcaptcha.com/1/api.js?render=explicit",
  turnstile: "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
};

const loading = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  if (!loading.has(src)) {
    loading.set(src, new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => { loading.delete(src); reject(new Error("captcha script")); };
      document.head.append(script);
    }));
  }
  return loading.get(src)!;
}

export function Captcha({ config, onToken, reset = 0 }: { config: CaptchaConfig | null | undefined; onToken: (token: string | null) => void; reset?: number }) {
  const { t } = useT();
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | number | null>(null);
  const [failed, setFailed] = useState(false);
  const report = useRef(onToken);
  useEffect(() => { report.current = onToken; }, [onToken]);

  useEffect(() => {
    if (!config || !box.current) return;
    let live = true;
    const el = box.current;
    loadScript(SCRIPTS[config.provider]).then(async () => {
      // The script defines its global a moment after it loads.
      for (let i = 0; i < 40 && live && !(window as unknown as Globals)[config.provider]; i++) await new Promise((r) => setTimeout(r, 50));
      const api = (window as unknown as Globals)[config.provider];
      if (!live || !api) { if (live) setFailed(true); return; }
      widget.current = api.render(el, {
        sitekey: config.siteKey,
        callback: (token: string) => report.current(token),
        "expired-callback": () => report.current(null),
        "error-callback": () => report.current(null),
      });
    }).catch(() => { if (live) setFailed(true); });
    return () => {
      live = false;
      const api = (window as unknown as Globals)[config.provider];
      if (api?.remove && widget.current != null) try { api.remove(widget.current); } catch { /* already gone */ }
      widget.current = null;
    };
  }, [config]);

  // A fresh challenge after each try (a token is single-use).
  useEffect(() => {
    if (!config || !reset || widget.current == null) return;
    const api = (window as unknown as Globals)[config.provider];
    try { api?.reset(widget.current); } catch { /* re-rendered on the next load */ }
    report.current(null);
  }, [reset, config]);

  if (!config) return null;
  return (
    <div className="grid min-h-[65px] justify-center">
      <div ref={box} />
      {failed && <p role="alert" className="text-center text-xs text-warn">{t("The security check didn't load. Turn off any blocker for this page and reload.")}</p>}
    </div>
  );
}
