-- Fix: creatives_set_file (20261005300000) declared a variable named `kind`, the same name as the
-- creatives.kind column, so its `update ... set mime = kind` failed with "column reference "kind" is
-- ambiguous": the Studio couldn't place a logo or save a composed ad. The variable is now file_mime;
-- nothing else changes (grants are kept by create or replace).
create or replace function public.creatives_set_file(p_id uuid, p_patch jsonb) returns public.creatives
language plpgsql security definer set search_path = '' as $$
declare
  c public.creatives;
  path text;
  link text;
  file_mime text;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or octet_length(p_patch::text) > 65536 then
    raise exception 'Send the changes as one JSON object (at most 64 KB).' using errcode = '22023';
  end if;
  select * into c from public.creatives where id = p_id and user_id = (select auth.uid()) for update;
  if not found then
    raise exception 'This creative doesn''t exist.' using errcode = 'P0002';
  end if;
  if c.kind <> 'image' then
    raise exception 'Only image creatives get a composed text or a placed logo.' using errcode = '22023';
  end if;

  path := coalesce(p_patch->>'storage_path', c.storage_path);
  if path not like c.product_id::text || '/%' or path like '%..%' then
    raise exception 'The file must be in this product''s folder of the creatives bucket.' using errcode = '22023';
  end if;
  link := coalesce(p_patch->>'url', c.url);
  if right(link, length('/storage/v1/object/public/creatives/' || path)) <> '/storage/v1/object/public/creatives/' || path then
    raise exception 'The url must be the public address of the file.' using errcode = '22023';
  end if;
  file_mime := coalesce(p_patch->>'mime', c.mime);
  if file_mime not in ('image/png', 'image/jpeg', 'image/webp') then
    raise exception 'The file must be a PNG, JPEG or WebP image.' using errcode = '22023';
  end if;
  if p_patch ? 'copy' and jsonb_typeof(p_patch->'copy') <> 'object' then
    raise exception 'copy must be a JSON object.' using errcode = '22023';
  end if;

  update public.creatives set
    storage_path = path,
    url = link,
    mime = file_mime,
    size_bytes = case when p_patch ? 'size_bytes' then (p_patch->>'size_bytes')::bigint else size_bytes end,
    width = case when p_patch ? 'width' then (p_patch->>'width')::integer else width end,
    height = case when p_patch ? 'height' then (p_patch->>'height')::integer else height end,
    copy = case when p_patch ? 'copy' then p_patch->'copy' else copy end,
    headline = case when p_patch ? 'headline' then left(p_patch->>'headline', 255) else headline end,
    primary_text = case when p_patch ? 'primary_text' then left(p_patch->>'primary_text', 2200) else primary_text end,
    cta = case when p_patch ? 'cta' then left(p_patch->>'cta', 40) else cta end,
    drive_file_id = case when path is distinct from c.storage_path then null else drive_file_id end
  where id = p_id
  returning * into c;
  return c;
end;
$$;
