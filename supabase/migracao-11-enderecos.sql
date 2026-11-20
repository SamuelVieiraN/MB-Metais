-- =====================================================================
--  Migração 11: vários endereços de entrega por cliente
--  - tabela customer_addresses (só as funções abaixo acessam)
--  - o cliente não troca mais nome/CPF/CNPJ pelo site (só o telefone)
--  - endereço marcado como principal continua refletido em customers
--  Pode ser rodada mais de uma vez.
-- =====================================================================

create table if not exists public.customer_addresses (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  label       text not null default '' check (char_length(label) <= 40),
  cep         text not null check (cep ~ '^[0-9]{8}$'),
  street      text not null check (char_length(street) between 2 and 120),
  number      text not null check (char_length(number) between 1 and 10),
  complement  text not null default '' check (char_length(complement) <= 60),
  district    text not null default '' check (char_length(district) <= 80),
  city        text not null check (char_length(city) between 2 and 80),
  uf          text not null check (uf ~ '^[A-Z]{2}$'),
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists customer_addresses_customer on public.customer_addresses (customer_id);
create unique index if not exists customer_addresses_one_default on public.customer_addresses (customer_id) where is_default;
alter table public.customer_addresses enable row level security;
revoke all on public.customer_addresses from authenticated, anon;

-- cadastros que já existem: o endereço do cadastro vira o primeiro endereço
insert into public.customer_addresses (customer_id, label, cep, street, number, complement, district, city, uf, is_default)
select c.id, 'Principal', c.cep, c.street, c.number, c.complement, c.district, c.city, c.uf, true
  from public.customers c
 where c.cep ~ '^[0-9]{8}$' and char_length(c.street) >= 2 and char_length(c.number) >= 1
   and char_length(c.city) >= 2 and c.uf ~ '^[A-Z]{2}$'
   and not exists (select 1 from public.customer_addresses a where a.customer_id = c.id);

-- uso interno: espelha o endereço principal no cadastro (a equipe vê esse)
create or replace function public._sync_default_address(p_customer uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare a public.customer_addresses;
begin
  select * into a from public.customer_addresses where customer_id = p_customer and is_default;
  if found then
    update public.customers
       set cep = a.cep, street = a.street, number = a.number, complement = a.complement,
           district = a.district, city = a.city, uf = a.uf, updated_at = now()
     where id = p_customer;
  end if;
end;
$$;

-- o cadastro novo já cria o primeiro endereço
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
  if not exists (select 1 from public.customer_addresses where customer_id = auth.uid()) then
    insert into public.customer_addresses (customer_id, label, cep, street, number, complement, district, city, uf, is_default)
    values (auth.uid(), 'Principal', p_clean ->> 'cep', p_clean ->> 'street', p_clean ->> 'number', p_clean ->> 'complement',
            p_clean ->> 'district', p_clean ->> 'city', p_clean ->> 'uf', true);
  end if;
end;
$$;

-- Cliente: agora só o telefone muda por aqui (nome e documento são fixos; endereços têm tela própria)
create or replace function public.update_my_customer(p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_phone text := regexp_replace(coalesce(p_data ->> 'phone', ''), '\D', '', 'g');
begin
  perform public._require_customer();
  perform public._throttle('editar_dados', 20, interval '1 hour');
  if char_length(v_phone) not between 10 and 11 then
    raise exception 'Informe o telefone com DDD.';
  end if;
  update public.customers set phone = v_phone, updated_at = now() where id = auth.uid();
end;
$$;

-- Cliente: lista os próprios endereços (o principal primeiro)
create or replace function public.my_addresses()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public._require_customer();
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'label', a.label, 'cep', a.cep, 'street', a.street,
            'number', a.number, 'complement', a.complement, 'district', a.district, 'city', a.city, 'uf', a.uf,
            'is_default', a.is_default) order by a.is_default desc, a.created_at)
          from public.customer_addresses a where a.customer_id = auth.uid()), '[]'::jsonb);
end;
$$;

