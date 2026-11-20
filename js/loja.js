/*
 * Loja online (catálogo público + cadastro de cliente + solicitação de pedido).
 *
 * Regras de segurança ficam no banco (supabase/migracao-10-loja-clientes.sql): aqui só se
 * desenha a tela e se chama o servidor. Sem dependências externas, sem cookies, sem rastreadores.
 * Guarda no navegador apenas o essencial: login, carrinho e tema.
 */
(function (root) {
  'use strict';

  const { esc, brl, int, icons, toast, confirmBox, $, $$ } = root.UI;
  const V = root.Validators;
  const CO = root.COMPANY || {};
  const cfg = root.APP_CONFIG || {};
  const base = String(cfg.supabaseUrl || '').replace(/\/+$/, '');
  const anon = cfg.supabaseAnonKey || '';
  const online = !!(base && anon);
  const SKEY = 'mb:loja-sessao';
  const CKEY = 'mb:loja-carrinho';
  const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

  const ls = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* sem armazenamento: vale até recarregar */ } },
    del: (k) => { try { localStorage.removeItem(k); } catch (e) { /* ok */ } },
  };

  // ---------------- estado ----------------
  let session = null;
  let me = null; // resposta de my_customer, ou { staff: true }
  let catalog = null;
  let catErr = null;
  let cart = {}; // product_id -> quantidade
  let cartNote = '';
  let q = '';
  let cat = '';
  let sortBy = 'nome';
  let onlyReady = false;
  let acTab = 'solicitacoes';
  let myReqs = null;
  let lastCep = '';

  try {
    session = JSON.parse(ls.get(SKEY) || 'null');
    cart = JSON.parse(ls.get(CKEY) || '{}') || {};
  } catch (e) {
    session = null;
    cart = {};
  }
  const saveSession = (s) => {
    session = s;
    if (s) ls.set(SKEY, JSON.stringify(s));
    else ls.del(SKEY);
  };
  const saveCart = () => ls.set(CKEY, JSON.stringify(cart));
  const cartCount = () => Object.keys(cart).length;

  // ---------------- servidor ----------------
  function friendly(status, b) {
    const msg = String((b && (b.message || b.msg || b.error_description || b.error)) || '');
    const code = String((b && (b.code || b.error_code)) || '');
    if (/invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.';
    if (/email not confirmed/i.test(msg)) return 'Confirme o seu e-mail antes de entrar. Procure a mensagem na caixa de entrada (e no spam).';
    if (/weak_password|password should be|password.*at least/i.test(msg + ' ' + code)) return 'Senha fraca. Use pelo menos 10 caracteres, misturando letras e números.';
    if (/captcha/i.test(msg)) return 'Não foi possível confirmar que você não é um robô. Tente de novo.';
    if (status === 429 || /rate limit|too many/i.test(msg) || code === '54000') return 'Muitas tentativas em pouco tempo. Aguarde um pouco e tente de novo.';
    if (/email address.*invalid|invalid.*email|unable to validate email/i.test(msg)) return 'E-mail inválido.';
    if (status === 401 || /jwt/i.test(msg)) return 'Sua sessão expirou. Entre de novo.';
    return msg || `Erro inesperado (${status}).`;
  }

  async function refreshIfNeeded() {
    if (!session || session.expires_at - 60 > Date.now() / 1000) return;
    let res;
    try {
      res = await fetch(`${base}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { apikey: anon, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: session.refresh_token }),
      });
    } catch (e) {
      throw new Error('Sem conexão com o servidor. Confira a internet e tente de novo.');
    }
    if (!res.ok) {
      saveSession(null);
      me = null;
      renderTop();
      throw new Error('Sua sessão expirou. Entre de novo.');
    }
    saveSession(toSession(await res.json()));
  }

  const toSession = (r) => ({
    access_token: r.access_token,
    refresh_token: r.refresh_token,
    expires_at: r.expires_at || Math.floor(Date.now() / 1000) + (r.expires_in || 3600),
  });

  async function call(path, o) {
    o = o || {};
    if (o.auth) await refreshIfNeeded();
    const headers = { apikey: anon, 'Content-Type': 'application/json' };
    if (o.auth && session) headers.Authorization = 'Bearer ' + session.access_token;
    else if (anon.startsWith('eyJ')) headers.Authorization = 'Bearer ' + anon;
    let res;
    try {
      res = await fetch(base + path, { method: o.method || 'GET', headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
    } catch (e) {
      throw new Error('Sem conexão com o servidor. Confira a internet e tente de novo.');
    }
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch (e) {
      json = null;
    }
    if (!res.ok) throw new Error(friendly(res.status, json));
    return json;
  }
  const rpc = (fn, args, auth) => call(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args || {}, auth: !!auth });

  async function loadMe() {
    try {
      me = await rpc('my_customer', {}, true);
    } catch (e) {
      if (/não autorizado/i.test(e.message)) me = { staff: true };
      else throw e;
    }
    return me;
  }

  // ---------------- janelas ----------------
  const modal = () => $('#modal');
  function openDlg(html, cls) {
    const m = modal();
    m.className = cls || '';
    m.innerHTML = html;
    if (!m.open) m.showModal();
    const f = $$('input:not([type=hidden]), select, textarea', m).find((x) => !x.closest('.hp'));
    if (f && !/Mobi|Android/i.test(navigator.userAgent)) f.focus();
  }
  const closeDlg = () => {
    const m = modal();
    if (m && m.open) m.close();
  };
  const errBox = () => $('#f-err', modal());
  function showErr(msg) {
    const e = errBox();
    if (!e) return toast(msg, 'error');
    e.textContent = msg;
    e.hidden = false;
    e.scrollIntoView({ block: 'nearest' });
  }
  const busy = (btn, on) => {
    if (!btn) return;
    btn.disabled = on;
    btn.classList.toggle('busy', on);
  };
  const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || '';

  // ---------------- topo e rodapé ----------------
  const isDark = () => document.documentElement.dataset.theme === 'dark';
  function renderTop() {
    const t = $('#lj-theme');
    if (t) t.innerHTML = `${isDark() ? icons.sun : icons.moon}<span>${isDark() ? 'Tema claro' : 'Tema escuro'}</span>`;
    const c = $('#lj-cart');
    if (c) c.innerHTML = `${icons.cart}<span>Solicitação</span>${cartCount() ? `<span class="lj-badge" aria-label="${cartCount()} produto(s)">${cartCount()}</span>` : ''}`;
    const a = $('#lj-account');
    if (a) a.innerHTML = session && me && me.registered ? `${icons.user}<span><small>Olá,</small>${esc(firstName(me.name))}</span>` : `${icons.user}<span><small>Bem-vindo</small>Entrar ou cadastrar</span>`;
    const g = $('#lj-go');
    if (g && !g.innerHTML) g.innerHTML = icons.search;
    const inp = $('#lj-q');
    if (inp && inp.value !== q) inp.value = q;
    const w = $('#lj-wa');
    if (w) {
      const num = String(CO.whatsapp || '').replace(/\D/g, '');
      w.hidden = !num;
      if (num) {
        w.href = `https://wa.me/${num.length <= 11 ? '55' + num : num}`;
        w.innerHTML = `${icons.chat}<span>WhatsApp</span>`;
      }
    }
    const m = $('#lj-util-msg');
    if (m) m.textContent = CO.phone ? `Atendimento: ${CO.phone}` : 'Atendimento direto com a nossa equipe';
    renderCatNav();
  }

  function renderCatNav() {
    const n = $('#lj-catnav');
    if (!n) return;
    const cats = [...new Set((catalog || []).map((p) => p.category).filter(Boolean))].sort((x, y) => x.localeCompare(y, 'pt-BR'));
    const on = (location.hash || '#/').startsWith('#/conta') ? null : cat;
    n.innerHTML = cats.length
      ? `<div class="lj-wrap lj-catrow"><button class="lj-cat ${on === '' ? 'on' : ''}" data-act="cat" data-id="">${icons.menu}<span>Todos os produtos</span></button>${cats
          .map((c) => `<button class="lj-cat ${on === c ? 'on' : ''}" data-act="cat" data-id="${esc(c)}">${esc(c)}</button>`)
          .join('')}</div>`
      : '';
  }

  function renderFoot() {
    const co = CO;
    const fill = (v) => (v ? esc(v) : '<span class="lj-soon">em breve</span>');
    const wa = String(co.whatsapp || '').replace(/\D/g, '');
    $('#lj-foot').innerHTML = `
      <div class="lj-trust"><div class="lj-wrap lj-benefits">
        <div>${icons.shield}<span><b>Cadastro seguro</b>Seus dados protegidos conforme a LGPD</span></div>
        <div>${icons.clipboard}<span><b>Preço e prazo claros</b>Confirmados com você antes de fechar o pedido</span></div>
        <div>${icons.chat}<span><b>Atendimento direto</b>Fale com quem fabrica e vende</span></div>
        <div>${icons.truck}<span><b>Entrega combinada</b>Frete e prazo informados na proposta</span></div>
      </div></div>
      <div class="lj-footmain"><div class="lj-wrap lj-cols">
        <section><h4>${esc(co.name || 'M&B Metais')}</h4><p>CNPJ ${esc(co.cnpj || '')}</p><p>${esc(co.address || '')}</p></section>
        <section><h4>Atendimento</h4>
          <p>Telefone: ${fill(co.phone)}</p>
          <p>E-mail: ${co.email ? `<a href="mailto:${esc(co.email)}">${esc(co.email)}</a>` : fill('')}</p>
          ${wa ? `<p>WhatsApp: <a href="https://wa.me/${wa.length <= 11 ? '55' + wa : wa}" target="_blank" rel="noopener">${esc(co.whatsapp)}</a></p>` : ''}</section>
        <section><h4>Comprar</h4>
          <p><a href="#/" data-act="home">Catálogo</a></p>
          <p><a href="#/conta" data-act="account">Minha conta</a></p>
          <p>Como funciona: escolha os produtos, crie sua conta e envie a solicitação.</p></section>
        <section><h4>Informações legais</h4>
          <nav aria-label="Informações legais"><a href="privacidade">Política de Privacidade</a><a href="termos">Termos de Uso</a><a href="cookies">Cookies e armazenamento</a><a href="privacidade#direitos">Seus direitos (LGPD)</a></nav></section>
      </div></div>
      <div class="lj-copy"><div class="lj-wrap">© ${new Date().getFullYear()} ${esc(co.name || '')}. Todos os direitos reservados. Preços e disponibilidade são confirmados pela empresa ao analisar a sua solicitação. Imagens meramente ilustrativas.</div></div>`;
  }

  // ---------------- catálogo ----------------
  async function loadCatalog() {
    try {
      catalog = ((await rpc('public_catalog')) || []).map((p) => ({ ...p, price: p.price === null ? null : Number(p.price), photos: Array.isArray(p.photos) ? p.photos : [] }));
      catErr = null;
      // tira do carrinho o que saiu do catálogo
      let dropped = 0;
      Object.keys(cart).forEach((id) => {
        if (!catalog.some((p) => p.id === id)) {
          delete cart[id];
          dropped++;
        }
      });
      if (dropped) {
        saveCart();
        toast('Alguns produtos da sua solicitação saíram do catálogo e foram removidos.');
      }
    } catch (e) {
      catalog = [];
      catErr = e.message;
    }
    renderCatNav();
  }

  const byId = (id) => (catalog || []).find((p) => p.id === id);
  const priceHtml = (p) => (p.price === null ? '<div class="lj-price ask">Sob consulta</div>' : `<div class="lj-price">${esc(brl(p.price))}</div>`);

  function cardHtml(p) {
    const img = p.photos[0];
    return `<article class="lj-card">
      <button class="lj-photo" data-act="detail" data-id="${esc(p.id)}" aria-label="Ver detalhes de ${esc(p.name)}">
        ${img ? `<img src="${esc(img)}" alt="${esc(p.name)}" loading="lazy" />` : `<span class="ph">${icons.image}</span>`}
        ${p.in_stock ? '<span class="lj-tag">Pronta entrega</span>' : ''}
      </button>
      <div class="lj-body">
        <small>${esc(p.category || '')}</small>
        <h3 data-act="detail" data-id="${esc(p.id)}">${esc(p.name)}</h3>
        ${p.code ? `<span class="lj-code">Cód. ${esc(p.code)}</span>` : ''}
        ${p.blurb ? `<p class="lj-blurb">${esc(p.blurb)}</p>` : ''}
        ${priceHtml(p)}
        ${cart[p.id] ? `<div class="lj-added">${stepper(p.id, true)}<small>Produto adicionado</small></div>` : `<button class="btn primary lj-buy" data-act="add" data-id="${esc(p.id)}">${icons.cart} Adicionar</button>`}
      </div>
    </article>`;
  }

  function filtered() {
    const s = q.trim().toLowerCase();
    const list = (catalog || []).filter(
      (p) => (!cat || p.category === cat) && (!onlyReady || p.in_stock) && (!s || `${p.name} ${p.code} ${p.category} ${p.blurb}`.toLowerCase().includes(s))
    );
    const price = (p, dir) => (p.price === null ? (dir > 0 ? Infinity : -Infinity) : p.price);
    if (sortBy === 'menor') list.sort((x, y) => price(x, 1) - price(y, 1) || x.name.localeCompare(y.name, 'pt-BR'));
    else if (sortBy === 'maior') list.sort((x, y) => (y.price === null ? -1 : y.price) - (x.price === null ? -1 : x.price) || x.name.localeCompare(y.name, 'pt-BR'));
    else list.sort((x, y) => x.name.localeCompare(y.name, 'pt-BR'));
    return list;
  }

  function gridHtml() {
    const list = filtered();
    if (!list.length) return `<div class="card empty" style="grid-column:1/-1"><p>${(catalog || []).length ? 'Nenhum produto encontrado para essa busca.' : 'O catálogo está sendo preparado. Volte em breve.'}</p></div>`;
    return list.map(cardHtml).join('');
  }

  const countText = () => {
    const n = filtered().length;
    return `${n} produto${n === 1 ? '' : 's'}${cat ? ' em ' + esc(cat) : ''}`;
  };

  // ---------------- banner de divulgação (troca sozinho) ----------------
  let bn = 0;
  let bnPaused = false;
  function slides() {
    const ready = (catalog || []).filter((p) => p.in_stock && p.photos[0]).slice(0, 3);
    const custom = Array.isArray(CO.banners) && CO.banners.length ? CO.banners : null;
    if (custom) return custom.map((b, i) => ({ tone: i % 4, eyebrow: b.eyebrow || '', title: b.title || '', text: b.text || '', cta: b.cta || 'Ver produtos', act: 'browse', icon: icons.store }));
    const list = [
      { tone: 0, eyebrow: 'Fabricação própria em metal', title: 'Torneiras, duchas e acessórios para a sua obra', text: 'Escolha os produtos e envie a sua solicitação. Nossa equipe confirma preço, prazo e disponibilidade com você.', cta: 'Ver produtos', act: 'browse', icon: icons.drop },
    ];
    if (ready.length) list.push({ tone: 1, eyebrow: 'Pronta entrega', title: 'Produtos montados, prontos para sair', text: 'Confira os modelos que já estão montados e disponíveis agora.', cta: 'Ver pronta entrega', act: 'ready', photos: ready.map((p) => p.photos[0]), icon: icons.box });
    list.push(
      { tone: 2, eyebrow: 'Cadastro rápido', title: 'Crie sua conta em 2 minutos', text: 'Para pessoa física ou empresa. Digite o CEP e o endereço é preenchido sozinho.', cta: 'Criar minha conta', act: 'signup', icon: icons.user },
      { tone: 3, eyebrow: 'Atendimento direto', title: 'Preço e prazo confirmados com você', text: 'Você envia a solicitação sem compromisso e recebe a proposta da nossa equipe antes de fechar o pedido.', cta: 'Começar a solicitação', act: 'browse', icon: icons.chat }
    );
    return list;
  }

  function bannerHtml() {
    const sl = slides();
    if (bn >= sl.length) bn = 0;
    return `<section class="lj-banner" aria-roledescription="carrossel" aria-label="Destaques da loja">
      <div class="lj-slides">${sl
        .map(
          (x, i) => `<div class="lj-slide tone${x.tone} ${i === bn ? 'on' : ''}" ${i === bn ? '' : 'aria-hidden="true"'} data-i="${i}">
          <div class="lj-slide-text">
            <span class="lj-eyebrow">${esc(x.eyebrow)}</span>
            <h1>${esc(x.title)}</h1>
            <p>${esc(x.text)}</p>
            <button class="btn primary big" data-act="bn-cta" data-a="${esc(x.act)}" ${i === bn ? '' : 'tabindex="-1"'}>${esc(x.cta)}</button>
          </div>
          <div class="lj-slide-art">${x.photos ? x.photos.map((u) => `<span class="lj-art-photo"><img src="${esc(u)}" alt="" loading="lazy" /></span>`).join('') : `<span class="lj-art-icon">${x.icon}</span>`}</div>
        </div>`
        )
        .join('')}</div>
      <button class="lj-bn-arrow prev" data-act="bn-prev" aria-label="Banner anterior">${icons.chevron}</button>
      <button class="lj-bn-arrow next" data-act="bn-next" aria-label="Próximo banner">${icons.chevron}</button>
      <div class="lj-bn-dots">${sl.map((_, i) => `<button class="${i === bn ? 'on' : ''}" data-act="bn-go" data-i="${i}" aria-label="Ir para o banner ${i + 1}"></button>`).join('')}</div>
    </section>`;
  }

  function setBanner(i) {
    const els = $$('.lj-slide');
    if (!els.length) return;
    bn = (i + els.length) % els.length;
    els.forEach((el, k) => {
      el.classList.toggle('on', k === bn);
      if (k === bn) el.removeAttribute('aria-hidden');
      else el.setAttribute('aria-hidden', 'true');
      const b = $('button', el);
      if (b) b.tabIndex = k === bn ? 0 : -1;
    });
    $$('.lj-bn-dots button').forEach((d, k) => d.classList.toggle('on', k === bn));
  }

  const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  setInterval(() => {
    if (bnPaused || reduceMotion() || document.hidden || !$('.lj-banner') || (modal() && modal().open)) return;
    setBanner(bn + 1);
  }, 6000);

  function viewCatalog() {
    if (!online) {
      return `<div class="card empty" style="margin-top:24px"><p><b>A loja ainda não está conectada ao banco de dados.</b></p><p class="muted">Preencha o arquivo js/config.js (veja o README).</p></div>`;
    }
    if (catalog === null) return `<div class="loading" style="margin-top:40px"><span class="spinner"></span> Carregando catálogo…</div>`;
    const cats = [...new Set(catalog.map((p) => p.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const count = (c) => catalog.filter((p) => !c || p.category === c).length;
    const li = (id, label) => `<li><button class="${cat === id ? 'on' : ''}" data-act="cat" data-id="${esc(id)}"><span>${esc(label)}</span><em>${count(id)}</em></button></li>`;
    const showBanner = !cat && !q.trim() && !onlyReady;
    return `
      ${showBanner ? bannerHtml() : ''}
      ${catErr ? `<div class="banner bad">${esc(catErr)}</div>` : ''}
      <div class="lj-layout" id="lj-products">
        <aside class="lj-filters" aria-label="Filtros">
          <h2>Categorias</h2>
          <ul>${li('', 'Todos os produtos')}${cats.map((c) => li(c, c)).join('')}</ul>
          <h2>Disponibilidade</h2>
          <label class="lj-check"><input type="checkbox" id="lj-ready" ${onlyReady ? 'checked' : ''} /> Só pronta entrega</label>
        </aside>
        <section>
          <div class="lj-result">
            <h2 id="lj-count">${countText()}</h2>
            <label>Ordenar por
              <select id="lj-sort"><option value="nome" ${sortBy === 'nome' ? 'selected' : ''}>Nome (A–Z)</option><option value="menor" ${sortBy === 'menor' ? 'selected' : ''}>Menor preço</option><option value="maior" ${sortBy === 'maior' ? 'selected' : ''}>Maior preço</option></select>
            </label>
          </div>
          <div class="lj-grid" id="lj-grid">${gridHtml()}</div>
        </section>
      </div>`;
  }

  // redesenha a página inteira só quando o banner entra ou sai; senão, só a lista
  function syncCatalog() {
    const want = !cat && !q.trim() && !onlyReady;
    if (!!$('.lj-banner') !== want) $('#lj-main').innerHTML = viewCatalog();
    else refreshGrid();
  }

  function refreshGrid() {
    const g = $('#lj-grid');
    if (g) g.innerHTML = gridHtml();
    const c = $('#lj-count');
    if (c) c.innerHTML = countText();
  }

  function showDetail(id) {
    const p = byId(id);
    if (!p) return;
    const photos = p.photos;
    openDlg(
      `<form method="dialog" class="lj-detail-wrap" style="padding:22px">
        <div class="lj-detail">
          <div class="lj-gallery">
            <div class="big" id="lj-big">${photos[0] ? `<img src="${esc(photos[0])}" alt="${esc(p.name)}" />` : `<span class="ph">${icons.image}</span>`}</div>
            ${photos.length > 1 ? `<div class="lj-thumbs">${photos.map((u, i) => `<button type="button" class="${i === 0 ? 'on' : ''}" data-act="thumb" data-src="${esc(u)}" aria-label="Foto ${i + 1}"><img src="${esc(u)}" alt="" /></button>`).join('')}</div>` : ''}
          </div>
          <div>
            <p class="muted" style="margin:0">${esc(p.category || '')}${p.code ? ' · ' + esc(p.code) : ''}</p>
            <h2 style="font-size:1.4rem">${esc(p.name)}</h2>
            ${p.in_stock ? '<p><span class="pill ok">Pronta entrega</span></p>' : '<p><span class="pill info">Sob encomenda</span></p>'}
            ${p.blurb ? `<p>${esc(p.blurb)}</p>` : ''}
            ${priceHtml(p)}
            <div class="qty" style="margin:12px 0"><button type="button" data-act="dq" data-d="-1" aria-label="Menos">−</button><input id="dq" type="number" min="1" max="9999" value="1" aria-label="Quantidade" /><button type="button" data-act="dq" data-d="1" aria-label="Mais">+</button></div>
            <div class="modal-actions" style="justify-content:flex-start">
              <button type="button" class="btn primary" data-act="add-detail" data-id="${esc(p.id)}">Adicionar à solicitação</button>
              <button type="button" class="btn ghost" data-act="close">Fechar</button>
            </div>
          </div>
        </div>
      </form>`,
      'wide'
    );
  }

  // ---------------- solicitação (carrinho) ----------------
  function addToCart(id, qty) {
    const n = Math.max(1, Math.min(9999, Math.floor(Number(qty) || 1)));
    cart[id] = Math.min(9999, (cart[id] || 0) + n);
    cartChanged();
    toast('Adicionado à solicitação.');
  }

  // ---------------- carrinho (aba lateral) e finalização ----------------
  const drawerEl = () => $('#drawer');
  const cartIds = () => Object.keys(cart).filter((id) => byId(id));
  const cartTotals = () => {
    let sum = 0;
    let priced = 0;
    let ask = 0;
    cartIds().forEach((id) => {
      const p = byId(id);
      if (p.price === null) ask += 1;
      else {
        sum += p.price * cart[id];
        priced += 1;
      }
    });
    return { sum, priced, ask };
  };
  const stepper = (id, rm) => `<div class="lj-stepper" role="group" aria-label="Quantidade"><button type="button" data-act="cq" data-id="${esc(id)}" data-d="-1" ${rm ? 'data-rm="1"' : ''} aria-label="Diminuir">−</button><input type="number" min="1" max="9999" value="${esc(cart[id])}" data-cqin="${esc(id)}" aria-label="Quantidade" /><button type="button" data-act="cq" data-id="${esc(id)}" data-d="1" aria-label="Aumentar">+</button></div>`;
  const totalsHtml = () => {
    const t = cartTotals();
    const sub = t.priced ? esc(brl(t.sum)) : 'A confirmar';
    return `<div class="lj-sumrow"><span>Subtotal</span><b>${sub}</b></div>${t.priced && t.ask ? `<p class="lj-sumnote">+ ${t.ask} produto${t.ask > 1 ? 's' : ''} sob consulta, cotado${t.ask > 1 ? 's' : ''} na proposta.</p>` : ''}`;
  };

  function drawerHtml() {
    const ids = cartIds();
    const rows = ids
      .map((id) => {
        const p = byId(id);
        const img = p.photos[0];
        return `<div class="dr-item">
          <span class="dr-thumb">${img ? `<img src="${esc(img)}" alt="" />` : icons.image}</span>
          <div class="dr-info"><b>${esc(p.name)}</b><small>${esc(p.code ? 'Cód. ' + p.code : p.category || '')}</small>
            <div class="dr-line"><span class="dr-price ${p.price === null ? 'ask' : ''}">${p.price === null ? 'Sob consulta' : esc(brl(p.price))}</span>${stepper(id)}</div></div>
          <button type="button" class="dr-rm" data-act="crm" data-id="${esc(id)}" aria-label="Remover ${esc(p.name)}">${icons.trash}</button>
        </div>`;
      })
      .join('');
    return `<div class="dr">
      <header><h2>Minha solicitação${ids.length ? ` <span>(${ids.length})</span>` : ''}</h2><button type="button" class="dr-x" data-act="drawer-close" aria-label="Fechar">${icons.x}</button></header>
      ${ids.length ? '<p class="dr-tip">Isto é uma <b>solicitação</b>, não uma compra: preço, prazo e frete são confirmados pela nossa equipe.</p>' : ''}
      <div class="dr-body">${ids.length ? rows : `<div class="dr-empty">${icons.cart}<b>Sua solicitação está vazia</b><p>Escolha produtos no catálogo para começar.</p></div>`}</div>
      <footer>
        ${ids.length ? `<div id="dr-sum">${totalsHtml()}</div><button type="button" class="au-btn" data-act="finalizar">Finalizar solicitação</button>` : ''}
        <button type="button" class="dr-cont" data-act="drawer-close">${ids.length ? 'Continuar comprando' : 'Ver produtos'}</button>
      </footer>
    </div>`;
  }

  function showCart() {
    const d = drawerEl();
    d.innerHTML = drawerHtml();
    if (!d.open) d.showModal();
  }

  // atualiza tudo que mostra o carrinho (cards, selo, aba lateral e página de finalização)
  function cartChanged() {
    saveCart();
    renderTop();
    refreshGrid();
    const d = drawerEl();
    if (d && d.open) {
      const keep = d.querySelector('.dr-body');
      const top = keep ? keep.scrollTop : 0;
      d.innerHTML = drawerHtml();
      const nb = d.querySelector('.dr-body');
      if (nb) nb.scrollTop = top;
    }
    if (location.hash.startsWith('#/finalizar')) {
      if (!cartIds().length) {
        location.hash = '#/';
        return;
      }
      updateCheckout();
    }
  }

  // ----- página de finalização -----
  let chk = { mode: 'entrega', cep: '', addr: null, msg: '', addrId: null };
  let addrs = null; // endereços salvos do cliente (null = ainda não carregou)
  let recoverMode = false; // entrou pelo link de "esqueci a senha": não precisa da senha atual
  const addrFull = (a) => `${a.street}, ${a.number}${a.complement ? ' - ' + a.complement : ''}${a.district ? ', ' + a.district : ''}, ${a.city}/${a.uf} · CEP ${V.maskCEP(a.cep)}`;
  const selAddr = () => (addrs || []).find((a) => a.id === chk.addrId) || (addrs || []).find((a) => a.is_default) || (addrs || [])[0] || null;
  async function loadAddrs() {
    try {
      addrs = (await rpc('my_addresses', {}, true)) || [];
    } catch (e) {
      addrs = [];
    }
    return addrs;
  }

  const addrLine = (a) => [a.street, a.district, a.city && a.uf ? `${a.city}/${a.uf}` : a.city].filter(Boolean).join(' · ');

  function chkRowsHtml() {
    return `<div class="chk-table"><div class="chk-head"><span>Produto</span><span>Preço</span><span>Quantidade</span><span>Total</span><span></span></div>${cartIds()
      .map((id) => {
        const p = byId(id);
        const img = p.photos[0];
        return `<div class="chk-row">
          <div class="chk-prod"><span class="dr-thumb">${img ? `<img src="${esc(img)}" alt="" />` : icons.image}</span><div><b>${esc(p.name)}</b><small>${esc(p.code ? 'Cód. ' + p.code : p.category || '')}</small></div></div>
          <div class="chk-price" data-l="Preço">${p.price === null ? '<span class="ask">Sob consulta</span>' : esc(brl(p.price))}</div>
          <div data-l="Quantidade">${stepper(id)}</div>
          <div class="chk-price" data-l="Total">${p.price === null ? '–' : esc(brl(p.price * cart[id]))}</div>
          <button type="button" class="dr-rm" data-act="crm" data-id="${esc(id)}" aria-label="Remover ${esc(p.name)}">${icons.trash}</button>
        </div>`;
      })
      .join('')}</div>`;
  }

  function chkDeliveryHtml() {
    const tab = (m, label) => `<button type="button" class="${chk.mode === m ? 'on' : ''}" data-act="ship" data-v="${m}">${label}${chk.mode === m ? ' ✓' : ''}</button>`;
    let body;
    if (chk.mode === 'retirada') {
      body = `<div class="chk-result ok">${icons.store}<div><b>Retirada na empresa</b><p>${esc(CO.address || 'Endereço da empresa')}</p><p class="muted">Combinamos o dia e o horário pelo telefone ou e-mail.</p></div></div>`;
    } else if (session && me && me.registered) {
      if (addrs === null) body = '<p class="hint"><span class="spinner"></span> Carregando seus endereços…</p>';
      else if (!addrs.length) body = `<div class="chk-result">${icons.truck}<div><b>Você ainda não tem endereço de entrega</b><p class="muted">Cadastre um endereço para continuar.</p><p><button type="button" class="btn primary" data-act="addr-new">Adicionar endereço</button></p></div></div>`;
      else {
        const sel = selAddr();
        body = `<div class="chk-addrs" role="radiogroup" aria-label="Endereço de entrega">${addrs
          .map(
            (a) => `<label class="chk-addr ${sel && sel.id === a.id ? 'on' : ''}"><input type="radio" name="addr" value="${esc(a.id)}" ${sel && sel.id === a.id ? 'checked' : ''} />
              <span><b>${esc(a.label || 'Endereço')}</b>${a.is_default ? ' <em class="pill info">Principal</em>' : ''}<small>${esc(addrFull(a))}</small></span></label>`
          )
          .join('')}</div>
          <p><button type="button" class="btn" data-act="addr-new">${icons.plus} Adicionar outro endereço</button></p>
          <p class="muted" style="font-size:.86rem">O valor do frete e o prazo são informados pela nossa equipe na proposta, antes de você fechar o pedido.</p>`;
      }
    } else {
      body = `<div class="chk-cep"><label>CEP de entrega<input id="chk-cep" inputmode="numeric" maxlength="9" placeholder="00000-000" value="${esc(chk.cep)}" autocomplete="postal-code" /></label><button type="button" class="btn" data-act="calc">Calcular</button></div>
        <p class="hint"><a href="https://buscacepinter.correios.com.br/app/endereco/index.php" target="_blank" rel="noopener">Não sei meu CEP</a></p>
        <div id="chk-res">${chkResultHtml()}</div>`;
    }
    return `<div class="chk-seg">${tab('entrega', 'Entrega')}${tab('retirada', 'Retirada')}</div>${body}`;
  }

  function chkResultHtml() {
    if (chk.msg) return `<p class="form-error" role="alert">${esc(chk.msg)}</p>`;
    if (!chk.addr) return '';
    return `<div class="chk-result ok">${icons.truck}<div><b>Entregamos em ${esc(chk.addr.city || 'sua região')}${chk.addr.uf ? '/' + esc(chk.addr.uf) : ''}</b><p>${esc(addrLine(chk.addr) || 'CEP ' + chk.cep)} · CEP ${esc(chk.cep)}</p><p class="muted">O valor do frete e o prazo são informados pela nossa equipe na proposta, antes de você fechar o pedido.</p></div></div>`;
  }

  function chkSummaryHtml() {
    return `${totalsHtml()}
      <div class="lj-sumrow"><span>Frete</span><b>${chk.mode === 'retirada' ? 'Sem frete' : 'A combinar'}</b></div>
      <div class="lj-sumrow total"><span>Total estimado</span><b>${cartTotals().priced ? esc(brl(cartTotals().sum)) : 'A confirmar'}</b></div>
      <p class="lj-sumnote">Valores finais confirmados na proposta.</p>`;
  }

  function updateCheckout() {
    const r = $('#chk-rows');
    if (r) r.innerHTML = chkRowsHtml();
    const m = $('#chk-sum');
    if (m) m.innerHTML = chkSummaryHtml();
    const n = $('#chk-count');
    if (n) n.textContent = `${cartIds().length} produto${cartIds().length === 1 ? '' : 's'}`;
  }

  function viewCheckout() {
    const ids = cartIds();
    if (!ids.length) return `<div class="card empty" style="margin-top:24px"><p><b>Sua solicitação está vazia.</b></p><p><button class="btn primary" data-act="home">Ver produtos</button></p></div>`;
    const logged = !!(session && me && me.registered);
    const done = (n) => (n === 1 ? true : n === 2 ? logged : n === 3 ? chk.mode === 'retirada' || (logged ? !!selAddr() : !!chk.addr) : false);
    const step = (n, l) => `<li class="${done(n) ? 'done' : ''}"><b>${done(n) ? '✓' : n}</b><span>${l}</span></li>`;
    const dataBlock = logged
      ? `<div class="chk-data"><div><b>${esc(me.name)}</b><span>${labelDoc(me.kind)} ${esc(V.fmtDoc(me.kind, me.doc))}</span></div><div><span>${esc(me.email)}</span><span>${esc(V.maskPhone(me.phone || ''))}</span></div><p class="hint">Quer corrigir algum dado? <a href="#/conta" data-act="account">Minha conta &rarr; Meus dados</a></p></div>`
      : `<div class="chk-result">${icons.user}<div><b>Entre ou crie sua conta para enviar</b><p class="muted">Seus produtos continuam salvos. O cadastro leva cerca de 2 minutos.</p><p><button type="button" class="btn primary" data-act="chk-login">Entrar ou cadastrar</button></p></div></div>`;
    return `
      <nav class="lj-crumb" aria-label="Você está aqui"><a href="#/" data-act="home">Início</a> ${icons.chevron} <span>Finalizar solicitação</span></nav>
      <div class="chk-top"><h1>Finalizar solicitação</h1><span class="chk-safe">${icons.shield} Seus dados protegidos (LGPD)</span></div>
      <ol class="chk-steps" aria-label="Etapas">${step(1, 'Carrinho')}${step(2, 'Dados pessoais')}${step(3, 'Entrega')}<li class="cur"><b>4</b><span>Confirmação</span></li></ol>
      <form id="f-cart" class="chk" novalidate>
        <div class="chk-main">
          <section class="chk-card"><h2>Produtos <small id="chk-count">${ids.length} produto${ids.length === 1 ? '' : 's'}</small></h2><div id="chk-rows">${chkRowsHtml()}</div></section>
          <section class="chk-card"><h2>Seus dados</h2>${dataBlock}</section>
          <section class="chk-card"><h2>Frete e entrega</h2><div id="chk-del">${chkDeliveryHtml()}</div></section>
          <section class="chk-card"><h2>Observação <small>(opcional)</small></h2><textarea name="note" rows="3" maxlength="300" placeholder="Ex.: prazo desejado, cor, dúvidas">${esc(cartNote)}</textarea></section>
        </div>
        <aside class="chk-side">
          <div class="chk-card sticky"><h2>Resumo</h2><div id="chk-sum">${chkSummaryHtml()}</div>
            <p class="form-error" id="f-err" role="alert" hidden></p>
            <button type="submit" class="au-btn">Enviar solicitação</button>
            <button type="button" class="dr-cont" data-act="home">Continuar comprando</button>
            <p class="lj-note" style="margin:12px 0 0">Isto é uma <b>solicitação</b>, não uma compra. A empresa entra em contato para confirmar preço, prazo e pagamento.</p>
          </div>
        </aside>
      </form>`;
  }

  async function doCalc() {
    const cep = V.digits(($('#chk-cep') || {}).value || '');
    chk.msg = '';
    if (cep.length !== 8) {
      chk.msg = 'Digite um CEP com 8 números.';
      chk.addr = null;
    } else {
      chk.cep = V.maskCEP(cep);
      const res = $('#chk-res');
      if (res) res.innerHTML = '<p class="hint">Buscando endereço…</p>';
      const r = await lookupCep(cep);
      if (r.found) chk.addr = r.found;
      else {
        chk.addr = null;
        chk.msg = r.failed ? 'Não consegui consultar o CEP agora. Tente de novo em instantes.' : 'CEP não encontrado. Confira os números.';
      }
    }
    const d = $('#chk-del');
    if (d) d.innerHTML = chkDeliveryHtml();
  }

  const deliveryNote = () => {
    if (chk.mode === 'retirada') return 'RETIRADA NA EMPRESA';
    const sa = session && me && me.registered ? selAddr() : null;
    if (sa) return `ENTREGA em ${addrFull(sa)}`;
    const a = chk.addr;
    return `ENTREGA${a ? ' em ' + addrLine(a) : ''}${chk.cep ? ' · CEP ' + chk.cep : ''}`;
  };

  async function sendRequest(form) {
    cartNote = String(form.note.value || '');
    const items = cartIds().map((id) => ({ product_id: id, qty: cart[id] }));
    if (!items.length) return showErr('Escolha pelo menos um produto.');
    if (!session) {
      openAuth('entrar', 'Entre ou crie uma conta para enviar a solicitação. Seus produtos continuam salvos.');
      return;
    }
    const btn = $('button[type=submit]', form);
    busy(btn, true);
    try {
      if (!me) await loadMe();
      if (me.staff) throw new Error('Esta é uma conta da equipe. Para pedir como cliente, crie uma conta de cliente com outro e-mail.');
      if (!me.registered) {
        busy(btn, false);
        return openComplete('Falta completar o seu cadastro para enviar a solicitação.');
      }
      if (chk.mode === 'entrega' && !selAddr()) {
        busy(btn, false);
        return showErr('Escolha ou cadastre um endereço de entrega (ou use Retirada).');
      }
      if (me.needs_terms) {
        busy(btn, false);
        return openTerms();
      }
      const note = (deliveryNote() + (cartNote.trim() ? ' | ' + cartNote.trim() : '')).slice(0, 500);
      await rpc('create_request', { p_items: items, p_note: note }, true);
      cart = {};
      cartNote = '';
      chk = { mode: 'entrega', cep: '', addr: null, msg: '', addrId: null };
      saveCart();
      renderTop();
      myReqs = null;
      location.hash = '#/';
      openDlg(`<form method="dialog" style="padding:26px;text-align:center">
        <div class="hoje-ico" style="margin:0 auto 10px">${icons.check}</div>
        <h2>Solicitação enviada!</h2>
        <p class="muted">Recebemos o seu pedido e vamos entrar em contato pelo telefone ou e-mail cadastrado. Você acompanha o andamento em <b>Minha conta</b>.</p>
        <div class="modal-actions" style="justify-content:center"><button type="button" class="btn" data-act="close">Fechar</button><button type="button" class="btn primary" data-act="go-account">Ver minhas solicitações</button></div>
      </form>`);
    } catch (e) {
      showErr(e.message);
    } finally {
      busy(btn, false);
    }
  }

  // ---------------- formulários de cadastro ----------------
  const labelDoc = (k) => (k === 'pj' ? 'CNPJ' : 'CPF');
  const labelName = (k) => (k === 'pj' ? 'Razão social' : 'Nome completo');

  function fieldsHtml(kind, v, docLocked) {
    v = v || {};
    return `
      <div class="form-grid">
        <label class="s6">${labelName(kind)}<input name="name" type="text" maxlength="120" autocomplete="${kind === 'pj' ? 'organization' : 'name'}" value="${esc(v.name || '')}" required /></label>
        <label class="s3">${labelDoc(kind)}<input name="doc" type="text" inputmode="${kind === 'pj' ? 'text' : 'numeric'}" maxlength="18" autocomplete="off" value="${esc(v.doc ? V.fmtDoc(kind, v.doc) : '')}" ${docLocked ? 'readonly' : ''} required /><span class="hint" id="doc-hint"></span></label>
        <label class="s3">Telefone / WhatsApp<input name="phone" type="tel" inputmode="tel" maxlength="16" autocomplete="tel-national" placeholder="(85) 99999-9999" value="${esc(v.phone ? V.maskPhone(v.phone) : '')}" required /></label>
        <label class="s2">CEP<input name="cep" type="text" inputmode="numeric" maxlength="9" autocomplete="postal-code" placeholder="00000-000" value="${esc(v.cep ? V.maskCEP(v.cep) : '')}" required /><span class="hint" id="cep-hint"></span></label>
        <label class="s4">Rua<input name="street" type="text" maxlength="120" autocomplete="address-line1" value="${esc(v.street || '')}" required /></label>
        <label class="s2">Número<input name="number" type="text" maxlength="10" value="${esc(v.number || '')}" placeholder="S/N" required /></label>
        <label class="s4">Complemento (opcional)<input name="complement" type="text" maxlength="60" value="${esc(v.complement || '')}" /></label>
        <label class="s3">Bairro<input name="district" type="text" maxlength="80" value="${esc(v.district || '')}" /></label>
        <label class="s3">Cidade<input name="city" type="text" maxlength="80" autocomplete="address-level2" value="${esc(v.city || '')}" required /></label>
        <label class="s2">UF<select name="uf" required><option value="">UF</option>${UFS.map((u) => `<option ${v.uf === u ? 'selected' : ''}>${u}</option>`).join('')}</select></label>
      </div>`;
  }

  function readCad(form, kind) {
    const g = (n) => String((form[n] && form[n].value) || '').trim();
    return { kind, doc: V.cleanDoc(kind, g('doc')), name: g('name'), phone: V.digits(g('phone')), cep: V.digits(g('cep')), street: g('street'), number: g('number'), complement: g('complement'), district: g('district'), city: g('city'), uf: g('uf').toUpperCase() };
  }

  function validateCad(c, checkDoc) {
    if (c.name.length < 2) return `Informe ${c.kind === 'pj' ? 'a razão social' : 'o nome completo'}.`;
    if (checkDoc && !V.validDoc(c.kind, c.doc)) return `${labelDoc(c.kind)} inválido. Confira os números.`;
    if (!V.validPhone(c.phone)) return 'Informe o telefone com DDD.';
    if (c.cep.length !== 8) return 'Informe o CEP com 8 números.';
    if (c.street.length < 2) return 'Informe a rua.';
    if (!c.number) return 'Informe o número (ou S/N).';
    if (c.city.length < 2) return 'Informe a cidade.';
    if (!UFS.includes(c.uf)) return 'Escolha o estado (UF).';
    return '';
  }

  // máscaras e busca de CEP
  async function lookupCep(cep) {
    const tries = [
      async () => {
        const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
        if (!r.ok) throw new Error('x');
        const j = await r.json();
        if (j.erro) return null;
        return { street: j.logradouro, district: j.bairro, city: j.localidade, uf: j.uf };
      },
      async () => {
        const r = await fetch(`https://brasilapi.com.br/api/cep/v1/${cep}`);
        if (r.status === 404) return null;
        if (!r.ok) throw new Error('x');
        const j = await r.json();
        return { street: j.street, district: j.neighborhood, city: j.city, uf: j.state };
      },
    ];
    for (const t of tries) {
      try {
        return { found: await t() };
      } catch (e) {
        /* tenta o próximo serviço */
      }
    }
    return { failed: true };
  }

  async function onCepInput(input) {
    input.value = V.maskCEP(input.value);
    const cep = V.digits(input.value);
    const hint = $('#cep-hint', input.closest('form'));
    if (cep.length !== 8) {
      if (hint) hint.textContent = '';
      lastCep = '';
      return;
    }
    if (cep === lastCep) return;
    lastCep = cep;
    if (hint) hint.textContent = 'Buscando endereço…';
    const r = await lookupCep(cep);
    if (lastCep !== cep) return; // o CEP mudou enquanto buscava
    const form = input.closest('form');
    if (r.found) {
      const set = (n, v) => {
        if (form[n] && v) form[n].value = v;
      };
      set('street', r.found.street);
      set('district', r.found.district);
      set('city', r.found.city);
      set('uf', r.found.uf);
      if (hint) hint.textContent = 'Endereço preenchido. Confira e informe o número.';
      if (form.number && !form.number.value) form.number.focus();
    } else if (hint) {
      hint.textContent = r.failed ? 'Não consegui buscar o CEP agora. Preencha o endereço à mão.' : 'CEP não encontrado. Preencha o endereço à mão.';
    }
  }

  function onDocInput(input, kind) {
    input.value = V.maskDoc(kind, input.value);
    const hint = $('#doc-hint', input.closest('form'));
    if (!hint) return;
    const len = V.cleanDoc(kind, input.value).length;
    const full = kind === 'pj' ? 14 : 11;
    if (len < full) hint.textContent = '';
    else if (V.validDoc(kind, input.value)) {
      hint.textContent = 'Número válido';
      hint.className = 'hint fld-ok';
    } else {
      hint.textContent = `${labelDoc(kind)} inválido`;
      hint.className = 'hint fld-bad';
    }
  }

  // ---------------- entrar / criar conta ----------------
  let authKind = 'pf';
  let turnstileId = null;

  function loadTurnstile() {
    if (!cfg.turnstileSiteKey) return Promise.resolve(false);
    if (root.turnstile) return Promise.resolve(true);
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
  }
  async function mountCaptcha() {
    const box = $('#ts-box');
    if (!box || !cfg.turnstileSiteKey) return;
    if (!(await loadTurnstile()) || !root.turnstile) return;
    turnstileId = root.turnstile.render(box, { sitekey: cfg.turnstileSiteKey });
  }
  const captchaToken = () => (turnstileId !== null && root.turnstile ? root.turnstile.getResponse(turnstileId) : '');

  // moldura das janelas de entrar / criar conta (estilo de painel profissional)
  const authLogo = `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3C16 3 6 14.2 6 20.5a10 10 0 0 0 20 0C26 14.2 16 3 16 3z" fill="currentColor"/><path d="M11.5 20.8a4.6 4.6 0 0 0 4.2 4.4" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>`;
  const pwField = (name, auto, extra) => `<span class="au-field">${icons.lock}<input name="${name}" type="password" autocomplete="${auto}" placeholder="${name === 'password2' ? 'Repita a senha' : 'Digite sua senha'}" ${extra || ''} required /><button type="button" class="au-eye" data-act="toggle-pass" aria-label="Mostrar ou ocultar a senha">${icons.eye}</button></span>`;
  const PW_RULES = [
    ['len', 'Pelo menos 10 caracteres', (p) => p.length >= 10],
    ['let', 'Pelo menos uma letra', (p) => /[A-Za-z]/.test(p)],
    ['num', 'Pelo menos um número', (p) => /\d/.test(p)],
    ['mail', 'Diferente do seu e-mail', (p, mail) => !mail || p.toLowerCase() !== mail.toLowerCase()],
  ];
  const pwRulesHtml = (withMail) =>
    `<ul class="pw-rules" id="pw-rules" aria-live="polite"><li class="pw-title">Sua senha precisa ter:</li>${PW_RULES.filter((r) => withMail || r[0] !== 'mail')
      .map((r) => `<li data-r="${r[0]}"><span class="pw-dot" aria-hidden="true"></span>${r[1]}</li>`)
      .join('')}</ul>`;
  function updatePwUi(form) {
    const pwEl = form.password || form.p1;
    const pw2 = form.password2 || form.p2;
    const box = $('#pw-rules', form);
    if (box && pwEl) {
      const mail = form.email ? String(form.email.value || '').trim() : '';
      PW_RULES.forEach((r) => {
        const li = $(`[data-r="${r[0]}"]`, box);
        if (li) li.classList.toggle('ok', !!pwEl.value && r[2](pwEl.value, mail));
      });
    }
    const m = $('#pw-match', form);
    if (m && pwEl && pw2) {
      if (!pw2.value) m.textContent = '';
      else if (pw2.value === pwEl.value) {
        m.textContent = 'As senhas são iguais.';
        m.className = 'hint pw-match fld-ok';
      } else {
        m.textContent = 'As senhas ainda não são iguais.';
        m.className = 'hint pw-match fld-bad';
      }
    }
  }
  function authShell(mode, title, sub, inner, foot) {
    const seg = `<div class="au-seg" role="tablist" aria-label="Entrar ou criar conta">
      <button type="button" role="tab" aria-selected="${mode === 'entrar'}" class="${mode === 'entrar' ? 'on' : ''}" data-act="auth-mode" data-m="entrar">${icons.logout} Entrar</button>
      <button type="button" role="tab" aria-selected="${mode === 'criar' || mode === 'criar2'}" class="${mode === 'criar' || mode === 'criar2' ? 'on' : ''}" data-act="auth-mode" data-m="criar">${icons.plus} Criar conta</button></div>`;
    return `<div class="au">
      <button type="button" class="au-x" data-act="close" aria-label="Fechar">${icons.x}</button>
      <div class="au-head"><span class="au-logo">${authLogo}</span><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div>
      ${seg}
      <div class="au-body">${inner}</div>
      <p class="au-safe">${icons.shield} Seus dados são protegidos conforme a LGPD.</p>
      ${foot ? `<div class="au-foot">${foot}</div>` : ''}
    </div>`;
  }

  function openAuth(mode, msg) {
    mode = mode || 'entrar';
    const note = msg ? `<p class="lj-note">${esc(msg)}</p>` : '';
    if (mode === 'entrar') {
      openDlg(
        authShell(
          mode,
          'Bem-vindo de volta',
          'Entre para acompanhar suas solicitações.',
          `<form id="f-login" novalidate>
          ${note}
          <label class="au-lbl">E-mail
            <span class="au-field">${icons.mail}<input name="email" type="email" autocomplete="username" inputmode="email" placeholder="Digite seu e-mail" required /></span>
          </label>
          <label class="au-lbl"><span class="au-row">Senha <button type="button" class="au-link" data-act="auth-mode" data-m="recuperar">Esqueci a senha</button></span>
            ${pwField('password', 'current-password')}
          </label>
          <p class="form-error" id="f-err" role="alert" hidden></p>
          <button type="submit" class="au-btn">Entrar</button>
        </form>`,
          `Ainda não tem conta? <button type="button" class="au-link strong" data-act="auth-mode" data-m="criar">Criar conta</button>`
        ),
        'auth'
      );
    } else if (mode === 'recuperar') {
      openDlg(
        authShell(
          'entrar',
          'Recuperar a senha',
          'Enviaremos um link para você criar uma senha nova.',
          `<form id="f-recover" novalidate>
          <label class="au-lbl">E-mail da sua conta
            <span class="au-field">${icons.mail}<input name="email" type="email" autocomplete="username" inputmode="email" placeholder="Digite seu e-mail" required /></span>
          </label>
          <p class="form-error" id="f-err" role="alert" hidden></p>
          <button type="submit" class="au-btn">Enviar o link</button>
        </form>`,
          `Lembrou a senha? <button type="button" class="au-link strong" data-act="auth-mode" data-m="entrar">Voltar para entrar</button>`
        ),
        'auth'
      );
    } else if (mode === 'criar') {
      openDlg(
        authShell(
          mode,
          'Criar sua conta',
          'Primeiro, conte-nos quem vai comprar.',
          `<p class="au-ask">O cadastro é de pessoa física ou de empresa?</p>
          <div class="lj-choose">
            <button type="button" data-act="kind" data-k="pf"><b>Pessoa física</b><small class="muted">Cadastro com CPF</small></button>
            <button type="button" data-act="kind" data-k="pj"><b>Empresa</b><small class="muted">Cadastro com CNPJ</small></button>
          </div>
          <p class="hint">Pedimos só o necessário para atender a sua solicitação e entregar. <a href="privacidade" target="_blank" rel="noopener">Como usamos seus dados</a>.</p>`,
          `Já tem conta? <button type="button" class="au-link strong" data-act="auth-mode" data-m="entrar">Entrar</button>`
        ),
        'auth'
      );
    } else {
      openDlg(
        authShell(
          'criar',
          `Conta ${authKind === 'pj' ? 'de empresa' : 'de pessoa física'}`,
          'Preencha os dados abaixo. Leva cerca de 2 minutos.',
          `<form id="f-signup" novalidate>
          <p class="au-sec">Acesso</p>
          <div class="form-grid">
            <label>E-mail<input name="email" type="email" autocomplete="email" inputmode="email" required /></label>
            <div class="s6 pw-box"><label class="au-lbl">Senha${pwField('password', 'new-password', 'minlength="10"')}</label>${pwRulesHtml(true)}</div>
            <div class="s6"><label class="au-lbl">Repita a senha${pwField('password2', 'new-password')}</label><span class="hint pw-match" id="pw-match"></span></div>
          </div>
          <p class="au-sec">${authKind === 'pj' ? 'Dados da empresa' : 'Seus dados'}</p>
          ${fieldsHtml(authKind, {}, false)}
          <div class="hp" aria-hidden="true"><label>Site<input name="site" type="text" tabindex="-1" autocomplete="off" /></label></div>
          <label class="check" style="margin-top:14px"><input type="checkbox" name="accept" required /><span>Li e concordo com os <a href="termos" target="_blank" rel="noopener">Termos de Uso</a> e com a <a href="privacidade" target="_blank" rel="noopener">Política de Privacidade</a>.</span></label>
          <div id="ts-box" style="margin-top:12px"></div>
          <p class="form-error" id="f-err" role="alert" hidden></p>
          <button type="submit" class="au-btn">Criar conta</button>
          <button type="button" class="au-link center" data-act="auth-mode" data-m="criar">Voltar</button>
        </form>`,
          `Já tem conta? <button type="button" class="au-link strong" data-act="auth-mode" data-m="entrar">Entrar</button>`
        ),
        'auth wide'
      );
      mountCaptcha();
    }
  }

  async function afterLogin() {
    await loadMe();
    if (me.staff) {
      await signOut(true);
      return openAuth('entrar', 'Esta conta é da equipe da empresa e não serve para pedidos. Use um e-mail de cliente.');
    }
    if (!me.registered) {
      try {
        const ok = await rpc('complete_registration', {}, true);
        if (ok) await loadMe();
      } catch (e) {
        /* abre o formulário abaixo */
      }
    }
    renderTop();
    closeDlg();
    if (!me.registered) return openComplete('Falta completar o seu cadastro.');
    if (me.needs_terms) return openTerms();
    toast(`Olá, ${firstName(me.name)}!`);
    if (location.hash.startsWith('#/conta') || location.hash.startsWith('#/finalizar')) route();
  }

  async function doLogin(form) {
    const btn = $('button[type=submit]', form);
    errBox().hidden = true;
    const email = form.email.value.trim();
    if (!email || !form.password.value) return showErr('Informe e-mail e senha.');
    busy(btn, true);
    try {
      const r = await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password: form.password.value } });
      saveSession(toSession(r));
      me = null;
      await afterLogin();
    } catch (e) {
      showErr(e.message);
    } finally {
      busy(btn, false);
    }
  }

  async function doSignup(form) {
    const btn = $('button[type=submit]', form);
    errBox().hidden = true;
    if (form.site.value) return closeDlg(); // robô preencheu o campo escondido
    const email = form.email.value.trim();
    const cad = readCad(form, authKind);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return showErr('Informe um e-mail válido.');
    if (form.password.value.length < 10) return showErr('A senha precisa ter pelo menos 10 caracteres.');
    if (!/[A-Za-z]/.test(form.password.value) || !/\d/.test(form.password.value)) return showErr('Use letras e números na senha.');
    if (form.password.value.toLowerCase() === email.toLowerCase()) return showErr('A senha não pode ser igual ao e-mail.');
    if (form.password.value !== form.password2.value) return showErr('As duas senhas não são iguais.');
    const bad = validateCad(cad, true);
    if (bad) return showErr(bad);
    if (!form.accept.checked) return showErr('Para criar a conta, aceite os Termos de Uso e a Política de Privacidade.');
    const token = captchaToken();
    if (cfg.turnstileSiteKey && !token) return showErr('Confirme a verificação de segurança antes de continuar.');
    busy(btn, true);
    try {
      const redirect = encodeURIComponent(location.origin + location.pathname);
      const body = { email, password: form.password.value, data: { name: cad.name, origem: 'loja', terms: CO.termsVersion, cad } };
      if (token) body.gotrue_meta_security = { captcha_token: token };
      const r = await call(`/auth/v1/signup?redirect_to=${redirect}`, { method: 'POST', body });
      if (r && r.access_token) {
        saveSession(toSession(r)); // projeto sem confirmação de e-mail: já entra
        me = null;
        await afterLogin();
        return;
      }
      openDlg(`<form method="dialog" style="padding:26px;text-align:center">
        <div class="hoje-ico" style="margin:0 auto 10px">${icons.mail}</div>
        <h2>Confirme o seu e-mail</h2>
        <p class="muted">Enviamos um link para <b>${esc(email)}</b>. Clique nele para ativar a conta e depois volte aqui para entrar. Se não aparecer, olhe a caixa de spam.</p>
        <div class="modal-actions" style="justify-content:center"><button type="button" class="btn primary" data-act="close">Entendi</button></div>
      </form>`);
    } catch (e) {
      showErr(e.message);
      if (turnstileId !== null && root.turnstile) root.turnstile.reset(turnstileId);
    } finally {
      busy(btn, false);
    }
  }

  async function doRecover(form) {
    const btn = $('button[type=submit]', form);
    errBox().hidden = true;
    const email = form.email.value.trim();
    if (!email) return showErr('Informe o e-mail da conta.');
    busy(btn, true);
    try {
      const redirect = encodeURIComponent(location.origin + location.pathname);
      await call(`/auth/v1/recover?redirect_to=${redirect}`, { method: 'POST', body: { email } });
      openDlg(`<form method="dialog" style="padding:26px;text-align:center"><h2>Pronto</h2>
        <p class="muted">Se existir uma conta com esse e-mail, enviamos o link para criar uma senha nova.</p>
        <div class="modal-actions" style="justify-content:center"><button type="button" class="btn primary" data-act="close">Fechar</button></div></form>`);
    } catch (e) {
      showErr(e.message);
    } finally {
      busy(btn, false);
    }
  }

  async function signOut(silent) {
    const token = session && session.access_token;
    saveSession(null);
    me = null;
    myReqs = null;
    addrs = null;
    recoverMode = false;
    if (token) {
      try {
        await fetch(`${base}/auth/v1/logout`, { method: 'POST', headers: { apikey: anon, Authorization: `Bearer ${token}` } });
      } catch (e) {
        /* sair daqui já basta */
      }
    }
    renderTop();
    if (!silent) {
      toast('Você saiu da conta.');
      if (location.hash.startsWith('#/conta')) location.hash = '#/';
      else route();
    }
  }

  // completar cadastro (conta criada sem os dados) e aceitar termos novos
  function openComplete(msg) {
    authKind = authKind || 'pf';
    openDlg(
      `<form id="f-complete" novalidate>
        <h2>Complete o seu cadastro</h2>
        ${msg ? `<p class="lj-note">${esc(msg)}</p>` : ''}
        <div class="lj-tabs"><button type="button" class="chip ${authKind === 'pf' ? 'on' : ''}" data-act="ckind" data-k="pf">Pessoa física</button><button type="button" class="chip ${authKind === 'pj' ? 'on' : ''}" data-act="ckind" data-k="pj">Empresa</button></div>
        ${fieldsHtml(authKind, {}, false)}
        <label class="check" style="margin-top:14px"><input type="checkbox" name="accept" required /><span>Li e concordo com os <a href="termos" target="_blank" rel="noopener">Termos de Uso</a> e com a <a href="privacidade" target="_blank" rel="noopener">Política de Privacidade</a>.</span></label>
        <p class="form-error" id="f-err" role="alert" hidden></p>
        <div class="modal-actions"><button type="button" class="btn ghost" data-act="close">Agora não</button><button type="submit" class="btn primary">Salvar cadastro</button></div>
      </form>`,
      'wide'
    );
  }

  async function doComplete(form) {
    const btn = $('button[type=submit]', form);
    errBox().hidden = true;
    const cad = readCad(form, authKind);
    const bad = validateCad(cad, true);
    if (bad) return showErr(bad);
    if (!form.accept.checked) return showErr('Aceite os Termos de Uso e a Política de Privacidade para continuar.');
    busy(btn, true);
    try {
      await rpc('register_customer', { p_data: cad, p_terms: CO.termsVersion }, true);
      await loadMe();
      renderTop();
      closeDlg();
      toast('Cadastro salvo.');
      route();
    } catch (e) {
      showErr(e.message);
    } finally {
      busy(btn, false);
    }
  }

  function openTerms() {
    openDlg(`<form id="f-terms" novalidate>
      <h2>Atualizamos os nossos termos</h2>
      <p class="muted">Para continuar, leia e aceite a versão atual dos <a href="termos" target="_blank" rel="noopener">Termos de Uso</a> e da <a href="privacidade" target="_blank" rel="noopener">Política de Privacidade</a>.</p>
      <label class="check"><input type="checkbox" name="accept" required /><span>Li e concordo.</span></label>
      <p class="form-error" id="f-err" role="alert" hidden></p>
      <div class="modal-actions"><button type="button" class="btn ghost" data-act="close">Agora não</button><button type="submit" class="btn primary">Aceitar</button></div>
    </form>`);
  }

  async function doTerms(form) {
    if (!form.accept.checked) return showErr('Marque a caixa para aceitar.');
    const btn = $('button[type=submit]', form);
    busy(btn, true);
    try {
      await rpc('accept_terms', { p_terms: CO.termsVersion }, true);
      await loadMe();
      closeDlg();
      toast('Obrigado! Aceite registrado.');
    } catch (e) {
      showErr(e.message);
    } finally {
      busy(btn, false);
    }
  }

  // ---------------- minha conta ----------------
  const REQ_ST = { nova: ['warn', 'Em análise'], aprovada: ['ok', 'Aprovada'], recusada: ['bad', 'Recusada'], cancelada: ['info', 'Cancelada'] };
  const dt = (v) => new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

  async function loadReqs() {
    try {
      myReqs = (await rpc('my_requests', {}, true)) || [];
    } catch (e) {
      myReqs = [];
      toast(e.message, 'error');
    }
  }

  function viewAccount() {
    if (!session || !me || !me.registered) return `<div class="loading" style="margin-top:40px"><span class="spinner"></span> Carregando…</div>`;
    const tab = (id, label) => `<button class="chip ${acTab === id ? 'on' : ''}" data-act="actab" data-id="${id}">${label}</button>`;
    let body = '';
    if (acTab === 'solicitacoes') {
      if (myReqs === null) body = `<div class="loading"><span class="spinner"></span> Carregando…</div>`;
      else if (!myReqs.length) body = `<div class="card empty"><p>Você ainda não enviou nenhuma solicitação.</p><p><a class="btn primary" href="#/">Ver o catálogo</a></p></div>`;
      else
        body = myReqs
          .map((r) => {
            const st = REQ_ST[r.status] || ['info', r.status];
            return `<article class="card lj-req ${esc(r.status)}">
              <header><b>Solicitação #${esc(r.num)}</b> <span class="muted">· ${esc(dt(r.created_at))}</span> <span class="pill ${st[0]}">${esc(st[1])}</span></header>
              <ul style="margin:6px 0;padding-left:20px">${(r.items || []).map((i) => `<li><b>${esc(i.qty)}×</b> ${esc(i.name)}</li>`).join('')}</ul>
              ${r.note ? `<p class="muted">“${esc(r.note)}”</p>` : ''}
              ${r.status === 'recusada' && r.reason ? `<p class="muted">Motivo: ${esc(r.reason)}</p>` : ''}
              ${r.status === 'aprovada' ? '<p class="lj-note">Aprovada! Nossa equipe vai falar com você para combinar pagamento e entrega.</p>' : ''}
              ${r.status === 'nova' ? `<div><button class="btn small danger" data-act="req-cancel" data-id="${esc(r.id)}">Cancelar solicitação</button></div>` : ''}
            </article>`;
          })
          .join('');
    } else if (acTab === 'dados') {
      const lock = (label, val) => `<label class="s3 locked">${label}<span class="lk-field"><input type="text" value="${esc(val)}" readonly tabindex="-1" aria-readonly="true" />${icons.lock}</span></label>`;
      body = `<form id="f-data" class="card" novalidate style="max-width:760px">
        <h3>Meus dados</h3>
        <p class="lk-note">${icons.lock}<span>Os campos em cinza são fixos por segurança. Para corrigir nome, documento ou e-mail, fale com a empresa.</span></p>
        <div class="form-grid" style="margin-top:12px">
          ${lock(labelName(me.kind), me.name)}
          ${lock(labelDoc(me.kind), V.fmtDoc(me.kind, me.doc))}
          ${lock('E-mail da conta', me.email)}
          <label class="s3">Telefone / WhatsApp<input name="phone" type="tel" inputmode="tel" maxlength="16" autocomplete="tel-national" placeholder="(85) 99999-9999" value="${esc(me.phone ? V.maskPhone(me.phone) : '')}" required /></label>
        </div>
        <p class="form-error" id="f-err" role="alert" hidden></p>
        <div class="modal-actions"><button type="submit" class="btn primary">Salvar telefone</button></div>
      </form>`;
    } else if (acTab === 'enderecos') {
      if (addrs === null) body = `<div class="loading"><span class="spinner"></span> Carregando…</div>`;
      else
        body = `<div class="card" style="max-width:760px">
          <div class="ad-head"><div><h3>Endereços de entrega</h3><p class="muted">Cadastre mais de um endereço (casa, obra, empresa) e escolha qual usar ao finalizar a solicitação.</p></div>
          <button class="btn primary" data-act="addr-new">${icons.plus} Novo endereço</button></div>
          ${
            addrs.length
              ? `<div class="ad-list">${addrs
                  .map(
                    (a) => `<article class="ad-card ${a.is_default ? 'main' : ''}">
                    <div><b>${esc(a.label || 'Endereço')}</b>${a.is_default ? ' <em class="pill ok">Principal</em>' : ''}<p>${esc(addrFull(a))}</p></div>
                    <div class="ad-act">${a.is_default ? '' : `<button class="btn small" data-act="addr-main" data-id="${esc(a.id)}">Tornar principal</button>`}
                      <button class="btn small" data-act="addr-edit" data-id="${esc(a.id)}">Editar</button>
                      <button class="btn small danger" data-act="addr-del" data-id="${esc(a.id)}">Excluir</button></div></article>`
                  )
                  .join('')}</div>`
              : '<p class="muted" style="margin-top:14px">Você ainda não cadastrou nenhum endereço.</p>'
          }</div>`;
    } else if (acTab === 'seguranca') {
      body = `<form id="f-pass" class="card" novalidate style="max-width:460px">
        <h3>Trocar a senha</h3>
        ${recoverMode ? '<p class="muted">Você entrou pelo link do e-mail. Crie a nova senha abaixo.</p>' : '<p class="muted">Por segurança, informe a senha atual antes de criar a nova.</p>'}
        <div class="form-grid" style="margin-top:10px">
          ${recoverMode ? '' : `<div class="s6"><label class="au-lbl">Senha atual${pwField('pold', 'current-password')}</label></div>`}
          <div class="s6 pw-box"><label class="au-lbl">Nova senha${pwField('p1', 'new-password', 'minlength="10"')}</label>${pwRulesHtml(false)}</div>
          <div class="s6"><label class="au-lbl">Repita a nova senha${pwField('p2', 'new-password')}</label><span class="hint pw-match" id="pw-match"></span></div>
        </div>
        <p class="form-error" id="f-err" role="alert" hidden></p>
        <div class="modal-actions"><button type="submit" class="btn primary">Trocar a senha</button></div>
      </form>`;
    } else {
      body = `<div class="card" style="display:grid;gap:12px">
        <h3>Privacidade e seus direitos (LGPD)</h3>
        <p class="muted">Você pode baixar uma cópia dos seus dados ou excluir a sua conta quando quiser. Veja também a <a href="privacidade" target="_blank" rel="noopener">Política de Privacidade</a>.</p>
        <div><button class="btn" data-act="export">Baixar meus dados (arquivo JSON)</button></div>
        <hr style="border:0;border-top:1px solid var(--line);width:100%" />
        <p class="muted"><b>Excluir a conta</b> apaga o seu cadastro, os aceites e as solicitações que não viraram pedido. Solicitações já aprovadas ficam guardadas só com o nome, pelo prazo exigido em lei (registro de vendas).</p>
        <div><button class="btn danger" data-act="delete-account">Excluir minha conta</button></div>
        ${CO.dpoEmail || CO.email ? `<p class="hint">Outras dúvidas sobre os seus dados: <a href="mailto:${esc(CO.dpoEmail || CO.email)}">${esc(CO.dpoEmail || CO.email)}</a></p>` : ''}
      </div>`;
    }
    return `
      <section class="lj-hero" style="padding:20px 24px">
        <h1 style="font-size:1.5rem">Olá, ${esc(firstName(me.name))}</h1>
        <p style="margin:0">${labelDoc(me.kind)} ${esc(V.fmtDoc(me.kind, me.doc))} · ${esc(me.email)}</p>
      </section>
      <div class="lj-bar"><div class="chips">${tab('solicitacoes', 'Minhas solicitações')}${tab('dados', 'Meus dados')}${tab('enderecos', 'Endereços')}${tab('seguranca', 'Senha')}${tab('privacidade', 'Privacidade')}</div>
        <button class="btn" data-act="logout">Sair</button></div>
      <div class="lj-acc">${body}</div>`;
  }

  // ---------------- rotas e eventos ----------------
  async function route() {
    const main = $('#lj-main');
    renderCatNav();
    const hash = location.hash || '#/';
    if (hash.startsWith('#/finalizar')) {
      if (catalog === null && online) {
        main.innerHTML = '<div class="loading" style="margin-top:40px"><span class="spinner"></span> Carregando…</div>';
        await loadCatalog();
        renderTop();
      }
      if (session && !me) {
        try {
          await loadMe();
        } catch (e) {
          me = null;
        }
      }
      if (me && me.staff) {
        await signOut(true);
      }
      if (!cartIds().length) {
        location.hash = '#/';
        return;
      }
      main.innerHTML = viewCheckout();
      document.title = 'Finalizar solicitação | M&B Metais';
      window.scrollTo({ top: 0 });
      if (session && me && me.registered && addrs === null) {
        await loadAddrs();
        if (location.hash.startsWith('#/finalizar')) main.innerHTML = viewCheckout();
      }
      return;
    }
    if (hash.startsWith('#/conta')) {
      if (!session) {
        main.innerHTML = viewCatalog();
        openAuth('entrar', 'Entre para ver a sua conta.');
        return;
      }
      if (!me) {
        main.innerHTML = viewAccount();
        try {
          await loadMe();
        } catch (e) {
          toast(e.message, 'error');
        }
      }
      if (me && me.staff) {
        await signOut(true);
        main.innerHTML = viewCatalog();
        return openAuth('entrar', 'Esta conta é da equipe e não serve para pedidos.');
      }
      if (me && !me.registered) {
        main.innerHTML = viewCatalog();
        return openComplete('Falta completar o seu cadastro.');
      }
      main.innerHTML = viewAccount();
      if (acTab === 'enderecos' && addrs === null) {
        await loadAddrs();
        if (location.hash.startsWith('#/conta')) main.innerHTML = viewAccount();
      }
      if (acTab === 'solicitacoes' && myReqs === null) {
        await loadReqs();
        if (location.hash.startsWith('#/conta')) main.innerHTML = viewAccount();
      }
    } else {
      if (catalog === null && online) {
        main.innerHTML = viewCatalog();
        await loadCatalog();
        renderTop();
      }
      main.innerHTML = viewCatalog();
    }
    document.title = hash.startsWith('#/conta') ? 'Minha conta | M&B Metais' : 'Catálogo | M&B Metais';
  }

  const A = {
    theme: () => {
      const dark = !isDark();
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      ls.set('mb:tema', dark ? 'escuro' : 'claro');
      renderTop();
    },
    cart: () => showCart(),
    account: async () => {
      if (!session) return openAuth('entrar');
      location.hash = '#/conta';
      route();
    },
    close: () => closeDlg(),
    'close-modal': () => closeDlg(),
    'go-account': () => {
      closeDlg();
      acTab = 'solicitacoes';
      myReqs = null;
      location.hash = '#/conta';
      route();
    },
    cat: (el) => {
      cat = el.dataset.id;
      if ((location.hash || '#/').startsWith('#/conta')) location.hash = '#/';
      else {
        $('#lj-main').innerHTML = viewCatalog();
        renderCatNav();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    },
    home: () => {
      cat = '';
      q = '';
      onlyReady = false;
      const i = $('#lj-q');
      if (i) i.value = '';
      if ((location.hash || '#/').startsWith('#/conta')) location.hash = '#/';
      else {
        $('#lj-main').innerHTML = viewCatalog();
        renderCatNav();
      }
      window.scrollTo({ top: 0 });
    },
    'bn-next': () => setBanner(bn + 1),
    'bn-prev': () => setBanner(bn - 1),
    'bn-go': (el) => setBanner(Number(el.dataset.i)),
    'bn-cta': (el) => {
      const a = el.dataset.a;
      if (a === 'signup') return openAuth('criar');
      if (a === 'ready') {
        onlyReady = true;
        $('#lj-main').innerHTML = viewCatalog();
        const p = $('#lj-products');
        if (p) p.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      A.browse();
    },
    browse: () => {
      const p = $('#lj-products');
      if (p) p.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    detail: (el) => showDetail(el.dataset.id),
    add: (el) => addToCart(el.dataset.id, 1),
    'add-detail': (el) => {
      addToCart(el.dataset.id, $('#dq').value);
      closeDlg();
    },
    thumb: (el) => {
      $('#lj-big').innerHTML = `<img src="${esc(el.dataset.src)}" alt="" />`;
      $$('.lj-thumbs button').forEach((b) => b.classList.toggle('on', b === el));
    },
    dq: (el) => {
      const i = $('#dq');
      i.value = Math.max(1, Math.min(9999, (Number(i.value) || 1) + Number(el.dataset.d)));
    },
    cq: (el) => {
      const id = el.dataset.id;
      const next = (cart[id] || 1) + Number(el.dataset.d);
      if (next < 1) {
        if (el.dataset.rm) delete cart[id];
        else cart[id] = 1;
      } else cart[id] = Math.min(9999, next);
      cartChanged();
    },
    crm: (el) => {
      delete cart[el.dataset.id];
      cartChanged();
    },
    'drawer-close': () => {
      const d = drawerEl();
      if (d && d.open) d.close();
    },
    finalizar: () => {
      const d = drawerEl();
      if (d && d.open) d.close();
      if (!cartIds().length) return toast('Escolha pelo menos um produto.');
      location.hash = '#/finalizar';
      window.scrollTo({ top: 0 });
    },
    ship: (el) => {
      chk.mode = el.dataset.v;
      const d = $('#chk-del');
      if (d) d.innerHTML = chkDeliveryHtml();
      const m = $('#chk-sum');
      if (m) m.innerHTML = chkSummaryHtml();
    },
    calc: () => doCalc(),
    'chk-login': () => openAuth('entrar', 'Entre ou crie uma conta para enviar a solicitação. Seus produtos continuam salvos.'),
    'auth-mode': (el) => openAuth(el.dataset.m),
    'toggle-pass': (el) => {
      const i = $('input', el.parentElement);
      if (i) i.type = i.type === 'password' ? 'text' : 'password';
    },
    kind: (el) => {
      authKind = el.dataset.k;
      lastCep = '';
      openAuth('criar2');
    },
    ckind: (el) => {
      authKind = el.dataset.k;
      lastCep = '';
      openComplete();
    },
    'addr-new': () => openAddr(null),
    'addr-edit': (el) => openAddr((addrs || []).find((a) => a.id === el.dataset.id)),
    'addr-main': async (el) => {
      try {
        await rpc('set_default_address', { p_id: el.dataset.id }, true);
        await loadAddrs();
        refreshAddrViews();
      } catch (e) {
        toast(e.message, 'error');
      }
    },
    'addr-del': async (el) => {
      if (!(await confirmBox('Excluir este endereço?', 'Excluir endereço', true))) return;
      try {
        await rpc('delete_my_address', { p_id: el.dataset.id }, true);
        chk.addrId = null;
        await loadAddrs();
        refreshAddrViews();
        toast('Endereço excluído.');
      } catch (e) {
        toast(e.message, 'error');
      }
    },
    actab: (el) => {
      acTab = el.dataset.id;
      route();
    },
    logout: () => signOut(false),
    'req-cancel': async (el) => {
      if (!(await confirmBox('Cancelar esta solicitação?', 'Cancelar solicitação', true))) return;
      try {
        await rpc('cancel_my_request', { p_id: el.dataset.id }, true);
        myReqs = null;
        toast('Solicitação cancelada.');
        route();
      } catch (e) {
        toast(e.message, 'error');
      }
    },
    export: async () => {
      try {
        const d = await rpc('export_my_data', {}, true);
        const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'meus-dados-mb-metais.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      } catch (e) {
        toast(e.message, 'error');
      }
    },
    'delete-account': () => {
      openDlg(`<form id="f-delete" novalidate>
        <h2>Excluir a conta</h2>
        <p>Isso apaga o seu cadastro e não pode ser desfeito. Para confirmar, digite <b>EXCLUIR</b>.</p>
        <input name="word" type="text" autocomplete="off" aria-label="Digite EXCLUIR" />
        <p class="form-error" id="f-err" role="alert" hidden></p>
        <div class="modal-actions"><button type="button" class="btn ghost" data-act="close">Cancelar</button><button type="submit" class="btn danger-solid">Excluir para sempre</button></div>
      </form>`);
    },
  };

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act], [data-action=close-modal]');
    if (!el) return;
    const name = el.dataset.act || el.dataset.action;
    if (A[name]) {
      e.preventDefault();
      A[name](el);
    }
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.cqin) {
      cartChanged();
      return;
    }
    if (t.id === 'lj-sort') {
      sortBy = t.value;
      refreshGrid();
    } else if (t.id === 'lj-ready') {
      onlyReady = t.checked;
      syncCatalog();
    }
  });

  document.addEventListener('submit', (e) => {
    const f = e.target;
    if (f.id === 'lj-searchform') {
      e.preventDefault();
      if ((location.hash || '#/').startsWith('#/conta')) location.hash = '#/';
      const p = $('#lj-products');
      if (p) p.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const h = { 'f-login': doLogin, 'f-signup': doSignup, 'f-recover': doRecover, 'f-complete': doComplete, 'f-terms': doTerms, 'f-cart': sendRequest, 'f-addr': saveAddr }[f.id];
    if (h) {
      e.preventDefault();
      h(f);
    } else if (f.id === 'f-data') {
      e.preventDefault();
      saveData(f);
    } else if (f.id === 'f-pass') {
      e.preventDefault();
      savePass(f);
    } else if (f.id === 'f-delete') {
      e.preventDefault();
      doDelete(f);
    }
  });

  // ---------------- endereços ----------------
  function openAddr(a) {
    a = a || {};
    lastCep = '';
    openDlg(`<form id="f-addr" novalidate data-id="${esc(a.id || '')}" style="padding:24px;max-width:640px">
      <h2 style="margin:0 0 4px">${a.id ? 'Editar endereço' : 'Novo endereço'}</h2>
      <p class="muted" style="margin:0 0 12px">Digite o CEP e o resto é preenchido sozinho.</p>
      <div class="form-grid">
        <label class="s6">Apelido (opcional)<input name="label" type="text" maxlength="40" placeholder="Ex.: Casa, Obra, Empresa" value="${esc(a.label || '')}" /></label>
        <label class="s2">CEP<input name="cep" type="text" inputmode="numeric" maxlength="9" autocomplete="postal-code" placeholder="00000-000" value="${esc(a.cep ? V.maskCEP(a.cep) : '')}" required /><span class="hint" id="cep-hint"></span></label>
        <label class="s4">Rua<input name="street" type="text" maxlength="120" value="${esc(a.street || '')}" required /></label>
        <label class="s2">Número<input name="number" type="text" maxlength="10" placeholder="S/N" value="${esc(a.number || '')}" required /></label>
        <label class="s4">Complemento (opcional)<input name="complement" type="text" maxlength="60" value="${esc(a.complement || '')}" /></label>
        <label class="s3">Bairro<input name="district" type="text" maxlength="80" value="${esc(a.district || '')}" /></label>
        <label class="s3">Cidade<input name="city" type="text" maxlength="80" value="${esc(a.city || '')}" required /></label>
        <label class="s2">UF<select name="uf" required><option value="">UF</option>${UFS.map((u) => `<option ${a.uf === u ? 'selected' : ''}>${u}</option>`).join('')}</select></label>
      </div>
      <p class="form-error" id="f-err" role="alert" hidden></p>
      <div class="modal-actions"><button type="button" class="btn" data-act="close">Cancelar</button><button type="submit" class="btn primary">Salvar endereço</button></div>
    </form>`);
  }

  async function saveAddr(form) {
    const g = (n) => String((form[n] && form[n].value) || '').trim();
    const d = { label: g('label'), cep: V.digits(g('cep')), street: g('street'), number: g('number'), complement: g('complement'), district: g('district'), city: g('city'), uf: g('uf').toUpperCase() };
    if (d.cep.length !== 8) return showErr('Informe o CEP com 8 números.');
    if (d.street.length < 2) return showErr('Informe a rua.');
    if (!d.number) return showErr('Informe o número (ou S/N).');
    if (d.city.length < 2) return showErr('Informe a cidade.');
    if (!UFS.includes(d.uf)) return showErr('Escolha o estado (UF).');
    const btn = $('button[type=submit]', form);
    busy(btn, true);
    try {
      const id = await rpc('save_my_address', { p_id: form.dataset.id || null, p_data: d }, true);
      await loadAddrs();
      closeDlg();
      chk.addrId = id;
      toast('Endereço salvo.');
      refreshAddrViews();
    } catch (e) {
      showErr(e.message);
    } finally {
      busy(btn, false);
    }
  }

  function refreshAddrViews() {
    const h = location.hash || '#/';
    if (h.startsWith('#/finalizar')) {
      const d = $('#chk-del');
      if (d) d.innerHTML = chkDeliveryHtml();
    } else if (h.startsWith('#/conta')) {
      $('#lj-main').innerHTML = viewAccount();
    }
  }

  async function saveData(form) {
    const e0 = $('#f-err', form);
    e0.hidden = true;
    const phone = V.digits(form.phone.value);
    if (!V.validPhone(phone)) {
      e0.textContent = 'Informe o telefone com DDD.';
      e0.hidden = false;
      return;
    }
    const cad = { phone };
    const btn = $('button[type=submit]', form);
    busy(btn, true);
    try {
      await rpc('update_my_customer', { p_data: cad }, true);
      await loadMe();
      renderTop();
      toast('Dados atualizados.');
    } catch (err) {
      e0.textContent = err.message;
      e0.hidden = false;
    } finally {
      busy(btn, false);
    }
  }

  async function savePass(form) {
    const e0 = $('#f-err', form);
    e0.hidden = true;
    const p1 = form.p1.value;
    const fail = (m) => {
      e0.textContent = m;
      e0.hidden = false;
    };
    if (!recoverMode && !form.pold.value) return fail('Informe a senha atual.');
    if (p1.length < 10 || !/[A-Za-z]/.test(p1) || !/\d/.test(p1)) return fail('A nova senha precisa ter pelo menos 10 caracteres, com letras e números.');
    if (me && me.email && p1.toLowerCase() === String(me.email).toLowerCase()) return fail('A senha não pode ser igual ao e-mail.');
    if (p1 !== form.p2.value) return fail('As duas senhas novas não são iguais.');
    if (!recoverMode && p1 === form.pold.value) return fail('A nova senha precisa ser diferente da atual.');
    const btn = $('button[type=submit]', form);
    busy(btn, true);
    try {
      if (!recoverMode) {
        // confere a senha atual entrando de novo com ela
        try {
          saveSession(toSession(await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: me.email, password: form.pold.value } })));
        } catch (err) {
          throw new Error('A senha atual está incorreta.');
        }
      }
      await call('/auth/v1/user', { method: 'PUT', body: { password: p1 }, auth: true });
      recoverMode = false;
      form.reset();
      updatePwUi(form);
      toast('Senha trocada.');
    } catch (err) {
      fail(err.message);
    } finally {
      busy(btn, false);
    }
  }

  async function doDelete(form) {
    if (String(form.word.value).trim().toUpperCase() !== 'EXCLUIR') return showErr('Digite EXCLUIR para confirmar.');
    const btn = $('button[type=submit]', form);
    busy(btn, true);
    try {
      await rpc('delete_my_account', {}, true);
      saveSession(null);
      me = null;
      myReqs = null;
      addrs = null;
      recoverMode = false;
      cart = {};
      saveCart();
      renderTop();
      closeDlg();
      location.hash = '#/';
      toast('Conta excluída. Seus dados foram apagados.');
      route();
    } catch (e) {
      showErr(e.message);
    } finally {
      busy(btn, false);
    }
  }

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'lj-q') {
      q = t.value;
      if ((location.hash || '#/').startsWith('#/conta')) {
        location.hash = '#/';
        return;
      }
      syncCatalog();
    } else if (t.name === 'cep') onCepInput(t);
    else if (['password', 'password2', 'p1', 'p2', 'email'].includes(t.name) && t.closest('form') && $('#pw-rules', t.closest('form'))) updatePwUi(t.closest('form'));
    else if (t.name === 'doc' && !t.readOnly) {
      const form = t.closest('form');
      const kind = form.id === 'f-data' ? me.kind : authKind;
      onDocInput(t, kind);
    } else if (t.name === 'phone') t.value = V.maskPhone(t.value);
    else if (t.dataset && t.dataset.cqin) {
      const n = Math.max(1, Math.min(9999, Math.floor(Number(t.value) || 1)));
      cart[t.dataset.cqin] = n;
      saveCart();
    }
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t && t.name === 'addr' && t.type === 'radio') {
      chk.addrId = t.value;
      const d = $('#chk-del');
      if (d) d.innerHTML = chkDeliveryHtml();
    }
  });

  document.addEventListener('mouseover', (e) => {
    if (e.target.closest && e.target.closest('.lj-banner')) bnPaused = true;
  });
  document.addEventListener('mouseout', (e) => {
    if (e.target.closest && e.target.closest('.lj-banner')) bnPaused = false;
  });
  document.addEventListener('focusin', (e) => {
    if (e.target.closest && e.target.closest('.lj-banner')) bnPaused = true;
  });
  document.addEventListener('focusout', () => (bnPaused = false));

  document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'drawer') e.target.close();
  });

  window.addEventListener('hashchange', route);

  // ---------------- começo ----------------
  async function consumeHash() {
    const h = location.hash.replace(/^#/, '');
    if (!/access_token=|error_description=/.test(h)) return null;
    const p = new URLSearchParams(h);
    history.replaceState(null, '', location.pathname + location.search + '#/');
    if (p.get('error_description')) return { error: p.get('error_description').replace(/\+/g, ' ') };
    if (p.get('access_token')) {
      saveSession({
        access_token: p.get('access_token'),
        refresh_token: p.get('refresh_token'),
        expires_at: Number(p.get('expires_at')) || Math.floor(Date.now() / 1000) + (Number(p.get('expires_in')) || 3600),
      });
      return { type: p.get('type') };
    }
    return null;
  }

  async function start() {
    renderTop();
    renderFoot();
    const link = online ? await consumeHash() : null;
    if (session) {
      try {
        await loadMe();
        if (me.staff) {
          await signOut(true);
        }
      } catch (e) {
        me = null;
      }
    }
    renderTop();
    await route();
    if (link && link.error) openAuth('entrar', 'O link expirou ou já foi usado. Entre com e-mail e senha ou peça um novo link.');
    else if (link && link.type === 'recovery' && session) {
      acTab = 'seguranca';
      recoverMode = true;
      location.hash = '#/conta';
      toast('Crie agora a sua nova senha.');
    } else if (link && session && me && me.registered === false) {
      try {
        if (await rpc('complete_registration', {}, true)) {
          await loadMe();
          renderTop();
          toast('E-mail confirmado! Conta pronta.');
          route();
        } else openComplete('E-mail confirmado! Falta completar o seu cadastro.');
      } catch (e) {
        openComplete('E-mail confirmado! Falta completar o seu cadastro.');
      }
    } else if (link && session && me && me.registered) toast('E-mail confirmado! Conta pronta.');
  }

  start();
})(typeof self !== 'undefined' ? self : this);
