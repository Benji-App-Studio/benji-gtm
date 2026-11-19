-- Playground templates imported from another of the person's products. A ready template can be copied
-- into another product's Library: a starter is added as usual; a custom one becomes a new row there that
-- points at the same brand-neutral files (no new image, no credits). This column marks the copy with the
-- product it came from, so the Library can say "From <product>". If that product is deleted, the mark
-- goes (the copy and its files stay). API: /api/playground/[productId]/templates (action "import").

alter table public.product_templates
  add column imported_from_product_id uuid references public.products (id) on delete set null;

-- The foreign key's lookup when a product is deleted.
create index product_templates_imported_from_idx on public.product_templates (imported_from_product_id) where imported_from_product_id is not null;

comment on column public.product_templates.imported_from_product_id is 'Set on a template imported from another of the person''s products: that product. The copy shares the original''s files (source_path, template_path), so the API deletes a file only when no template row still uses it.';
