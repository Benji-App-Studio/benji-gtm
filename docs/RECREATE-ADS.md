# Make a competitor's winning ad for your own app

> **What this file is for:** turning an ad that works for a competitor into the same kind of ad for your
> app, in one step: a ready-made prompt to paste into ChatGPT or Higgsfield, one image made right here, or
> a full batch in Studio.
>
> **When to use it:** after you've collected competitors' ads on your app's **Research** page, whenever
> you spot one that has run for weeks (a sign it works). A prompt takes one minute; an image takes one
> or two minutes more.

## What it keeps and what it changes

It keeps their **structure**: the format (a static benefit image, a before and after, a review card…),
the layout, the kind of hook, the order of the message and the shape (4:5, 9:16…).

It changes everything that is **theirs** into **yours**: your app's name, what it does, who it's for,
the outcome it promises, your colours (as exact hex codes), your fonts, your tone, your logo and your
screens. Their brand name, logo, people and exact words are never copied, and the claims it may make
come only from your Brand page.

## Before you start (once)

1. Open your app's **Brand** page and fill in at least your **colours** and a **logo** (or app icon).
   ✅ **Checkpoint:** the Brand page shows your colours and logo. Without them the prompt still works,
   with plainer wording, and the sheet tells you what's missing.
2. Optional: on the **Product** page, add a few **app screen** images. They are sent with the prompt so
   the ad shows your real app.

## Steps: a ready-made prompt (free, no key needed)

1. On **Research**, find the ad and click **Make for (your app)** on its card, or open it and click
   **Make this for (your app)** at the bottom.
   ✅ **Checkpoint:** a sheet opens with three numbered parts.
2. Under **1. Ready-made prompt**, pick where you'll use it: **GPT Image / ChatGPT**, **Higgsfield** or
   **General** (Midjourney and similar tools).
3. Click **Copy prompt**.
4. Click **Download reference** (their ad, for tools that take a reference image) and
   **Download my brand kit** (your logo, icon and screenshots in one zip, with your colours and fonts
   in `brand.txt`).
5. In the other tool, add the images and paste the prompt. For Higgsfield, add the images in the order
   the prompt numbers them.
   ✅ **Checkpoint:** the result has your name, colours and logo, and none of theirs.

**A video ad?** Choose **A still image in its style** (one image that looks like a frame of their video;
it is not a video) or **A video prompt** (a shot-by-shot prompt for Higgsfield's Seedance, Sora or Veo).

**Improve with AI** (shows when your OpenAI key is set): OpenAI rewrites the prompt more precisely. The
price is shown first (a cent or two at most). A rewrite that adds a claim, a number, a banned word or
their brand is refused and your prompt stays; **Undo** puts the earlier one back.

## Steps: generate it here (one click)

1. Under **2. Generate here**, pick the provider (only those with a key show), the shape, the
   resolution and the quality.
   ✅ **Checkpoint:** the **Generate** button shows the estimated cost, for example "~1 credit at
   Higgsfield" or "~$0.18 at OpenAI".
2. Click **Generate**.
   ✅ **Checkpoint:** the image appears in the sheet within a minute or two, and in **Studio**, where you
   can approve, edit or download it.

**No image key yet?** The part says so, with the guides: [OpenAI](keys/openai.md) (one key, the one you
may already have for reading ads) or [Higgsfield](keys/higgsfield.md) (its Marketing Studio ad models,
with its own credits). Add either under **Settings > API keys**.

## Steps: a full batch in Studio

1. Under **3. Send to Studio**, click **Send to Studio**.
   ✅ **Checkpoint:** Studio opens with the prompt as the brief and their ad as the reference.
2. In Studio, pick more angles (variants) and sizes, check the cost, and create the batch.

**Check every detail first** opens the detailed Recreate sheet instead: every brand-specific detail of
their ad listed, how close to stay to it, and every option.

## Costs

| Way | Cost |
| --- | --- |
| Ready-made prompt | Free here; you pay the other tool as usual |
| Improve with AI | One short OpenAI request on your key: at most a cent or two, shown before it runs |
| Generate here, Higgsfield | 0.25 to 4.25 credits per image, by quality and resolution (Medium at 2K: 1 credit) |
| Generate here, OpenAI | About 1 to 30 cents per image, by quality and resolution; each image sent with it (their ad, your logo, a screen) adds about 5 cents |
| Send to Studio | What the batch you build there costs, shown before it starts |

## Troubleshooting

**"Your brand has no colours or logo yet".** Add them on the **Brand** page, then open the sheet again.
You can continue without them; the prompt says less about your look.

**"Their image wasn't saved and its link no longer loads".** The ad's image expired before it was
saved. The prompt still describes the layout; there's no reference to download or send. Collect or import
that competitor again to save a fresh copy.

**The provider is busy, out of credits, or refused the prompt.** The sheet says which, in plain words.
Press **Retry** (the price is shown first) or **Try with OpenAI / Higgsfield instead**. A refusal under
content rules usually goes away with fewer claims and no people or brands in the prompt.

**"Storage is full".** Nothing new can be saved: open **Settings > Storage** to free space (see
[TROUBLESHOOTING.md](TROUBLESHOOTING.md#running-out-of-space)).

**"This quality … takes longer than your Supabase plan allows".** On the free Supabase plan, OpenAI's
slowest settings don't fit in one run. Pick a lower quality or resolution.
