-- =====================================================================
--  Estoque & Montagem: banco de dados (Supabase / PostgreSQL)
--
--  Como usar: no painel do Supabase, abra "SQL Editor", clique em
--  "New query", cole TODO este arquivo e clique em "Run".
--  Pode rodar de novo sem medo: ele só cria o que ainda não existe e
--  atualiza as regras.
--
--  Segurança (o ponto principal):
--   * Custos e preços ficam em tabelas SEPARADAS (part_costs e
--     product_prices) que só o GERENTE consegue ler ou alterar. O banco
--     recusa para o funcionário, mesmo que alguém tente burlar a tela.
--   * Entradas, saídas e montagens passam por funções que conferem o
--     estoque e gravam o histórico juntas (sem ficar pela metade e sem
--     dois usuários se atropelando).
--   * Usuário "inativo" perde todo o acesso na hora.
-- =====================================================================

-- ---------- tabelas ----------

create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text not null default '',
  role       text not null default 'funcionario' check (role in ('gerente', 'funcionario')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.parts (
  id         uuid primary key default gen_random_uuid(),
  code       text not null default '',
  name       text not null,
  stock      integer not null default 0 check (stock >= 0),
  min        integer not null default 0 check (min >= 0),
  photo_url  text,
  created_at timestamptz not null default now()
);
create unique index if not exists parts_code_unique on public.parts (lower(code)) where code <> '';

create table if not exists public.part_costs (
  part_id uuid primary key references public.parts (id) on delete cascade,
  cost    numeric(12, 2) not null default 0 check (cost >= 0)
);

create table if not exists public.products (
  id         uuid primary key default gen_random_uuid(),
  code       text not null default '',
  name       text not null,
  category   text not null default 'Sem categoria',
  photo_url  text,
  created_at timestamptz not null default now()
);
create unique index if not exists products_code_unique on public.products (lower(code)) where code <> '';

create table if not exists public.product_prices (
  product_id uuid primary key references public.products (id) on delete cascade,
  price      numeric(12, 2) not null default 0 check (price >= 0)
);

create table if not exists public.bom (
  product_id uuid not null references public.products (id) on delete cascade,
  part_id    uuid not null references public.parts (id) on delete restrict,
  qty        integer not null check (qty > 0),
  primary key (product_id, part_id)
);

create table if not exists public.movements (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  part_id    uuid,
  part_name  text not null,
  type       text not null check (type in ('entrada', 'saida', 'producao')),
  qty        integer not null check (qty > 0),
  note       text not null default '',
  user_id    uuid,
  user_name  text not null default '',
  user_role  text not null default ''
);
create index if not exists movements_created_idx on public.movements (created_at desc);

-- ---------- perfil criado automaticamente para cada novo usuário ----------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, role)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(new.email, '@', 1)),
    'funcionario'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- cria o perfil de quem já existia antes de rodar este arquivo
insert into public.profiles (id, name)
select u.id, split_part(u.email, '@', 1) from auth.users u
on conflict (id) do nothing;

-- ---------- quem é quem ----------

create or replace function public.is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active);
$$;

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active and role = 'gerente');
$$;

-- uso interno das funções abaixo
create or replace function public._require_active()
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = auth.uid();
  if not found or not p.active then
    raise exception 'Acesso não autorizado.' using errcode = '42501';
  end if;
  return p;
end;
$$;

create or replace function public._require_manager()
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare p public.profiles;
begin
  p := public._require_active();
  if p.role <> 'gerente' then
    raise exception 'Apenas o gerente pode fazer isso.' using errcode = '42501';
  end if;
  return p;
end;
$$;

-- ---------- regras de acesso às tabelas (RLS) ----------

alter table public.profiles       enable row level security;
alter table public.parts          enable row level security;
alter table public.part_costs     enable row level security;
alter table public.products       enable row level security;
alter table public.product_prices enable row level security;
alter table public.bom            enable row level security;
alter table public.movements      enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_manager());

