-- Migração 3: estorno de movimentação (gerente) e conferência de estoque (contagem).
-- Rode UMA vez no SQL Editor do Supabase (depois da migração 2). Pode repetir sem problema.

-- ---------- colunas novas no histórico ----------
alter table public.movements add column if not exists reverts     uuid;
alter table public.movements add column if not exists reverted_by uuid;
alter table public.movements add column if not exists origin      text not null default '';

-- ---------- contagens de estoque ----------
create table if not exists public.counts (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default clock_timestamp(),
  user_id          uuid,
  user_name        text not null default '',
  note             text not null default '',
  status           text not null default 'pendente' check (status in ('pendente', 'aprovada', 'rejeitada')),
  items            jsonb not null default '[]'::jsonb,
  reviewed_by_name text not null default '',
  reviewed_at      timestamptz
);
alter table public.counts enable row level security;
revoke all on public.counts from authenticated, anon;   -- só pelas funções abaixo

-- ---------- histórico (agora com estorno e origem) ----------
drop function if exists public.list_movements(integer);
create or replace function public.list_movements(p_limit integer default 500)
returns table (id uuid, created_at timestamptz, part_id uuid, part_name text, type text,
               qty integer, note text, user_name text, user_role text,
               reverts uuid, reverted_by uuid, origin text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare me public.profiles;
begin
  me := public._require_active();
  return query
    select m.id, m.created_at, m.part_id, m.part_name, m.type, m.qty,
           case when me.role = 'gerente' then m.note else ''::text end,
           m.user_name, m.user_role, m.reverts, m.reverted_by, m.origin
    from public.movements m
    order by m.created_at desc
    limit least(greatest(coalesce(p_limit, 500), 1), 1000);
end;
$$;

-- ---------- estorno (só gerente): desfaz uma entrada ou saída lançada por engano ----------
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

-- ---------- conferência: qualquer usuário envia a contagem; o gerente aprova ----------
create or replace function public.submit_count(p_items jsonb, p_note text default '')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me     public.profiles;
  it     jsonb;
  v_part public.parts;
  v_cnt  integer;
  v_out  jsonb := '[]'::jsonb;
  v_id   uuid;
begin
  me := public._require_active();
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Conte pelo menos uma peça.';
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    v_cnt := (it ->> 'counted')::integer;
    if v_cnt is null or v_cnt < 0 then
      raise exception 'A quantidade contada não pode ser negativa.';
    end if;
    select * into v_part from public.parts where id = (it ->> 'part_id')::uuid;
    if not found then
      raise exception 'Uma das peças contadas não existe mais.';
    end if;
    v_out := v_out || jsonb_build_object(
      'part_id', v_part.id, 'name', v_part.name, 'code', v_part.code,
      'system', v_part.stock, 'counted', v_cnt);
  end loop;
  insert into public.counts (user_id, user_name, note, items)
  values (me.id, me.name, coalesce(p_note, ''), v_out)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.list_counts(p_limit integer default 30)
returns table (id uuid, created_at timestamptz, user_name text, note text, status text,
               items jsonb, reviewed_by_name text, reviewed_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_active();
  return query
    select c.id, c.created_at, c.user_name, c.note, c.status, c.items, c.reviewed_by_name, c.reviewed_at
    from public.counts c
    order by c.created_at desc
    limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$$;

create or replace function public.review_count(p_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me     public.profiles;
  c      public.counts;
  it     jsonb;
  v_part public.parts;
  v_cnt  integer;
  v_diff integer;
begin
  me := public._require_manager();
  select * into c from public.counts where id = p_id for update;
  if not found then
    raise exception 'Contagem não encontrada.';
  end if;
  if c.status <> 'pendente' then
    raise exception 'Esta contagem já foi %.', c.status;
  end if;

  if p_approve then
    for it in select * from jsonb_array_elements(c.items) loop
      v_cnt := (it ->> 'counted')::integer;
      select * into v_part from public.parts where id = (it ->> 'part_id')::uuid for update;
      if not found then
        continue;  -- peça apagada depois da contagem
      end if;
      v_diff := v_cnt - v_part.stock;
      if v_diff <> 0 then
        update public.parts set stock = v_cnt where id = v_part.id;
        insert into public.movements (part_id, part_name, type, qty, note, user_id, user_name, user_role, origin)
        values (v_part.id, v_part.name, case when v_diff > 0 then 'entrada' else 'saida' end, abs(v_diff),
                'Conferência de estoque (contagem de ' || c.user_name || ')',
                me.id, me.name, me.role, 'conferencia');
      end if;
    end loop;
  end if;

  update public.counts
     set status = case when p_approve then 'aprovada' else 'rejeitada' end,
         reviewed_by_name = me.name, reviewed_at = clock_timestamp()
   where id = p_id;
end;
$$;

-- ---------- permissões ----------
revoke execute on function public.list_movements(integer)       from public, anon;
revoke execute on function public.reverse_movement(uuid)        from public, anon;
revoke execute on function public.submit_count(jsonb, text)     from public, anon;
revoke execute on function public.list_counts(integer)          from public, anon;
revoke execute on function public.review_count(uuid, boolean)   from public, anon;
grant  execute on function public.list_movements(integer)       to authenticated;
grant  execute on function public.reverse_movement(uuid)        to authenticated;
grant  execute on function public.submit_count(jsonb, text)     to authenticated;
grant  execute on function public.list_counts(integer)          to authenticated;
grant  execute on function public.review_count(uuid, boolean)   to authenticated;
