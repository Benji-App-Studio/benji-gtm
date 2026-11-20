# Sign-in emails in four languages

Benji GTM speaks English, Traditional Chinese (Taiwan), Japanese and Korean. Supabase sends the
sign-in emails (confirm your address, reset your password, a sign-in link, change your address), and it
has one template per email for the whole project. The templates in this folder hold all four languages
and pick one for each person, from the language saved on their account:

- People who sign up with email and password get the language the sign-up page was showing.
- People who sign in with Google get the app's language when they come back from Google.
- Changing the language in **Settings › Language** changes it for later emails too.
- Anyone else (accounts made before this, or a language the app doesn't know) gets English.

The links use the `token_hash` form, so they work in any browser, not just the one the email was asked
from (as in [DEPLOY-VERCEL.md](../DEPLOY-VERCEL.md), step 4.2). They need **Site URL** to be your
online address (step 3 there).

## Paste them into Supabase

1. Open your project on [supabase.com](https://supabase.com/dashboard), then **Authentication › Emails
   › Templates**.
2. For each email below: choose it at the top, paste the subject into **Subject heading**, open the
   file, copy everything in it and paste it into **Message body** (replace what is there), then click
   **Save changes**.

| Supabase template | File |
| --- | --- |
| Confirm signup | [confirm-signup.html](confirm-signup.html) |
| Reset password | [reset-password.html](reset-password.html) |
| Magic link | [magic-link.html](magic-link.html) |
| Change email address | [change-email.html](change-email.html) |

3. Send yourself one to check: on the login page click **Forgot your password?**. The email arrives in
   the language your account has.

Supabase's built-in email server sends only a few emails an hour, and only to the members of your
Supabase team. For anyone else, add your own email server first (DEPLOY-VERCEL.md, step 4.1).

## Subjects

Paste the line for each template into **Subject heading**. Each picks the language the same way the
message does.

**Confirm signup**

```
{{ $l := printf "%v" (or .Data.locale "en") }}{{ if eq $l "ja" }}メールアドレスを確認してください{{ else if eq $l "ko" }}이메일 주소를 확인하세요{{ else if eq $l "zh-TW" }}請確認你的電子郵件地址{{ else }}Confirm your email address{{ end }}
```

**Reset password**

```
{{ $l := printf "%v" (or .Data.locale "en") }}{{ if eq $l "ja" }}パスワードの再設定{{ else if eq $l "ko" }}비밀번호 재설정{{ else if eq $l "zh-TW" }}重設你的密碼{{ else }}Reset your password{{ end }}
```

**Magic link**

```
{{ $l := printf "%v" (or .Data.locale "en") }}{{ if eq $l "ja" }}ログイン用リンク{{ else if eq $l "ko" }}로그인 링크{{ else if eq $l "zh-TW" }}你的登入連結{{ else }}Your sign-in link{{ end }}
```

**Change email address**

```
{{ $l := printf "%v" (or .Data.locale "en") }}{{ if eq $l "ja" }}メールアドレス変更の確認{{ else if eq $l "ko" }}이메일 주소 변경 확인{{ else if eq $l "zh-TW" }}確認變更電子郵件地址{{ else }}Confirm your new email address{{ end }}
```

If a subject arrives with the braces showing, your Supabase project doesn't fill in templates in
subjects: use a plain subject that works in every language instead, for example
`Benji GTM: Confirm your email · メール確認 · 이메일 확인 · 確認電子郵件`.

## Good to know

- The language lives in each account's user metadata as `locale` (`en`, `zh-TW`, `ja` or `ko`). You
  can see it in **Authentication › Users** (open a user, then **Raw user meta data**).
- The invite email (**Invite user**) is never sent: Settings › Members makes an invite link that you
  pass on yourself.
- To change the wording, edit the language's block between `{{ if … }}` and the next `{{ else … }}`.
  Keep the link exactly as it is.