drop policy if exists parts_select on public.parts;
create policy parts_select on public.parts for select to authenticated using (public.is_active());
drop policy if exists parts_write on public.parts;
create policy parts_write on public.parts for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

drop policy if exists part_costs_manager on public.part_costs;
create policy part_costs_manager on public.part_costs for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

drop policy if exists products_select on public.products;
create policy products_select on public.products for select to authenticated using (public.is_active());
drop policy if exists products_write on public.products;
create policy products_write on public.products for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

drop policy if exists product_prices_manager on public.product_prices;
create policy product_prices_manager on public.product_prices for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

drop policy if exists bom_select on public.bom;
create policy bom_select on public.bom for select to authenticated using (public.is_active());
drop policy if exists bom_write on public.bom;
create policy bom_write on public.bom for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

drop policy if exists movements_select on public.movements;
create policy movements_select on public.movements for select to authenticated using (public.is_active());
-- movements: ninguém grava direto; só as funções abaixo

revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
-- movimentações e perfis só mudam pelas funções
revoke insert, update, delete on public.movements from authenticated;
revoke insert, update, delete on public.profiles  from authenticated;

-- ---------- funções (o que o site chama) ----------

-- Entrada ou saída de uma peça.
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
      insert into public.part_costs (part_id, cost) values (p_part, v_new)
      on conflict (part_id) do update set cost = excluded.cost;
    end if;
    update public.parts set stock = stock + p_qty where id = p_part;
  end if;

  insert into public.movements (part_id, part_name, type, qty, note, user_id, user_name, user_role)
  values (p_part, v_name, p_type, p_qty, coalesce(p_note, ''), me.id, me.name, me.role);
end;
$$;

-- Montagem: desconta todas as peças da ficha técnica de uma vez, ou não faz nada.
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
end;
$$;

-- Criar ou atualizar peças (gerente). items = lista de
-- { id, code, name, stock, min, cost }  ("cost" ausente ou nulo = não mexe no custo).
-- Se o estoque informado for diferente do atual, grava a diferença no histórico.
create or replace function public.save_parts(items jsonb, p_note text default 'Ajuste manual')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me       public.profiles;
  it       jsonb;
  v_id     uuid;
  v_name   text;
  v_in     integer;   -- estoque informado (nulo = não informado)
  v_min_in integer;   -- mínimo informado (nulo = não informado)
  v_new    integer;
  v_old    integer;
begin
  me := public._require_manager();
  if items is null or jsonb_typeof(items) <> 'array' then
    raise exception 'Dados inválidos.';
  end if;

  for it in select * from jsonb_array_elements(items) loop
    v_id     := (it ->> 'id')::uuid;
    v_name   := btrim(coalesce(it ->> 'name', ''));
    v_in     := case when jsonb_typeof(it -> 'stock') = 'number' then (it ->> 'stock')::integer end;
    v_min_in := case when jsonb_typeof(it -> 'min') = 'number' then (it ->> 'min')::integer end;
    if v_name = '' then
      raise exception 'Toda peça precisa de um nome.';
    end if;
    if coalesce(v_in, 0) < 0 or coalesce(v_min_in, 0) < 0 then
      raise exception 'Estoque e mínimo não podem ser negativos.';
    end if;

    select stock into v_old from public.parts where id = v_id for update;
    if found then
      -- estoque ausente = não mexe (evita pisar numa movimentação feita por outra pessoa)
      v_new := coalesce(v_in, v_old);
      update public.parts
         set code  = btrim(coalesce(it ->> 'code', code)),
             name  = v_name,
             min   = coalesce(v_min_in, min),
             stock = v_new
       where id = v_id;
      if v_new <> v_old then
        insert into public.movements (part_id, part_name, type, qty, note, user_id, user_name, user_role)
        values (v_id, v_name, case when v_new > v_old then 'entrada' else 'saida' end,
                abs(v_new - v_old), coalesce(p_note, ''), me.id, me.name, me.role);
      end if;
    else
      v_new := coalesce(v_in, 0);
      insert into public.parts (id, code, name, stock, min)
      values (v_id, btrim(coalesce(it ->> 'code', '')), v_name, v_new, coalesce(v_min_in, 0));
      if v_new > 0 then
        insert into public.movements (part_id, part_name, type, qty, note, user_id, user_name, user_role)
        values (v_id, v_name, 'entrada', v_new,
                case when p_note is null or p_note = 'Ajuste manual' then 'Estoque inicial'
                     else 'Estoque inicial · ' || p_note end,
                me.id, me.name, me.role);
      end if;
    end if;

    if jsonb_typeof(it -> 'cost') = 'number' then
      if (it ->> 'cost')::numeric < 0 then
        raise exception 'O custo não pode ser negativo.';
      end if;
      insert into public.part_costs (part_id, cost) values (v_id, round((it ->> 'cost')::numeric, 2))
      on conflict (part_id) do update set cost = excluded.cost;
    end if;
  end loop;
