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

💡 **Using your own domain?** Also add `PUBLIC_ORIGIN` with the address people open, for example
`https://gtm.example.com`. On a plain `*.vercel.app` address you can skip it: Vercel tells the app its
production address by itself. The app uses this address for its public page (search engines and link
previews) and for the links in sign-in emails.

## Step 3. Let your Supabase project accept sign-ins from the new address

1. In Supabase open **Authentication**, then **URL Configuration**.
2. Set **Site URL** to your online address, for example `https://your-app.vercel.app`.
3. Under **Redirect URLs** click **Add URL** and add your online address followed by
   `/auth/confirm**`, for example `https://your-app.vercel.app/auth/confirm**`. Every sign-in link
   comes back there: password reset, email confirmation and Google. Keep `http://localhost:3000/**`
   so signing in on your Mac keeps working.
4. Click **Save**.

💡 Setup does steps 2 and 3 for you when it knows the online address: run it with
`npm run provision -- --public-origin https://your-app.vercel.app …`, or set `PUBLIC_ORIGIN` before
you run setup. Without it, setup allows only the address on your Mac.

✅ **Checkpoint:** open your online address. It shows the public page with **Log in** and **Get
started** at the top (your Mac opens the app directly instead). Click **Log in** and sign in with the
email and password from setup (the ones in the box "Your sign-in details"; if you changed the
password since, use the new one), and see your dashboard.

## Step 4. Password reset by email and Google sign-in (optional)

The online copy's **Forgot your password?** sends a reset link by email. Supabase's built-in email
only reaches the members of your Supabase team and sends a few emails an hour, so for anyone else:

1. **Email server.** In Supabase open **Authentication > Emails > SMTP Settings** and add your email
   provider's SMTP details (Resend, Postmark, Amazon SES and others give them to you).
2. **Links that work in any browser.** By default a reset or confirmation link works only in the
   browser where it was asked for, and asking again makes the earlier email's link stop working. To
   make links work anywhere, open **Authentication > Emails > Templates** and change the link:
   - **Reset password:** set the link to
     `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/update-password`
   - **Confirm signup:** set the link to
     `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/onboarding`

   For example: `<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/update-password">Choose a new password</a>`.
   This needs **Site URL** from step 3.

   💡 Ready-made templates with these links, in English, Traditional Chinese, Japanese and Korean
   (each person gets their own language), are in [email-templates](email-templates/README.md): paste
   them instead of editing the links by hand.
3. **Google** (only shows when people may sign up by themselves, `ALLOW_SIGNUP=1`). In Google Cloud
   create an OAuth client (type Web application) with the redirect URI
   `https://<your-project-ref>.supabase.co/auth/v1/callback`. Then in Supabase open
   **Authentication > Sign In / Providers > Google**, turn it on and paste the client ID and secret.
   The **Continue with Google** button appears on the online copy within about five minutes.

## Good to know

- The online copy and the copy on your Mac show the same data, because both use your Supabase project.
- **Every change to your copy on GitHub redeploys it.** When you update ([UPDATING.md](UPDATING.md)),
  Sync fork (or `git push` after `npm run update`) is what puts the new version online, about two
  minutes later. The update of your Supabase project (Settings > Updates > Open setup) still happens
  on your Mac.
- The online copy always shows a login page; the copy on your Mac never does. Your email and password
  are the same on both. You can see your email and change the password in **Settings > Account**.
- **Forgot your password?** On the online copy, **Forgot your password?** sends a reset link by email
  (step 4). Without email: open the app on your Mac (it signs you in by itself), go to
  **Settings > Account** and change it there. If that Mac isn't available, start the app from your
  copy of the code on any Mac and follow its setup page: it connects your project again and lets you
  choose a new password with a Supabase access token.
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
  your online address. Add it and try again.
- **A reset or confirmation link says it expired, or was opened in a different browser:** ask for a
  new one and open it in the same browser, or change the email templates as in step 4.2.
- **"We couldn't send the email just now":** the project has no email server yet (step 4.1), or it
  hit Supabase's hourly email limit.
- **Your repository isn't in Vercel's list:** see step 1.2 (Adjust GitHub App Permissions).
