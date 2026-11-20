"use client";
// The first-run checklist: six steps, one open at a time. The access token lives in this component's
// memory only: it is sent with each setup call and is gone when the page is closed or reloaded.
import { useState } from "react";
import { PasswordInput, SignInDetails } from "@/components/account-pieces";
import { rich } from "@/components/rich";
import { Button, ButtonLink, Callout, Field, inputClass, Spinner } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { m } from "@/lib/i18n/translate";
import { PREPARE_STEPS } from "@/lib/server/provision/types";
import { KeysStep } from "./keys-step";
import { NewTokenNote, tokenRejected } from "./token-retry";
import { FailureNote, OutLink, postJson, ProgressList, runStream, StepCard, Steps, SUPABASE_LINKS, TokenHelp, useProgress, type CardState, type RunFailure } from "./parts";

type StepKey = "project" | "token" | "prepare" | "account" | "keys" | "finish";
const ORDER: StepKey[] = ["project", "token", "prepare", "account", "keys", "finish"];

interface ProjectOption { ref: string; name: string; region: string; ready: boolean; problem: string | null }
interface Inspection { project: { ref: string; name: string; region: string }; state: "empty" | "update"; pending: number; applied: number; owned: boolean; plan: "free" | "paid" }

export function SetupChecklist({ appName, start }: { appName: string; start: "project" | "keys" }) {
  const { t } = useT();
  const [open, setOpen] = useState<StepKey>(start);
  // Steps before `start` were finished in an earlier visit (the account exists) and can't be reopened.
  const locked = start === "keys";
  const [token, setToken] = useState("");
  const [projects, setProjects] = useState<ProjectOption[] | null>(null);
  const [picked, setPicked] = useState("");
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<RunFailure | null>(null);
  /** Set when the account step found the project already has its owner (another tab finished setup). */
  const [ownerFound, setOwnerFound] = useState(false);
  const [prepared, setPrepared] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  /** The sign-in just made, shown once before moving on. */
  const [details, setDetails] = useState<{ email: string; password: string; signedIn: boolean } | null>(null);
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

  async function prepare(useToken = token) {
    setBusy(true); setFailure(null); progress.reset();
    const failed = await runStream("/api/setup/prepare", { token: useToken, ref: picked }, progress.record);
    setBusy(false);
    if (failed) return setFailure(failed);
    setPrepared(true);
  }

  async function createAccount(event: React.FormEvent) {
    event.preventDefault();
    await submitAccount();
  }

  async function submitAccount(useToken = token) {
    if (password.length < 8) return setFailure({ message: t("Use a password with at least 8 characters.") });
    setBusy(true); setFailure(null);
    const connectOnly = Boolean(inspection?.owned);
    const { data, error } = await postJson<{ ok: boolean; signedIn: boolean; email: string }>("/api/setup/owner", connectOnly ? { token: useToken, ref: picked, connectOnly: true, password } : { token: useToken, ref: picked, email, password });
    if (error?.code === "owner_exists" && !connectOnly) {
      // The project got its owner meanwhile (setup finished in another tab or window): check it again, and the
      // form becomes "Connect this computer", signing in as that owner.
      const again = await postJson<Inspection>("/api/setup/inspect", { token: useToken, ref: picked });
      setBusy(false);
      if (again.data?.owned) {
        setInspection(again.data);
        return setOwnerFound(true);
      }
      return setFailure(error);
    }
    setBusy(false);
    if (error || !data) return setFailure(error);
    // The token isn't needed again: it leaves the page's memory now.
    setToken("");
    setDetails({ email: data.email, password, signedIn: data.signedIn });
  }

  /** A full reload: the app now knows its project, and the password leaves the page's memory. */
  function continueAfterAccount() {
    window.location.assign(details?.signedIn ? "/setup?step=keys" : "/app");
  }

  const projectName = inspection?.project.name ?? projects?.find((project) => project.ref === picked)?.name;

  return (
    <div className="space-y-2">
      <StepCard number={1} title={t("Create your Supabase project")} state={stateOf("project")} onOpen={reopen("project")} summary={t("You have a new, empty project.")}
        why={t("Supabase is the service that stores your data. You get your own project, in your own account, so your data stays yours. {app} sets it up for you in the next steps.", { app: appName })}>
        <Steps>
          <li>{rich(t("Open {link} and create a free account. If you already have one, sign in."), { link: <OutLink href={SUPABASE_LINKS.signUp}>supabase.com</OutLink> })}</li>
          <li>{rich(t("Open {link}. Type any name. Choose a database password and keep it somewhere safe; you won't need to type it here. Pick the region closest to you. Press {button}."), { link: <OutLink href={SUPABASE_LINKS.newProject}>New project</OutLink>, button: <b>Create new project</b> })}</li>
          <li>{t("Wait until Supabase has finished setting the project up. This takes about two minutes.")}</li>
        </Steps>
        <Callout tone="raised">{t("Use a new project made only for {app}. Setup refuses a project that already holds other data. The free plan is enough to start.", { app: appName })}</Callout>
        <FreePlanLimits appName={appName} />
        <Button type="button" onClick={() => go("token")}>{t("My project is ready")}</Button>
      </StepCard>

      <StepCard number={2} title={t("Connect it with an access token")} state={stateOf("token")} onOpen={reopen("token")} summary={projectName ? t("Project: {name}", { name: projectName }) : undefined}
        why={t("So that {app} can prepare the project for you, instead of you copying settings by hand.", { app: appName })}>
        <TokenHelp appName={appName} />
        <form onSubmit={checkToken} className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 basis-64">
            <Field label={t("Access token")}>
              <input className={inputClass} type="password" autoComplete="off" spellCheck={false} placeholder="sbp_..." value={token}
                onChange={(event) => { setToken(event.target.value.trim()); setProjects(null); setInspection(null); }} />
            </Field>
          </div>
          <Button type="submit" disabled={busy || !token}>{busy && !projects ? <><Spinner className="size-3.5" />{t("Checking")}</> : t("Check")}</Button>
        </form>
        {projects && projects.length === 0 && (
          <p className="text-sm text-warn">{t("The token works, but this account has no project yet. Go back to step 1, create one, then press Check again.")}</p>
        )}
        {projects && projects.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium text-ink">{t("The token works. Pick your project:")}</legend>
            {projects.map((project) => (
              <label key={project.ref} className="flex items-start gap-2.5 rounded-inner border border-line px-3 py-2.5 text-sm">
                <input type="radio" name="project" className="mt-1" value={project.ref} checked={picked === project.ref} disabled={!project.ready || busy}
                  onChange={() => { setPicked(project.ref); setInspection(null); setFailure(null); }} />
                <span className="min-w-0">
                  <span className="font-medium text-ink">{project.name}</span> <span className="text-muted">({project.region})</span>
                  {project.problem && <span className="block text-muted">{t(project.problem)}</span>}
                </span>
              </label>
            ))}
            <Button type="button" variant="secondary" onClick={checkProject} disabled={busy || !picked}>{busy ? <><Spinner className="size-3.5" />{t("Checking")}</> : t("Check this project")}</Button>
          </fieldset>
        )}
        {inspection && (
          <>
            <p className="text-sm text-win">
              {inspection.state === "empty"
                ? t("\"{project}\" is empty and ready to be prepared.", { project: inspection.project.name })
                : t("\"{project}\" was prepared for {app} before. Setup will add only what is missing.", { project: inspection.project.name, app: appName })}
            </p>
            <Button type="button" onClick={() => go("prepare")}>{t("Continue")}</Button>
          </>
        )}
        {failure && open === "token" && <FailureNote failure={failure} />}
      </StepCard>

      <StepCard number={3} title={t("Prepare the project")} state={stateOf("prepare")} onOpen={reopen("prepare")} summary={t("Tables, backend and starter images are in place.")}
        why={t("This creates the database tables, installs the backend and copies the starter images into your project. It takes about two minutes. Keep this page open.")}>
        {(busy || prepared || Object.keys(progress.steps).length > 0) && <ProgressList ids={PREPARE_STEPS} steps={progress.steps} running={busy} />}
        {failure && open === "prepare" && (tokenRejected(failure)
          ? <NewTokenNote failure={failure} oldToken={token} busy={busy} onRetry={(fresh) => { setToken(fresh); void prepare(fresh); }} />
          : <FailureNote failure={failure} onRetry={() => { void prepare(); }} busy={busy} />)}
        {!prepared && !failure && <Button type="button" onClick={() => { void prepare(); }} disabled={busy}>{busy ? <><Spinner className="size-3.5" />{t("Preparing")}</> : t("Prepare the project")}</Button>}
        {prepared && (
          <>
            <p className="text-sm text-win">{t("Your project is ready.")}</p>
            <Button type="button" onClick={() => go("account")}>{t("Continue")}</Button>
          </>
        )}
      </StepCard>

      <StepCard number={4} title={inspection?.owned ? t("Connect this computer") : t("Create your account")} state={stateOf("account")} summary={t("Your account is the owner of this copy.")}
        why={inspection?.owned
          ? t("This project already has an owner account. Choose a password for it, and this computer connects to the project and signs you in with it. You can type your current password again.")
          : t("This becomes the owner account of your copy of {app}. Nobody else can sign up afterwards; you can invite people later in Settings.", { app: appName })}>
        {details ? (
          <>
            <SignInDetails email={details.email} password={details.password} />
            <Button type="button" onClick={continueAfterAccount}>{t("Continue")}</Button>
          </>
        ) : (
          <form onSubmit={createAccount} className="space-y-4" noValidate>
            <div className="grid gap-4 sm:grid-cols-2">
              {!inspection?.owned && (
                <Field label={t("Your email")}>
                  <input className={inputClass} type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
                </Field>
              )}
              <Field label={t("Choose a password")} hint={t("At least 8 characters.")}>
                <PasswordInput autoComplete="new-password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} />
              </Field>
            </div>
            <p className="text-sm text-muted">{t("This is your own account in your own Supabase project. On this computer the app signs you in automatically, so you won't type this again; you need the password only if you put the app online later.")}</p>
            <Button type="submit" disabled={busy}>
              {busy ? <><Spinner className="size-3.5" />{t("Working")}</> : inspection?.owned ? t("Connect this computer") : t("Create my account")}
            </Button>
          </form>
        )}
        {ownerFound && !details && <p className="text-sm text-muted" role="status">{t("This project got its owner in another tab or window. Type that account's password to connect this computer.")}</p>}
        {failure && open === "account" && (tokenRejected(failure)
          ? <NewTokenNote failure={failure} oldToken={token} busy={busy} onRetry={(fresh) => { setToken(fresh); void submitAccount(fresh); }} />
          : <FailureNote failure={failure} />)}
      </StepCard>

      <StepCard number={5} title={t("Add your keys")} state={stateOf("keys")} summary={t("Your OpenAI key is saved.")}
        why={t("{app} works through your own accounts with these services, so you pay them directly and only for what you use. Your keys are stored in your Supabase project, never on this computer.", { app: appName })}>
        <KeysStep onDone={() => go("finish")} />
      </StepCard>

      <StepCard number={6} title={t("Create your first app")} state={stateOf("finish")}
        why={t("Tell {app} about your product. Every competitor search and analysis starts from it.", { app: appName })}>
        <p className="text-sm text-ink">
          {rich(t("Setup is finished. You can now delete the access token: open {link} and remove it."), { link: <OutLink href={SUPABASE_LINKS.tokens}>{t("Access Tokens in Supabase")}</OutLink> })}
        </p>
        <ButtonLink href="/onboarding">{t("Create your first app")}</ButtonLink>
      </StepCard>
    </div>
  );
}

