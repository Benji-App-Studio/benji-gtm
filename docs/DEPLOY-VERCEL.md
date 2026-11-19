# Putting it online with Vercel (optional)

> **What this file is for:** running Benji GTM on the internet instead of only on your Mac, so
> you can open it from anywhere.
>
> **When to use it:** only after the app already works on your Mac. Do the normal setup first: it
> prepares your Supabase project, and the online copy uses that same project. The setup page itself
> only works on your Mac, never on the online copy.

## What you need

- The app working locally (you finished [SETUP.md](SETUP.md)).
- Your copy of the repository on GitHub (your fork or template copy from the README).
- A free Vercel account: https://vercel.com (signing up with GitHub is easiest).

## Step 1. Import your copy on Vercel

1. On Vercel click **Add New…**, then **Project**.
2. Under "Import Git Repository", find **your** copy (your fork or template copy, with your name in
   its address, not the original) and click **Import**. If it isn't listed, click
   **Adjust GitHub App Permissions** and allow Vercel to see that repository.
3. Next to **Root Directory**, click **Edit**, choose `studio` and click **Continue**.
   Vercel then recognises the app as Next.js by itself.

✅ **Checkpoint:** the page shows Framework Preset "Next.js" and Root Directory `studio`.

## Step 2. Add the two environment variables

1. On the same page, open **Environment Variables** and add these two:

   | Name | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | Your project URL, like `https://abcd1234.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The publishable key (starts with `sb_publishable_`) |

2. Where to find them in Supabase: open https://supabase.com/dashboard and click your project.
   - **Project URL:** under **Integrations > Data API**. The **Connect** button at the top of the
     page also shows it.
   - **Publishable key:** under **Project Settings > API Keys**. It starts with `sb_publishable_`.
   - More detail: [keys/supabase.md](keys/supabase.md).
3. Click **Deploy**.

✅ **Checkpoint:** Vercel shows "Congratulations" and gives you an address like `https://your-app.vercel.app`.

💡 These two values are not secret: they are what every browser that opens the app sees anyway. Your
API keys stay in your Supabase project and are never put on Vercel or in GitHub.

## Step 3. Let your Supabase project accept sign-ins from the new address

1. In Supabase open **Authentication**, then **URL Configuration**.
2. Set **Site URL** to your Vercel address, for example `https://your-app.vercel.app`.
3. Under **Redirect URLs** click **Add URL** and add your Vercel address followed by `/**`, for
   example `https://your-app.vercel.app/**`. Also add `http://localhost:3000/**` so signing in on
   your Mac keeps working.
4. Click **Save**.

✅ **Checkpoint:** open your Vercel address. It shows a login page, because anyone with the address
could reach it. Sign in with the email and password from setup (the ones in the box "Your sign-in
details"; if you changed the password since, use the new one) and see your dashboard.

## Good to know

- The online copy and the copy on your Mac show the same data, because both use your Supabase project.
- **Every change to your copy on GitHub redeploys it.** When you update ([UPDATING.md](UPDATING.md)),
  Sync fork (or `git push` after `npm run update`) is what puts the new version online, about two
  minutes later. The update of your Supabase project (Settings > Updates > Open setup) still happens
  on your Mac.
- The online copy always shows a login page; the copy on your Mac never does. Your email and password
  are the same on both. You can see your email and change the password in **Settings > Account**.
- **Forgot your password?** Open the app on your Mac (it signs you in by itself), go to
  **Settings > Account** and change it there. If that Mac isn't available, start the app from your
  copy of the code on any Mac and follow its setup page: it connects your project again and lets you
  choose a new password with a Supabase access token. No email is needed. The login page of the
  online copy says the same under **Forgot your password?**.
- Nobody else can sign up. Add people yourself in **Settings > Members**. They sign in on the online
  copy (the copy on your Mac opens only on your Mac).

## Troubleshooting

- **The online copy shows the setup page, or "Open this page on the computer that runs the app":**
  one of the two environment variables is missing or misspelled. Fix it on Vercel under
  **Settings > Environment Variables**, then open **Deployments**, click the three dots on the newest
  one and choose **Redeploy**.
- **The build fails with "No Next.js version detected":** the Root Directory is not `studio`. Change
  it under **Settings > Build and Deployment** (Root Directory), then redeploy.
- **Signing in sends you back to `localhost` or says the address is not allowed:** step 3 is missing
  your Vercel address. Add it and try again.
- **Your repository isn't in Vercel's list:** see step 1.2 (Adjust GitHub App Permissions).
