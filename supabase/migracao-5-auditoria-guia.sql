-- Migração 5: auditoria de custos/preços, custo de compra no recebimento e guia de montagem.
-- Rode UMA vez no SQL Editor do Supabase (depois da migração 4). Pode repetir sem problema.
-- Rode ANTES de publicar o site novo.

-- ---------- guia de montagem (passo a passo, texto) ----------
alter table public.products add column if not exists guide jsonb not null default '[]'::jsonb;

-- ---------- auditoria de custos e preços (só o gerente lê) ----------
create table if not exists public.price_log (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  kind       text not null check (kind in ('custo', 'preco')),
  item_id    uuid,
  item_name  text not null default '',
  old_value  numeric(12, 2),
  new_value  numeric(12, 2) not null,
  source     text not null default 'manual',   -- manual | recebimento | cadastro
  detail     text not null default '',
  user_name  text not null default ''
);
create index if not exists price_log_created_idx on public.price_log (created_at desc);
alter table public.price_log enable row level security;
revoke all on public.price_log from authenticated, anon;   -- só pela função list_price_log

create or replace function public._log_price()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind  text;
  v_id    uuid;
  v_name  text;
  v_old   numeric;
  v_new   numeric;
  v_user  text;
  v_src   text;
begin
  if tg_table_name = 'part_costs' then
    v_kind := 'custo'; v_id := new.part_id; v_new := new.cost;
    select name into v_name from public.parts where id = new.part_id;
  else
    v_kind := 'preco'; v_id := new.product_id; v_new := new.price;
    select name into v_name from public.products where id = new.product_id;
  end if;
  if tg_op = 'UPDATE' then
    v_old := (to_jsonb(old) ->> case when v_kind = 'custo' then 'cost' else 'price' end)::numeric;
    if v_old is not distinct from v_new then
      return new;
    end if;
  end if;
  select name into v_user from public.profiles where id = auth.uid();
  v_src := coalesce(nullif(current_setting('app.price_source', true), ''),
                    case when v_old is null then 'cadastro' else 'manual' end);
  insert into public.price_log (kind, item_id, item_name, old_value, new_value, source, detail, user_name)
  values (v_kind, v_id, coalesce(v_name, ''), v_old, v_new, v_src,
          coalesce(current_setting('app.price_detail', true), ''), coalesce(v_user, ''));
  return new;
end;
$$;

drop trigger if exists part_costs_log on public.part_costs;
create trigger part_costs_log after insert or update on public.part_costs
  for each row execute function public._log_price();
drop trigger if exists product_prices_log on public.product_prices;
create trigger product_prices_log after insert or update on public.product_prices
  for each row execute function public._log_price();

