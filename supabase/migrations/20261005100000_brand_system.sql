-- A product's brand system (studio/src/lib/brand-system.ts): the /brand skill's art direction and rules
-- inside Radar. The look (prompt modifier, photography, packaging), the voice, the avatars ads speak to,
-- the closed list of offers, named colours, uploaded fonts, product facts and positioning. Imported
-- from a brands/<name>/intelligence folder or written on the Brand page; every generator reads it.
-- Same row-level security as the rest of the product row.
alter table public.products add column if not exists brand_system jsonb;
comment on column public.products.brand_system is 'Brand system (lib/brand-system.ts BrandSystem): look, voice, avatars, offers, palette, fonts, products, positioning.';

-- Its font files live in the workspace bucket (<user>/<product>/fonts/), so the bucket takes fonts too.
-- WOFF2 is left out: the composed-ads renderer (Satori) reads TTF, OTF and WOFF only.
update storage.buckets
   set allowed_mime_types = array(select distinct unnest(coalesce(allowed_mime_types, '{}') || array['font/ttf', 'font/otf', 'font/woff']))
 where id = 'workspace';
