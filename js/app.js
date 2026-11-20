/*
 * Controle principal do site: login, abas, catálogo (mostruário, peças, produtos),
 * simulação, histórico e financeiro. As abas Planilhas e Usuários ficam em
 * js/views-sheets.js e js/views-users.js e se registram aqui.
 *
 * Cálculos: js/logic.js. Dados: js/store.js (demonstração) ou js/supabase.js (online).
 */
(function (root) {
  'use strict';

  const L = root.Logic;
  const U = root.UI;
  const { esc, brl, int, pct, $, $$, icons, toast, openModal, closeModal, confirmBox, uuid } = U;

  const App = {
    auth: null,
    store: null,
    user: null,
    state: { parts: [], products: [], movements: [] },
    loadError: null,
    tab: 'hoje',
    filter: '',
    partFilter: '',
    prodFilter: '',
    category: '',
    simPlan: {},
    tabs: [],
    actions: {},
  };
  root.App = App;

  App.isManager = () => !!App.user && App.user.role === 'gerente';
  App.isRemote = () => !!App.store && App.store.kind === 'supabase';
  App.registerTab = (t) => {
    App.tabs.push(t);
    App.tabs.sort((a, b) => a.order - b.order);
  };
  App.refresh = async () => {
    App.state = await App.store.load();
    App.loadError = null;
  };

  const roleLabel = (r) => (r === 'gerente' ? 'Gerente' : 'Funcionário');
  const findItem = (kind, id) => (kind === 'part' ? App.state.parts : App.state.products).find((x) => x.id === id);

  // =====================================================================
  //  Login
  // =====================================================================
  function showLogin(error) {
    App.user = null;
    document.body.dataset.screen = 'login';
    const demo = App.auth.isDemo;
    const demoUsers = demo ? root.Auth.demoUsers : [];
    $('#login-screen').innerHTML = `
      <section class="login-art" aria-hidden="true">
        <div class="login-art-inner">
          <div class="login-logo">${icons.drop}</div>
          <h2>Estoque &amp; Montagem</h2>
          <p>Do estoque de peças ao produto final, num só lugar.</p>
          <ul>
            <li>${icons.check}<span>Quanto dá para montar, na hora</span></li>
            <li>${icons.check}<span>Custos e margens só para a gerência</span></li>
            <li>${icons.check}<span>Catálogo com fotos e planilhas Excel</span></li>
          </ul>
        </div>
      </section>
      <section class="login-panel">
        <div class="login-card">
          <div class="lc-head">
            <span class="lc-logo">${icons.drop}</span>
            <h1>Acesso da equipe</h1>
            <p class="muted">Entre com o e-mail e a senha cadastrados pela gerência.</p>
          </div>
          ${
            demo
              ? `<div class="demo-note"><b>Modo demonstração.</b> Os dados ficam só neste navegador e as contas abaixo são de teste. Para ter login de verdade, conecte o banco de dados (veja o README).</div>`
              : ''
          }
          <form id="login-form" novalidate>
            <label>E-mail
              <span class="field">${icons.mail}<input name="email" type="email" autocomplete="username" inputmode="email" placeholder="voce@empresa.com" required /></span>
            </label>
            <label>Senha
              <span class="field">${icons.lock}<input name="password" type="password" autocomplete="current-password" placeholder="Sua senha" required />
                <button type="button" class="field-btn" data-action="toggle-pass" aria-label="Mostrar senha">${icons.eye}</button></span>
            </label>
            <p class="form-error" id="login-error" role="alert" ${error ? '' : 'hidden'}>${esc(error || '')}</p>
            <button class="btn primary big lc-btn" type="submit">Entrar</button>
          </form>
          <p class="lc-safe">${icons.lock}<span>Conexão protegida. Seus dados seguem a LGPD e cada acesso fica registrado.</span></p>
          ${
            demo
              ? `<div class="demo-quick">
                  <span>Entrar direto como</span>
                  ${demoUsers.map((u) => `<button class="btn" data-action="demo-login" data-id="${u.role}">${roleLabel(u.role)}</button>`).join('')}
                </div>
                <p class="hint demo-accounts">${demoUsers.map((u) => `${esc(u.email)} · senha de teste no código`).join('<br>')}</p>`
              : ''
          }
        </div>
      </section>`;
    $('#login-screen input[name=email]').focus();
  }

  async function doLogin(form) {
    const btn = $('button[type=submit]', form);
    const err = $('#login-error');
    err.hidden = true;
    btn.disabled = true;
    btn.classList.add('busy');
    try {
      const r = await App.auth.signIn(form.email.value, form.password.value);
      if (r.mfa) {
        showMfaStep();
        return;
      }
      if (!r.ok) {
        err.textContent = r.error;
        err.hidden = false;
        return;
      }
      await enter(r.user);
    } catch (e) {
      err.textContent = e.message || 'Não foi possível entrar.';
      err.hidden = false;
    } finally {
      btn.disabled = false;
      btn.classList.remove('busy');
    }
  }

  // segunda etapa do login: código do app autenticador
  function showMfaStep() {
    $('#login-form').outerHTML = `
      <form id="mfa-form" novalidate>
        <p class="muted">Verificação em 2 etapas: abra o app autenticador no celular e digite o código de 6 números.</p>
        <label>Código
          <span class="field">${icons.lock}<input name="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" required /></span>
        </label>
        <p class="form-error" id="login-error" role="alert" hidden></p>
        <button class="btn primary big lc-btn" type="submit">Confirmar</button>
        <button class="btn ghost" type="button" data-action="mfa-cancel">Voltar</button>
      </form>`;
    $('#mfa-form input[name=code]').focus();
  }

  async function doMfa(form) {
    const btn = $('button[type=submit]', form);
    const err = $('#login-error');
    err.hidden = true;
    btn.disabled = true;
    btn.classList.add('busy');
    try {
      const r = await App.auth.verifyMfa(form.code.value);
      if (!r.ok) {
        err.textContent = r.error;
        err.hidden = false;
        return;
      }
      await enter(r.user);
    } catch (e) {
      err.textContent = e.message || 'Não foi possível confirmar o código.';
      err.hidden = false;
    } finally {
      btn.disabled = false;
      btn.classList.remove('busy');
    }
  }

  async function enter(user) {
    App.user = user;
    App.tab = 'hoje';
    App.filter = App.partFilter = App.category = App.prodFilter = '';
    App.mtSearch = '';
    App.simPlan = {};
    App.buyPlan = {};
    App.countInputs = {};
    App.countFilter = '';
    App.rcFilter = 'todos';
    App.store = App.auth.isDemo ? root.createLocalStore(() => App.user) : root.createSupabaseStore(() => App.user);
    document.body.dataset.screen = 'app';
    renderUserBox();
    $('#view').innerHTML = `<div class="loading"><span class="spinner"></span> Carregando…</div>`;
    renderTabs();
    try {
      await App.refresh();
    } catch (e) {
      App.loadError = e.message || 'Não consegui carregar os dados.';
    }
    App.render(true);
  }

  async function logout() {
    closeModal();
    await App.auth.signOut();
    App.user = null;
    showLogin();
  }

  function renderUserBox() {
    const u = App.user;
    if (!u) {
      $('#userbox').innerHTML = '';
      $('#top-right').innerHTML = '';
      return;
    }
    const initials = String(u.name || u.email || '?')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((s) => s[0])
      .join('')
      .toUpperCase();
    $('#userbox').innerHTML = `
      <div class="profile">
        <span class="avatar">${esc(initials)}</span>
        <span class="who sb-label"><b>${esc(u.name)}</b><small>${roleLabel(u.role)}</small></span>
      </div>
      ${App.auth.isDemo ? '' : `<button class="side-link" data-action="security" title="Segurança da conta">${icons.key}<span class="sb-label">Segurança</span></button>`}
      <button class="side-link" data-action="logout" title="Sair">${icons.logout}<span class="sb-label">Sair</span></button>`;
    renderTopRight();
  }

  // ---------- tema (claro/escuro) e menu recolhido ----------
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* ignora */ } },
  };
  const isDark = () => document.documentElement.dataset.theme === 'dark';
  function applyTheme(dark, save) {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    const m = document.querySelector('meta[name=theme-color]');
    if (m) m.setAttribute('content', dark ? '#0b171c' : '#084b58');
    if (save) store.set('mb:tema', dark ? 'escuro' : 'claro');
    renderTopRight();
  }
  function renderTopRight() {
    const el = $('#top-right');
    if (!el || !App.user) return;
    el.innerHTML = `
      ${App.auth.isDemo ? '<span class="mode-badge" title="Os dados ficam só neste navegador">Demonstração</span>' : ''}
      <button class="icon-top" data-action="theme-toggle" aria-label="${isDark() ? 'Usar tema claro' : 'Usar tema escuro'}" title="${isDark() ? 'Tema claro' : 'Tema escuro'}">${isDark() ? icons.sun : icons.moon}</button>`;
  }
  const isMobile = () => window.matchMedia('(max-width: 900px)').matches;
  function renderSbToggle() {
    const min = document.documentElement.classList.contains('sb-min');
    const b = $('#sb-toggle');
    if (b) {
      b.innerHTML = icons.panel;
      b.setAttribute('aria-label', min ? 'Expandir menu' : 'Recolher menu');
      b.setAttribute('aria-expanded', String(!min));
    }
    const o = $('#sb-open');
    if (o) o.innerHTML = icons.menu;
  }
  function setSidebarMin(min) {
    document.documentElement.classList.toggle('sb-min', min);
    store.set('mb:menu', min ? 'min' : 'max');
    renderSbToggle();
  }
  const setDrawer = (open) => document.body.classList.toggle('sb-open', open);

  // =====================================================================
  //  Abas e renderização
  // =====================================================================
  const visibleTabs = () =>
    App.tabs.filter((t) => (!t.managerOnly || App.isManager()) && (!t.remoteOnly || App.isRemote()));

  // Menu em dois níveis: grupos no topo; dentro do grupo ativo, as telas dele.
  const GROUPS = [
    { id: 'hoje', label: 'Hoje', icon: 'home', tabs: ['hoje'] },
    { id: 'calendario', label: 'Calendário', icon: 'calendar', tabs: ['calendario'] },
    { id: 'mostruario', label: 'Mostruário', icon: 'store', tabs: ['mostruario'] },
    { id: 'estoque', label: 'Estoque', icon: 'box', tabs: ['pecas', 'recebimento', 'reposicao', 'conferencia'] },
    { id: 'producao', label: 'Produção', icon: 'tool', tabs: ['produtos', 'montados', 'simulacao'] },
    { id: 'pedidos', label: 'Pedidos', icon: 'clipboard', tabs: ['pedidos'] },
    { id: 'loja', label: 'Loja online', icon: 'cart', tabs: ['catalogo', 'solicitacoes', 'clientes'] },
    { id: 'movimentacoes', label: 'Movimentações', icon: 'swap', tabs: ['movimentacoes'] },
    { id: 'gerencia', label: 'Gerência', icon: 'shield', tabs: ['financeiro', 'planilhas', 'usuarios', 'auditoria'], lock: true },
  ];
  App.groups = () => {
    const vis = visibleTabs();
    const used = new Set();
    const out = GROUPS.map((g) => {
      const tabs = g.tabs.map((id) => vis.find((t) => t.id === id)).filter(Boolean);
      tabs.forEach((t) => used.add(t.id));
      return { ...g, tabs };
    }).filter((g) => g.tabs.length);
    vis.filter((t) => !used.has(t.id)).forEach((t) => out.push({ id: t.id, label: t.label, tabs: [t] }));
    return out;
  };
  App.lastInGroup = App.lastInGroup || {};

  function renderTabs() {
    const tabs = visibleTabs();
    if (!tabs.some((t) => t.id === App.tab)) App.tab = 'hoje';
    const groups = App.groups();
    const cur = groups.find((g) => g.tabs.some((t) => t.id === App.tab)) || groups[0];
    App.lastInGroup[cur.id] = App.tab;
    $('#tabs').innerHTML = groups
      .map((g) => {
        const target = g.id === cur.id ? App.tab : App.lastInGroup[g.id] || g.tabs[0].id;
        return `<button class="tab" data-tab="${target}" data-group="${g.id}" title="${g.label}" ${g.id === cur.id ? 'aria-current="page"' : ''}>${icons[g.icon] || icons.file}<span class="sb-label">${g.label}</span></button>`;
      })
      .join('');
    $('#subtabs').innerHTML =
      cur.tabs.length > 1
        ? `<div class="subtabs">${cur.tabs
            .map((t) => `<button class="subtab" data-tab="${t.id}" ${t.id === App.tab ? 'aria-current="page"' : ''}>${t.label}</button>`)
            .join('')}</div>`
        : '';
    const tt = $('#top-title');
    if (tt) tt.innerHTML = `<b>${esc(cur.label)}</b>${cur.tabs.length > 1 ? `<span class="crumb">${icons.chevR}${esc((cur.tabs.find((t) => t.id === App.tab) || {}).label || '')}</span>` : ''}`;
  }

  App.render = function (animate) {
    if (!App.user) return;
    renderTabs();
    const tab = visibleTabs().find((t) => t.id === App.tab);
    const view = $('#view');
    if (App.loadError) {
      view.innerHTML = `<div class="card empty"><p><b>Não consegui carregar os dados.</b></p><p>${esc(App.loadError)}</p>
        <button class="btn primary" data-action="retry">Tentar de novo</button></div>`;
    } else {
      view.innerHTML = tab.view();
      if (tab.after) tab.after();
    }
    renderFoot();
    if (animate) {
      view.classList.remove('enter');
      void view.offsetWidth;
      view.classList.add('enter');
    }
  };

  function renderFoot() {
    const f = $('#foot');
    const co = {
      name: 'M&B Industria e Comercio de Metais',
      cnpj: '44.702.361/0001-55',
      address: 'Rua A (Lot Laguna Park 6), 107 · Lagoa Redonda · Fortaleza/CE · CEP 60831-222',
    };
    const brand = `<div class="foot-brand">
        <b>${esc(co.name)}</b>
        <span class="foot-copy">© ${new Date().getFullYear()} ${esc(co.name)}. Todos os direitos reservados.</span>
        <span class="foot-info">CNPJ ${esc(co.cnpj)} · ${esc(co.address)}</span>
      </div>`;
    if (App.isRemote()) {
      f.innerHTML = brand + `<span>Conectado ao banco de dados online.</span>`;
    } else if (App.isManager()) {
      f.innerHTML = brand + `<span>Modo demonstração: dados salvos neste navegador.</span>
        <button class="btn small" data-action="export-json">Exportar backup</button>
        <button class="btn small" data-action="import-json">Importar backup</button>
        <button class="btn small danger" data-action="reset-demo">Restaurar dados de exemplo</button>`;
    } else {
      f.innerHTML = brand + `<span>Modo demonstração. Valores financeiros ficam ocultos para o perfil Funcionário.</span>`;
    }
  }

  /** Roda uma alteração, recarrega e redesenha. Erros sobem para quem chamou. */
  App.commit = async function (fn) {
    await fn();
    await App.refresh();
    App.render();
  };

  // =====================================================================
  //  Fotos
  // =====================================================================
  let photoTarget = null;
  App.photoIdx = App.photoIdx || {};

  /** Fotos de um item: produto pode ter várias (a primeira é a principal); peça tem uma só. */
  const photosOf = (kind, item) => (kind === 'product' ? item.photos || (item.photo ? [item.photo] : []) : item.photo ? [item.photo] : []);
  const idxOf = (kind, item) => Math.min(App.photoIdx[item.id] || 0, Math.max(photosOf(kind, item).length - 1, 0));

  function dotsHtml(n, i) {
    return n > 1 ? `<span class="dots" aria-hidden="true">${Array.from({ length: n }, (_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</span>` : '';
  }

  function media(kind, item, badge) {
    const list = photosOf(kind, item);
    const has = list.length > 0;
    const i = idxOf(kind, item);
    const multi = list.length > 1;
    return `<div class="media ${has ? 'has' : ''} ${multi ? 'carousel' : ''}">
      <button type="button" class="media-main" data-action="photo-click" data-kind="${kind}" data-id="${item.id}" aria-label="${has ? (multi ? `Fotos de ${esc(item.name)}: toque na direita ou na esquerda para trocar, no centro para ampliar` : 'Ampliar foto de ') + (multi ? '' : esc(item.name)) : 'Adicionar foto de ' + esc(item.name)}">
        ${has ? `<img src="${esc(list[i])}" alt="${esc(item.name)}" loading="lazy" />` : `<span class="ph">${icons.image}<small>Adicionar foto</small></span>`}
        ${multi ? '<span class="car-arrow l" aria-hidden="true">‹</span><span class="car-arrow r" aria-hidden="true">›</span>' : ''}
      </button>
      ${dotsHtml(list.length, i)}
      ${badge || ''}
      <button type="button" class="media-btn" data-action="pick-photo" data-kind="${kind}" data-id="${item.id}" title="${kind === 'product' ? 'Adicionar foto' : has ? 'Trocar foto' : 'Adicionar foto'}" aria-label="${kind === 'product' ? 'Adicionar foto' : has ? 'Trocar foto' : 'Adicionar foto'}">${icons.camera}</button>
    </div>`;
  }

  /** Passa para a foto seguinte/anterior (volta ao começo no fim) sem redesenhar a tela. */
  function stepPhoto(kind, id, delta, box) {
    const item = findItem(kind, id);
    if (!item) return;
    const list = photosOf(kind, item);
    if (list.length < 2) return;
    const i = (idxOf(kind, item) + delta + list.length) % list.length;
    App.photoIdx[id] = i;
    const root_ = box || document;
    $$(`.media-main[data-id="${id}"]`, root_).forEach((btn) => {
      const wrap = btn.closest('.media');
      const img = $('img', btn);
      if (img) img.src = list[i];
      const dots = $('.dots', wrap);
      if (dots) dots.outerHTML = dotsHtml(list.length, i);
    });
  }

  function thumb(kind, item) {
    return `<button type="button" class="thumb ${item.photo ? 'has' : ''}" data-action="view-photo" data-kind="${kind}" data-id="${item.id}" aria-label="${item.photo ? 'Ver foto de ' : 'Adicionar foto de '}${esc(item.name)}">
      ${item.photo ? `<img src="${esc(item.photo)}" alt="" loading="lazy" />` : icons.camera}
    </button>`;
  }

  async function handlePhotoFile(file) {
    const t = photoTarget;
    photoTarget = null;
    if (!t || !file) return;
    const item = findItem(t.kind, t.id);
    toast('Preparando a foto…');
    try {
      const local = App.store.kind === 'local';
      const prep = await root.Images.prepare(file, local ? { max: 720, quality: 0.72 } : undefined);
      const payload = local ? { dataUrl: prep.dataUrl } : { blob: prep.blob };
      if (t.kind === 'product') {
        await App.store.addPhoto(t.id, payload);
        await App.refresh();
        App.photoIdx[t.id] = Math.max(0, photosOf('product', findItem('product', t.id)).length - 1);
      } else {
        await App.store.setPhoto(t.kind, t.id, payload, item && item.photo);
        await App.refresh();
      }
      App.render();
      toast('Foto salva.');
    } catch (e) {
      toast(e.message || 'Não consegui salvar a foto.', 'error');
    }
  }

  function openLightbox(kind, id) {
    const item = findItem(kind, id);
    if (!item) return;
    if (!photosOf(kind, item).length) {
      photoTarget = { kind, id };
      $('#photo-input').click();
      return;
    }
    renderLightbox(kind, id);
    $('#lightbox').showModal();
  }

  function renderLightbox(kind, id) {
    const item = findItem(kind, id);
    const dlg = $('#lightbox');
    if (!item) return dlg.close();
    const list = photosOf(kind, item);
    if (!list.length) return dlg.close();
    const i = idxOf(kind, item);
    const multi = list.length > 1;
    dlg.innerHTML = `
      <figure>
        <div class="lb-stage" data-kind="${kind}" data-id="${id}">
          <img src="${esc(list[i])}" alt="${esc(item.name)}" />
          ${multi ? `<button type="button" class="lb-nav l" data-action="lb-prev" data-kind="${kind}" data-id="${id}" aria-label="Foto anterior">‹</button><button type="button" class="lb-nav r" data-action="lb-next" data-kind="${kind}" data-id="${id}" aria-label="Próxima foto">›</button>` : ''}
        </div>
        <figcaption>${esc(item.name)}${multi ? ` <span class="muted">· foto ${i + 1} de ${list.length}${i === 0 ? ' (principal)' : ''}</span>` : ''}</figcaption>
        ${multi ? `<div class="lb-thumbs">${list.map((u, k) => `<button type="button" class="${k === i ? 'on' : ''}" data-action="lb-go" data-kind="${kind}" data-id="${id}" data-i="${k}" aria-label="Ver foto ${k + 1}"><img src="${esc(u)}" alt="" /></button>`).join('')}</div>` : ''}
      </figure>
      <div class="modal-actions">
        <button class="btn danger" data-action="photo-remove" data-kind="${kind}" data-id="${id}">Remover ${kind === 'product' ? 'esta foto' : 'foto'}</button>
        ${kind === 'product' && i > 0 ? `<button class="btn" data-action="photo-cover" data-kind="${kind}" data-id="${id}">Tornar principal</button>` : ''}
        <button class="btn" data-action="pick-photo" data-kind="${kind}" data-id="${id}" data-close="lightbox">${kind === 'product' ? 'Adicionar foto' : 'Trocar foto'}</button>
        <button class="btn primary" data-action="close-lightbox">Fechar</button>
      </div>`;
  }

  // =====================================================================
  //  Mostruário
  // =====================================================================
  function viewMostruario() {
    const { parts, products } = App.state;
    const stock = L.stockMap(parts);
    const zero = products.filter((p) => L.maxProducible(p, stock).max === 0).length;
    const low = L.lowStock(parts);
    const cats = [...new Set(products.map((p) => p.category))].sort((a, b) => a.localeCompare(b));
    return `
      <section class="page-head">
        <div>
          <h1>Mostruário</h1>
          <p class="muted">Catálogo com quanto dá para montar de cada produto agora. Cada número considera só aquele produto; as peças em comum são disputadas entre eles (veja a aba Simulação).</p>
        </div>
        <input class="search" id="filter" type="search" placeholder="Buscar produto…" value="${esc(App.filter)}" aria-label="Buscar produto" />
      </section>
      <div class="kpis">
        <div class="kpi"><div class="label">Produtos</div><div class="value">${int(products.length)}</div></div>
        <div class="kpi ${zero ? 'bad' : 'ok'}"><div class="label">Sem estoque para montar</div><div class="value">${int(zero)}</div></div>
        <div class="kpi ${low.length ? 'warn' : 'ok'}"><div class="label">Peças no mínimo ou abaixo</div><div class="value">${int(low.length)}</div></div>
      </div>
      ${
        low.length
          ? `<div class="card alert-card"><h3>${icons.alert} Atenção ao estoque</h3><div class="chips">${low
              .map((p) => `<span class="pill ${p.stock === 0 ? 'bad' : 'warn'}">${esc(p.name)} · ${int(p.stock)}/${int(p.min)}</span>`)
              .join('')}</div></div>`
          : ''
      }
      ${
        cats.length > 1
          ? `<div class="cat-chips" role="group" aria-label="Filtrar por categoria">
              <button class="chip ${App.category ? '' : 'on'}" data-action="set-category" data-id="">Todos</button>
              ${cats.map((c) => `<button class="chip ${App.category === c ? 'on' : ''}" data-action="set-category" data-id="${esc(c)}">${esc(c)}</button>`).join('')}
            </div>`
          : ''
      }
      <div id="grid" class="grid">${cardsHtml()}</div>`;
  }

  function cardsHtml() {
    const q = App.filter.trim().toLowerCase();
    const list = App.state.products.filter(
      (p) => (!App.category || p.category === App.category) && (!q || (p.name + ' ' + p.category + ' ' + (p.code || '')).toLowerCase().includes(q))
    );
    if (!list.length) return `<div class="empty card" style="grid-column:1/-1">Nenhum produto encontrado.</div>`;
    const stock = L.stockMap(App.state.parts);
    const byId = L.partsById(App.state.parts);
    const manager = App.isManager();
    return list
      .map((p) => {
        const { max, limitingPartId } = L.maxProducible(p, stock);
        const lim = limitingPartId ? byId[limitingPartId] : null;
        const limItem = p.bom.find((i) => i.partId === limitingPartId);
        const level = max === 0 ? 'bad' : max < 5 ? 'warn' : 'ok';
        const badgeText = max === 0 ? 'Sem estoque' : max < 5 ? 'Poucas unidades' : 'Disponível';
        let limitText;
        if (!p.bom.length) limitText = 'Sem ficha técnica cadastrada.';
        else if (max === 0) limitText = `Falta: <b>${esc(lim ? lim.name : '(peça removida)')}</b>`;
        else
          limitText = `Limitado por <b>${esc(lim ? lim.name : '(peça removida)')}</b> (${int(lim ? lim.stock : 0)} em estoque, ${int(limItem.qty)} por unidade)`;
        let money = '';
        if (manager) {
          const cost = L.productCost(p, App.state.parts);
          const m = L.margin(p.price, cost);
          money = `<div class="money-row">
            <div><span>Custo</span><b>${brl(cost)}</b></div>
            <div><span>Preço de venda</span><b>${brl(p.price)}</b></div>
            <div><span>Lucro / un.</span><b>${brl(m.profit)} (${pct(m.pct)})</b></div>
            <div><span>Se montar o máximo</span><b>${brl(max * p.price)}</b></div>
          </div>`;
        }
        return `<article class="card prod-card ${level}">
          ${media('product', p, `<span class="badge ${level}">${badgeText}</span>`)}
          <div class="body">
            <div class="cat">${esc(p.category)}${p.code ? ` · ${esc(p.code)}` : ''}</div>
            <h3>${esc(p.name)}</h3>
            <div class="big"><strong>${int(max)}</strong><span class="muted">unidades possíveis</span></div>
            <div><span class="pill ready">${int(p.ready || 0)} montado${(p.ready || 0) === 1 ? '' : 's'} (pronto${(p.ready || 0) === 1 ? '' : 's'})</span></div>
            <div class="limit">${limitText}</div>
            ${money}
          </div>
        </article>`;
      })
      .join('');
  }

  // =====================================================================
  //  Peças
  // =====================================================================
  function partRowsHtml() {
    const manager = App.isManager();
    const q = App.partFilter.trim().toLowerCase();
    const list = App.state.parts.filter((p) => !q || (p.name + ' ' + (p.code || '')).toLowerCase().includes(q));
    if (!list.length) return `<tr><td colspan="8" class="empty">${App.state.parts.length ? 'Nenhuma peça encontrada.' : 'Nenhuma peça cadastrada.'}</td></tr>`;
    return list
      .map((p) => {
        const level = p.stock === 0 ? 'bad' : p.stock <= p.min ? 'warn' : 'ok';
        const label = p.stock === 0 ? 'Zerado' : p.stock <= p.min ? 'Baixo' : 'OK';
        return `<tr>
          <td class="thumb-cell">${thumb('part', p)}</td>
          <td><b>${esc(p.name)}</b>${p.code ? `<br><span class="hint">${esc(p.code)}</span>` : ''}</td>
          <td class="right num">${int(p.stock)}</td>
          <td class="right num">${int(p.min)}</td>
          <td><span class="pill ${level}">${label}</span></td>
          ${manager ? `<td class="right num">${brl(p.cost)}</td><td class="right num">${brl(p.stock * p.cost)}</td>` : ''}
          <td class="row-actions">
            <button class="btn small" data-action="move-in" data-id="${p.id}">+ Entrada</button>
            <button class="btn small" data-action="move-out" data-id="${p.id}">− Saída</button>
            ${manager ? `<button class="btn small" data-action="edit-part" data-id="${p.id}">Editar</button>` : ''}
          </td>
        </tr>`;
      })
      .join('');
  }

  function viewPecas() {
    const manager = App.isManager();
    return `
      <section class="page-head">
        <div>
          <h1>Peças</h1>
          <p class="muted">Estoque atual de cada peça, com foto. Entradas e saídas ficam registradas no Histórico.</p>
        </div>
        <div class="actions">
          <input class="search" id="part-filter" type="search" placeholder="Buscar peça ou código…" value="${esc(App.partFilter)}" aria-label="Buscar peça" />
          ${manager ? `<button class="btn primary" data-action="new-part">${icons.plus} Nova peça</button>` : ''}
        </div>
      </section>
      <div class="table-wrap"><table>
        <thead><tr>
          <th></th><th>Peça</th><th class="right">Estoque</th><th class="right">Mínimo</th><th>Situação</th>
          ${manager ? '<th class="right">Custo unit.</th><th class="right">Valor em estoque</th>' : ''}
          <th></th>
        </tr></thead>
        <tbody id="parts-body">${partRowsHtml()}</tbody>
      </table></div>`;
  }

  function openMovement(partId, type) {
    const part = App.state.parts.find((p) => p.id === partId);
    if (!part) return;
    const isIn = type === 'entrada';
    const body = `
      <p>${esc(part.name)}<br><span class="muted">Em estoque agora: <b>${int(part.stock)}</b></span></p>
      <label>Quantidade
        <input name="qty" type="number" min="1" step="1" inputmode="numeric" required />
      </label>
      ${
        isIn && App.isManager()
          ? `<label>Custo unitário desta compra (opcional)
              <input name="cost" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Ex.: 18,50" />
            </label>
            <p class="hint">Se informar, o custo da peça passa a ser a média ponderada entre o estoque atual e esta compra.</p>`
          : ''
      }
      ${
        App.isManager()
          ? `<label>Observação (opcional)
              <input name="note" type="text" maxlength="120" placeholder="${isIn ? 'Ex.: compra do fornecedor X' : 'Ex.: perda, ajuste, venda direta'}" />
            </label>`
          : ''
      }`;
    openModal(
      isIn ? 'Entrada de peças' : 'Saída de peças',
      body,
      async (fd) => {
        const qty = Number(fd.get('qty'));
        const rawCost = fd.get('cost');
        const unitCost = rawCost === null || rawCost === '' ? null : Number(rawCost);
        const check = L.applyMovement(App.state.parts, partId, type, qty, unitCost);
        if (!check.ok) return { error: check.error };
        await App.commit(() => App.store.move({ partId, type, qty, note: String(fd.get('note') || '').trim(), unitCost }));
        toast(isIn ? 'Entrada registrada.' : 'Saída registrada.');
      },
      isIn ? 'Registrar entrada' : 'Registrar saída'
    );
  }

  function openPartForm(partId) {
    if (!App.isManager()) return;
    const editing = partId ? App.state.parts.find((p) => p.id === partId) : null;
    const body = `
      <label>Código (opcional)
        <input name="code" type="text" maxlength="40" value="${esc(editing ? editing.code : '')}" />
      </label>
      <label>Nome da peça
        <input name="name" type="text" required maxlength="80" value="${esc(editing ? editing.name : '')}" />
      </label>
      ${editing ? '' : `<label>Estoque inicial<input name="stock" type="number" min="0" step="1" inputmode="numeric" value="0" /></label>`}
      <label>Estoque mínimo (para o alerta)
        <input name="min" type="number" min="0" step="1" inputmode="numeric" value="${editing ? editing.min : 0}" />
      </label>
      <label>Custo unitário (R$)
        <input name="cost" type="number" min="0" step="0.01" inputmode="decimal" value="${editing ? editing.cost : 0}" />
      </label>
      ${editing ? '<p class="hint">Para mudar a quantidade em estoque, use Entrada ou Saída: assim fica no Histórico.</p>' : ''}`;
    openModal(editing ? 'Editar peça' : 'Nova peça', body, async (fd) => {
      const name = String(fd.get('name') || '').trim();
      const min = Math.floor(Number(fd.get('min')) || 0);
      const cost = Number(fd.get('cost')) || 0;
      if (!name) return { error: 'Informe o nome da peça.' };
      if (min < 0 || cost < 0) return { error: 'Mínimo e custo não podem ser negativos.' };
      const item = { id: editing ? editing.id : uuid(), code: String(fd.get('code') || '').trim(), name, min, cost };
      if (!editing) item.stock = Math.max(0, Math.floor(Number(fd.get('stock')) || 0));
      await App.commit(() => App.store.saveParts([item], 'Ajuste manual'));
      toast('Peça salva.');
    });
    if (editing) addDeleteButton('del-part', editing.id);
  }

  function addDeleteButton(action, id) {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn danger';
    del.dataset.action = action;
    del.dataset.id = id;
    del.textContent = 'Excluir';
    $('.modal-actions', $('#modal')).prepend(del);
  }

  async function deletePart(partId) {
    if (!App.isManager()) return;
    const part = App.state.parts.find((p) => p.id === partId);
    if (!part) return;
    const usedBy = App.state.products.filter((pr) => pr.bom.some((i) => i.partId === partId));
    if (usedBy.length) {
      toast(`Não dá para excluir: usada em ${usedBy.map((p) => p.name).join(', ')}.`, 'error');
      return;
    }
    if (!(await confirmBox(`Excluir a peça "${part.name}"? O histórico dela será mantido.`, 'Excluir', true))) return;
    try {
      await App.commit(() => App.store.deletePart(partId));
      closeModal();
      toast('Peça excluída.');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // =====================================================================
  //  Produtos
  // =====================================================================
  function prodCardsHtml() {
    const manager = App.isManager();
    const byId = L.partsById(App.state.parts);
    const stock = L.stockMap(App.state.parts);
    const q = App.prodFilter.trim().toLowerCase();
    const list = App.state.products.filter((p) => !q || [p.name, p.code, p.category].join(' ').toLowerCase().includes(q));
    if (!list.length) return `<div class="empty card" style="grid-column:1/-1">${App.state.products.length ? 'Nenhum produto encontrado para essa busca.' : 'Nenhum produto cadastrado.'}</div>`;
    return list
      .map((p) => {
        const { max } = L.maxProducible(p, stock);
        const items = p.bom
          .map((i) => {
            const part = byId[i.partId];
            return `<li><span>${esc(part ? part.name : '(peça removida)')}</span><span class="q">${int(i.qty)}×</span></li>`;
          })
          .join('');
        let money = '';
        if (manager) {
          const cost = L.productCost(p, App.state.parts);
          const m = L.margin(p.price, cost);
          money = `<div class="money-row">
            <div><span>Custo</span><b>${brl(cost)}</b></div>
            <div><span>Preço de venda</span><b>${brl(p.price)}</b></div>
            <div><span>Lucro / un.</span><b>${brl(m.profit)}</b></div>
            <div><span>Margem</span><b>${pct(m.pct)}</b></div>
          </div>`;
        }
        return `<article class="card prod-card neutral">
          ${media('product', p)}
          <div class="body">
            <div class="cat">${esc(p.category)}${p.code ? ` · ${esc(p.code)}` : ''}</div>
            <h3>${esc(p.name)}</h3>
            <div><span class="pill ready">${int(p.ready || 0)} montado${(p.ready || 0) === 1 ? '' : 's'} (pronto${(p.ready || 0) === 1 ? '' : 's'})</span></div>
            <div><span class="hint">Ficha técnica (por unidade)</span><ul class="bom">${items || '<li class="muted">Nenhuma peça cadastrada.</li>'}</ul></div>
            ${money}
            <div class="actions">
              <button class="btn small" data-action="guide" data-id="${p.id}">Guia de montagem</button>
              <button class="btn primary small" data-action="produce" data-id="${p.id}" ${max === 0 ? 'disabled' : ''}>Registrar montagem</button>
              ${manager ? `<button class="btn small" data-action="edit-product" data-id="${p.id}">Editar</button>` : ''}
            </div>
          </div>
        </article>`;
      })
      .join('');
  }

  function viewProdutos() {
    const manager = App.isManager();
    return `
      <section class="page-head">
        <div>
          <h1>Produtos</h1>
          <p class="muted">Cada produto final tem uma ficha técnica: as peças e quantas entram em uma unidade. É ela que alimenta o mostruário e a simulação.</p>
        </div>
        <div class="actions">
          <input class="search" id="prod-filter" type="search" placeholder="Buscar por nome, código ou categoria…" value="${esc(App.prodFilter)}" aria-label="Buscar produto" />
          ${manager ? `<button class="btn primary" data-action="new-product">${icons.plus} Novo produto</button>` : ''}
        </div>
      </section>
      <div class="grid" id="prod-grid">${prodCardsHtml()}</div>`;
  }


  // =====================================================================
  //  Guia de montagem (para o operador): foto do resultado, peças e passo a passo
  // =====================================================================
  App.openGuide = (id) => openGuide(id);
  function openGuide(productId) {
    const p = App.state.products.find((x) => x.id === productId);
    if (!p) return;
    const byId = L.partsById(App.state.parts);
    const { max } = L.maxProducible(p, L.stockMap(App.state.parts));
    const partRows = p.bom
      .map((i) => {
        const part = byId[i.partId];
        const short = !part || part.stock < i.qty;
        return `<li class="g-item"><label><input type="checkbox" class="g-chk" /> <span>${esc(part ? part.name : '(peça removida)')}</span></label>
          <span class="q">${int(i.qty)}×</span>${short ? '<span class="pill bad">falta peça</span>' : ''}</li>`;
      })
      .join('');
    const steps = (p.guide || [])
      .map((s, n) => `<li class="g-step"><label><input type="checkbox" class="g-chk" /> <span><b>${n + 1}.</b> ${esc(s)}</span></label></li>`)
      .join('');
    const total = p.bom.length + (p.guide || []).length;
    const body = `
      ${p.photo ? `<figure class="guide-photo"><img src="${esc(p.photo)}" alt="Produto montado: ${esc(p.name)}" /><figcaption>Resultado final: assim o produto deve ficar</figcaption></figure>` : '<p class="hint">Este produto ainda não tem foto do produto montado.</p>'}
      <h3 class="guide-h">1. Separe as peças (para 1 unidade)</h3>
      <ul class="g-list">${partRows || '<li class="muted">Sem peças na ficha técnica.</li>'}</ul>
      <h3 class="guide-h">2. Monte seguindo os passos</h3>
      ${steps ? `<ol class="g-list g-steps">${steps}</ol>` : `<p class="hint">Ainda não há passo a passo cadastrado${App.isManager() ? '. Edite o produto e escreva os passos (um por linha).' : '. Peça ao gerente para cadastrar.'}</p>`}
      <p class="g-progress" id="g-progress" data-total="${total}" aria-live="polite">0 de ${total} itens conferidos</p>
      <p class="hint">${max > 0 ? `Dá para montar até <b>${int(max)}</b> com o estoque atual.` : '<b>Sem peças suficientes para montar agora.</b> Veja a aba Reposição.'} As marcações são só para você acompanhar e não ficam salvas.</p>`;
    openModal(`Guia de montagem · ${p.name}`, body, async () => {
      setTimeout(() => openProduce(productId), 0);
    }, 'Registrar montagem', { wide: true, noFocus: true });
    const sub = $('button[type=submit]', $('#modal'));
    if (sub && max === 0) sub.disabled = true;
  }

  document.addEventListener('change', (e) => {
    if (!e.target.classList || !e.target.classList.contains('g-chk')) return;
    const modal = $('#modal');
    const done = $$('.g-chk:checked', modal).length;
    const box = $('#g-progress', modal);
    if (box) box.textContent = `${done} de ${box.dataset.total} itens conferidos${done === Number(box.dataset.total) && done > 0 ? ' · tudo pronto, pode registrar a montagem' : ''}`;
    const li = e.target.closest('li');
    if (li) li.classList.toggle('done', e.target.checked);
  });

  function bomRow(selectedId, qty) {
    const opts = App.state.parts
      .map((p) => `<option value="${p.id}" ${p.id === selectedId ? 'selected' : ''}>${esc(p.name)}</option>`)
      .join('');
    return `<div class="bom-row">
      <select name="bomPart" aria-label="Peça">${opts}</select>
      <input name="bomQty" type="number" min="1" step="1" inputmode="numeric" value="${qty || 1}" aria-label="Quantidade" />
      <button type="button" class="icon-btn" data-action="del-bom-row" aria-label="Remover peça">${icons.x}</button>
    </div>`;
  }

  function openProductForm(productId) {
    if (!App.isManager()) return;
    if (!App.state.parts.length) {
      toast('Cadastre as peças antes de criar um produto.', 'error');
      return;
    }
    const editing = productId ? App.state.products.find((p) => p.id === productId) : null;
    const rows = (editing && editing.bom.length ? editing.bom : [{ partId: App.state.parts[0].id, qty: 1 }])
      .map((i) => bomRow(i.partId, i.qty))
      .join('');
    const cats = [...new Set(App.state.products.map((p) => p.category))];
    const body = `
      <label>Código (opcional)
        <input name="code" type="text" maxlength="40" value="${esc(editing ? editing.code : '')}" />
      </label>
      <label>Nome do produto
        <input name="name" type="text" required maxlength="80" value="${esc(editing ? editing.name : '')}" />
      </label>
      <label>Categoria
        <input name="category" type="text" maxlength="40" list="cats" placeholder="Ex.: Torneiras, Duchas, Acessórios" value="${esc(editing ? editing.category : '')}" />
        <datalist id="cats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
      </label>
      <label>Preço de venda (R$)
        <input name="price" type="number" min="0" step="0.01" inputmode="decimal" value="${editing ? editing.price : 0}" />
      </label>

      <label>Passo a passo da montagem (um passo por linha)
        <textarea name="guide" rows="6" maxlength="3000" placeholder="1. Separe as peças...&#10;2. Passe a fita veda-rosca...">${esc(editing && editing.guide ? editing.guide.join('\n') : '')}</textarea>
      </label>
      <div>
        <strong style="font-size:.9rem">Ficha técnica: peças em 1 unidade</strong>
        <div id="bom-rows" style="margin-top:6px">${rows}</div>
        <button type="button" class="btn small" data-action="add-bom-row">${icons.plus} Adicionar peça</button>
      </div>`;
    openModal(editing ? 'Editar produto' : 'Novo produto', body, async (fd) => {
      const name = String(fd.get('name') || '').trim();
      const price = Number(fd.get('price')) || 0;
      if (!name) return { error: 'Informe o nome do produto.' };
      if (price < 0) return { error: 'O preço não pode ser negativo.' };
      const ids = fd.getAll('bomPart');
      const qtys = fd.getAll('bomQty');
      const merged = {};
      for (let i = 0; i < ids.length; i++) {
        const q = Math.floor(Number(qtys[i]));
        if (!(q > 0)) return { error: 'Toda peça da ficha técnica precisa de quantidade maior que zero.' };
        merged[ids[i]] = (merged[ids[i]] || 0) + q;
      }
      const bom = Object.keys(merged).map((partId) => ({ partId, qty: merged[partId] }));
      if (!bom.length) return { error: 'Adicione ao menos uma peça na ficha técnica.' };
      const item = {
        id: editing ? editing.id : uuid(),
        code: String(fd.get('code') || '').trim(),
        name,
        category: String(fd.get('category') || '').trim() || 'Sem categoria',
        price,
        bom,
        guide: String(fd.get('guide') || '').split('\n').map((x) => x.replace(/^\s*\d+\s*[.)-]\s*/, '').trim()).filter(Boolean),
      };
      await App.commit(() => App.store.saveProducts([item]));
      toast('Produto salvo.');
    });
    if (editing) addDeleteButton('del-product', editing.id);
  }

  async function deleteProduct(productId) {
    if (!App.isManager()) return;
    const p = App.state.products.find((x) => x.id === productId);
    if (!p) return;
    if (!(await confirmBox(`Excluir o produto "${p.name}"?`, 'Excluir', true))) return;
    try {
      delete App.simPlan[productId];
      await App.commit(() => App.store.deleteProduct(productId));
      closeModal();
      toast('Produto excluído.');
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function openProduce(productId) {
    const product = App.state.products.find((p) => p.id === productId);
    if (!product) return;
    const { max } = L.maxProducible(product, L.stockMap(App.state.parts));
    const body = `
      <p><b>${esc(product.name)}</b><br><span class="muted">Dá para montar até <b>${int(max)}</b> com o estoque atual.</span></p>
      <label>Quantidade a montar
        <input name="qty" type="number" min="1" max="${max}" step="1" inputmode="numeric" value="1" required />
      </label>
      <p class="hint">As peças da ficha técnica serão descontadas do estoque automaticamente.</p>`;
    openModal(
      'Registrar montagem',
      body,
      async (fd) => {
        const qty = Math.floor(Number(fd.get('qty')));
        const check = L.applyProduction(App.state.parts, product, qty);
        if (!check.ok) return { error: check.error };
        await App.commit(() => App.store.produce(productId, qty));
        toast(`Montagem registrada: ${int(qty)}× ${product.name}. Agora há ${int((product.ready || 0) + qty)} pronto(s).`);
      },
      'Registrar montagem'
    );
  }

  // =====================================================================
  //  Simulação
  // =====================================================================
  function viewSimulacao() {
    const manager = App.isManager();
    const stock = L.stockMap(App.state.parts);
    const rows = App.state.products
      .map((p) => {
        const { max } = L.maxProducible(p, stock);
        return `<div class="sim-row">
          <label for="sim-${p.id}"><b>${esc(p.name)}</b></label>
          <input id="sim-${p.id}" type="number" min="0" step="1" inputmode="numeric" placeholder="0" data-sim="${p.id}" value="${App.simPlan[p.id] || ''}" />
          <small>Máximo isolado: ${int(max)} · <button class="link-btn" data-action="sim-max" data-id="${p.id}">usar máximo</button></small>
        </div>`;
      })
      .join('');
    return `
      <section class="page-head">
        <div>
          <h1>Simulação</h1>
          <p class="muted">Digite quanto quer montar de cada produto e veja, ao vivo, se as peças dão conta, o que sobra e o que falta${manager ? ', e quanto isso rende' : ''}. Nada é alterado até você registrar a produção.</p>
        </div>
      </section>
      <div class="sim-layout">
        <div class="card">
          <h2>Quanto montar</h2>
          ${rows || '<p class="empty">Cadastre produtos para simular.</p>'}
          <div class="actions" style="margin-top:12px"><button class="btn small" data-action="sim-clear">Limpar</button></div>
        </div>
        <div id="sim-result"></div>
      </div>`;
  }

  function renderSimResult() {
    const box = $('#sim-result');
    if (!box) return;
    const manager = App.isManager();
    const sim = L.simulate(App.simPlan, App.state.products, App.state.parts);
    if (sim.units === 0) {
      box.innerHTML = `<div class="card empty">Informe uma quantidade em algum produto para ver o resultado.</div>`;
      return;
    }
    const tableRows = sim.rows
      .sort((a, b) => a.remaining - b.remaining)
      .map(
        (r) => `<tr>
          <td>${esc(r.name)}</td>
          <td class="right num">${int(r.used)}</td>
          <td class="right num">${int(r.stock)}</td>
          <td class="right num ${r.missing ? 'neg' : ''}">${r.missing ? '−' + int(r.missing) + ' (falta)' : int(r.remaining)}</td>
        </tr>`
      )
      .join('');
    const extra = App.state.products.filter((p) => sim.extra[p.id] > 0);
    const m = L.margin(sim.revenue, sim.cost);
    box.innerHTML = `
      <div class="banner ${sim.feasible ? 'ok' : 'bad'}">${
        sim.feasible
          ? `Dá para montar: ${int(sim.units)} unidade(s) no total com o estoque atual.`
          : 'Não dá: faltam peças para este plano (veja em vermelho na tabela).'
      }</div>
      ${
        manager
          ? `<div class="kpis">
              <div class="kpi"><div class="label">Receita prevista</div><div class="value">${brl(sim.revenue)}</div></div>
              <div class="kpi"><div class="label">Custo das peças</div><div class="value">${brl(sim.cost)}</div></div>
              <div class="kpi ${sim.profit >= 0 ? 'ok' : 'bad'}"><div class="label">Lucro previsto</div><div class="value">${brl(sim.profit)}</div><span class="hint">margem ${pct(m.pct)}</span></div>
            </div>`
          : ''
      }
      <div class="table-wrap"><table>
        <thead><tr><th>Peça usada</th><th class="right">Consumo</th><th class="right">Em estoque</th><th class="right">Sobra</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table></div>
      ${
        sim.feasible && extra.length
          ? `<div class="card" style="margin-top:14px"><h3>Depois disso, ainda dá para montar</h3>
              <div class="chips">${extra.map((p) => `<span class="pill ok">${esc(p.name)} · até ${int(sim.extra[p.id])}</span>`).join('')}</div></div>`
          : ''
      }
      <div class="actions" style="margin-top:14px">
        <button class="btn primary" data-action="sim-apply" ${sim.feasible ? '' : 'disabled'}>Registrar esta produção</button>
      </div>`;
  }

  async function applySimulation() {
    const sim = L.simulate(App.simPlan, App.state.products, App.state.parts);
    if (!sim.feasible || sim.units === 0) return;
    if (!(await confirmBox(`Registrar a montagem de ${sim.units} unidade(s) e descontar as peças do estoque?`, 'Registrar produção'))) return;
    try {
      for (const product of App.state.products) {
        const qty = Math.floor(Number(App.simPlan[product.id]) || 0);
        if (qty > 0) await App.store.produce(product.id, qty);
      }
      App.simPlan = {};
      await App.refresh();
      App.render();
      toast('Produção registrada e estoque atualizado.');
    } catch (e) {
      await App.refresh().catch(() => {});
      App.render();
      toast(e.message, 'error');
    }
  }

  // =====================================================================
  //  Histórico
  // =====================================================================
  function viewHistorico() {
    const mgr = App.isManager();
    const label = { entrada: 'Entrada', saida: mgr ? 'Saída' : 'Saiu p/ entrega', producao: 'Montagem' };
    const pill = { entrada: 'ok', saida: 'warn', producao: 'bad' };
    const originLabel = { estorno: 'Estorno', conferencia: 'Conferência', recebimento: 'Recebimento', desmontagem: 'Desmontagem' };
    const labelOf = (m) => originLabel[m.origin] || label[m.type] || esc(m.type);
    const rows = App.state.movements
      .slice(0, 300)
      .map((m) => {
        const sign = m.type === 'entrada' ? '+' : '−';
        const done = !!m.revertedBy;
        const canUndo = mgr && !done && !m.reverts && m.origin !== 'recebimento' && m.origin !== 'desmontagem' && (m.type === 'entrada' || m.type === 'saida');
        return `<tr${done ? ' class="reverted"' : ''}>
          <td class="num">${new Date(m.date).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
          <td><span class="pill ${m.origin ? 'info' : pill[m.type] || 'ok'}">${labelOf(m)}</span>${done ? ' <small class="muted">estornado</small>' : ''}</td>
          <td>${esc(m.partName)}</td>
          <td class="right num">${sign}${int(m.qty)}</td>
          ${mgr ? `<td>${esc(m.note)}</td>` : ''}
          <td>${esc(m.who || roleLabel(m.role))}</td>
          ${mgr ? `<td class="right">${canUndo ? `<button class="btn small" data-action="reverse-move" data-id="${m.id}">Estornar</button>` : ''}</td>` : ''}
        </tr>`;
      })
      .join('');
    return `<div class="table-wrap"><table>
        <thead><tr><th>Quando</th><th>Tipo</th><th>Peça</th><th class="right">Qtd.</th>${mgr ? '<th>Observação</th>' : ''}<th>Quem</th>${mgr ? '<th></th>' : ''}</tr></thead>
        <tbody>${rows || `<tr><td colspan="${mgr ? 7 : 5}" class="empty">Ainda não há movimentações.</td></tr>`}</tbody>
      </table></div>`;
  }
  App.partsHistoryHtml = viewHistorico;

  // =====================================================================
  //  Financeiro (só gerência)
  // =====================================================================

  // =====================================================================
  //  Auditoria de custos e preços (Financeiro)
  // =====================================================================
  const SRC = { manual: 'Ajuste manual', compra: 'Compra (entrada)', recebimento: 'Recebimento', cadastro: 'Cadastro' };
  App.auditFilter = App.auditFilter || 'todos';
  const changePct = (l) => (l.oldValue && l.oldValue > 0 ? ((l.newValue - l.oldValue) / l.oldValue) * 100 : null);
  const isAlert = (l) => l.kind === 'custo' && changePct(l) !== null && changePct(l) >= 10;

  function auditHtml() {
    const log = App.state.priceLog || [];
    const f = App.auditFilter;
    const shown = log.filter((l) => f === 'todos' || (f === 'alertas' ? isAlert(l) : f === 'custo' ? l.kind === 'custo' : l.kind === 'preco'));
    const alerts = log.filter(isAlert);
    const dt = (iso) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    const rows = shown
      .map((l) => {
        const c = changePct(l);
        const cls = c === null ? '' : l.kind === 'custo' ? (c > 0 ? 'neg' : 'pos') : c > 0 ? 'pos' : 'neg';
        return `<tr class="${isAlert(l) ? 'alert-row' : ''}">
          <td>${dt(l.date)}</td>
          <td><b>${esc(l.name)}</b><br><span class="hint">${l.kind === 'custo' ? 'Custo da peça' : 'Preço de venda'}</span></td>
          <td class="right num">${l.oldValue === null ? '–' : brl(l.oldValue)}</td>
          <td class="right num"><b>${brl(l.newValue)}</b></td>
          <td class="right num ${cls}">${c === null ? '–' : (c > 0 ? '+' : '') + pct(c)}</td>
          <td>${esc(SRC[l.source] || l.source)}${l.detail ? `<br><span class="hint">${esc(l.detail)}</span>` : ''}</td>
          <td>${esc(l.who || '')}</td>
        </tr>`;
      })
      .join('');
    const chips = [['todos', 'Tudo'], ['alertas', `Alertas${alerts.length ? ` (${alerts.length})` : ''}`], ['custo', 'Custos'], ['preco', 'Preços']]
      .map(([id, label]) => `<button class="chip ${f === id ? 'on' : ''}" data-action="audit-filter" data-id="${id}">${label}</button>`)
      .join('');
    return `
      <h2 style="margin-top:24px">Auditoria de custos e preços</h2>
      <p class="muted">Toda mudança de custo de peça ou preço de venda fica aqui: quando, de quanto para quanto, de onde veio (recebimento, compra, ajuste manual) e quem fez. Aumentos de custo de <b>10% ou mais</b> aparecem como alerta.</p>
      ${alerts.length ? `<div class="notice warn" role="status"><b>${alerts.length} aumento(s) de custo de 10% ou mais.</b> Última: ${esc(alerts[0].name)} (${alerts[0].oldValue !== null ? brl(alerts[0].oldValue) + ' → ' : ''}${brl(alerts[0].newValue)}). Confira se os preços de venda ainda cobrem a margem.</div>` : ''}
      <div class="chips" style="margin:10px 0">${chips}</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Quando</th><th>Item</th><th class="right">Antes</th><th class="right">Depois</th><th class="right">Variação</th><th>Origem</th><th>Quem</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" class="empty">Nenhuma mudança registrada ainda.</td></tr>'}</tbody>
      </table></div>`;
  }

  function viewFinanceiro() {
    const { parts, products } = App.state;
    const stock = L.stockMap(parts);
    const data = products
      .map((p) => {
        const cost = L.productCost(p, parts);
        const m = L.margin(p.price, cost);
        const { max } = L.maxProducible(p, stock);
        return { p, cost, m, max };
      })
      .sort((a, b) => b.m.pct - a.m.pct);
    const avg = data.length ? data.reduce((s, d) => s + d.m.pct, 0) / data.length : 0;
    const best = data[0];
    const worst = data[data.length - 1];
    const rows = data
      .map(
        (d) => `<tr>
          <td><b>${esc(d.p.name)}</b><br><span class="hint">${esc(d.p.category)}</span></td>
          <td class="right num">${brl(d.cost)}</td>
          <td class="right num">${brl(d.p.price)}</td>
          <td class="right num ${d.m.profit < 0 ? 'neg' : ''}">${brl(d.m.profit)}</td>
          <td class="right num"><span class="pill ${d.m.pct < 0 ? 'bad' : d.m.pct < 25 ? 'warn' : 'ok'}">${pct(d.m.pct)}</span></td>
          <td class="right num">${int(d.max)}</td>
          <td class="right num">${brl(d.max * d.m.profit)}</td>
        </tr>`
      )
      .join('');
    const partRows = [...parts]
      .sort((a, b) => b.stock * b.cost - a.stock * a.cost)
      .slice(0, 8)
      .map((p) => `<tr><td>${esc(p.name)}</td><td class="right num">${int(p.stock)}</td><td class="right num">${brl(p.cost)}</td><td class="right num">${brl(p.stock * p.cost)}</td></tr>`)
      .join('');
    return `
      <section class="page-head">
        <div>
          <h1>Financeiro</h1>
          <p class="muted">Custo de cada produto (soma das peças da ficha técnica), preço de venda e margem. Visível só para a gerência.</p>
        </div>
      </section>
      <div class="kpis">
        <div class="kpi"><div class="label">Valor parado em estoque</div><div class="value">${brl(L.stockValue(parts))}</div></div>
        <div class="kpi"><div class="label">Margem média</div><div class="value">${pct(avg)}</div></div>
        <div class="kpi ok"><div class="label">Melhor margem</div><div class="value">${best ? pct(best.m.pct) : '–'}</div><span class="hint">${best ? esc(best.p.name) : ''}</span></div>
        <div class="kpi ${worst && worst.m.pct < 25 ? 'warn' : ''}"><div class="label">Menor margem</div><div class="value">${worst ? pct(worst.m.pct) : '–'}</div><span class="hint">${worst ? esc(worst.p.name) : ''}</span></div>
      </div>
      <h2>Produtos por margem</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Produto</th><th class="right">Custo</th><th class="right">Preço</th><th class="right">Lucro / un.</th><th class="right">Margem</th><th class="right">Dá para montar</th><th class="right">Lucro se montar o máx.</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="7" class="empty">Sem produtos.</td></tr>`}</tbody>
      </table></div>
      <p class="hint" style="margin-top:8px">"Lucro se montar o máx." considera cada produto isoladamente; como as peças são compartilhadas, não some os valores. Use a Simulação para planos combinados.</p>
      <h2 style="margin-top:20px">Peças com mais dinheiro parado</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Peça</th><th class="right">Estoque</th><th class="right">Custo unit.</th><th class="right">Valor</th></tr></thead>
        <tbody>${partRows}</tbody>
      </table></div>${auditHtml()}`;
  }

  App.registerTab({ id: 'mostruario', label: 'Mostruário', order: 10, view: viewMostruario });
  App.registerTab({ id: 'pecas', label: 'Peças', order: 20, view: viewPecas });
  App.registerTab({ id: 'produtos', label: 'Produtos', order: 30, view: viewProdutos });
  App.registerTab({ id: 'simulacao', label: 'Simulação', order: 40, view: viewSimulacao, after: renderSimResult });
  App.registerTab({ id: 'financeiro', label: 'Financeiro', order: 70, managerOnly: true, view: viewFinanceiro });

  // =====================================================================
  //  Ações (botões com data-action)
  // =====================================================================
  Object.assign(App.actions, {
    'reverse-move': async (id) => {
      if (!App.isManager()) return;
      const m = App.state.movements.find((x) => x.id === id);
      if (!m) return;
      const what = m.type === 'entrada' ? 'a entrada' : 'a saída';
      if (!(await root.UI.confirmBox(`Estornar ${what} de ${m.qty} × ${m.partName}? O estoque volta ao que era e o estorno fica registrado no histórico.`, 'Estornar lançamento'))) return;
      await App.commit(() => App.store.reverse(id));
      toast('Lançamento estornado.');
    },
    'close-modal': () => closeModal(),
    'close-lightbox': () => $('#lightbox').close(),
    logout: () => logout(),
    'mfa-cancel': () => {
      if (App.auth.cancelMfa) App.auth.cancelMfa();
      showLogin();
    },
    'theme-toggle': () => applyTheme(!isDark(), true),
    'sb-toggle': () => (isMobile() ? setDrawer(false) : setSidebarMin(!document.documentElement.classList.contains('sb-min'))),
    'sb-open': () => setDrawer(true),
    'sb-close': () => setDrawer(false),
    retry: async () => {
      $('#view').innerHTML = `<div class="loading"><span class="spinner"></span> Carregando…</div>`;
      try {
        await App.refresh();
      } catch (e) {
        App.loadError = e.message;
      }
      App.render();
    },
    'toggle-pass': (id, el) => {
      const input = $('input[name=password]', el.closest('form'));
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      el.innerHTML = show ? icons.eyeOff : icons.eye;
      el.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
    },
    'demo-login': async (role) => {
      const r = root.Auth.signInDemo(role);
      if (r.ok) await enter(r.user);
    },
    'set-category': (cat) => {
      App.category = cat || '';
      App.render();
    },
    'pick-photo': (id, el) => {
      photoTarget = { kind: el.dataset.kind, id };
      if (el.dataset.close === 'lightbox') $('#lightbox').close();
      $('#photo-input').click();
    },
    'view-photo': (id, el) => openLightbox(el.dataset.kind, id),
    'photo-click': (id, el, e) => {
      const kind = el.dataset.kind;
      const item = findItem(kind, id);
      if (!item) return;
      const list = photosOf(kind, item);
      if (list.length > 1 && e) {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / (r.width || 1);
        if (x < 0.3) return stepPhoto(kind, id, -1);
        if (x > 0.7) return stepPhoto(kind, id, 1);
      }
      openLightbox(kind, id);
    },
    'lb-prev': (id, el) => {
      App.photoIdx[id] = (idxOf(el.dataset.kind, findItem(el.dataset.kind, id)) - 1 + photosOf(el.dataset.kind, findItem(el.dataset.kind, id)).length) % photosOf(el.dataset.kind, findItem(el.dataset.kind, id)).length;
      renderLightbox(el.dataset.kind, id);
    },
    'lb-next': (id, el) => {
      const item = findItem(el.dataset.kind, id);
      App.photoIdx[id] = (idxOf(el.dataset.kind, item) + 1) % photosOf(el.dataset.kind, item).length;
      renderLightbox(el.dataset.kind, id);
    },
    'lb-go': (id, el) => {
      App.photoIdx[id] = Number(el.dataset.i) || 0;
      renderLightbox(el.dataset.kind, id);
    },
    'photo-cover': async (id, el) => {
      const item = findItem(el.dataset.kind, id);
      const url = photosOf('product', item)[idxOf('product', item)];
      await App.store.coverPhoto(id, url);
      App.photoIdx[id] = 0;
      await App.refresh();
      App.render();
      renderLightbox('product', id);
      toast('Esta agora é a foto principal.');
    },
    'photo-remove': async (id, el) => {
      const kind = el.dataset.kind;
      const item = findItem(kind, id);
      if (!item || !(await confirmBox('Remover a foto?', 'Remover', true))) return;
      try {
        if (kind === 'product') {
          const url = photosOf('product', item)[idxOf('product', item)];
          await App.store.removePhoto(id, url);
          App.photoIdx[id] = 0;
        } else {
          await App.store.setPhoto(kind, id, null, item.photo);
        }
        await App.refresh();
        App.render();
        if (kind === 'product' && photosOf('product', findItem('product', id)).length) renderLightbox('product', id);
        else $('#lightbox').close();
        toast('Foto removida.');
      } catch (e) {
        toast(e.message, 'error');
      }
    },
    'new-part': () => openPartForm(),
    'edit-part': (id) => openPartForm(id),
    'del-part': (id) => deletePart(id),
    'move-in': (id) => openMovement(id, 'entrada'),
    'move-out': (id) => openMovement(id, 'saida'),
    'new-product': () => openProductForm(),
    'edit-product': (id) => openProductForm(id),
    'del-product': (id) => deleteProduct(id),
    produce: (id) => openProduce(id),
    guide: (id) => openGuide(id),
    'audit-filter': (id) => {
      App.auditFilter = id;
      App.render();
    },
    'add-bom-row': () => {
      const wrap = $('#bom-rows', $('#modal'));
      if (wrap) wrap.insertAdjacentHTML('beforeend', bomRow(App.state.parts[0].id, 1));
    },
    'del-bom-row': (id, btn) => {
      if ($$('.bom-row', $('#modal')).length > 1) btn.closest('.bom-row').remove();
    },
    'sim-max': (id) => {
      const p = App.state.products.find((x) => x.id === id);
      if (!p) return;
      App.simPlan[id] = L.maxProducible(p, L.stockMap(App.state.parts)).max;
      const input = $(`#sim-${CSS.escape(id)}`);
      if (input) input.value = App.simPlan[id] || '';
      renderSimResult();
    },
    'sim-clear': () => {
      App.simPlan = {};
      $$('[data-sim]').forEach((i) => (i.value = ''));
      renderSimResult();
    },
    'sim-apply': () => applySimulation(),
    // modo demonstração
    'export-json': async () => {
      const blob = new Blob([JSON.stringify(await App.store.exportJson(), null, 2)], { type: 'application/json' });
      App.download(blob, `estoque-backup-${new Date().toISOString().slice(0, 10)}.json`);
    },
    'import-json': () => $('#json-input').click(),
    'reset-demo': async () => {
      if (!(await confirmBox('Apagar tudo e voltar aos dados de exemplo?', 'Restaurar', true))) return;
      await App.commit(() => App.store.reset());
      toast('Dados de exemplo restaurados.');
    },
  });

  App.download = function (blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  // =====================================================================
  //  Eventos globais
  // =====================================================================
  function bindEvents() {
    document.addEventListener('click', (e) => {
      if (e.target.tagName === 'DIALOG') {
        // clique no fundo escuro fecha a janela (menos a de confirmação)
        if (e.target.id !== 'confirm') e.target.close();
        return;
      }
      const tabBtn = e.target.closest('[data-tab]');
      if (tabBtn) {
        App.tab = tabBtn.dataset.tab;
        App.render(true);
        window.scrollTo({ top: 0 });
        setDrawer(false);
        return;
      }
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const fn = App.actions[btn.dataset.action];
      if (!fn) return;
      Promise.resolve()
        .then(() => fn(btn.dataset.id, btn, e))
        .catch((err) => toast((err && err.message) || 'Algo deu errado.', 'error'));
    });

    // efeito de "onda" no clique (só enfeite; respeita quem prefere menos movimento)
    document.addEventListener('pointerdown', (e) => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const el = e.target.closest('.tab, .subtab, .btn, .chip, .hoje-btn, .icon-top, .side-link, .cal-day');
      if (!el || el.disabled) return;
      const r = el.getBoundingClientRect();
      const size = Math.max(r.width, r.height) * 1.6;
      const s = document.createElement('span');
      s.className = 'ripple';
      s.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
      el.appendChild(s);
      setTimeout(() => s.remove(), 650);
    });

    document.addEventListener('submit', (e) => {
      if (e.target.id === 'login-form') {
        e.preventDefault();
        doLogin(e.target);
      } else if (e.target.id === 'mfa-form') {
        e.preventDefault();
        doMfa(e.target);
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const d = e.key === 'ArrowRight' ? 1 : -1;
      const btn = e.target.closest && e.target.closest('.media-main[data-action="photo-click"]');
      if (btn) {
        e.preventDefault();
        return stepPhoto(btn.dataset.kind, btn.dataset.id, d);
      }
      const lb = $('#lightbox');
      const stage = lb && lb.open ? $('.lb-stage', lb) : null;
      if (stage) {
        const item = findItem(stage.dataset.kind, stage.dataset.id);
        const n = item ? photosOf(stage.dataset.kind, item).length : 0;
        if (n > 1) {
          App.photoIdx[stage.dataset.id] = (idxOf(stage.dataset.kind, item) + d + n) % n;
          renderLightbox(stage.dataset.kind, stage.dataset.id);
        }
      }
    });

    document.addEventListener('input', (e) => {
      const t = e.target;
      if (t.id === 'filter') {
        App.filter = t.value;
        const grid = $('#grid');
        if (grid) grid.innerHTML = cardsHtml();
      } else if (t.id === 'prod-filter') {
        App.prodFilter = t.value;
        const grid = $('#prod-grid');
        if (grid) grid.innerHTML = prodCardsHtml();
      } else if (t.id === 'part-filter') {
        App.partFilter = t.value;
        const body = $('#parts-body');
        if (body) body.innerHTML = partRowsHtml();
      } else if (t.dataset && t.dataset.sim) {
        const v = Math.max(0, Math.floor(Number(t.value) || 0));
        if (v > 0) App.simPlan[t.dataset.sim] = v;
        else delete App.simPlan[t.dataset.sim];
        renderSimResult();
      }
    });

    $('#photo-input').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      handlePhotoFile(file);
    });

    $('#json-input').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const d = JSON.parse(String(reader.result));
          if (!(await confirmBox('Substituir todos os dados atuais pelos do arquivo?', 'Substituir', true))) return;
          await App.commit(() => App.store.importJson(d));
          toast('Backup importado.');
        } catch (err) {
          toast('Arquivo inválido. Use um backup exportado por este sistema.', 'error');
        }
      };
      reader.readAsText(file);
    });
  }

  // =====================================================================
  //  Início
  // =====================================================================
  App.start = async function () {
    App.auth = root.supabaseEnabled ? root.SupabaseAuth : root.Auth;
    if (App.auth.onSessionLost) {
      App.auth.onSessionLost(() => {
        App.user = null;
        showLogin('Sua sessão expirou. Entre de novo.');
      });
    }
    bindEvents();
    renderSbToggle();
    document.body.dataset.screen = 'loading';
    try {
      const user = await App.auth.current();
      if (user) await enter(user);
      else showLogin();
    } catch (e) {
      showLogin(e.message);
    }
  };
})(typeof self !== 'undefined' ? self : this);
