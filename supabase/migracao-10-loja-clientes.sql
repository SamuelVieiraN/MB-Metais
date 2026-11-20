-- =====================================================================
-- Migração 10: loja online (catálogo público), contas de cliente,
-- solicitações, segurança (2 etapas, limite de tentativas, auditoria)
-- Pode ser rodada mais de uma vez.
-- =====================================================================

-- ---------- 1) papel "cliente" e perfil padrão seguro ----------
-- Com o cadastro aberto, QUALQUER pessoa pode criar conta. Por isso o perfil
-- padrão deixa de ser "funcionário": toda conta nova nasce como "cliente",
-- sem nenhum acesso ao estoque. O gerente promove a equipe na aba Usuários.
do $$
declare c text;
begin
  for c in
    select con.conname from pg_constraint con
     where con.conrelid = 'public.profiles'::regclass and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%role%'
  loop
    execute format('alter table public.profiles drop constraint %I', c);
  end loop;
end $$;
alter table public.profiles
  add constraint profiles_role_check check (role in ('gerente', 'funcionario', 'cliente'));
alter table public.profiles alter column role set default 'cliente';
-- 'painel' = criada no painel do Supabase (equipe); 'loja' = cadastro feito pelo cliente
alter table public.profiles add column if not exists origin text not null default 'painel';

-- ---------- 2) verificação em 2 etapas (se o usuário ativou, o servidor exige) ----------
create or replace function public._aal_ok()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
      or coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

-- só equipe (gerente/funcionário) conta como "ativo"; cliente nunca
create or replace function public.is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles
                  where id = auth.uid() and active and role in ('gerente', 'funcionario'))
     and public._aal_ok();
$$;

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active and role = 'gerente')
     and public._aal_ok();
$$;

create or replace function public._require_active()
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = auth.uid();
  if not found or not p.active or p.role not in ('gerente', 'funcionario') then
    raise exception 'Acesso não autorizado.' using errcode = '42501';
  end if;
  if not public._aal_ok() then
    raise exception 'Confirme o código de verificação em 2 etapas para continuar.' using errcode = '42501';
  end if;
  return p;
end;
$$;

-- ---------- 3) auditoria e limite de tentativas ----------
create table if not exists public.audit_log (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  user_id   uuid,
  user_name text not null default '',
  action    text not null,
  detail    text not null default ''
);
alter table public.audit_log enable row level security;
revoke all on public.audit_log from authenticated, anon;   -- só pela função list_audit

create table if not exists public.rate_events (
  id      bigint generated always as identity primary key,
  user_id uuid not null,
  kind    text not null,
  at      timestamptz not null default now()
);
create index if not exists rate_events_lookup on public.rate_events (user_id, kind, at);
create index if not exists rate_events_at on public.rate_events (at);
alter table public.rate_events enable row level security;
revoke all on public.rate_events from authenticated, anon;

