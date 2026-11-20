/*
 * Loja online (só gerência, só com o banco online):
 *   Catálogo      -> o que aparece na loja pública e com qual preço de vitrine
 *   Solicitações  -> pedidos feitos pelos clientes: aprovar (vira pedido) ou recusar
 *   Clientes      -> quem se cadastrou
 *   Auditoria     -> registro das ações administrativas
 */
(function (root) {
  'use strict';

  const App = root.App;
  const { esc, icons, toast, openModal, confirmBox, brl, int, $, $$ } = root.UI;
  const V = root.Validators;

  const dt = (v) => (v ? new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '–');
  const digits = (s) => String(s || '').replace(/\D/g, '');

  // =====================================================================
  //  Catálogo
  // =====================================================================
  let cat = null; // { productId: {published, price, show_price, blurb, sort} }
  let draft = {}; // alterações ainda não salvas
  let catErr = null;
  let catSearch = '';
  let catFilter = 'todos';

  const blank = () => ({ published: false, price: null, show_price: false, blurb: '', sort: 0 });
  const rowOf = (id) => draft[id] || (cat && cat[id]) || blank();
  const draftCount = () => Object.keys(draft).length;

  async function loadCat() {
    try {
      const rows = await App.store.listCatalog();
      cat = {};
      rows.forEach((r) => (cat[r.product_id] = { published: !!r.published, price: r.price === null ? null : Number(r.price), show_price: !!r.show_price, blurb: r.blurb || '', sort: r.sort || 0 }));
      catErr = null;
    } catch (e) {
      cat = {};
      catErr = e.message;
    }
  }

  function catRows() {
    const q = catSearch.trim().toLowerCase();
    const list = App.state.products.filter((p) => {
      const r = rowOf(p.id);
      if (catFilter === 'na-loja' && !r.published) return false;
      if (catFilter === 'fora' && r.published) return false;
      return !q || `${p.name} ${p.code} ${p.category}`.toLowerCase().includes(q);
    });
    if (!list.length) return '<tr><td colspan="5" class="empty">Nenhum produto encontrado.</td></tr>';
    return list
      .map((p) => {
        const r = rowOf(p.id);
        const img = (p.photos && p.photos[0]) || p.photo;
        return `<tr data-pid="${esc(p.id)}" class="${draft[p.id] ? 'dirty' : ''}">
          <td><label class="switch"><input type="checkbox" data-cf="published" ${r.published ? 'checked' : ''} aria-label="Mostrar ${esc(p.name)} na loja" /><span>${r.published ? 'Na loja' : 'Fora'}</span></label></td>
          <td><div class="ord-prod">${img ? `<img class="mini" src="${esc(img)}" alt="" loading="lazy" />` : ''}<span><b>${esc(p.name)}</b><br><small class="muted">${esc(p.code || p.category || '')}</small></span></div></td>
          <td><input type="number" min="0" max="9999999" step="0.01" inputmode="decimal" data-cf="price" value="${r.price === null ? '' : esc(r.price)}" placeholder="${p.price ? 'venda: ' + esc(brl(p.price)) : 'R$'}" aria-label="Preço de vitrine" /></td>
          <td><label class="switch"><input type="checkbox" data-cf="show_price" ${r.show_price ? 'checked' : ''} aria-label="Mostrar o preço na loja" /><span>${r.show_price ? 'Mostra' : 'Sob consulta'}</span></label></td>
          <td><input type="text" maxlength="400" data-cf="blurb" value="${esc(r.blurb)}" placeholder="Descrição curta (opcional)" aria-label="Descrição curta" /></td>
        </tr>`;
      })
      .join('');
  }

  function catSaveBtn() {
    const n = draftCount();
    return `<button class="btn primary" data-action="cat-save" ${n ? '' : 'disabled'}>${n ? `Salvar alterações (${n})` : 'Nada a salvar'}</button>`;
  }

  function viewCatalogo() {
    if (cat === null) return `<div class="loading"><span class="spinner"></span> Carregando catálogo…</div>`;
    const published = App.state.products.filter((p) => rowOf(p.id).published).length;
    const chip = (id, label) => `<button class="chip ${catFilter === id ? 'on' : ''}" data-action="cat-filter" data-id="${id}">${label}</button>`;
    return `
      <section class="page-head">
        <div>
          <h1>Catálogo da loja</h1>
          <p class="muted">Marque o que aparece para os clientes. Por padrão o preço fica como <b>Sob consulta</b>; se quiser mostrar, informe o valor e ligue <b>Mostra</b>. O preço de vitrine é só seu: o funcionário nunca o vê.</p>
        </div>
        <div class="actions">
          <a class="btn" href="loja" target="_blank" rel="noopener">${icons.link} Abrir a loja</a>
          <button class="btn" data-action="cat-copy">Copiar link</button>
          <span id="cat-save">${catSaveBtn()}</span>
        </div>
      </section>
      ${catErr ? `<div class="banner bad">${esc(catErr)}</div>` : ''}
      <div class="toolbar">
        <input class="search" type="search" id="cat-search" placeholder="Buscar produto" value="${esc(catSearch)}" aria-label="Buscar produto" />
        <div class="chips">${chip('todos', 'Todos')}${chip('na-loja', `Na loja (${published})`)}${chip('fora', 'Fora da loja')}</div>
      </div>
      <div class="table-wrap"><table class="cat-table">
        <thead><tr><th>Loja</th><th>Produto</th><th>Preço de vitrine (R$)</th><th>Preço</th><th>Descrição curta</th></tr></thead>
        <tbody id="cat-body">${catRows()}</tbody>
      </table></div>
      <p class="hint" style="margin-top:10px">Os clientes veem o nome, o código, as fotos, a descrição e se há pronta entrega. Peças, custos, ficha técnica e quantidades nunca aparecem na loja.</p>`;
  }

  function readRow(tr) {
    const pid = tr.dataset.pid;
    const base = { ...rowOf(pid) };
    const get = (f) => $(`[data-cf=${f}]`, tr);
    base.published = get('published').checked;
    base.show_price = get('show_price').checked;
    const pv = String(get('price').value).trim().replace(',', '.');
    base.price = pv === '' ? null : Number(pv);
    base.blurb = get('blurb').value;
    const orig = (cat && cat[pid]) || blank();
    const same = orig.published === base.published && orig.show_price === base.show_price && orig.price === base.price && orig.blurb === base.blurb;
    if (same) delete draft[pid];
    else draft[pid] = base;
    tr.classList.toggle('dirty', !same);
    $('.switch span', $('[data-cf=published]', tr).closest('.switch')).textContent = base.published ? 'Na loja' : 'Fora';
    $('.switch span', $('[data-cf=show_price]', tr).closest('.switch')).textContent = base.show_price ? 'Mostra' : 'Sob consulta';
    const b = $('[data-action=cat-save]');
    if (b) {
      const n = draftCount();
      b.disabled = !n;
      b.textContent = n ? `Salvar alterações (${n})` : 'Nada a salvar';
    }
  }

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'cat-search') {
      catSearch = t.value;
      const b = $('#cat-body');
      if (b) b.innerHTML = catRows();
    } else if (t.id === 'cu-search') {
      cuSearch = t.value;
      const b = $('#cu-body');
      if (b) b.innerHTML = custRows();
    } else if (t.dataset && t.dataset.cf && t.closest('#cat-body')) {
      readRow(t.closest('tr'));
    }
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.cf && t.closest('#cat-body')) readRow(t.closest('tr'));
  });

  // =====================================================================
  //  Solicitações
  // =====================================================================
  let reqs = null;
  let reqErr = null;
  let reqFilter = 'novas';

  App.refreshRequests = async () => {
    try {
      reqs = await App.store.listRequests();
      reqErr = null;
    } catch (e) {
      reqs = reqs || [];
      reqErr = e.message;
    }
    App.newRequests = reqs.filter((r) => r.status === 'nova').length;
    if (App.tab === 'hoje' || App.tab === 'solicitacoes') App.render();
  };

  const STATUS = {
    nova: ['warn', 'Nova'],
    aprovada: ['ok', 'Aprovada'],
    recusada: ['bad', 'Recusada'],
    cancelada: ['info', 'Cancelada pelo cliente'],
  };

  function addressTxt(r) {
    const a = [r.street && `${r.street}, ${r.number || 's/n'}${r.complement ? ' (' + r.complement + ')' : ''}`, r.district, r.city && `${r.city}/${r.uf}`, r.cep && 'CEP ' + V.maskCEP(r.cep)].filter(Boolean);
    return a.join(' · ');
  }

  function reqCard(r) {
    const st = STATUS[r.status] || ['info', r.status];
    const phone = digits(r.phone);
    const items = (r.items || []).map((i) => `<li><b>${esc(i.qty)}×</b> ${esc(i.name)}${i.code ? ` <small class="muted">${esc(i.code)}</small>` : ''}</li>`).join('');
    const acts =
      r.status === 'nova'
        ? `<button class="btn primary" data-action="req-approve" data-id="${esc(r.id)}">Aprovar e criar pedido</button>
           <button class="btn danger" data-action="req-reject" data-id="${esc(r.id)}">Recusar</button>`
        : r.status === 'aprovada'
        ? `<button class="btn" data-action="go-tab" data-id="pedidos">Ver em Pedidos</button>`
        : '';
    return `<article class="card req ${esc(r.status)}">
      <header><b>Solicitação #${esc(r.num)}</b><span class="muted"> · ${esc(dt(r.created_at))}</span> <span class="pill ${st[0]}">${esc(st[1])}</span></header>
      <p class="req-cust"><b>${esc(r.customer_name || 'Cliente excluído')}</b>${r.doc ? ` · ${r.kind === 'pj' ? 'CNPJ' : 'CPF'} ${esc(V.fmtDoc(r.kind, r.doc))}` : ''}</p>
      <p class="muted req-contact">
        ${phone ? `<a href="tel:${esc(phone)}">${esc(V.maskPhone(phone))}</a> · <a href="https://wa.me/55${esc(phone)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
        ${r.email ? ` · <a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : ''}
      </p>
      <p class="muted">${esc(addressTxt(r))}</p>
      <ul class="req-items">${items}</ul>
      ${r.note ? `<p class="req-note">“${esc(r.note)}”</p>` : ''}
      ${r.status === 'recusada' && r.reason ? `<p class="muted">Motivo: ${esc(r.reason)}</p>` : ''}
      ${r.decided_by && r.status !== 'nova' ? `<p class="hint">${esc(st[1])} por ${esc(r.decided_by)} em ${esc(dt(r.decided_at))}</p>` : ''}
      ${acts ? `<div class="req-actions">${acts}</div>` : ''}
    </article>`;
  }

  function viewSolicitacoes() {
    if (reqs === null) return `<div class="loading"><span class="spinner"></span> Carregando solicitações…</div>`;
    const novas = reqs.filter((r) => r.status === 'nova').length;
    const list = reqFilter === 'novas' ? reqs.filter((r) => r.status === 'nova') : reqs;
    const chip = (id, label) => `<button class="chip ${reqFilter === id ? 'on' : ''}" data-action="req-filter" data-id="${id}">${label}</button>`;
    return `
      <section class="page-head">
        <div>
          <h1>Solicitações da loja</h1>
          <p class="muted">Pedidos que os clientes enviaram pela loja online. Ao aprovar, o sistema cria o pedido (com prazo de entrega, se você informar) e ele entra no calendário.</p>
        </div>
        <div class="actions"><button class="btn" data-action="req-reload">Atualizar</button></div>
      </section>
      ${reqErr ? `<div class="banner bad">${esc(reqErr)}</div>` : ''}
      <div class="toolbar"><div class="chips">${chip('novas', `Novas (${novas})`)}${chip('todas', 'Todas')}</div></div>
      ${list.length ? `<div class="req-list">${list.map(reqCard).join('')}</div>` : `<div class="card empty"><p>${reqFilter === 'novas' ? 'Nenhuma solicitação nova.' : 'Nenhuma solicitação ainda.'}</p></div>`}`;
  }

  // =====================================================================
  //  Clientes
  // =====================================================================
  let custs = null;
  let custErr = null;
  let cuSearch = '';

  async function loadCusts() {
    try {
      custs = await App.store.listCustomers();
      custErr = null;
    } catch (e) {
      custs = [];
      custErr = e.message;
    }
  }

  function custRows() {
    const q = cuSearch.trim().toLowerCase();
    const list = (custs || []).filter((c) => !q || `${c.name} ${c.doc} ${c.email} ${c.city}`.toLowerCase().includes(q));
    if (!list.length) return '<tr><td colspan="6" class="empty">Nenhum cliente.</td></tr>';
    return list
      .map(
        (c) => `<tr>
        <td><b>${esc(c.name)}</b><br><small class="muted">${c.kind === 'pj' ? 'CNPJ' : 'CPF'} ${esc(V.fmtDoc(c.kind, c.doc))}</small></td>
        <td>${esc(V.maskPhone(c.phone))}<br><small class="muted">${esc(c.email)}</small></td>
        <td>${esc(c.city)}/${esc(c.uf)}</td>
        <td class="right num">${esc(int(c.requests))}<br><small class="muted">${c.last_request ? esc(dt(c.last_request)) : ''}</small></td>
        <td><span class="pill ${c.active ? 'ok' : 'bad'}">${c.active ? 'Ativo' : 'Bloqueado'}</span></td>
        <td class="row-actions"><button class="btn small ${c.active ? 'danger' : ''}" data-action="cu-toggle" data-id="${esc(c.id)}">${c.active ? 'Bloquear' : 'Liberar'}</button></td>
      </tr>`
      )
      .join('');
  }

  function viewClientes() {
    if (custs === null) return `<div class="loading"><span class="spinner"></span> Carregando clientes…</div>`;
    return `
      <section class="page-head">
        <div>
          <h1>Clientes</h1>
          <p class="muted">Quem se cadastrou na loja. Bloquear impede novas solicitações. Os dados são pessoais: use só para atender o pedido (LGPD).</p>
        </div>
        <div class="actions"><button class="btn" data-action="cu-reload">Atualizar</button></div>
      </section>
      ${custErr ? `<div class="banner bad">${esc(custErr)}</div>` : ''}
      <div class="toolbar"><input class="search" type="search" id="cu-search" placeholder="Buscar por nome, documento, e-mail ou cidade" value="${esc(cuSearch)}" aria-label="Buscar cliente" /></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Cliente</th><th>Contato</th><th>Cidade</th><th class="right">Solicitações</th><th>Acesso</th><th></th></tr></thead>
        <tbody id="cu-body">${custRows()}</tbody>
      </table></div>`;
  }

  // =====================================================================
  //  Auditoria
  // =====================================================================
  let audit = null;
  let auditErr = null;
  const ACTION = {
    catalogo_salvo: 'Catálogo salvo',
    solicitacao_aprovada: 'Solicitação aprovada',
    solicitacao_recusada: 'Solicitação recusada',
    cliente_bloqueado: 'Cliente bloqueado',
    cliente_reativado: 'Cliente liberado',
    cliente_excluiu_conta: 'Cliente excluiu a conta',
    usuario_alterado: 'Usuário alterado',
    auditoria_limpa: 'Registros antigos apagados',
  };

  async function loadAudit() {
    try {
      audit = await App.store.listAudit();
      auditErr = null;
    } catch (e) {
      audit = [];
      auditErr = e.message;
    }
  }

  function viewAuditoria() {
    if (audit === null) return `<div class="loading"><span class="spinner"></span> Carregando registro…</div>`;
    const rows = audit
      .map((a) => `<tr><td class="nowrap">${esc(dt(a.at))}</td><td>${esc(a.user_name || '–')}</td><td>${esc(ACTION[a.action] || a.action)}</td><td class="muted">${esc(a.detail)}</td></tr>`)
      .join('');
    return `
      <section class="page-head">
        <div>
          <h1>Auditoria</h1>
          <p class="muted">Registro das ações de gerência (catálogo, solicitações, clientes e usuários). Não guarda CPF, e-mail nem outros dados pessoais. Fica guardado por 12 meses.</p>
        </div>
        <div class="actions">
          <button class="btn" data-action="au-reload">Atualizar</button>
          <button class="btn danger" data-action="au-purge">Apagar com mais de 12 meses</button>
        </div>
      </section>
      ${auditErr ? `<div class="banner bad">${esc(auditErr)}</div>` : ''}
      <div class="table-wrap"><table>
        <thead><tr><th>Quando</th><th>Quem</th><th>O quê</th><th>Detalhe</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="4" class="empty">Nenhuma ação registrada ainda.</td></tr>'}</tbody>
      </table></div>`;
  }

  // =====================================================================
  //  Ações
  // =====================================================================
  Object.assign(App.actions, {
    'cat-filter': (id) => {
      catFilter = id;
      App.render();
    },
    'cat-copy': async () => {
      const url = new URL('loja', location.href).href;
      try {
        await navigator.clipboard.writeText(url);
        toast('Link da loja copiado: ' + url);
      } catch (e) {
        toast('Copie o endereço: ' + url);
      }
    },
    'cat-save': async (id, btn) => {
      const items = Object.entries(draft).map(([pid, r]) => ({ product_id: pid, published: r.published, price: r.price, show_price: r.show_price, blurb: String(r.blurb || '').trim(), sort: r.sort || 0 }));
      if (!items.length) return;
      for (const i of items) {
        if (i.price !== null && (!Number.isFinite(i.price) || i.price < 0)) return toast('Há um preço inválido. Corrija e salve de novo.', 'error');
        if (i.show_price && i.price === null) return toast('Para mostrar o preço, informe o valor (ou deixe como Sob consulta).', 'error');
      }
      btn.disabled = true;
      btn.classList.add('busy');
      try {
        await App.store.saveCatalog(items);
        draft = {};
        await loadCat();
        toast('Catálogo salvo.');
      } catch (e) {
        toast(e.message, 'error');
      }
      App.render();
    },

    'req-filter': (id) => {
      reqFilter = id;
      App.render();
    },
    'req-reload': async () => {
      await App.refreshRequests();
    },
    'req-approve': (id) => {
      const r = (reqs || []).find((x) => x.id === id);
      if (!r) return;
      openModal(
        `Aprovar solicitação #${r.num}`,
        `<p>Vai criar um pedido com <b>${esc((r.items || []).length)}</b> produto(s) para <b>${esc(r.customer_name)}</b>.</p>
         <label>Prazo de entrega ao cliente (opcional)<input type="date" name="due" /></label>
         <p class="hint">O pedido entra em Pedidos e no Calendário. Depois é só montar e finalizar como sempre.</p>`,
        async (fd) => {
          await App.store.approveRequest(id, String(fd.get('due') || ''));
          await App.refresh();
          await App.refreshRequests();
          toast('Solicitação aprovada: o pedido foi criado.');
        },
        'Aprovar e criar pedido'
      );
    },
    'req-reject': (id) => {
      const r = (reqs || []).find((x) => x.id === id);
      if (!r) return;
      openModal(
        `Recusar solicitação #${r.num}`,
        `<label>Motivo (o cliente vê)<textarea name="reason" rows="3" maxlength="300" placeholder="Ex.: produto indisponível no momento"></textarea></label>`,
        async (fd) => {
          await App.store.rejectRequest(id, String(fd.get('reason') || ''));
          await App.refreshRequests();
          toast('Solicitação recusada.');
        },
        'Recusar'
      );
    },

    'cu-reload': async () => {
      custs = null;
      App.render();
      await loadCusts();
      App.render();
    },
    'cu-toggle': async (id) => {
      const c = (custs || []).find((x) => x.id === id);
      if (!c) return;
      const ok = await confirmBox(c.active ? `Bloquear ${c.name}? O cliente não poderá mais enviar solicitações.` : `Liberar ${c.name} de novo?`, c.active ? 'Bloquear' : 'Liberar', c.active);
      if (!ok) return;
      try {
        await App.store.setCustomerActive(id, !c.active);
        await loadCusts();
        toast(c.active ? 'Cliente bloqueado.' : 'Cliente liberado.');
      } catch (e) {
        toast(e.message, 'error');
      }
      App.render();
    },

    'au-reload': async () => {
      audit = null;
      App.render();
      await loadAudit();
      App.render();
    },
    'au-purge': async () => {
      const ok = await confirmBox('Apagar os registros de auditoria com mais de 12 meses? Isso não pode ser desfeito.', 'Apagar', true);
      if (!ok) return;
      try {
        const n = await App.store.purgeAudit(12);
        toast(`${n} registro(s) antigo(s) apagado(s).`);
        await loadAudit();
      } catch (e) {
        toast(e.message, 'error');
      }
      App.render();
    },
  });

  const lazy = (get, load, id) => async () => {
    if (get() === null) {
      await load();
      if (App.tab === id) App.render();
    }
  };

  App.registerTab({ id: 'catalogo', label: 'Catálogo', order: 62, managerOnly: true, remoteOnly: true, view: viewCatalogo, after: lazy(() => cat, loadCat, 'catalogo') });
  App.registerTab({
    id: 'solicitacoes',
    label: 'Solicitações',
    order: 63,
    managerOnly: true,
    remoteOnly: true,
    view: viewSolicitacoes,
    after: async () => {
      if (reqs === null) await App.refreshRequests();
    },
  });
  App.registerTab({ id: 'clientes', label: 'Clientes', order: 64, managerOnly: true, remoteOnly: true, view: viewClientes, after: lazy(() => custs, loadCusts, 'clientes') });
  App.registerTab({ id: 'auditoria', label: 'Auditoria', order: 90, managerOnly: true, remoteOnly: true, view: viewAuditoria, after: lazy(() => audit, loadAudit, 'auditoria') });
})(typeof self !== 'undefined' ? self : this);
