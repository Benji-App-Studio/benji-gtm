"use client";
// The first-run checklist: six steps, one open at a time. The access token lives in this component's
// memory only: it is sent with each setup call and is gone when the page is closed or reloaded.
import { useState } from "react";
import { Button, ButtonLink, Callout, Field, inputClass, Spinner } from "@/components/ui";
import { PREPARE_STEPS } from "@/lib/server/provision/types";
import { KeysStep } from "./keys-step";
import { FailureNote, OutLink, postJson, ProgressList, runStream, StepCard, Steps, SUPABASE_LINKS, TokenHelp, useProgress, type CardState, type RunFailure } from "./parts";

type StepKey = "project" | "token" | "prepare" | "account" | "keys" | "finish";
const ORDER: StepKey[] = ["project", "token", "prepare", "account", "keys", "finish"];

interface ProjectOption { ref: string; name: string; region: string; ready: boolean; problem: string | null }
interface Inspection { project: { ref: string; name: string; region: string }; state: "empty" | "update"; pending: number; applied: number; owned: boolean; plan: "free" | "paid" }

export function SetupChecklist({ appName, start }: { appName: string; start: "project" | "keys" }) {
  const [open, setOpen] = useState<StepKey>(start);
  // Steps before `start` were finished in an earlier visit (the account exists) and can't be reopened.
  const locked = start === "keys";
  const [token, setToken] = useState("");
  const [projects, setProjects] = useState<ProjectOption[] | null>(null);
  const [picked, setPicked] = useState("");
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<RunFailure | null>(null);
  const [prepared, setPrepared] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const progress = useProgress();

  const stateOf = (key: StepKey): CardState => (key === open ? "open" : ORDER.indexOf(key) < ORDER.indexOf(open) ? "done" : "todo");
  const go = (key: StepKey) => { setFailure(null); setOpen(key); };
  const reopen = (key: StepKey) => (!locked && !busy && stateOf(key) === "done" ? () => go(key) : undefined);

  async function checkToken(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setFailure(null); setProjects(null); setInspection(null); setPrepared(false);
    const { data, error } = await postJson<{ projects: ProjectOption[] }>("/api/setup/projects", { token });
    setBusy(false);
    if (error || !data) return setFailure(error);
    setProjects(data.projects);
    const ready = data.projects.filter((project) => project.ready);
    setPicked(ready.length === 1 ? ready[0].ref : "");
  }

  async function checkProject() {
    setBusy(true); setFailure(null); setInspection(null); setPrepared(false);
    const { data, error } = await postJson<Inspection>("/api/setup/inspect", { token, ref: picked });
    setBusy(false);
    if (error || !data) return setFailure(error);
    setInspection(data);
  }

  async function prepare() {
    setBusy(true); setFailure(null); progress.reset();
    const failed = await runStream("/api/setup/prepare", { token, ref: picked }, progress.record);
    setBusy(false);
    if (failed) return setFailure(failed);
    setPrepared(true);
  }

  async function createAccount(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setFailure(null);
    const connectOnly = Boolean(inspection?.owned);
    const { data, error } = await postJson<{ ok: boolean; signedIn: boolean }>("/api/setup/owner", connectOnly ? { token, ref: picked, connectOnly: true } : { token, ref: picked, email, password });
    if (error || !data) { setBusy(false); return setFailure(error); }
    // A full reload: the app now knows its project, and the token and password leave the page's memory.
    window.location.assign(data.signedIn ? "/setup?step=keys" : `/login?next=${encodeURIComponent("/setup?step=keys")}`);
  }

  const projectName = inspection?.project.name ?? projects?.find((project) => project.ref === picked)?.name;

  return (
    <div className="space-y-3">
      <StepCard number={1} title="Create your Supabase project" state={stateOf("project")} onOpen={reopen("project")} summary="You have a new, empty project."
        why={`Supabase is the service that stores your data. You get your own project, in your own account, so your data stays yours. ${appName} sets it up for you in the next steps.`}>
        <Steps>
          <li>Open <OutLink href={SUPABASE_LINKS.signUp}>supabase.com</OutLink> and create a free account. If you already have one, sign in.</li>
          <li>Open <OutLink href={SUPABASE_LINKS.newProject}>New project</OutLink>. Type any name. Choose a database password and keep it somewhere safe; you won&apos;t need to type it here. Pick the region closest to you. Press <b>Create new project</b>.</li>
          <li>Wait until Supabase has finished setting the project up. This takes about two minutes.</li>
        </Steps>
        <Callout tone="raised">Use a new project made only for {appName}. Setup refuses a project that already holds other data. The free plan is enough to start; Supabase pauses a free project after a week without use, and you can restore it from your dashboard.</Callout>
        <Button type="button" onClick={() => go("token")}>My project is ready</Button>
      </StepCard>

      <StepCard number={2} title="Connect it with an access token" state={stateOf("token")} onOpen={reopen("token")} summary={projectName ? `Project: ${projectName}` : undefined}
        why={`So that ${appName} can prepare the project for you, instead of you copying settings by hand.`}>
        <TokenHelp appName={appName} />
        <form onSubmit={checkToken} className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 basis-64">
            <Field label="Access token">
              <input className={inputClass} type="password" autoComplete="off" spellCheck={false} placeholder="sbp_..." value={token}
                onChange={(event) => { setToken(event.target.value.trim()); setProjects(null); setInspection(null); }} />
            </Field>
          </div>
          <Button type="submit" disabled={busy || !token}>{busy && !projects ? <><Spinner className="size-3.5" />Checking</> : "Check"}</Button>
        </form>
        {projects && projects.length === 0 && (
          <p className="text-sm text-warn">The token works, but this account has no project yet. Go back to step 1, create one, then press Check again.</p>
        )}
        {projects && projects.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium text-ink">The token works. Pick your project:</legend>
            {projects.map((project) => (
              <label key={project.ref} className="flex items-start gap-2.5 rounded-inner border border-line p-3 text-sm">
                <input type="radio" name="project" className="mt-1" value={project.ref} checked={picked === project.ref} disabled={!project.ready || busy}
                  onChange={() => { setPicked(project.ref); setInspection(null); setFailure(null); }} />
                <span className="min-w-0">
                  <span className="font-medium text-ink">{project.name}</span> <span className="text-muted">({project.region})</span>
                  {project.problem && <span className="block text-muted">{project.problem}</span>}
                </span>
              </label>
            ))}
            <Button type="button" variant="secondary" onClick={checkProject} disabled={busy || !picked}>{busy ? <><Spinner className="size-3.5" />Checking</> : "Check this project"}</Button>
          </fieldset>
        )}
        {inspection && (
          <>
            <p className="text-sm text-win">
              {inspection.state === "empty"
                ? `"${inspection.project.name}" is empty and ready to be prepared.`
                : `"${inspection.project.name}" was prepared for ${appName} before. Setup will add only what is missing.`}
            </p>
            <Button type="button" onClick={() => go("prepare")}>Continue</Button>
          </>
        )}
        {failure && open === "token" && <FailureNote failure={failure} />}
      </StepCard>

      <StepCard number={3} title="Prepare the project" state={stateOf("prepare")} onOpen={reopen("prepare")} summary="Tables, backend and starter images are in place."
        why="This creates the database tables, installs the backend and copies the starter images into your project. It takes about two minutes. Keep this page open.">
        {(busy || prepared || Object.keys(progress.steps).length > 0) && <ProgressList ids={PREPARE_STEPS} steps={progress.steps} running={busy} />}
        {failure && open === "prepare" && <FailureNote failure={failure} onRetry={prepare} busy={busy} />}
        {!prepared && !failure && <Button type="button" onClick={prepare} disabled={busy}>{busy ? <><Spinner className="size-3.5" />Preparing</> : "Prepare the project"}</Button>}
        {prepared && (
          <>
            <p className="text-sm text-win">Your project is ready.</p>
            <Button type="button" onClick={() => go("account")}>Continue</Button>
          </>
        )}
      </StepCard>

      <StepCard number={4} title={inspection?.owned ? "Connect this computer" : "Create your account"} state={stateOf("account")} summary="Your account is the owner of this copy."
        why={inspection?.owned
          ? "This project already has an owner account. Connect this computer to the project, then sign in with that account."
          : `This becomes the owner account of your copy of ${appName}. Your email and password are sent only to your own Supabase project. Nobody else can sign up afterwards; you can invite people later in Settings.`}>
        <form onSubmit={createAccount} className="space-y-4">
          {!inspection?.owned && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Your email">
                <input className={inputClass} type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
              </Field>
              <Field label="Choose a password" hint="At least 8 characters.">
                <input className={inputClass} type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} />
              </Field>
            </div>
          )}
          <Button type="submit" disabled={busy}>
            {busy ? <><Spinner className="size-3.5" />Working</> : inspection?.owned ? "Connect this computer" : "Create my account"}
          </Button>
        </form>
        {failure && open === "account" && <FailureNote failure={failure} />}
      </StepCard>

      <StepCard number={5} title="Add your keys" state={stateOf("keys")} summary="Your OpenAI key is saved."
        why={`${appName} works through your own accounts with these services, so you pay them directly and only for what you use. Your keys are stored in your Supabase project, never on this computer.`}>
        <KeysStep onDone={() => go("finish")} />
      </StepCard>

      <StepCard number={6} title="Create your first app" state={stateOf("finish")}
        why={`Tell ${appName} about your product. Every competitor search and analysis starts from it.`}>
        <p className="text-sm text-ink">
          Setup is finished. You can now delete the access token: open <OutLink href={SUPABASE_LINKS.tokens}>Access Tokens in Supabase</OutLink> and remove it.
        </p>
        <ButtonLink href="/onboarding">Create your first app</ButtonLink>
      </StepCard>
    </div>
  );
}
