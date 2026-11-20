# Google Drive service account

> **What this does in the app:** Benji GTM copies your approved creatives into a Google Drive folder,
> sorted into subfolders. Without it, creatives stay in Benji GTM and you download them yourself.
>
> **Required or optional:** Optional (Advanced).
>
> **What it costs:** Free on Google Cloud. You need a **Google Workspace** account (paid) for the
> shared drive; see below.

## Read this first: you need a shared drive (not a free Gmail Drive)

A service account is a robot Google account. Google gives robot accounts **no storage of their own**,
so they can't save files into a normal "My Drive" folder, even one you share with them. Uploads fail
with a "storage quota" error.

The fix is a **shared drive**: files in a shared drive belong to the organization, so they use the
organization's storage. Shared drives come with **Google Workspace** (a paid Google account for a
business). A free personal Gmail account can't create one.

- You have Google Workspace: follow this guide.
- You only have free Gmail: skip this key and download creatives from Benji GTM, or ask someone with
  Google Workspace to add you and the service account to a shared drive.

## Before you start

You need:

- A Google Workspace account that can create or manage a **shared drive**.
- About 15 minutes.

## Steps

### Part 1: Make a Google Cloud project

1. Open https://console.cloud.google.com and sign in with your Google Workspace account.
2. Click the project picker in the top bar (next to the Google Cloud logo), then **New project**.
3. Name it (for example `Benji GTM drive`) and click **Create**.
4. When it's ready, pick it in the project picker.

✅ **Checkpoint:** the top bar shows your new project's name.

### Part 2: Turn on the Google Drive API

5. Open https://console.cloud.google.com/apis/library/drive.googleapis.com
6. Check that the top bar shows your project, then click **Enable**.

✅ **Checkpoint:** the page now shows **Manage** (or "API enabled") instead of **Enable**.

### Part 3: Create the service account

7. Open https://console.cloud.google.com/iam-admin/serviceaccounts
8. Click **+ Create service account**.
9. Type a name, for example `Benji GTM drive export`. The ID fills in by itself.
10. Click **Done**. No roles are needed.

✅ **Checkpoint:** the list shows the service account with an email like
`name@your-project.iam.gserviceaccount.com`. Copy that email: you need it in Part 6.

### Part 4: Create its key file

11. Click the service account's email.
12. Open the **Keys** tab.
13. Click **Add key**, then **Create new key**.
14. Choose **JSON** and click **Create**. A `.json` file downloads to your Mac.

✅ **Checkpoint:** a file ending in `.json` is in your Downloads folder. Google won't let you download
it again; if you lose it, just create a new key.

If you see "Service account key creation is disabled" instead, read "If it doesn't work" below.

### Part 5: Paste the key file into Benji GTM

15. In Finder, right-click the downloaded `.json` file and choose **Open With > TextEdit**.
16. Press **Command-A** to select everything, then **Command-C** to copy.
17. In Benji GTM, open **Settings > Your keys**.
18. Find the **Google Drive service account** row and click **Add**.
19. Paste everything into the box (it's several lines long) and click **Save and check**.

✅ **Checkpoint:** the row says **Saved. The key was checked and works.** The check also names the
service account's email.

20. Close TextEdit and move the `.json` file to the Trash, then empty the Trash. Benji GTM has
    its own copy.

### Part 6: Share a shared drive folder with the service account

21. Open https://drive.google.com and click **Shared drives** in the left menu.
22. Open the shared drive you want to use (or click **+ New** to create one).
23. Click the shared drive's name at the top, then **Manage members**.
24. Paste the service account's email from step 10, choose the role **Content manager**, untick
    **Notify people** and click **Share** (or **Send**).
25. Open (or create) the folder for your creatives inside that shared drive.
26. Copy the address from the browser's address bar. It looks like
    `https://drive.google.com/drive/folders/1AbCdEf…`.

### Part 7: Add the folder to your app

27. In Benji GTM, open **Settings**. Under **Your apps** in the left menu, click your app.
28. In **Connections**, find the **Storage** card and paste the folder address into **Google Drive
    folder ID**. Benji GTM keeps only the ID part.
29. Click **Save**.

✅ **Checkpoint:** export an approved creative to Drive. It appears in the folder, inside a subfolder
Benji GTM creates.

## What it looks like

The contents of a `.json` file: several lines that start with `{` and `"type": "service_account"`,
and include `"client_email"` and a `"private_key"` that begins `-----BEGIN PRIVATE KEY-----`. About
2,300 characters.

## If it doesn't work

| What you see | What to do |
| --- | --- |
| "Service account key creation is disabled" when creating the key | Your organization blocks key files (Google turns this on by default for organizations created since May 2024, with the policy `iam.disableServiceAccountKeyCreation`). Ask your Google Workspace admin to exempt this project from that policy, then try step 13 again. |
| "This isn't a Google service account key" | Only part of the file was pasted, or a different file. Open the `.json` file again, select **everything** and paste it. |
| "Google rejected this service account key" | The key was deleted, or the project was shut down. Create a new key (Part 4) and use **Replace**. |
| An export fails with "storage quota" | The folder is in someone's My Drive, not in a shared drive. Move it to a shared drive (Part 6). |
| An export fails with "File not found" for the folder | The service account isn't a member of the shared drive, or the folder ID is wrong. Redo steps 23–28. If it still fails, tell whoever maintains your copy of Benji GTM: the app uses Google's narrowest Drive permission (`drive.file`), which may not see folders the app didn't create. |
| The Drive API isn't enabled | Redo Part 2 in the same project the service account is in. |

## Keep it safe

- The `.json` file is a password for the robot account. Never paste it into a chat with an AI helper,
  an email or a screenshot. Paste it only into Benji GTM's Settings.
- To cancel it: https://console.cloud.google.com/iam-admin/serviceaccounts > click the service
  account > **Keys** tab > delete the key (trash icon). Remove the service account from the shared
  drive's members too.

Checked against: https://docs.cloud.google.com/iam/docs/service-accounts-create ·
https://docs.cloud.google.com/iam/docs/keys-create-delete ·
https://developers.google.com/workspace/drive/api/guides/about-shareddrives ·
https://developers.google.com/workspace/drive/api/guides/handle-errors ·
https://developers.google.com/workspace/drive/api/guides/api-specific-auth (19 November 2026).