end;
$$;

-- Criar ou atualizar produtos (gerente). items = lista de
-- { id, code, name, category, price, bom: [ { partId, qty } ] }
-- "price" nulo = não mexe no preço; "bom" ausente = não mexe na ficha técnica.
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

-- Foto de peça ou produto (qualquer usuário ativo). p_url nulo remove a foto.
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
    update public.products set photo_url = p_url where id = p_id;
  else
    raise exception 'Tipo inválido.';
  end if;
  if not found then
    raise exception 'Item não encontrado.';
  end if;
end;
$$;

-- Lista de usuários (gerente).
create or replace function public.list_users()
returns table (id uuid, email text, name text, role text, active boolean, last_sign_in_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_manager();
  return query
    select p.id, u.email::text, p.name, p.role, p.active, u.last_sign_in_at
      from public.profiles p
      join auth.users u on u.id = p.id
     order by lower(p.name), u.email;
end;
$$;

-- Mudar perfil, nome ou ativar/desativar um usuário (gerente).
create or replace function public.set_user(
  p_id     uuid,
  p_role   text,
  p_active boolean,
  p_name   text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_manager();
  if p_role not in ('gerente', 'funcionario') then
    raise exception 'Perfil inválido.';
  end if;
  if p_id = auth.uid() and (p_role <> 'gerente' or not p_active) then
    raise exception 'Você não pode tirar o seu próprio acesso de gerente.';
  end if;
  update public.profiles
     set role = p_role, active = p_active, name = coalesce(nullif(btrim(p_name), ''), name)
   where id = p_id;
  if not found then
    raise exception 'Usuário não encontrado.';
  end if;
end;
$$;

-- permissões das funções: só usuários logados
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.apply_movement(uuid, text, integer, text, numeric),
  public.apply_production(uuid, integer),
  public.save_parts(jsonb, text),
  public.save_products(jsonb),
  public.set_photo(text, uuid, text),
  public.list_users(),
  public.set_user(uuid, text, boolean, text),
  public.is_active(),
  public.is_manager()
to authenticated;

-- ---------- fotos (Storage) ----------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = 2097152,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists fotos_upload on storage.objects;
create policy fotos_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and public.is_active());

drop policy if exists fotos_delete on storage.objects;
create policy fotos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'fotos' and public.is_active());

-- =====================================================================
--  DEPOIS DE RODAR ESTE ARQUIVO:
--  1) Authentication > Users > Add user: crie o seu usuário (marque
--     "Auto Confirm User").
--  2) Torne-o gerente rodando (troque o e-mail):
--       update public.profiles set role = 'gerente'
--        where id = (select id from auth.users where email = 'seu@email.com');
--  3) Authentication > Sign In / Providers: DESLIGUE "Allow new users to
--     sign up", para que só quem você cadastrar consiga entrar.
-- =====================================================================
