# AppStack API key

> **What this does in the app:** Measure reads the installs, trials, purchases and revenue that AppStack
> matched to each of your ads. Without it, Measure can't say which ad brought which install.
>
> **Required or optional:** Optional. Only useful if your app already uses AppStack.
>
> **What it costs:** The key is free. AppStack's own plan is whatever you agreed with them.

## What AppStack is

AppStack is an attribution tool for mobile apps: a small piece of code in your app (the SDK) tells it
about each install, trial and purchase, and AppStack works out which ad on Meta, TikTok, Google or
Apple brought that person. Benji GTM reads those results through AppStack's Export API.

AppStack is **invite-only**. If you don't have an account yet, request access at
https://www.appstack.tech. Its dashboard is at **https://console.appstack.tech** (the address
`app.appstack.tech` doesn't exist).

## Before you start

You need:

- An AppStack account with your app added, and the AppStack SDK already in your app.
- Your app's **bundle ID** (iOS) or **package name** (Android), for example `com.yourcompany.yourapp`.
- About 5 minutes.

## Steps

### Part 1: Copy your app's API key

1. Open https://console.appstack.tech/auth/sign-in and sign in.
2. Make sure the right app is selected.
3. In the side menu, open **SDK**.
4. Choose the **Production** environment.
5. Copy the **API key**.

✅ **Checkpoint:** you have one key copied, for the Production environment.

💡 AppStack's Export API docs say the key is in "your app settings" in the dashboard. If your app's
settings show a key meant for the API, use that one; otherwise use the Production SDK key from step 5.

💡 Each key belongs to **one app on one platform**. An app on both iOS and Android has two keys; use the
one for the platform you advertise.

### Part 2: Paste the key into Benji GTM

6. In Benji GTM, open **Settings > Your keys**.
7. Find the **AppStack** row and click **Add**.
8. Paste the key and click **Save and check**.

✅ **Checkpoint:** the row says **Saved. The key was checked and works.**

### Part 3: Add the app ID to your app

The "App ID" Benji GTM asks for is your app's **bundle ID** (iOS) or **package name** (Android).
AppStack uses it to name the app in its data.

9. Find your bundle ID. For an iOS app: App Store Connect (https://appstoreconnect.apple.com) >
   **Apps** > your app > **App Information** > **Bundle ID**. It looks like `com.yourcompany.yourapp`.
10. In Benji GTM, open **Settings**. Under **Your apps** in the left menu, click your app.
11. In **Connections**, find the **AppStack** card, paste the bundle ID into **App ID** and click
    **Save**.
12. Click **Verify**.

✅ **Checkpoint:** the card says *AppStack's export for com.yourcompany.yourapp is readable.*

## What it looks like

A long string of letters and numbers. AppStack doesn't publish a fixed format, so there's no prefix to
check.

## If it doesn't work

| What you see | What to do |
| --- | --- |
| "AppStack rejected this key" | The key was copied badly, revoked, or is for another app. Copy it again from the right app (Part 1) and use **Replace**. |
| The check works but Measure shows no installs | You may have copied the **Development** key. Development events aren't attributed. Use the **Production** key. |
| Only iOS (or only Android) installs show | Each platform has its own key. Benji GTM reads one key per app. |
| You can't sign in to console.appstack.tech | AppStack is invite-only. Request access at https://www.appstack.tech or write to support@appstack.tech. |

## Keep it safe

- Never paste the key into a chat with an AI helper, an email or a screenshot. Paste it only into
  Benji GTM's Settings.
- To cancel a key, ask AppStack (support@appstack.tech) or use the dashboard if it offers a way to
  rotate keys. Their docs don't describe one.

Checked against: https://docs.appstack.tech/api/export · https://docs.appstack.tech/introduction ·
https://docs.appstack.tech/SDKs/swift · https://docs.appstack.tech/tooling/cli ·
https://www.appstack.tech (sign-in link) (19 November 2026). AppStack's docs are short: they don't
show the dashboard menus for the API key beyond "app settings" and the SDK section, and they don't
say whether the Export API key and the SDK key are the same key.
