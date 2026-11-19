-- Composed ads (studio/src/lib/server/compose.tsx) keep an editable SVG and a layers.json next to each
-- composed PNG in the creatives bucket, so the bucket takes those two types too.
update storage.buckets
   set allowed_mime_types = array(select distinct unnest(coalesce(allowed_mime_types, '{}') || array['image/svg+xml', 'application/json']))
 where id = 'creatives';