create or replace function public.list_price_log(p_limit integer default 300)
returns table (id uuid, created_at timestamptz, kind text, item_id uuid, item_name text,
               old_value numeric, new_value numeric, source text, detail text, user_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_manager();
  return query
    select l.id, l.created_at, l.kind, l.item_id, l.item_name, l.old_value, l.new_value,
           l.source, l.detail, l.user_name
      from public.price_log l
     order by l.created_at desc
     limit least(greatest(coalesce(p_limit, 300), 1), 1000);
end;
$$;

-- ---------- produtos: agora com guia de montagem ----------
create or replace function public.save_products(items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  it      jsonb;
  v_id    uuid;
  v_name  text;
begin
  perform public._require_manager();
  if items is null or jsonb_typeof(items) <> 'array' then
    raise exception 'Dados inválidos.';
  end if;

  for it in select * from jsonb_array_elements(items) loop
    v_id   := (it ->> 'id')::uuid;
    v_name := btrim(coalesce(it ->> 'name', ''));
    if v_name = '' then
      raise exception 'Todo produto precisa de um nome.';
    end if;

    insert into public.products (id, code, name, category)
    values (v_id, btrim(coalesce(it ->> 'code', '')), v_name,
            coalesce(nullif(btrim(it ->> 'category'), ''), 'Sem categoria'))
    on conflict (id) do update
      set code = excluded.code, name = excluded.name, category = excluded.category;

    if jsonb_typeof(it -> 'guide') = 'array' then
      update public.products set guide = coalesce(
        (select jsonb_agg(to_jsonb(btrim(s))) from jsonb_array_elements_text(it -> 'guide') s where btrim(s) <> ''),
        '[]'::jsonb) where id = v_id;
    end if;

    if jsonb_typeof(it -> 'price') = 'number' then
      if (it ->> 'price')::numeric < 0 then
        raise exception 'O preço não pode ser negativo.';
      end if;
      insert into public.product_prices (product_id, price) values (v_id, round((it ->> 'price')::numeric, 2))
      on conflict (product_id) do update set price = excluded.price;
    end if;

    if jsonb_typeof(it -> 'bom') = 'array' then
      delete from public.bom where product_id = v_id;
      insert into public.bom (product_id, part_id, qty)
      select v_id, (b ->> 'partId')::uuid, sum((b ->> 'qty')::integer)
        from jsonb_array_elements(it -> 'bom') b
       group by (b ->> 'partId')::uuid;
    end if;
  end loop;
end;
$$;

-- ---------- recebimento: custo de compra por item (só o gerente informa e vê) ----------
create or replace function public._receipt_items(p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  it     jsonb;
  v_part public.parts;
  v_rec  integer;
  v_exp  integer;
  v_cost numeric;
  v_out  jsonb := '[]'::jsonb;
  v_any  boolean := false;
  v_seen uuid[] := '{}';
  v_mgr  boolean := public.is_manager();
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Inclua pelo menos uma peça no recebimento.';
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into v_part from public.parts where id = (it ->> 'part_id')::uuid;
    if not found then
      raise exception 'Uma das peças do recebimento não existe mais.';
    end if;
    if v_part.id = any (v_seen) then
      raise exception 'A peça "%" aparece duas vezes. Some as quantidades em uma linha só.', v_part.name;
    end if;
    v_seen := v_seen || v_part.id;
    v_rec := (it ->> 'received')::integer;
    v_exp := case when jsonb_typeof(it -> 'expected') = 'number' then (it ->> 'expected')::integer end;
    v_cost := case when v_mgr and jsonb_typeof(it -> 'unit_cost') = 'number' then (it ->> 'unit_cost')::numeric end;
    if v_rec is null or v_rec < 0 or coalesce(v_exp, 0) < 0 then
      raise exception 'As quantidades não podem ser negativas.';
    end if;
    if v_cost is not null and v_cost < 0 then
      raise exception 'O custo de compra não pode ser negativo.';
    end if;
    if v_rec > 0 then v_any := true; end if;
    v_out := v_out || jsonb_build_object('part_id', v_part.id, 'name', v_part.name, 'code', v_part.code,
                                         'expected', v_exp, 'received', v_rec,
                                         'unit_cost', case when v_cost is null then null else round(v_cost, 2) end);
  end loop;
  if not v_any then
    raise exception 'Informe a quantidade recebida de pelo menos uma peça.';
  end if;
  return v_out;
end;
$$;

-- Lista: o funcionário não recebe fornecedor, detalhes do registro nem custo de compra.
create or replace function public.list_receipts(p_limit integer default 100)
returns table (id uuid, num integer, created_at timestamptz, updated_at timestamptz, user_name text,
               ref text, supplier text, status text, items jsonb, log jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
declare me public.profiles;
begin
  me := public._require_active();
  return query
    select r.id, r.num, r.created_at, r.updated_at, r.user_name, r.ref,
           case when me.role = 'gerente' then r.supplier else ''::text end,
           r.status,
           case when me.role = 'gerente' then r.items
                else (select coalesce(jsonb_agg(e - 'unit_cost'), '[]'::jsonb) from jsonb_array_elements(r.items) e) end,
           case when me.role = 'gerente' then r.log
                else (select coalesce(jsonb_agg(e || jsonb_build_object('detail', '')), '[]'::jsonb)
                        from jsonb_array_elements(r.log) e) end
    from public.receipts r
    order by r.created_at desc
    limit least(greatest(coalesce(p_limit, 100), 1), 300);
end;
$$;

-- Autorizar: entra no estoque e, onde houver custo de compra, o custo da peça vira a MÉDIA PONDERADA
-- (estoque atual x custo atual + recebido x custo da compra) / (estoque atual + recebido).
create or replace function public.approve_receipt(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me public.profiles;
  r  public.receipts;
  x  record;
  v_stock integer;
  v_cost  numeric;
  v_avg   numeric;
begin
  me := public._require_manager();
  select * into r from public.receipts where id = p_id for update;
  if not found then
    raise exception 'Recebimento não encontrado.';
  end if;
  if r.status <> 'pendente' then
    raise exception 'Este recebimento não está aguardando autorização.';
  end if;
  for x in select * from jsonb_to_recordset(r.items)
             as t(part_id uuid, name text, received integer, unit_cost numeric) where received > 0 loop
    select stock into v_stock from public.parts where id = x.part_id for update;
    if not found then
      raise exception 'A peça "%" não existe mais.', x.name;
    end if;
    update public.parts set stock = stock + x.received where id = x.part_id;
    insert into public.movements (part_id, part_name, type, qty, note, user_id, user_name, user_role, origin)
    values (x.part_id, x.name, 'entrada', x.received, 'Recebimento #' || r.num, me.id, me.name, me.role, 'recebimento');

    if x.unit_cost is not null then
      select cost into v_cost from public.part_costs where part_id = x.part_id;
      if v_cost is null or v_cost = 0 or v_stock <= 0 then
        v_avg := x.unit_cost;
      else
        v_avg := (v_stock * v_cost + x.received * x.unit_cost) / (v_stock + x.received);
      end if;
      perform set_config('app.price_source', 'recebimento', true);
      perform set_config('app.price_detail',
        'Recebimento #' || r.num || ': ' || x.received || ' un. a R$ ' || to_char(x.unit_cost, 'FM999990.00'), true);
      insert into public.part_costs (part_id, cost) values (x.part_id, round(v_avg, 2))
      on conflict (part_id) do update set cost = excluded.cost;
      perform set_config('app.price_source', '', true);
      perform set_config('app.price_detail', '', true);
    end if;
  end loop;
  update public.receipts
     set status = 'concluido', updated_at = clock_timestamp(),
         log = log || jsonb_build_array(jsonb_build_object('at', clock_timestamp(), 'by', me.name, 'action', 'autorizado', 'detail', ''))
   where id = p_id;
end;
$$;

-- Entrada ou saída de uma peça (a compra com custo agora fica na auditoria de custos).
create or replace function public.apply_movement(
  p_part      uuid,
  p_type      text,
  p_qty       integer,
  p_note      text default '',
  p_unit_cost numeric default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me       public.profiles;
  v_stock  integer;
  v_name   text;
  v_cost   numeric;
  v_new    numeric;
begin
  me := public._require_active();
  if p_qty is null or p_qty <= 0 then
    raise exception 'Informe uma quantidade maior que zero.';
  end if;
  if p_type not in ('entrada', 'saida') then
    raise exception 'Tipo de movimentação inválido.';
  end if;

  select stock, name into v_stock, v_name from public.parts where id = p_part for update;
  if not found then
    raise exception 'Peça não encontrada.';
  end if;

  if p_type = 'saida' then
    if v_stock < p_qty then
      raise exception 'Só há % em estoque; não dá para dar saída de %.', v_stock, p_qty;
    end if;
    update public.parts set stock = stock - p_qty where id = p_part;
  else
    -- só o gerente informa custo; vira média ponderada com o estoque atual
    if p_unit_cost is not null and me.role = 'gerente' then
      if p_unit_cost < 0 then
        raise exception 'O custo não pode ser negativo.';
      end if;
      select cost into v_cost from public.part_costs where part_id = p_part;
      if v_cost is null or v_cost = 0 then
        v_new := round(p_unit_cost, 2);
      else
        v_new := round((v_stock * v_cost + p_qty * p_unit_cost) / (v_stock + p_qty), 2);
      end if;
      perform set_config('app.price_source', 'compra', true);
      perform set_config('app.price_detail', 'Entrada de ' || p_qty || ' un. a R$ ' || to_char(p_unit_cost, 'FM999990.00'), true);
      insert into public.part_costs (part_id, cost) values (p_part, v_new)
      on conflict (part_id) do update set cost = excluded.cost;
      perform set_config('app.price_source', '', true);
      perform set_config('app.price_detail', '', true);
    end if;
    update public.parts set stock = stock + p_qty where id = p_part;
  end if;

  insert into public.movements (part_id, part_name, type, qty, note, user_id, user_name, user_role)
  values (p_part, v_name, p_type, p_qty, case when me.role = 'gerente' then coalesce(p_note, '') else '' end, me.id, me.name, me.role);
end;
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.apply_movement(uuid, text, integer, text, numeric),
  public.save_products(jsonb),
  public.list_receipts(integer),
  public.approve_receipt(uuid),
  public.list_price_log(integer)
to authenticated;
