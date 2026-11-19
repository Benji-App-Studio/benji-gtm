// Settings → Updates: how a newer version reaches this workspace. The code comes from the person's own
// copy on GitHub (a fork, or a copy made with "Use this template"); the database changes are applied by
// the owner on the setup page (app/setup/updates.tsx). This page says which version is running, explains
// the steps in the words that page uses, and links there.
import { APP_NAME } from "@/lib/brand-config";
import pkg from "../../../package.json";
import { ButtonLink, SettingsGroup, SettingsRow } from "../ui";
import { SettingsPage } from "./settings-ui";

const STEPS: { title: string; body: string }[] = [
  { title: "Get the new code", body: "On GitHub, click Sync fork on your copy (for a template copy, run npm run update in the app's folder), then git pull and start the app again. A copy on Vercel redeploys when your GitHub copy changes." },
  { title: "Open setup and paste a new access token", body: "Setup already knows which Supabase project this workspace uses, so there is nothing to pick. Create a new access token in Supabase, paste it and press Check for updates." },
  { title: "Press Apply the update", body: "Only the database changes that are new are applied, and the backend functions are installed again. It is safe to repeat." },
];

export function UpdatesSettings() {
  return (
    <SettingsPage page="updates">
      <SettingsGroup title="This copy">
        <SettingsRow label="Version" description={`The version of ${APP_NAME} that is running now.`}><span className="font-mono text-xs text-label">{pkg.version}</span></SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="How to update">
        {STEPS.map((step, i) => (
          <div key={step.title} className="flex gap-3 px-4 py-3.5">
            <span aria-hidden className="mt-px grid size-5 shrink-0 place-items-center rounded-full bg-control text-xs font-medium text-label tabular-nums">{i + 1}</span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">{step.title}</p>
              <p className="mt-0.5 text-caption text-muted">{step.body}</p>
            </div>
          </div>
        ))}
        <SettingsRow label="Setup" description="Only the owner can run an update. The access token is used while the update runs and is not stored; you can delete it in Supabase afterwards.">
          <ButtonLink href="/setup" size="sm">Open setup</ButtonLink>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="What an update keeps">
        <SettingsRow label="Your data" description="Apps, analyses, creatives and files live in your Supabase project, not in the app's folder." />
        <SettingsRow label="Your API keys" description="Keys are stored in the project, not in the app's folder, so updating the code doesn't touch them." />
        <SettingsRow label="The connection to your project" description="On your own machine it is saved outside the app's folder, so updating the code keeps it. On a hosted copy it comes from the environment variables you set." />
      </SettingsGroup>
    </SettingsPage>
  );
}