-- uso interno: registra uma ação administrativa (nunca grava dados pessoais)
create or replace function public._audit(p_action text, p_detail text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (user_id, user_name, action, detail)
  values (auth.uid(), coalesce((select name from public.profiles where id = auth.uid()), ''),
          left(coalesce(p_action, ''), 80), left(coalesce(p_detail, ''), 500));
end;
$$;

-- uso interno: no máximo p_max ações do tipo p_kind por usuário dentro da janela
create or replace function public._throttle(p_kind text, p_max integer, p_window interval)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.rate_events where at < now() - interval '2 days';
  if (select count(*) from public.rate_events
       where user_id = auth.uid() and kind = p_kind and at > now() - p_window) >= p_max then
    raise exception 'Muitas tentativas em pouco tempo. Aguarde um pouco e tente de novo.' using errcode = '54000';
  end if;
  insert into public.rate_events (user_id, kind) values (auth.uid(), p_kind);
end;
$$;

-- Gerente: registro das ações administrativas
create or replace function public.list_audit(p_limit integer default 200)
returns table (id bigint, at timestamptz, user_name text, action text, detail text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_manager();
  return query
    select a.id, a.at, a.user_name, a.action, a.detail
      from public.audit_log a
     order by a.at desc
     limit least(greatest(coalesce(p_limit, 200), 1), 1000);
end;
$$;

-- Gerente: apaga registros antigos (retenção). Padrão: guarda 12 meses.
create or replace function public.purge_audit(p_months integer default 12)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  perform public._require_manager();
  delete from public.audit_log where at < now() - make_interval(months => greatest(coalesce(p_months, 12), 6));
  get diagnostics n = row_count;
  perform public._audit('auditoria_limpa', n || ' registros antigos apagados');
  return n;
end;
$$;

-- ---------- 4) usuários: agora com "cliente" e auditoria ----------
drop function if exists public.list_users();
create or replace function public.list_users()
returns table (id uuid, email text, name text, role text, active boolean, last_sign_in_at timestamptz, origin text)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_manager();
  -- clientes que se cadastraram pela loja não aparecem aqui (ficam na aba Clientes)
  return query
    select p.id, u.email::text, p.name, p.role, p.active, u.last_sign_in_at, p.origin
      from public.profiles p
      join auth.users u on u.id = p.id
     where p.role <> 'cliente' or p.origin = 'painel'
     order by lower(p.name), u.email;
end;
$$;

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
declare old public.profiles;
begin
  perform public._require_manager();
  if p_role not in ('gerente', 'funcionario', 'cliente') then
    raise exception 'Perfil inválido.';
  end if;
  if p_id = auth.uid() and (p_role <> 'gerente' or not p_active) then
    raise exception 'Você não pode tirar o seu próprio acesso de gerente.';
  end if;
  select * into old from public.profiles where id = p_id;
  if not found then
    raise exception 'Usuário não encontrado.';
  end if;
  update public.profiles
     set role = p_role, active = p_active, name = coalesce(nullif(btrim(p_name), ''), name)
   where id = p_id;
  if old.role is distinct from p_role or old.active is distinct from p_active then
    perform public._audit('usuario_alterado', old.name || ': perfil ' || old.role || ' -> ' || p_role
                          || ', ativo ' || old.active || ' -> ' || p_active);
  end if;
end;
$$;

-- ---------- 5) validação de CPF / CNPJ (inclui o CNPJ alfanumérico) ----------
create or replace function public._clean_doc(p text)
returns text
language sql
immutable
as $$ select upper(regexp_replace(coalesce(p, ''), '[^0-9A-Za-z]', '', 'g')) $$;

