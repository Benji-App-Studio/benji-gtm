-- Research → Recreate: an AI read of a competitor's ad (the `research` function's `scan` route, OpenAI
-- with the ad's image). It flags what is brand-specific (logos, words on the image, phone numbers,
-- faces…), reads the on-image text and the style, and suggests copy in the same style for our product.
-- One scan per click; the studio shows the stored one until the user scans again.
-- { on_image_text: [{ text, role }], flags: [{ kind, text, where, why, suggestion }],
--   style: { layout, typography, colours, text_density, vibe }, copy_suggestions: [{ headline, primary_text, on_image_text[], note }],
--   video_note, model, image_source }
alter table public.paid_ads add column if not exists scan jsonb;
alter table public.paid_ads add column if not exists scanned_at timestamptz;