// What Supabase's free plan limits, and what the app does about each (numbers: release/docs/keys/supabase.md
// and supabase/functions/_shared/limits.ts DEFAULT_LIMITS).
const FREE_LIMITS: [limit: string, handling: string][] = [
  [m("Each backend step runs for up to 150 seconds."), m("Long jobs, like collecting and reading ads, run in short steps that pick up where the last one stopped.")],
  [m("Each file can be up to 50 MB."), m("A competitor's video over 50 MB isn't saved; the ad and its still image are.")],
  [m("1 GB of file storage in all."), m("Imports check the space left first, and the Research page's Stored media line can delete saved files.")],
  [m("A project pauses after a week without use."), m("Your data stays. Open your Supabase dashboard and press Resume project, then reload this app.")],
];

function FreePlanLimits({ appName }: { appName: string }) {
  const { t } = useT();
  return (
    <div>
      <p className="text-sm font-medium text-ink">{t("What the free plan limits")}</p>
      <ul className="mt-1.5 grid gap-1.5 text-sm">
        {FREE_LIMITS.map(([limit, handling]) => (
          <li key={limit} className="grid gap-0.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:gap-4">
            <span className="text-ink">{t(limit)}</span>
            <span className="text-muted">{t(handling)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-xs text-muted">{t("{app} works within these. Supabase's Pro plan ($25 a month) raises them and never pauses.", { app: appName })}</p>
    </div>
  );
}
