-- Migração 7: espaço de produtos montados (histórico e ajuste) e reserva de montados para um pedido.
-- Rode UMA vez no SQL Editor do Supabase (depois da migração 6). Pode repetir sem problema.
-- Rode ANTES de publicar o site novo.

-- ---------- histórico dos produtos montados ----------
create table if not exists public.ready_log (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default clock_timestamp(),
  product_id   uuid,
  product_name text not null default '',
  delta        integer not null check (delta <> 0),
  kind         text not null check (kind in ('montagem', 'ajuste', 'pedido')),
  note         text not null default '',
  user_name    text not null default ''
);
create index if not exists ready_log_created_idx on public.ready_log (created_at desc);
alter table public.ready_log enable row level security;
revoke all on public.ready_log from authenticated, anon;   -- só pelas funções

create or replace function public.list_ready_log(p_limit integer default 100)
returns table (id uuid, created_at timestamptz, product_id uuid, product_name text, delta integer,
               kind text, note text, user_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare me public.profiles;
begin
  me := public._require_active();
  return query
    select l.id, l.created_at, l.product_id, l.product_name, l.delta, l.kind,
           case when me.role = 'gerente' then l.note else ''::text end, l.user_name
      from public.ready_log l
     order by l.created_at desc
     limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

-- Ajuste manual dos montados (gerente): entrou (já existiam, montados a mais) ou saiu (venda direta, perda, correção).
create or replace function public.adjust_ready(p_product uuid, p_delta integer, p_note text default '')
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
  if p_delta is null or p_delta = 0 then
    raise exception 'Informe uma quantidade diferente de zero.';
  end if;
  if p_delta < 0 and btrim(coalesce(p_note, '')) = '' then
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
  values (p_product, v_name, p_delta, 'ajuste', btrim(coalesce(p_note, '')), me.name);
end;
$$;

-- Reservar montados para um pedido (gerente). p_qty é o total reservado para aquele item (0 libera).
-- As reservas têm prioridade; o resto dos montados é repartido pelos pedidos mais antigos.
create or replace function public.reserve_order_item(p_order uuid, p_product uuid, p_qty integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me      public.profiles;
  o       public.orders;
  it      jsonb;
  v_ready integer;
  v_other integer;
  v_name  text;
begin
  me := public._require_manager();
  if p_qty is null or p_qty < 0 then
    raise exception 'Informe uma quantidade a partir de zero.';
  end if;
  select * into o from public.orders where id = p_order for update;
  if not found then
    raise exception 'Pedido não encontrado.';
  end if;
  if o.status <> 'aberto' then
    raise exception 'Só pedidos em andamento aceitam reserva.';
  end if;
  select e into it from jsonb_array_elements(o.items) e where e ->> 'product_id' = p_product::text;
  if it is null then
    raise exception 'Este produto não está no pedido.';
  end if;
  if p_qty > (it ->> 'qty')::integer then
    raise exception 'O pedido só precisa de % unidade(s) de "%".', it ->> 'qty', it ->> 'name';
  end if;
  select ready into v_ready from public.products where id = p_product for update;
  select coalesce(sum((e2 ->> 'reserved')::integer), 0) into v_other
    from public.orders o2, jsonb_array_elements(o2.items) e2
   where o2.status = 'aberto' and o2.id <> p_order and e2 ->> 'product_id' = p_product::text;
  if p_qty + v_other > coalesce(v_ready, 0) then
    raise exception 'Só há % montado(s) livre(s) de "%" (os outros já estão reservados em outros pedidos).',
      greatest(coalesce(v_ready, 0) - v_other, 0), it ->> 'name';
  end if;
  v_name := it ->> 'name';
  update public.orders
     set items = (select jsonb_agg(case when e ->> 'product_id' = p_product::text
                                        then e || jsonb_build_object('reserved', p_qty) else e end)
                    from jsonb_array_elements(items) e),
         updated_at = clock_timestamp(),
         log = log || jsonb_build_array(jsonb_build_object('at', clock_timestamp(), 'by', me.name,
                'action', case when p_qty = 0 then 'reserva liberada' else 'reservado' end,
                'detail', p_qty || ' un. de ' || v_name))
   where id = p_order;
end;
$$;

create or replace function public.apply_production(p_product uuid, p_qty integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me       public.profiles;
  v_pname  text;
  v_short  text := '';
  r        record;
begin
  me := public._require_active();
  if p_qty is null or p_qty <= 0 then
    raise exception 'Informe uma quantidade maior que zero.';
  end if;

  select name into v_pname from public.products where id = p_product;
  if not found then
    raise exception 'Produto não encontrado.';
  end if;
  if not exists (select 1 from public.bom where product_id = p_product) then
    raise exception 'Este produto não tem ficha técnica.';
  end if;

  -- trava as peças sempre na mesma ordem (evita travamento entre dois usuários)
  perform 1 from public.parts
   where id in (select part_id from public.bom where product_id = p_product)
   order by id for update;

  for r in
    select b.part_id, pa.name, pa.stock, b.qty * p_qty as need
      from public.bom b join public.parts pa on pa.id = b.part_id
     where b.product_id = p_product
     order by pa.name
  loop
    if r.stock < r.need then
      v_short := v_short || case when v_short = '' then '' else '; ' end
                 || format('%s (precisa %s, tem %s)', r.name, r.need, r.stock);
    end if;
  end loop;
  if v_short <> '' then
    raise exception 'Estoque insuficiente: %.', v_short;
  end if;

  for r in
    select b.part_id, pa.name, b.qty * p_qty as need
      from public.bom b join public.parts pa on pa.id = b.part_id
     where b.product_id = p_product
  loop
    update public.parts set stock = stock - r.need where id = r.part_id;
    insert into public.movements (part_id, part_name, type, qty, note, user_id, user_name, user_role)
    values (r.part_id, r.name, 'producao', r.need,
            format('Montagem: %s× %s', p_qty, v_pname), me.id, me.name, me.role);
  end loop;

  -- o produto montado passa a existir como estoque de produto pronto
  update public.products set ready = ready + p_qty where id = p_product;
  insert into public.ready_log (product_id, product_name, delta, kind, note, user_name)
  values (p_product, v_pname, p_qty, 'montagem', '', me.name);
end;
$$;

create or replace function public.finish_order(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me      public.profiles;
  o       public.orders;
  x       record;
  v_short text := '';
begin
  me := public._require_manager();
  select * into o from public.orders where id = p_id for update;
  if not found then
    raise exception 'Pedido não encontrado.';
  end if;
  if o.status <> 'aberto' then
    raise exception 'Este pedido não está em andamento.';
  end if;

  perform 1 from public.products
   where id in (select (e ->> 'product_id')::uuid from jsonb_array_elements(o.items) e)
   order by id for update;

  for x in
    select (e ->> 'product_id')::uuid as product_id, e ->> 'name' as name, (e ->> 'qty')::integer as qty,
           coalesce(p.ready, 0) as ready, p.id is null as gone
      from jsonb_array_elements(o.items) e
      left join public.products p on p.id = (e ->> 'product_id')::uuid
  loop
    if x.gone then
      raise exception 'O produto "%" não existe mais. Edite o pedido.', x.name;
    end if;
    if x.ready < x.qty then
      v_short := v_short || case when v_short = '' then '' else '; ' end
                 || format('%s (precisa %s, prontos %s)', x.name, x.qty, x.ready);
    end if;
  end loop;
  if v_short <> '' then
    raise exception 'Ainda faltam produtos montados: %.', v_short;
  end if;

  for x in select (e ->> 'product_id')::uuid as product_id, e ->> 'name' as name, (e ->> 'qty')::integer as qty from jsonb_array_elements(o.items) e loop
    update public.products set ready = ready - x.qty where id = x.product_id;
    insert into public.ready_log (product_id, product_name, delta, kind, note, user_name)
    values (x.product_id, x.name, -x.qty, 'pedido', 'Pedido #' || o.num, me.name);
  end loop;

  update public.orders
     set status = 'concluido', updated_at = clock_timestamp(),
         log = log || jsonb_build_array(jsonb_build_object('at', clock_timestamp(), 'by', me.name, 'action', 'finalizado', 'detail', ''))
   where id = p_id;
end;
$$;

create or replace function public.edit_order(p_id uuid, p_customer text, p_ref text, p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me public.profiles;
  o  public.orders;
begin
  me := public._require_manager();
  select * into o from public.orders where id = p_id for update;
  if not found then
    raise exception 'Pedido não encontrado.';
  end if;
  if o.status <> 'aberto' then
    raise exception 'Só pedidos em andamento podem ser editados.';
  end if;
  update public.orders
     set customer = btrim(coalesce(p_customer, '')), ref = btrim(coalesce(p_ref, '')),
         items = (select coalesce(jsonb_agg(n || jsonb_build_object('reserved', least((n ->> 'qty')::integer, coalesce(
                    (select (old_i ->> 'reserved')::integer from jsonb_array_elements(o.items) old_i
                      where old_i ->> 'product_id' = n ->> 'product_id'), 0))) ), '[]'::jsonb)
                    from jsonb_array_elements(public._order_items(p_items)) n),
             updated_at = clock_timestamp(),
         log = log || jsonb_build_array(jsonb_build_object('at', clock_timestamp(), 'by', me.name, 'action', 'editado', 'detail', ''))
   where id = p_id;
end;
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.apply_production(uuid, integer),
  public.finish_order(uuid),
  public.edit_order(uuid, text, text, jsonb),
  public.list_ready_log(integer),
  public.adjust_ready(uuid, integer, text),
  public.reserve_order_item(uuid, uuid, integer)
to authenticated;