create or replace function public.valid_cpf(p text)
returns boolean
language plpgsql
immutable
as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g'); s integer; r integer; i integer;
begin
  if length(d) <> 11 or d ~ '^(\d)\1{10}$' then return false; end if;
  s := 0;
  for i in 1..9 loop s := s + substr(d, i, 1)::integer * (11 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if;
  if r <> substr(d, 10, 1)::integer then return false; end if;
  s := 0;
  for i in 1..10 loop s := s + substr(d, i, 1)::integer * (12 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if;
  return r = substr(d, 11, 1)::integer;
end;
$$;

create or replace function public.valid_cnpj(p text)
returns boolean
language plpgsql
immutable
as $$
declare
  d  text := upper(regexp_replace(coalesce(p, ''), '[^0-9A-Za-z]', '', 'g'));
  w1 integer[] := '{5,4,3,2,9,8,7,6,5,4,3,2}';
  w2 integer[] := '{6,5,4,3,2,9,8,7,6,5,4,3,2}';
  s  integer; r integer; i integer;
begin
  if d !~ '^[0-9A-Z]{12}[0-9]{2}$' or d ~ '^(.)\1{13}$' then return false; end if;
  s := 0;
  for i in 1..12 loop s := s + (ascii(substr(d, i, 1)) - 48) * w1[i]; end loop;
  r := s % 11; r := case when r < 2 then 0 else 11 - r end;
  if r <> substr(d, 13, 1)::integer then return false; end if;
  s := 0;
  for i in 1..13 loop s := s + (ascii(substr(d, i, 1)) - 48) * w2[i]; end loop;
  r := s % 11; r := case when r < 2 then 0 else 11 - r end;
  return r = substr(d, 14, 1)::integer;
end;
$$;

-- versão vigente dos Termos de Uso e da Política de Privacidade (mude junto com js/company.js)
create or replace function public.terms_version()
returns text
language sql
immutable
as $$ select '2026-11-19'::text $$;

-- ---------- 6) clientes ----------
create table if not exists public.customers (
  id         uuid primary key references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('pf', 'pj')),
  doc        text not null,
  name       text not null check (char_length(name) between 2 and 120),
  phone      text not null default '',
  cep        text not null default '',
  street     text not null default '',
  number     text not null default '',
  complement text not null default '',
  district   text not null default '',
  city       text not null default '',
  uf         text not null default '',
  terms_version text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists customers_doc_unique on public.customers (doc);
alter table public.customers enable row level security;
revoke all on public.customers from authenticated, anon;   -- só pelas funções abaixo

-- histórico de aceites (consentimento): uma linha por aceite
create table if not exists public.consents (
  id      bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind    text not null check (kind in ('termos', 'privacidade')),
  version text not null,
  at      timestamptz not null default now()
);
alter table public.consents enable row level security;
revoke all on public.consents from authenticated, anon;

-- uso interno: confere e limpa os dados do cadastro (lança mensagem em português)
create or replace function public._customer_clean(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind  text := lower(btrim(coalesce(p ->> 'kind', '')));
  v_doc   text := public._clean_doc(p ->> 'doc');
  v_name  text := btrim(coalesce(p ->> 'name', ''));
  v_phone text := regexp_replace(coalesce(p ->> 'phone', ''), '\D', '', 'g');
  v_cep   text := regexp_replace(coalesce(p ->> 'cep', ''), '\D', '', 'g');
  v_street text := btrim(coalesce(p ->> 'street', ''));
  v_num   text := btrim(coalesce(p ->> 'number', ''));
  v_comp  text := btrim(coalesce(p ->> 'complement', ''));
  v_dist  text := btrim(coalesce(p ->> 'district', ''));
  v_city  text := btrim(coalesce(p ->> 'city', ''));
  v_uf    text := upper(btrim(coalesce(p ->> 'uf', '')));
begin
  if v_kind not in ('pf', 'pj') then
    raise exception 'Escolha se o cadastro é de pessoa física (CPF) ou de empresa (CNPJ).';
  end if;
  if v_kind = 'pf' and not public.valid_cpf(v_doc) then
    raise exception 'CPF inválido. Confira os números.';
  end if;
  if v_kind = 'pj' and not public.valid_cnpj(v_doc) then
    raise exception 'CNPJ inválido. Confira os números.';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception 'Informe o nome (ou a razão social) com até 120 letras.';
  end if;
  if char_length(v_phone) not between 10 and 11 then
    raise exception 'Informe o telefone com DDD.';
  end if;
  if char_length(v_cep) <> 8 then
    raise exception 'Informe o CEP com 8 números.';
  end if;
  if char_length(v_street) < 2 or char_length(v_street) > 120 then
    raise exception 'Informe a rua.';
  end if;
  if char_length(v_num) < 1 or char_length(v_num) > 10 then
    raise exception 'Informe o número (ou S/N).';
  end if;
  if char_length(v_comp) > 60 or char_length(v_dist) > 80 then
    raise exception 'Complemento ou bairro muito longo.';
  end if;
  if char_length(v_city) < 2 or char_length(v_city) > 80 then
    raise exception 'Informe a cidade.';
  end if;
  if not (v_uf = any (array['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'])) then
    raise exception 'Informe a sigla do estado (UF).';
  end if;
  return jsonb_build_object('kind', v_kind, 'doc', v_doc, 'name', v_name, 'phone', v_phone, 'cep', v_cep,
                            'street', v_street, 'number', v_num, 'complement', v_comp, 'district', v_dist,
                            'city', v_city, 'uf', v_uf);
end;
$$;

create or replace function public._require_customer_account()
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = auth.uid();
  if not found or not p.active or p.role <> 'cliente' then
    raise exception 'Acesso não autorizado.' using errcode = '42501';
  end if;
  return p;
end;
$$;

create or replace function public._require_customer()
returns public.customers
language plpgsql
security definer
set search_path = public
as $$
declare c public.customers;
begin
  perform public._require_customer_account();
  select * into c from public.customers where id = auth.uid();
  if not found then
    raise exception 'Complete o seu cadastro antes de enviar solicitações.';
  end if;
  return c;
end;
$$;

-- uso interno: grava (ou atualiza) o cadastro e registra o aceite dos termos
create or replace function public._save_customer(p_clean jsonb, p_terms text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_terms is distinct from public.terms_version() then
    raise exception 'Os Termos de Uso foram atualizados. Recarregue a página e aceite novamente.';
  end if;
  begin
    insert into public.customers (id, kind, doc, name, phone, cep, street, number, complement, district, city, uf, terms_version)
    values (auth.uid(), p_clean ->> 'kind', p_clean ->> 'doc', p_clean ->> 'name', p_clean ->> 'phone', p_clean ->> 'cep',
            p_clean ->> 'street', p_clean ->> 'number', p_clean ->> 'complement', p_clean ->> 'district',
            p_clean ->> 'city', p_clean ->> 'uf', p_terms)
    on conflict (id) do update
      set name = excluded.name, phone = excluded.phone, cep = excluded.cep, street = excluded.street,
          number = excluded.number, complement = excluded.complement, district = excluded.district,
          city = excluded.city, uf = excluded.uf, terms_version = excluded.terms_version, updated_at = now();
  exception when unique_violation then
    raise exception 'Não foi possível concluir o cadastro com estes dados. Se você já tem conta, entre com ela; se precisar de ajuda, fale com a empresa.';
  end;
  update public.profiles set name = p_clean ->> 'name' where id = auth.uid();
  insert into public.consents (user_id, kind, version) values (auth.uid(), 'termos', p_terms), (auth.uid(), 'privacidade', p_terms);
end;
$$;

-- Cliente: envia o cadastro (formulário)
create or replace function public.register_customer(p_data jsonb, p_terms text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_customer_account();
  perform public._throttle('cadastro', 8, interval '1 hour');
  perform public._save_customer(public._customer_clean(p_data), p_terms);
end;
$$;

-- Cliente: conclui o cadastro com os dados guardados no momento da criação da conta
-- (depois de confirmar o e-mail). Se não houver dados guardados, devolve false.
create or replace function public.complete_registration()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare m jsonb;
begin
  perform public._require_customer_account();
  if exists (select 1 from public.customers where id = auth.uid()) then
    return true;
  end if;
  select u.raw_user_meta_data into m from auth.users u where u.id = auth.uid();
  if m is null or m -> 'cad' is null or jsonb_typeof(m -> 'cad') <> 'object' then
    return false;
  end if;
  perform public._throttle('cadastro', 8, interval '1 hour');
  perform public._save_customer(public._customer_clean(m -> 'cad'), m ->> 'terms');
  return true;
end;
$$;

-- Cliente: vê os próprios dados
create or replace function public.my_customer()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare c public.customers; v_email text; v_cad boolean;
begin
  perform public._require_customer_account();
  select u.email::text, (u.raw_user_meta_data -> 'cad') is not null into v_email, v_cad
    from auth.users u where u.id = auth.uid();
  select * into c from public.customers where id = auth.uid();
  if not found then
    return jsonb_build_object('registered', false, 'email', v_email, 'has_cad', coalesce(v_cad, false));
  end if;
  return jsonb_build_object('registered', true, 'email', v_email, 'kind', c.kind, 'doc', c.doc, 'name', c.name,
    'phone', c.phone, 'cep', c.cep, 'street', c.street, 'number', c.number, 'complement', c.complement,
    'district', c.district, 'city', c.city, 'uf', c.uf, 'created_at', c.created_at,
    'needs_terms', c.terms_version is distinct from public.terms_version());
end;
$$;

-- Cliente: corrige telefone, endereço e nome (CPF/CNPJ não mudam por aqui)
create or replace function public.update_my_customer(p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare c public.customers; v jsonb;
begin
  c := public._require_customer();
  perform public._throttle('editar_dados', 20, interval '1 hour');
  v := public._customer_clean(p_data || jsonb_build_object('kind', c.kind, 'doc', c.doc));
  update public.customers
     set name = v ->> 'name', phone = v ->> 'phone', cep = v ->> 'cep', street = v ->> 'street',
         number = v ->> 'number', complement = v ->> 'complement', district = v ->> 'district',
         city = v ->> 'city', uf = v ->> 'uf', updated_at = now()
   where id = auth.uid();
  update public.profiles set name = v ->> 'name' where id = auth.uid();
end;
$$;

-- Cliente: aceita a versão nova dos termos
create or replace function public.accept_terms(p_terms text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_customer();
  if p_terms is distinct from public.terms_version() then
    raise exception 'Recarregue a página e tente de novo.';
  end if;
  update public.customers set terms_version = p_terms where id = auth.uid();
  insert into public.consents (user_id, kind, version) values (auth.uid(), 'termos', p_terms), (auth.uid(), 'privacidade', p_terms);
end;
$$;

-- ---------- 7) catálogo da loja ----------
create table if not exists public.catalog_items (
  product_id uuid primary key references public.products (id) on delete cascade,
  published  boolean not null default false,
  price      numeric(12, 2) check (price is null or (price >= 0 and price <= 9999999)),
  show_price boolean not null default false,
  blurb      text not null default '' check (char_length(blurb) <= 400),
  sort       integer not null default 0,
  updated_at timestamptz not null default now(),
  check (not show_price or price is not null)
);
alter table public.catalog_items enable row level security;
revoke all on public.catalog_items from authenticated, anon;   -- preço de vitrine: só o gerente, pelas funções

-- Gerente: lê as configurações do catálogo
create or replace function public.list_catalog()
returns table (product_id uuid, published boolean, price numeric, show_price boolean, blurb text, sort integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_manager();
  return query select c.product_id, c.published, c.price, c.show_price, c.blurb, c.sort from public.catalog_items c;
end;
$$;

-- Gerente: grava as configurações (lista de itens alterados)
create or replace function public.save_catalog(p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  it jsonb; v_id uuid; v_price numeric; v_show boolean; v_pub boolean; v_blurb text; v_sort integer; n integer := 0;
begin
  perform public._require_manager();
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Nada para salvar.';
  end if;
  if jsonb_array_length(p_items) > 500 then
    raise exception 'Itens demais de uma vez.';
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    v_id := (it ->> 'product_id')::uuid;
    if not exists (select 1 from public.products where id = v_id) then
      raise exception 'Um dos produtos não existe mais. Atualize a página.';
    end if;
    v_pub := coalesce((it ->> 'published')::boolean, false);
    v_show := coalesce((it ->> 'show_price')::boolean, false);
    v_price := case when jsonb_typeof(it -> 'price') = 'number' then (it ->> 'price')::numeric end;
    v_blurb := left(btrim(coalesce(it ->> 'blurb', '')), 400);
    v_sort := coalesce((it ->> 'sort')::integer, 0);
    if v_price is not null and (v_price < 0 or v_price > 9999999) then
      raise exception 'Preço fora do limite.';
    end if;
    if v_show and v_price is null then
      raise exception 'Para mostrar o preço, informe o valor.';
    end if;
    insert into public.catalog_items (product_id, published, price, show_price, blurb, sort, updated_at)
    values (v_id, v_pub, v_price, v_show, v_blurb, v_sort, now())
    on conflict (product_id) do update
      set published = excluded.published, price = excluded.price, show_price = excluded.show_price,
          blurb = excluded.blurb, sort = excluded.sort, updated_at = now();
    n := n + 1;
  end loop;
  perform public._audit('catalogo_salvo', n || ' produto(s) atualizado(s)');
end;
$$;

-- Público (sem login): só o que o gerente publicou. Nunca devolve custo, peças, estoque exato ou ficha técnica.
create or replace function public.public_catalog()
returns table (id uuid, code text, name text, category text, blurb text, photos jsonb, price numeric, in_stock boolean)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.code, p.name, p.category, c.blurb,
         case when jsonb_typeof(p.photos) = 'array' and jsonb_array_length(p.photos) > 0 then p.photos
              when p.photo_url is not null then jsonb_build_array(p.photo_url)
              else '[]'::jsonb end,
         case when c.show_price then c.price end,
         p.ready > 0
    from public.catalog_items c
    join public.products p on p.id = c.product_id
   where c.published
   order by c.sort, lower(p.name)
   limit 300;
$$;

-- ---------- 8) solicitações dos clientes ----------
create table if not exists public.requests (
  id            uuid primary key default gen_random_uuid(),
  num           integer generated by default as identity,
  created_at    timestamptz not null default now(),
  customer_id   uuid references public.customers (id) on delete set null,
  customer_name text not null default '',
  items         jsonb not null default '[]'::jsonb,
  note          text not null default '' check (char_length(note) <= 500),
  status        text not null default 'nova' check (status in ('nova', 'aprovada', 'recusada', 'cancelada')),
  reason        text not null default '',
  order_id      uuid references public.orders (id) on delete set null,
  decided_at    timestamptz,
  decided_by    text not null default ''
);
create index if not exists requests_customer on public.requests (customer_id, created_at desc);
alter table public.requests enable row level security;
revoke all on public.requests from authenticated, anon;

-- Cliente: envia uma solicitação (itens: [{product_id, qty}])
create or replace function public.create_request(p_items jsonb, p_note text default '')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  c     public.customers;
  it    jsonb;
  prod  public.products;
  v_qty integer;
  v_out jsonb := '[]'::jsonb;
  v_seen uuid[] := '{}';
  v_id  uuid;
begin
  c := public._require_customer();
  perform public._throttle('solicitacao', 10, interval '1 day');
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Escolha pelo menos um produto.';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'Máximo de 50 produtos por solicitação.';
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    select p.* into prod from public.products p
      join public.catalog_items ci on ci.product_id = p.id and ci.published
     where p.id = (it ->> 'product_id')::uuid;
    if not found then
      raise exception 'Um dos produtos não está mais disponível no catálogo. Atualize a página.';
    end if;
    if prod.id = any (v_seen) then
      raise exception 'O produto "%" aparece duas vezes.', prod.name;
    end if;
    v_seen := v_seen || prod.id;
    v_qty := (it ->> 'qty')::integer;
    if v_qty is null or v_qty < 1 or v_qty > 9999 then
      raise exception 'A quantidade de cada produto deve estar entre 1 e 9999.';
    end if;
    v_out := v_out || jsonb_build_object('product_id', prod.id, 'name', prod.name, 'code', prod.code, 'qty', v_qty);
  end loop;
  insert into public.requests (customer_id, customer_name, items, note)
  values (c.id, c.name, v_out, left(btrim(coalesce(p_note, '')), 500))
  returning id into v_id;
  return v_id;
end;
$$;

-- Cliente: as próprias solicitações
create or replace function public.my_requests()
returns table (id uuid, num integer, created_at timestamptz, items jsonb, note text, status text, reason text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_customer();
  return query
    select r.id, r.num, r.created_at, r.items, r.note, r.status, r.reason
      from public.requests r
     where r.customer_id = auth.uid()
     order by r.created_at desc
     limit 100;
end;
$$;

create or replace function public.cancel_my_request(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_customer();
  update public.requests
     set status = 'cancelada', decided_at = now(), decided_by = 'cliente'
   where id = p_id and customer_id = auth.uid() and status = 'nova';
  if not found then
    raise exception 'Só dá para cancelar solicitações que ainda não foram analisadas.';
  end if;
end;
$$;

-- Gerente: lista de solicitações com os dados de contato do cliente
create or replace function public.list_requests(p_limit integer default 200)
returns table (id uuid, num integer, created_at timestamptz, status text, items jsonb, note text, reason text,
               order_id uuid, decided_at timestamptz, decided_by text, customer_name text, kind text, doc text,
               phone text, email text, cep text, street text, number text, complement text, district text,
               city text, uf text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_manager();
  return query
    select r.id, r.num, r.created_at, r.status, r.items, r.note, r.reason, r.order_id, r.decided_at, r.decided_by,
           coalesce(c.name, r.customer_name), c.kind, c.doc, c.phone, u.email::text, c.cep, c.street, c.number,
           c.complement, c.district, c.city, c.uf
      from public.requests r
      left join public.customers c on c.id = r.customer_id
      left join auth.users u on u.id = r.customer_id
     order by (r.status = 'nova') desc, r.created_at desc
     limit least(greatest(coalesce(p_limit, 200), 1), 500);
end;
$$;

-- Gerente: aprova e transforma em pedido (com prazo de entrega opcional)
create or replace function public.approve_request(p_id uuid, p_due date default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me   public.profiles;
  r    public.requests;
  v_id uuid;
begin
  me := public._require_manager();
  select * into r from public.requests where id = p_id for update;
  if not found then
    raise exception 'Solicitação não encontrada.';
  end if;
  if r.status <> 'nova' then
    raise exception 'Esta solicitação já foi analisada.';
  end if;
  insert into public.orders (user_name, customer, ref, items, due_date, log)
  values (me.name, coalesce((select name from public.customers where id = r.customer_id), r.customer_name),
          'Solicitação #' || r.num,
          public._order_items((select jsonb_agg(jsonb_build_object('product_id', i ->> 'product_id', 'qty', (i ->> 'qty')::integer))
                                 from jsonb_array_elements(r.items) i)),
          p_due,
          jsonb_build_array(jsonb_build_object('at', clock_timestamp(), 'by', me.name, 'action', 'criado',
                                               'detail', 'a partir da solicitação #' || r.num)))
  returning id into v_id;
  update public.requests
     set status = 'aprovada', order_id = v_id, decided_at = now(), decided_by = me.name
   where id = p_id;
  perform public._audit('solicitacao_aprovada', '#' || r.num);
  return v_id;
end;
$$;

create or replace function public.reject_request(p_id uuid, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare me public.profiles; r public.requests;
begin
  me := public._require_manager();
  select * into r from public.requests where id = p_id for update;
  if not found then
    raise exception 'Solicitação não encontrada.';
  end if;
  if r.status <> 'nova' then
    raise exception 'Esta solicitação já foi analisada.';
  end if;
  update public.requests
     set status = 'recusada', reason = left(btrim(coalesce(p_reason, '')), 300), decided_at = now(), decided_by = me.name
   where id = p_id;
  perform public._audit('solicitacao_recusada', '#' || r.num);
end;
$$;

-- ---------- 9) clientes (gerente) ----------
create or replace function public.list_customers()
returns table (id uuid, kind text, doc text, name text, phone text, email text, city text, uf text,
               created_at timestamptz, active boolean, requests integer, last_request timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_manager();
  return query
    select c.id, c.kind, c.doc, c.name, c.phone, u.email::text, c.city, c.uf, c.created_at, p.active,
           (select count(*)::integer from public.requests r where r.customer_id = c.id),
           (select max(r.created_at) from public.requests r where r.customer_id = c.id)
      from public.customers c
      join public.profiles p on p.id = c.id
      join auth.users u on u.id = c.id
     order by lower(c.name)
     limit 1000;
end;
$$;

create or replace function public.set_customer_active(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_manager();
  update public.profiles set active = p_active where id = p_id and role = 'cliente';
  if not found then
    raise exception 'Cliente não encontrado.';
  end if;
  perform public._audit(case when p_active then 'cliente_reativado' else 'cliente_bloqueado' end, p_id::text);
end;
$$;

-- ---------- 10) direitos do titular (LGPD): exportar e excluir os próprios dados ----------
create or replace function public.export_my_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare out jsonb;
begin
  perform public._require_customer_account();
  perform public._throttle('exportar', 10, interval '1 day');
  select jsonb_build_object(
    'gerado_em', now(),
    'conta', (select jsonb_build_object('email', u.email, 'criada_em', u.created_at) from auth.users u where u.id = auth.uid()),
    'cadastro', (select to_jsonb(c) - 'id' from public.customers c where c.id = auth.uid()),
    'aceites', coalesce((select jsonb_agg(jsonb_build_object('tipo', k.kind, 'versao', k.version, 'em', k.at) order by k.at)
                           from public.consents k where k.user_id = auth.uid()), '[]'::jsonb),
    'solicitacoes', coalesce((select jsonb_agg(jsonb_build_object('numero', r.num, 'em', r.created_at, 'status', r.status,
                                'itens', r.items, 'observacao', r.note, 'motivo', r.reason) order by r.created_at)
                                from public.requests r where r.customer_id = auth.uid()), '[]'::jsonb))
  into out;
  return out;
end;
$$;

-- Exclui a conta: apaga cadastro, aceites e solicitações não aprovadas. Solicitações já aprovadas
-- viraram pedidos da empresa e ficam guardadas só com o nome, pelo prazo legal.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_customer_account();
  perform public._throttle('excluir_conta', 3, interval '1 day');
  delete from public.requests where customer_id = auth.uid() and status <> 'aprovada';
  update public.requests set customer_id = null where customer_id = auth.uid();
  perform public._audit('cliente_excluiu_conta', '');
  delete from auth.users where id = auth.uid();   -- apaga perfil, cadastro e aceites em cascata
end;
$$;

-- ---------- 11) conta nova: sempre "cliente"; o gerente promove a equipe ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_origin text := case when new.raw_user_meta_data ->> 'origem' = 'loja' then 'loja' else 'painel' end;
  v_name   text;
begin
  v_name := coalesce(nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'name', '')), 120), ''), split_part(new.email, '@', 1));
  insert into public.profiles (id, name, role, origin)
  values (new.id, v_name, 'cliente', v_origin)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- permissões: só o necessário ----------
-- Com o cadastro aberto, "usuário logado" passou a incluir clientes. Por isso, aqui as funções
-- internas (_require_*, _order_items, _audit...) deixam de ser chamáveis de fora.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.apply_movement(uuid, text, integer, text, numeric),
  public.apply_production(uuid, integer),
  public.save_parts(jsonb, text),
  public.save_products(jsonb),
  public.set_photo(text, uuid, text),
  public.list_users(),
  public.set_user(uuid, text, boolean, text),
  public.is_active(),
  public.is_manager(),
  public.list_movements(integer),
  public.reverse_movement(uuid),
  public.submit_count(jsonb, text),
  public.list_counts(integer),
  public.review_count(uuid, boolean),
  public.create_receipt(text, jsonb, text),
  public.list_receipts(integer),
  public.approve_receipt(uuid),
  public.edit_receipt(uuid, text, jsonb, text, text),
  public.delete_receipt(uuid, text),
  public.list_price_log(integer),
  public.create_order(text, text, jsonb, date),
  public.list_orders(integer),
  public.edit_order(uuid, text, text, jsonb, date),
  public.finish_order(uuid),
  public.cancel_order(uuid, text),
  public.list_ready_log(integer),
  public.reserve_order_item(uuid, uuid, integer),
  public.add_product_photo(uuid, text),
  public.remove_product_photo(uuid, text),
  public.cover_product_photo(uuid, text),
  public.adjust_ready(uuid, integer, text, text),
  public.unassemble_product(uuid, integer, text),
  public.list_audit(integer),
  public.purge_audit(integer),
  public.register_customer(jsonb, text),
  public.complete_registration(),
  public.my_customer(),
  public.update_my_customer(jsonb),
  public.accept_terms(text),
  public.list_catalog(),
  public.save_catalog(jsonb),
  public.create_request(jsonb, text),
  public.my_requests(),
  public.cancel_my_request(uuid),
  public.list_requests(integer),
  public.approve_request(uuid, date),
  public.reject_request(uuid, text),
  public.list_customers(),
  public.set_customer_active(uuid, boolean),
  public.export_my_data(),
  public.delete_my_account()
to authenticated;
-- a única função aberta ao público (sem login): o catálogo publicado
grant execute on function public.public_catalog() to anon, authenticated;
