"use client";
// Settings → Desktop runner. The runner is an optional program on the person's own Mac
// (scripts/creative-runner) that makes what the image and video services only offer through their own
// app: creator-style videos and product cut-outs. This page says what it is, creates or replaces the
// secret it signs in with (shown once), and gives the three commands that start it, run from the app's
// folder (its package.json has the `creative-runner` script).
import { useState } from "react";
import { APP_NAME } from "@/lib/brand-config";
import { featureState } from "@/lib/capabilities";
import { publicInstall } from "@/lib/install/public";
import { keyState, type InstallState, type KeyState } from "@/lib/install/types";
import type { UseInstall } from "@/lib/install/use-install";
import { ask } from "../dialog";
import { IconCheck, IconCopy } from "../icons";
import { Badge, Button, cx, SettingsGroup, SettingsRow, Spinner } from "../ui";
import { api, ReadOnlyNote, SettingsPage, Status, WithInstall } from "./settings-ui";

const SECRET_NAME = "CREATIVES_RUNNER_SECRET";
/** Stands in for the secret in the start command when it isn't on screen any more. */
const SECRET_STAND_IN = "your-secret";

export function RunnerSettings() {
  return (
    <SettingsPage page="runner">
      <WithInstall>
        {(install, manage, refresh) => <Runner install={install} manage={manage} refresh={refresh} />}
      </WithInstall>
    </SettingsPage>
  );
}

function Runner({ install, manage, refresh }: { install: InstallState; manage: boolean; refresh: UseInstall["refresh"] }) {
  const key = keyState(install, SECRET_NAME);
  const exists = featureState("studio.runner", install).ok;
  const fromServer = key.source === "env";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The secret just created: on screen until the page is left, never fetched again. */
  const [secret, setSecret] = useState<string | null>(null);

  async function create() {
    if (exists) {
      const yes = await ask({
        title: "Replace the runner's secret?",
        body: "The old secret stops working at once. A runner that is already going can't pick up new jobs until you restart it with the new secret.",
        confirm: "Replace secret", danger: true,
      });
      if (!yes) return;
    }
    setBusy(true); setError(null);
    const result = await api<{ secret: string; key: KeyState }>("/api/install/runner-secret", "POST", {});
    await refresh();
    setBusy(false);
    if (!result.ok) return setError(result.error);
    if (typeof result.data.secret !== "string" || !result.data.secret) return setError("The secret was created but didn't come back. Replace it to get a new one.");
    setSecret(result.data.secret);
  }

  const project = publicInstall()?.url.replace(/\/+$/, "") ?? "https://your-project.supabase.co";
  const start = `CREATIVES_FUNCTION_URL="${project}/functions/v1/creatives" CREATIVES_RUNNER_SECRET="${secret ?? SECRET_STAND_IN}" npm run creative-runner`;

  return (
    <>
      <ReadOnlyNote install={install} what="the desktop runner" />

      <SettingsGroup title="What needs it" description="Images and AI videos run on your Higgsfield or OpenAI key and never need the runner.">
        <SettingsRow label="Creator-style videos" description="UGC videos with a presenter, a hook and a setting, in Studio." />
        <SettingsRow label="Product cut-outs" description="A product photo with its background removed, under an app's Brand > Assets." />
      </SettingsGroup>

      <SettingsGroup title="Secret" description="The runner signs in to this workspace with a secret. It is stored in your own Supabase project and shown only once, when you create it.">
        <SettingsRow
          label={<span className="flex flex-wrap items-center gap-2">Runner secret{exists && <Badge tone="win">Created</Badge>}</span>}
          description={fromServer ? "Set as a secret on the Supabase project's edge functions, so it can't be replaced here."
            : exists ? `Created${key.last4 ? `, ending ${key.last4}` : ""}. Replace it if you lost it or it may have leaked.`
            : "Not created yet. Create it, then start the runner with it."}
          below={<>
            {error && <Status error={error} className="mt-2" />}
            {secret && (
              <div className="mt-3 rounded-inner border border-line bg-canvas p-3">
                <p className="text-sm text-label"><span className="font-medium text-ink">Copy this secret now.</span> It is not shown again. It is already filled in to the last command below.</p>
                <CopyLine value={secret} label="Runner secret" copy="Copy secret" className="mt-2" />
              </div>
            )}
          </>}>
          {manage && !fromServer && (
            <Button variant={exists ? "secondary" : "primary"} size="sm" disabled={busy} onClick={() => { void create(); }}>
              {busy && <Spinner className="size-3.5" />}{exists ? "Replace secret" : "Create secret"}
            </Button>
          )}
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Start it" description={<>On the Mac that will do the work, open the Terminal app, type <code className="font-mono text-xs text-label">cd</code> and a space, drag in the {APP_NAME} folder (the one you cloned, which holds <code className="font-mono text-xs text-label">package.json</code> and <code className="font-mono text-xs text-label">start.command</code>) and press Return. Then run these three commands in order. The Mac needs Node.js 22 or newer, ffmpeg, Xcode&apos;s command-line tools and the Higgsfield command-line app; <code className="font-mono text-xs [overflow-wrap:anywhere] text-label">scripts/creative-runner/README.md</code> in that folder says how to get each.</>}>
        <Step n={1} label="Install what it needs" description="Once, and again after an update." command="npm install" />
        <Step n={2} label="Sign in to Higgsfield" description="The runner makes videos and cut-outs with your Higgsfield account. It stops and says so when the sign-in expires." command="higgsfield auth login" />
        <Step n={3} label="Start the runner"
          description={secret ? "Your new secret is filled in. Leave the Terminal window open while it works; press Control-C to stop it."
            : exists ? `Put your secret in place of ${SECRET_STAND_IN}. If you don't have it any more, replace it above. Leave the Terminal window open while it works; press Control-C to stop it.`
            : `Create the secret above first: it is then filled in here in place of ${SECRET_STAND_IN}. Leave the Terminal window open while it works; press Control-C to stop it.`}
          command={start} />
      </SettingsGroup>
    </>
  );
}

function Step({ n, label, description, command }: { n: number; label: string; description: string; command: string }) {
  return (
    <SettingsRow label={<span className="flex items-center gap-2"><span className="grid size-[18px] shrink-0 place-items-center rounded-full bg-control text-[11px] leading-none font-medium text-label tabular-nums">{n}</span>{label}</span>}
      description={description} below={<CopyLine value={command} label={label} copy="Copy" className="mt-2.5" />} />
  );
}

/** One line of text to copy (a command or the secret), in the mono face, with a copy button. */
function CopyLine({ value, label, copy, className }: { value: string; label: string; copy: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  async function run() {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { /* no clipboard access: clicking the text selects all of it, so it can be copied by hand */ }
  }
  return (
    <div className={cx("flex flex-wrap items-center gap-2", className)}>
      {/* A long command wraps so all of it can be read; one click selects it for copying by hand. */}
      <code aria-label={label} className="min-w-0 flex-[1_1_240px] rounded-control border border-hairline bg-raised px-2.5 py-1 font-mono text-xs leading-5 break-all text-ink select-all">{value}</code>
      <Button type="button" variant="secondary" onClick={() => { void run(); }}>{copied ? <IconCheck /> : <IconCopy />}{copied ? "Copied" : copy}</Button>
    </div>
  );
}
