# Benji GTM

> **What this is:** a dashboard you run on your own Mac. It tracks your competitors, shows which of
> their ads and posts are working, and helps you turn that into your own creatives. You can add as
> many apps or brands as you like.
>
> **What you need:** a Mac with an internet connection, a free GitHub account, about 20 minutes, a
> free Supabase account and an OpenAI API key. Your data and your keys stay in your own Supabase project.

## Make your own copy

You don't download anything from this page. You make your own copy of this repository on GitHub
(https://github.com/Benji-App-Studio/benji-gtm), then put that copy on your Mac. There are two ways to make the copy. Already have
yours? Skip to [Clone it](#clone-it-put-your-copy-on-your-mac).

### Which one should I pick?

**Fork** makes a public copy that stays linked to the original, so updating later is one button
(**Sync fork**). **Use this template** makes a private copy that nobody else can see; updating it is
one command (`npm run update`) instead of a button. If you want your copy, and any changes you make
to it, kept private, pick the template; otherwise pick Fork.

**Fork:**

1. Sign in to GitHub and open https://github.com/Benji-App-Studio/benji-gtm.
2. At the top right, click **Fork**, then **Create fork**.

✅ **Checkpoint:** GitHub shows your copy, at an address with your name in it, and under its name
the line "forked from …".

**Use this template:**

1. Sign in to GitHub and open https://github.com/Benji-App-Studio/benji-gtm.
2. At the top right, click **Use this template**, then **Create a new repository**.
3. Type a name (for example `benji-gtm`), choose **Private**, and click **Create repository**.

✅ **Checkpoint:** GitHub shows your copy, at an address with your name in it, marked **Private**.

💡 **Is a public fork safe?** Yes. A fork of a public repository is public on GitHub, but no key,
password or piece of your data ever goes into the repository. Your API keys are stored encrypted in
your own Supabase project, and the link to your project is saved in your home folder on your Mac, not
in the repository.

## Clone it (put your copy on your Mac)

Pick one of the three ways. Each makes a folder named after your copy, for example `benji-gtm`.

- **GitHub Desktop** (no typing): install it from https://desktop.github.com and sign in. On your
  copy's GitHub page, click the green **Code** button, then **Open with GitHub Desktop**. Choose
  where to keep it (for example your Documents folder) and click **Clone**.
- **Terminal:** on your copy's GitHub page, click the green **Code** button and copy the HTTPS
  address. Open the **Terminal** app (press Command-Space, type `Terminal`, press Return) and go to
  your Documents folder:

  ```bash
  cd ~/Documents
  ```

  Then clone your copy. Paste your copy's address in place of the example:

  ```bash
  git clone https://github.com/YOUR-NAME/benji-gtm.git
  ```

- **Claude Code or Codex:** ask it "Clone my GitHub repository YOUR-NAME/benji-gtm into my
  Documents folder", with your own name and repository.

✅ **Checkpoint:** a folder `benji-gtm` in Documents, with `start.command`, `studio` and `docs` inside.

💡 **Beginner tip:** if Terminal says "git: command not found" or a window asks to install the
"command line developer tools", accept it, wait for it to finish, then clone again. Git comes with
those tools.

## Start it

1. Open the **Terminal** app.
2. Go to the folder you cloned (change the path if you kept it somewhere else):

   ```bash
   cd ~/Documents/benji-gtm
   ```

3. Start the app (`npm start` does the same):

   ```bash
   bash start.command
   ```

4. Wait. The first start installs what the app needs and prepares it. It shows two steps with a row
   of dots and takes a few minutes.
5. Your browser opens the setup page. Follow its six steps from top to bottom.

✅ **Checkpoint:** the browser shows a page headed "Set up Benji GTM" with six numbered steps.

💡 **Beginner tip:** not sure of the path? Type `cd` and a space in Terminal, drag the folder from
Finder onto the Terminal window, then press Return.

The full walk-through of every step is in [docs/SETUP.md](docs/SETUP.md).

## What it costs

| Service | What it is for | Cost |
| --- | --- | --- |
| GitHub | Holds your copy of the code | Free. |
| [Supabase](docs/keys/supabase.md) | Your database, files and background jobs | Free plan works. A paid plan lifts the limits on video size and storage. |
| [OpenAI](docs/keys/openai.md) | Reads ads and posts, writes the analysis, checks creatives | Pay for what you use. A typical analysis costs cents. |
| [Apify](docs/keys/apify.md) (optional) | Collects competitors' posts and ads automatically | Free monthly credit, then pay for what you use. |
| [Higgsfield](docs/keys/higgsfield.md) (optional) | Generates images and videos | Pay for what you use. |
| [Meta](docs/keys/meta-ads.md) ([Ad Library](docs/keys/meta-ad-library.md)), [RevenueCat](docs/keys/revenuecat.md), [Superwall](docs/keys/superwall.md), [Mixpanel](docs/keys/mixpanel.md), [AppStack](docs/keys/appstack.md) (optional) | Send ads to Meta, measure revenue, paywalls, funnel and unit economics | Your existing accounts. |
| Vercel (optional) | Puts the app online | Free plan works for personal use. |

You only need Supabase and OpenAI to begin. Everything else can be added later in **Settings > API keys**.
Each key has a step-by-step guide, including
[Typesafe](docs/keys/typesafe.md), [Google Drive](docs/keys/google-drive.md) and [TikTok](docs/keys/tiktok.md).

## Every day

- **Start:** in Terminal, `cd ~/Documents/benji-gtm`, then `bash start.command`. It takes a few
  seconds and opens your dashboard, already signed in: there is no login page on your own Mac. Keep
  the Terminal window open while you use the app.
- **Stop:** click the Terminal window and press Control-C.
- **Update:** when a new version is out, follow [docs/UPDATING.md](docs/UPDATING.md).
- **Settings:** in the app, click the name at the top of the sidebar, then **Settings**.
- **Your account:** **Settings > Account** shows your email and lets you change your password. You
  need the password only for a copy you put online ([docs/DEPLOY-VERCEL.md](docs/DEPLOY-VERCEL.md)),
  which shows a login page.
- **Your data** is in your Supabase project, not in this folder. Deleting the folder does not delete your data.

## More guides

- [Setup, step by step](docs/SETUP.md)
- [Updating to a new version](docs/UPDATING.md)
- [Putting it online with Vercel](docs/DEPLOY-VERCEL.md) (optional)
- [The Chrome extension that collects competitors' ads](docs/CHROME-EXTENSION.md) (free, optional)
- [Collecting competitors' ads: the three ways, what each covers and costs](docs/COLLECTING-ADS.md)
- [Make a competitor's winning ad for your own app: a ready-made prompt, one image, or a batch](docs/RECREATE-ADS.md)
- [Market: competitors' apps, top charts and review gaps](docs/MARKET.md) (free; AI parts use your OpenAI key)
- [The desktop runner for creator-style videos](docs/DESKTOP-RUNNER.md) (optional)
- [Languages: what follows your language, and Chinese, Japanese and Korean on ads](docs/LANGUAGES.md)
- [If something goes wrong](docs/TROUBLESHOOTING.md)
- [For coding agents (Claude Code, Codex)](AGENTS.md)

## What you may do

In plain words. The [LICENSE](LICENSE) file is what counts, not this summary.

- **You may** use Benji GTM for your own products and your own business, change the code, and
  deploy it for yourself and your team.
- **You may not** sell it or resell it, or offer it to others as a paid hosted service or paid
  support whose value comes from Benji GTM itself.

The licence is MIT with the Commons Clause condition added: the code is source-available, not open source.
