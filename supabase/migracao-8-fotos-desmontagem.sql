-- Migração 8: várias fotos por produto, venda direta e desmontagem de produtos montados.
-- Rode UMA vez no SQL Editor do Supabase (depois da migração 7). Pode repetir sem problema.
-- Rode ANTES de publicar o site novo.

-- ---------- várias fotos por produto (a primeira é a principal) ----------
alter table public.products add column if not exists photos jsonb not null default '[]'::jsonb;
update public.products set photos = jsonb_build_array(photo_url)
 where photo_url is not null and photos = '[]'::jsonb;

create or replace function public.set_photo(p_kind text, p_id uuid, p_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_active();
  if p_url is not null and p_url !~ '^https://' then
    raise exception 'Endereço de foto inválido.';
  end if;
  if p_kind = 'part' then
    update public.parts set photo_url = p_url where id = p_id;
  elsif p_kind = 'product' then
    update public.products
       set photo_url = p_url,
           photos = case when p_url is null then '[]'::jsonb else jsonb_build_array(p_url) end
     where id = p_id;
  else
    raise exception 'Tipo inválido.';
  end if;
  if not found then
    raise exception 'Item não encontrado.';
  end if;
end;
$$;

-- Acrescenta uma foto ao produto (no máximo 6).
create or replace function public.add_product_photo(p_id uuid, p_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_photos jsonb;
begin
  perform public._require_active();
  if p_url is null or p_url !~ '^https://' then
    raise exception 'Endereço de foto inválido.';
  end if;
  select photos into v_photos from public.products where id = p_id for update;
  if not found then
    raise exception 'Produto não encontrado.';
  end if;
  if jsonb_array_length(v_photos) >= 6 then
    raise exception 'Cada produto aceita até 6 fotos. Remova uma para adicionar outra.';
  end if;
  v_photos := v_photos || to_jsonb(p_url);
  update public.products set photos = v_photos, photo_url = v_photos ->> 0 where id = p_id;
end;
$$;

create or replace function public.remove_product_photo(p_id uuid, p_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_photos jsonb;
begin
  perform public._require_active();
  select coalesce(jsonb_agg(e), '[]'::jsonb) into v_photos
    from public.products p, jsonb_array_elements(p.photos) e
   where p.id = p_id and e #>> '{}' <> p_url;
  update public.products set photos = v_photos, photo_url = v_photos ->> 0 where id = p_id;
  if not found then
    raise exception 'Produto não encontrado.';
  end if;
end;
$$;

-- Torna uma das fotos a principal (vai para o começo).
create or replace function public.cover_product_photo(p_id uuid, p_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_photos jsonb;
begin
  perform public._require_active();
  select jsonb_build_array(p_url) || coalesce(jsonb_agg(e), '[]'::jsonb) into v_photos
    from public.products p, jsonb_array_elements(p.photos) e
   where p.id = p_id and e #>> '{}' <> p_url;
  if v_photos is null or not exists (select 1 from public.products where id = p_id and photos @> to_jsonb(p_url)) then
    raise exception 'Foto não encontrada neste produto.';
  end if;
  update public.products set photos = v_photos, photo_url = v_photos ->> 0 where id = p_id;
end;
$$;

-- ---------- movimentações de produtos: venda direta e desmontagem ----------
alter table public.ready_log drop constraint if exists ready_log_kind_check;
alter table public.ready_log add constraint ready_log_kind_check
  check (kind in ('montagem', 'ajuste', 'pedido', 'venda', 'desmontagem'));

drop function if exists public.adjust_ready(uuid, integer, text);
-- Ajuste manual dos montados (gerente). p_kind: 'ajuste' (padrão) ou 'venda' (venda direta, só saída).
create or replace function public.adjust_ready(p_product uuid, p_delta integer, p_note text default '', p_kind text default 'ajuste')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me     public.profiles;
  v_name text;
  v_old  integer;
begin
  me := public._require_manager();
  if p_kind not in ('ajuste', 'venda') then
    raise exception 'Tipo de movimentação inválido.';
  end if;
  if p_delta is null or p_delta = 0 then
    raise exception 'Informe uma quantidade diferente de zero.';
  end if;
  if p_kind = 'venda' and p_delta > 0 then
    raise exception 'Venda direta só pode ser uma saída.';
  end if;
  if p_kind = 'ajuste' and p_delta < 0 and btrim(coalesce(p_note, '')) = '' then
    raise exception 'Informe o motivo da saída.';
  end if;
  select name, ready into v_name, v_old from public.products where id = p_product for update;
  if not found then
    raise exception 'Produto não encontrado.';
  end if;
  if v_old + p_delta < 0 then
    raise exception 'Só há % montado(s) de "%"; não dá para tirar %.', v_old, v_name, -p_delta;
  end if;
  update public.products set ready = ready + p_delta where id = p_product;
  insert into public.ready_log (product_id, product_name, delta, kind, note, user_name)
  values (p_product, v_name, p_delta, p_kind, btrim(coalesce(p_note, '')), me.name);
end;
$$;

-- Desmontar (gerente): o produto sai dos montados e as peças da ficha técnica voltam ao estoque.
create or replace function public.unassemble_product(p_product uuid, p_qty integer, p_note text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me     public.profiles;
  v_name text;
  v_old  integer;
  r      record;
begin
  me := public._require_manager();
  if p_qty is null or p_qty <= 0 then
    raise exception 'Informe uma quantidade maior que zero.';
  end if;
  select name, ready into v_name, v_old from public.products where id = p_product for update;
  if not found then
    raise exception 'Produto não encontrado.';
  end if;
  if not exists (select 1 from public.bom where product_id = p_product) then
    raise exception 'Este produto não tem ficha técnica; não dá para devolver as peças.';
  end if;
  if v_old < p_qty then
    raise exception 'Só há % montado(s) de "%"; não dá para desmontar %.', v_old, v_name, p_qty;
  end if;
  perform 1 from public.parts where id in (select part_id from public.bom where product_id = p_product) order by id for update;
  for r in
    select b.part_id, pa.name, b.qty * p_qty as back
      from public.bom b join public.parts pa on pa.id = b.part_id
     where b.product_id = p_product
  loop
    update public.parts set stock = stock + r.back where id = r.part_id;
    insert into public.movements (part_id, part_name, type, qty, note, user_id, user_name, user_role, origin)
    values (r.part_id, r.name, 'entrada', r.back,
            format('Desmontagem: %s× %s', p_qty, v_name) || case when btrim(coalesce(p_note, '')) = '' then '' else ' · ' || btrim(p_note) end,
            me.id, me.name, me.role, 'desmontagem');
  end loop;
  update public.products set ready = ready - p_qty where id = p_product;
  insert into public.ready_log (product_id, product_name, delta, kind, note, user_name)
  values (p_product, v_name, -p_qty, 'desmontagem', btrim(coalesce(p_note, '')), me.name);
end;
$$;

create or replace function public.reverse_movement(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me      public.profiles;
  m       public.movements;
  v_stock integer;
  v_name  text;
  v_type  text;
  v_new   uuid;
begin
  me := public._require_manager();
  select * into m from public.movements where id = p_id for update;
  if not found then
    raise exception 'Movimentação não encontrada.';
  end if;
  if m.origin in ('recebimento', 'desmontagem') then
    raise exception 'Esta movimentação veio de um recebimento ou de uma desmontagem. Corrija pela aba Recebimento (editar/excluir) ou refaça a montagem em Produtos.';
  end if;
  if m.type = 'producao' then
    raise exception 'Montagens não podem ser estornadas aqui. Se preciso, registre uma entrada das peças.';
  end if;
  if m.reverts is not null then
    raise exception 'Isto já é um estorno e não pode ser estornado.';
  end if;
  if m.reverted_by is not null then
    raise exception 'Esta movimentação já foi estornada.';
  end if;

  select stock, name into v_stock, v_name from public.parts where id = m.part_id for update;
  if not found then
    raise exception 'A peça desta movimentação não existe mais.';
  end if;

  if m.type = 'entrada' then
    if v_stock < m.qty then
      raise exception 'Não dá para estornar: a entrada foi de % e só há % em estoque.', m.qty, v_stock;
    end if;
    update public.parts set stock = stock - m.qty where id = m.part_id;
    v_type := 'saida';
  else
    update public.parts set stock = stock + m.qty where id = m.part_id;
    v_type := 'entrada';
  end if;

  insert into public.movements (part_id, part_name, type, qty, note, user_id, user_name, user_role, reverts, origin)
  values (m.part_id, v_name, v_type, m.qty,
          'Estorno do lançamento de ' || to_char(m.created_at at time zone 'America/Fortaleza', 'DD/MM HH24:MI'),
          me.id, me.name, me.role, m.id, 'estorno')
  returning id into v_new;
  update public.movements set reverted_by = v_new where id = m.id;
end;
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.set_photo(text, uuid, text),
  public.add_product_photo(uuid, text),
  public.remove_product_photo(uuid, text),
  public.cover_product_photo(uuid, text),
  public.adjust_ready(uuid, integer, text, text),
  public.unassemble_product(uuid, integer, text),
  public.reverse_movement(uuid)
to authenticated;
