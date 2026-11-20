// What setup says while it works (lib/server/provision/*.ts streams one English sentence per step, and
// its failures arrive as English sentences too), in the page's language. Provisioning is plain
// TypeScript that scripts/provision.mjs and its tests also run, so its sentences stay English there;
// this file lists every sentence the setup page can show, as templates, for the dictionaries, and
// translates a message where it is shown:
//   provisionText(step.message, useT())
// The terminal-only adoption run (provision/adopt.ts) keeps its English output.
import { m } from "../../lib/i18n/translate";
import { templateTranslator } from "../../lib/i18n/template-match";

export const PROVISION_SENTENCES: readonly string[] = [
  // Values said inside other sentences.
  m("free"), m("paid"),
  // run.ts
  m("Something unexpected went wrong. Press Retry."),
  m("Paste your Supabase access token first."),
  m("Pick a project from the list first."),
  m("Looking at the project."),
  m("This access token can't see that project. Use a token from the Supabase account that owns it."),
  m("Reading the project's keys."),
  m("Got the project's keys. The secret one stays in memory and is never saved."),
  m("No account details were given, so no account was created."),
  m("The connection wasn't saved on this computer."),
  m("Saving the connection on this computer."),
  m("Saved. The app now uses your project."),
  // migrations.ts
  m("The supabase/migrations folder is missing from this download. Download the app again and keep the folder as it is."),
  m("This project already has data. Create a new empty project in Supabase and pick that one instead."),
  m("Supabase didn't run the test step safely, so setup stopped before changing anything. Use the terminal setup in the guide instead."),
  m("Checking which database changes are needed."),
  m("This project was set up by a newer version of the app. Download the latest version to stay in step."),
  m("The database is already up to date."),
  m("Applying database change {n} of {total}."),
  m("Applied {n} database change."),
  m("Applied {n} database changes."),
  m("Saving where this project's backend functions live."),
  m("The scheduled jobs now call this project's own functions."),
  m("{file} was changed after it was applied to your project. Changes to a migration that has already run are never applied, so your database and this copy of the app no longer match. Put that file back as it was (git checkout -- supabase/migrations, or Sync fork again), and make any change as a new migration with a later date in its name. Then press Retry."),
  m("{n} database files were changed after they were applied to your project ({files}). Changes to a migration that has already run are never applied, so your database and this copy of the app no longer match. Put those files back as they were (git checkout -- supabase/migrations, or Sync fork again), and make any change as a new migration with a later date in its name. Then press Retry."),
  // functions.ts
  m("The \"{slug}\" backend function is missing from this download. Download the app again and keep the folder as it is."),
  m("The \"{slug}\" backend function uses a file outside the functions folder, so it can't be installed."),
  m("Installing backend function {n} of {total}."),
  m("Supabase couldn't build the \"{slug}\" backend function. Press Retry; if it fails again, send us the technical detail below."),
  m("Installed {n} backend functions."),
  // install.ts
  m("Your {plan} plan's limits weren't applied: the ones in Settings > Limits were changed by hand, so they were kept."),
  m("Limits now match your {plan} plan: {seconds} s per function run, {mb} MB per file, {gb} GB of storage."),
  m("Couldn't read this project's API keys. Open the project in Supabase, wait until it has finished starting, then press Retry."),
  m("This project already has its owner ({email}). Sign in as the owner instead."),
  m("That doesn't look like an email address. Check it for typos."),
  m("Use a password with at least 8 characters."),
  m("Creating your account."),
  m("Couldn't create your account. Press Retry."),
  m("Closing sign-up so only you can get in."),
  m("Your account is ready. Sign-up is closed to everyone else."),
  m("This email already had an account in the project, so its password was kept. Sign-up is closed to everyone else."),
  m("Making a place for the app's own images."),
  m("Copying Style Library image {n} of {total}."),
  m("Kept the project's upload limit at {mb} MB."),
  m("Copied {n} Style Library images. One file can be up to {mb} MB."),
  m("The scheduled jobs start once your account exists."),
  m("The scheduled jobs are on."),
  // management-api.ts
  m("Supabase didn't accept the access token. Create a new token and paste it again."),
  m("This access token isn't allowed to do that. Create it again with the Full access preset (a Read-only token doesn't work), from the Supabase account that owns the project."),
  m("Your Supabase plan has reached a limit. Open your Supabase dashboard to see which one."),
  m("Supabase couldn't find that project. Check that you picked the right one."),
  m("Supabase asked us to slow down. Wait one minute, then press Retry."),
  m("Supabase had a problem on its side. Wait a minute, then press Retry."),
  m("Supabase refused a step. Press Retry. If it fails again, open the technical detail below."),
  m("Couldn't reach Supabase. Check your internet connection, then press Retry."),
  m("That doesn't look like a Supabase project. Pick the project from the list again."),
  m("Supabase created the account but didn't say which one. Press Retry."),
  m("Supabase didn't accept that password. Use at least 8 characters, with letters and numbers."),
  m("Supabase didn't accept that email address. Check it for typos."),
  m("That account doesn't look right. Press Retry."),
  // account.ts, reset.ts, request-access.ts, guard.ts, node-files.ts
  m("Your password was set, but signing in with it didn't work yet. Nothing was saved on this computer, so press the button again to retry."),
  m("Something unexpected went wrong. Try again."),
  m("Setup stopped. Try again."),
  m("This project doesn't have an owner yet. Create your account to finish setup."),
  m("This Supabase project isn't set up for the app yet. Open the setup page and run setup from the start."),
  m("The owner's account is no longer in your Supabase project. Type your email below to create it again, with the password you chose."),
  m("This access token can't see your project. Use a token from the Supabase account that owns it."),
  m("That doesn't look like a Supabase access token. Copy it again, with no spaces."),
  m("This install isn't connected to a hosted Supabase project, so it can't be updated from here."),
  m("Setup can only be done on the computer the app is running on. Start the app with start.command and open it there, at its localhost address."),
  m("Sign in as the owner to continue."),
  m("Only the owner of this install can do this."),
  m("Only staff can do this."),
  m("The folder named in INSTALL_REPO_ROOT has no supabase/migrations folder inside it. Point it at the folder you downloaded."),
  m("Couldn't find the supabase/migrations folder. Keep the downloaded folder in one piece and start the app from inside it."),
  m("Setup tried to read a file outside the app's folder and stopped."),
];

/** A setup message (a step's progress or a failure) in the page's language; unknown text stays as it came. */
export const provisionText = templateTranslator(PROVISION_SENTENCES);
