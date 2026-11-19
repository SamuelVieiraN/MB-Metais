-- =====================================================================
-- Migração 9: prazo de entrega nos pedidos (para o calendário)
-- Pode ser rodada mais de uma vez. Rode ANTES de publicar o site novo.
-- =====================================================================
alter table public.orders add column if not exists due_date date;

drop function if exists public.create_order(text, text, jsonb);
drop function if exists public.edit_order(uuid, text, text, jsonb);
drop function if exists public.list_orders(integer);

create or replace function public.create_order(p_customer text, p_ref text, p_items jsonb, p_due date default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me   public.profiles;
  v_id uuid;
begin
  me := public._require_manager();
  insert into public.orders (user_name, customer, ref, items, due_date, log)
  values (me.name, btrim(coalesce(p_customer, '')), btrim(coalesce(p_ref, '')), public._order_items(p_items), p_due,
          jsonb_build_array(jsonb_build_object('at', clock_timestamp(), 'by', me.name, 'action', 'criado', 'detail', '')))
  returning id into v_id;
  return v_id;
end;
$$;

-- Funcionário vê o andamento e o prazo, mas não o nome do cliente nem os detalhes do registro.
create or replace function public.list_orders(p_limit integer default 100)
returns table (id uuid, num integer, created_at timestamptz, updated_at timestamptz, user_name text,
               customer text, ref text, status text, items jsonb, log jsonb, due_date date)
language plpgsql
stable
security definer
set search_path = public
as $$
declare me public.profiles;
begin
  me := public._require_active();
  return query
    select o.id, o.num, o.created_at, o.updated_at, o.user_name,
           case when me.role = 'gerente' then o.customer else ''::text end,
           o.ref, o.status, o.items,
           case when me.role = 'gerente' then o.log
                else (select coalesce(jsonb_agg(e || jsonb_build_object('detail', '')), '[]'::jsonb)
                        from jsonb_array_elements(o.log) e) end,
           o.due_date
      from public.orders o
     order by o.created_at desc
     limit least(greatest(coalesce(p_limit, 100), 1), 300);
end;
$$;

create or replace function public.edit_order(p_id uuid, p_customer text, p_ref text, p_items jsonb, p_due date default null)
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
             due_date = p_due,
             updated_at = clock_timestamp(),
         log = log || jsonb_build_array(jsonb_build_object('at', clock_timestamp(), 'by', me.name, 'action', 'editado', 'detail', ''))
   where id = p_id;
end;
$$;

revoke execute on function public.create_order(text, text, jsonb, date) from public, anon;
revoke execute on function public.list_orders(integer) from public, anon;
revoke execute on function public.edit_order(uuid, text, text, jsonb, date) from public, anon;
grant execute on function public.create_order(text, text, jsonb, date) to authenticated;
grant execute on function public.list_orders(integer) to authenticated;
grant execute on function public.edit_order(uuid, text, text, jsonb, date) to authenticated;
