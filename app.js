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
    tab: 'mostruario',
    filter: '',
    partFilter: '',
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
          <h1>Entrar</h1>
          <p class="muted">Acesse com seu e-mail e senha.</p>
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
            <button class="btn primary big" type="submit">Entrar</button>
          </form>
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

  async function enter(user) {
    App.user = user;
    App.tab = 'mostruario';
    App.filter = App.partFilter = App.category = '';
    App.simPlan = {};
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
      ${App.auth.isDemo ? '<span class="mode-badge" title="Os dados ficam só neste navegador">Demonstração</span>' : ''}
      <div class="user-chip">
        <span class="avatar">${esc(initials)}</span>
        <span class="who"><b>${esc(u.name)}</b><small>${roleLabel(u.role)}</small></span>
      </div>
      <button class="btn-ghost-light" data-action="logout">${icons.logout}<span>Sair</span></button>`;
  }

  // =====================================================================
  //  Abas e renderização
  // =====================================================================
  const visibleTabs = () =>
    App.tabs.filter((t) => (!t.managerOnly || App.isManager()) && (!t.remoteOnly || App.isRemote()));

  function renderTabs() {
    const tabs = visibleTabs();
    if (!tabs.some((t) => t.id === App.tab)) App.tab = 'mostruario';
    $('#tabs').innerHTML = tabs
      .map(
        (t) =>
          `<button class="tab" data-tab="${t.id}" ${t.id === App.tab ? 'aria-current="page"' : ''}>${t.label}${
            t.managerOnly ? '<span class="lock">gerência</span>' : ''
          }</button>`
      )
      .join('');
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
    if (App.isRemote()) {
      f.innerHTML = `<span>Conectado ao banco de dados online.</span>`;
    } else if (App.isManager()) {
      f.innerHTML = `<span>Modo demonstração: dados salvos neste navegador.</span>
        <button class="btn small" data-action="export-json">Exportar backup</button>
        <button class="btn small" data-action="import-json">Importar backup</button>
        <button class="btn small danger" data-action="reset-demo">Restaurar dados de exemplo</button>`;
    } else {
      f.innerHTML = `<span>Modo demonstração. Valores financeiros ficam ocultos para o perfil Funcionário.</span>`;
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

  function media(kind, item, badge) {
    const has = !!item.photo;
    return `<div class="media ${has ? 'has' : ''}">
      <button type="button" class="media-main" data-action="view-photo" data-kind="${kind}" data-id="${item.id}" aria-label="${has ? 'Ampliar foto de ' : 'Adicionar foto de '}${esc(item.name)}">
        ${has ? `<img src="${esc(item.photo)}" alt="${esc(item.name)}" loading="lazy" />` : `<span class="ph">${icons.image}<small>Adicionar foto</small></span>`}
      </button>
      ${badge || ''}
      <button type="button" class="media-btn" data-action="pick-photo" data-kind="${kind}" data-id="${item.id}" title="${has ? 'Trocar foto' : 'Adicionar foto'}" aria-label="${has ? 'Trocar foto' : 'Adicionar foto'}">${icons.camera}</button>
    </div>`;
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
      await App.store.setPhoto(t.kind, t.id, local ? { dataUrl: prep.dataUrl } : { blob: prep.blob }, item && item.photo);
      await App.refresh();
      App.render();
      toast('Foto salva.');
    } catch (e) {
      toast(e.message || 'Não consegui salvar a foto.', 'error');
    }
  }

  function openLightbox(kind, id) {
    const item = findItem(kind, id);
    if (!item) return;
    if (!item.photo) {
      photoTarget = { kind, id };
      $('#photo-input').click();
      return;
    }
    const dlg = $('#lightbox');
    dlg.innerHTML = `
      <figure>
        <img src="${esc(item.photo)}" alt="${esc(item.name)}" />
        <figcaption>${esc(item.name)}</figcaption>
      </figure>
      <div class="modal-actions">
        <button class="btn danger" data-action="photo-remove" data-kind="${kind}" data-id="${id}">Remover foto</button>
        <button class="btn" data-action="pick-photo" data-kind="${kind}" data-id="${id}" data-close="lightbox">Trocar foto</button>
        <button class="btn primary" data-action="close-lightbox">Fechar</button>
      </div>`;
    dlg.showModal();
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
  function viewProdutos() {
    const manager = App.isManager();
    const byId = L.partsById(App.state.parts);
    const stock = L.stockMap(App.state.parts);
    const cards = App.state.products
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
            <div><span class="hint">Ficha técnica (por unidade)</span><ul class="bom">${items || '<li class="muted">Nenhuma peça cadastrada.</li>'}</ul></div>
            ${money}
            <div class="actions">
              <button class="btn primary small" data-action="produce" data-id="${p.id}" ${max === 0 ? 'disabled' : ''}>Registrar montagem</button>
              ${manager ? `<button class="btn small" data-action="edit-product" data-id="${p.id}">Editar</button>` : ''}
            </div>
          </div>
        </article>`;
      })
      .join('');
    return `
      <section class="page-head">
        <div>
          <h1>Produtos</h1>
          <p class="muted">Cada produto final tem uma ficha técnica: as peças e quantas entram em uma unidade. É ela que alimenta o mostruário e a simulação.</p>
        </div>
        <div class="actions">${manager ? `<button class="btn primary" data-action="new-product">${icons.plus} Novo produto</button>` : ''}</div>
      </section>
      <div class="grid">${cards || '<div class="empty card" style="grid-column:1/-1">Nenhum produto cadastrado.</div>'}</div>`;
  }

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
        toast(`Montagem registrada: ${int(qty)}× ${product.name}.`);
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
    const rows = App.state.movements
      .slice(0, 300)
      .map((m) => {
        const sign = m.type === 'entrada' ? '+' : '−';
        return `<tr>
          <td class="num">${new Date(m.date).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
          <td><span class="pill ${pill[m.type] || 'ok'}">${label[m.type] || esc(m.type)}</span></td>
          <td>${esc(m.partName)}</td>
          <td class="right num">${sign}${int(m.qty)}</td>
          ${mgr ? `<td>${esc(m.note)}</td>` : ''}
          <td>${esc(m.who || roleLabel(m.role))}</td>
        </tr>`;
      })
      .join('');
    return `
      <section class="page-head">
        <div>
          <h1>Histórico</h1>
          <p class="muted">Últimas movimentações de peças: entradas, saídas e consumo das montagens.</p>
        </div>
      </section>
      <div class="table-wrap"><table>
        <thead><tr><th>Quando</th><th>Tipo</th><th>Peça</th> <th class="right">Qtd.</th>${mgr ? '<th>Observação</th>' : ''}<th>Quem</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="${mgr ? 6 : 5}" class="empty">Ainda não há movimentações.</td></tr>`}</tbody>
      </table></div>`;
  }

  // =====================================================================
  //  Financeiro (só gerência)
  // =====================================================================
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
      </table></div>`;
  }

  App.registerTab({ id: 'mostruario', label: 'Mostruário', order: 10, view: viewMostruario });
  App.registerTab({ id: 'pecas', label: 'Peças', order: 20, view: viewPecas });
  App.registerTab({ id: 'produtos', label: 'Produtos', order: 30, view: viewProdutos });
  App.registerTab({ id: 'simulacao', label: 'Simulação', order: 40, view: viewSimulacao, after: renderSimResult });
  App.registerTab({ id: 'historico', label: 'Histórico', order: 60, view: viewHistorico });
  App.registerTab({ id: 'financeiro', label: 'Financeiro', order: 70, managerOnly: true, view: viewFinanceiro });

  // =====================================================================
  //  Ações (botões com data-action)
  // =====================================================================
  Object.assign(App.actions, {
    'close-modal': () => closeModal(),
    'close-lightbox': () => $('#lightbox').close(),
    logout: () => logout(),
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
    'photo-remove': async (id, el) => {
      const kind = el.dataset.kind;
      const item = findItem(kind, id);
      if (!item || !(await confirmBox('Remover a foto?', 'Remover', true))) return;
      try {
        await App.store.setPhoto(kind, id, null, item.photo);
        $('#lightbox').close();
        await App.refresh();
        App.render();
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

    document.addEventListener('submit', (e) => {
      if (e.target.id === 'login-form') {
        e.preventDefault();
        doLogin(e.target);
      }
    });

    document.addEventListener('input', (e) => {
      const t = e.target;
      if (t.id === 'filter') {
        App.filter = t.value;
        const grid = $('#grid');
        if (grid) grid.innerHTML = cardsHtml();
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