-- Cliente: cria (p_id nulo) ou edita um endereço; no máximo 10
create or replace function public.save_my_address(p_id uuid, p_data jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.customers;
  v_label text := left(btrim(coalesce(p_data ->> 'label', '')), 40);
  v_cep   text := regexp_replace(coalesce(p_data ->> 'cep', ''), '\D', '', 'g');
  v_street text := btrim(coalesce(p_data ->> 'street', ''));
  v_num   text := btrim(coalesce(p_data ->> 'number', ''));
  v_comp  text := btrim(coalesce(p_data ->> 'complement', ''));
  v_dist  text := btrim(coalesce(p_data ->> 'district', ''));
  v_city  text := btrim(coalesce(p_data ->> 'city', ''));
  v_uf    text := upper(btrim(coalesce(p_data ->> 'uf', '')));
  v_id    uuid := p_id;
  v_first boolean;
begin
  c := public._require_customer();
  perform public._throttle('endereco', 40, interval '1 hour');
  if char_length(v_cep) <> 8 then raise exception 'Informe o CEP com 8 números.'; end if;
  if char_length(v_street) not between 2 and 120 then raise exception 'Informe a rua.'; end if;
  if char_length(v_num) not between 1 and 10 then raise exception 'Informe o número (ou S/N).'; end if;
  if char_length(v_comp) > 60 or char_length(v_dist) > 80 then raise exception 'Complemento ou bairro muito longo.'; end if;
  if char_length(v_city) not between 2 and 80 then raise exception 'Informe a cidade.'; end if;
  if v_uf !~ '^[A-Z]{2}$' then raise exception 'Escolha o estado (UF).'; end if;
  if v_id is null then
    if (select count(*) from public.customer_addresses where customer_id = auth.uid()) >= 10 then
      raise exception 'Você já tem 10 endereços. Exclua algum para adicionar outro.';
    end if;
    v_first := not exists (select 1 from public.customer_addresses where customer_id = auth.uid());
    insert into public.customer_addresses (customer_id, label, cep, street, number, complement, district, city, uf, is_default)
    values (auth.uid(), v_label, v_cep, v_street, v_num, v_comp, v_dist, v_city, v_uf, v_first)
    returning id into v_id;
  else
    update public.customer_addresses
       set label = v_label, cep = v_cep, street = v_street, number = v_num, complement = v_comp,
           district = v_dist, city = v_city, uf = v_uf
     where id = v_id and customer_id = auth.uid();
    if not found then raise exception 'Endereço não encontrado.'; end if;
  end if;
  perform public._sync_default_address(auth.uid());
  return v_id;
end;
$$;

-- Cliente: escolhe qual é o endereço principal
create or replace function public.set_default_address(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._require_customer();
  if not exists (select 1 from public.customer_addresses where id = p_id and customer_id = auth.uid()) then
    raise exception 'Endereço não encontrado.';
  end if;
  update public.customer_addresses set is_default = false where customer_id = auth.uid() and is_default;
  update public.customer_addresses set is_default = true where id = p_id and customer_id = auth.uid();
  perform public._sync_default_address(auth.uid());
end;
$$;

-- Cliente: exclui um endereço (o mais antigo que sobrar vira principal)
create or replace function public.delete_my_address(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_was boolean;
begin
  perform public._require_customer();
  delete from public.customer_addresses where id = p_id and customer_id = auth.uid() returning is_default into v_was;
  if not found then raise exception 'Endereço não encontrado.'; end if;
  if v_was then
    update public.customer_addresses set is_default = true
     where id = (select id from public.customer_addresses where customer_id = auth.uid() order by created_at limit 1);
    perform public._sync_default_address(auth.uid());
  end if;
end;
$$;

-- a cópia dos dados (LGPD) inclui os endereços
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
    'enderecos', coalesce((select jsonb_agg(to_jsonb(a) - 'id' - 'customer_id' order by a.created_at)
                             from public.customer_addresses a where a.customer_id = auth.uid()), '[]'::jsonb),
    'aceites', coalesce((select jsonb_agg(jsonb_build_object('tipo', k.kind, 'versao', k.version, 'em', k.at) order by k.at)
                           from public.consents k where k.user_id = auth.uid()), '[]'::jsonb),
    'solicitacoes', coalesce((select jsonb_agg(jsonb_build_object('numero', r.num, 'em', r.created_at, 'status', r.status,
                                'itens', r.items, 'observacao', r.note, 'motivo', r.reason) order by r.created_at)
                                from public.requests r where r.customer_id = auth.uid()), '[]'::jsonb))
  into out;
  return out;
end;
$$;

-- permissões: só quem está logado, e as funções internas ficam fechadas
revoke execute on function public._sync_default_address(uuid) from public, anon, authenticated;
revoke execute on function public.my_addresses() from public, anon, authenticated;
revoke execute on function public.save_my_address(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.set_default_address(uuid) from public, anon, authenticated;
revoke execute on function public.delete_my_address(uuid) from public, anon, authenticated;
grant execute on function public.my_addresses() to authenticated;
grant execute on function public.save_my_address(uuid, jsonb) to authenticated;
grant execute on function public.set_default_address(uuid) to authenticated;
grant execute on function public.delete_my_address(uuid) to authenticated;
