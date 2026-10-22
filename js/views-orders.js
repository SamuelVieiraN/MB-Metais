/*
 * Aba "Pedidos": pedidos de clientes com acompanhamento.
 * Quem monta registra a montagem em Produtos (as peças saem e o produto vira "pronto").
 * Aqui o gerente cria o pedido, vê o que já está montado, o que falta e se as peças dão para o que falta,
 * e finaliza: só finaliza com tudo montado, e dá baixa nos produtos prontos.
 * O funcionário acompanha o andamento, sem o nome do cliente.
 */
(function (root) {
  'use strict';

  const App = root.App;
  const L = root.Logic;
  const { esc, int, icons, toast, confirmBox, openModal, $, $$ } = root.UI;

  App.orFilter = App.orFilter || 'abertos';

  const STATUS = {
    aberto: { label: 'Em andamento', pill: 'warn' },
    concluido: { label: 'Concluído', pill: 'ok' },
    cancelado: { label: 'Cancelado', pill: 'bad' },
  };
  const FILTERS = [
    ['abertos', 'Em andamento'],
    ['concluido', 'Concluídos'],
    ['cancelado', 'Cancelados'],
    ['todos', 'Todos'],
  ];
  const dt = (iso) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const matches = (o) => App.orFilter === 'todos' || (App.orFilter === 'abertos' ? o.status === 'aberto' : o.status === App.orFilter);

  // =====================================================================
  //  Lista
  // =====================================================================
  function cardHtml(o, alloc) {
    const manager = App.isManager();
    const st = STATUS[o.status] || STATUS.aberto;
    const pr = L.orderProgress(o, alloc[o.id], App.state.products, App.state.parts);
    const open = o.status === 'aberto';

    const rows = pr.lines
      .map((l) => {
        const cls = !open ? '' : l.missing === 0 ? 'ok' : l.have > 0 ? 'warn' : 'bad';
        const label = !open ? (o.status === 'concluido' ? 'entregue' : '–') : l.missing === 0 ? 'montado' : l.have > 0 ? `faltam ${int(l.missing)}` : 'não montado';
        return `<tr>
          <td>${esc(l.name)}${l.code ? `<br><small class="muted">${esc(l.code)}</small>` : ''}${l.gone ? ' <span class="pill bad">produto removido</span>' : ''}</td>
          <td class="right num">${int(l.qty)}</td>
          <td class="right num"><b>${int(l.have)}</b></td>
          <td class="right"><span class="pill ${cls}">${label}</span></td>
        </tr>`;
      })
      .join('');

    let banner = '';
    if (open) {
      if (pr.gone) banner = `<div class="notice warn">Um dos produtos deste pedido foi removido do sistema. ${manager ? 'Edite o pedido.' : 'Avise o gerente.'}</div>`;
      else if (pr.complete) banner = `<div class="notice ok">${icons.check} <b>Tudo montado.</b> ${manager ? 'Pode finalizar o pedido e dar baixa.' : 'Aguardando o gerente finalizar.'}</div>`;
      else if (pr.buildable) banner = `<div class="notice">Faltam montar <b>${int(pr.missing)}</b> unidade(s). <b>As peças em estoque dão</b> para montar o que falta: registre as montagens em Produtos.</div>`;
      else
        banner = `<div class="notice warn">Faltam montar <b>${int(pr.missing)}</b> unidade(s) e <b>as peças não dão</b> para tudo. Faltam: ${pr.partShortages
          .map((r) => `${esc(r.name)} (${int(r.missing)})`)
          .join(', ')}. Veja a aba Reposição.</div>`;
    }

    const log = (o.log || [])
      .map((e) => `<li><b>${dt(e.at)}</b> · ${esc(e.by || '')} · ${esc(e.action)}${manager && e.detail ? ` — <i>${esc(e.detail)}</i>` : ''}</li>`)
      .join('');
    const actions = [];
    if (open) {
      actions.push(`<button class="btn" data-action="go-tab" data-id="produtos">Ir para Produtos (montar)</button>`);
      if (manager) {
        actions.unshift(`<button class="btn primary" data-action="or-finish" data-id="${o.id}" ${pr.complete ? '' : 'disabled'} title="${pr.complete ? '' : 'Só finaliza com tudo montado'}">Finalizar pedido (dar baixa)</button>`);
        actions.push(`<button class="btn" data-action="or-edit" data-id="${o.id}">Editar</button>`);
        actions.push(`<button class="btn danger" data-action="or-cancel" data-id="${o.id}">Cancelar pedido</button>`);
      }
    }
    return `<details class="changes rc-card" ${open ? 'open' : ''}>
      <summary><b>#${o.num}</b> · ${dt(o.date)}${manager && o.customer ? ` · ${esc(o.customer)}` : ''}${o.ref ? ` · ${esc(o.ref)}` : ''}
        <span class="pill ${st.pill}">${st.label}</span>${open ? ` <span class="muted">${int(pr.have)} de ${int(pr.total)} montados</span>` : ''}</summary>
      <div style="padding:0 14px 14px">
        ${open || o.status === 'concluido' ? `<div class="ord-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${o.status === 'concluido' ? 100 : pr.pct}"><span class="${pr.complete || o.status === 'concluido' ? 'full' : ''}" style="width:${o.status === 'concluido' ? 100 : pr.pct}%"></span></div>` : ''}
        ${banner}
        <div class="table-wrap"><table>
          <thead><tr><th>Produto</th><th class="right">Pedido</th><th class="right">Montados</th><th class="right">Situação</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        ${open ? '<p class="hint" style="margin-top:6px">Os produtos montados são repartidos entre os pedidos em andamento, do mais antigo para o mais novo. A conta de peças vale para este pedido sozinho.</p>' : ''}
        <p class="hint" style="margin:10px 0 4px"><b>Registro</b></p>
        <ul class="rc-log">${log}</ul>
        ${actions.length ? `<div class="actions" style="margin-top:10px">${actions.join('')}</div>` : ''}
      </div>
    </details>`;
  }

  function view() {
    const orders = App.state.orders || [];
    const alloc = L.allocateReady(orders, App.state.products);
    const list = orders.filter(matches);
    const openN = orders.filter((o) => o.status === 'aberto').length;
    const readyN = orders.filter((o) => o.status === 'aberto' && L.orderProgress(o, alloc[o.id], App.state.products, App.state.parts).complete).length;
    const chips = FILTERS.map(([id, label]) => `<button class="chip ${App.orFilter === id ? 'on' : ''}" data-action="or-filter" data-id="${id}">${label}</button>`).join('');
    const manager = App.isManager();
    return `
      <section class="page-head">
        <div>
          <h1>Pedidos</h1>
          <p class="muted">Acompanhe cada pedido: o que já está montado, o que falta e se as peças dão para o que falta. ${
            manager ? 'Quando tudo estiver montado, finalize o pedido para dar baixa nos produtos.' : 'Monte os produtos pela aba Produtos; o gerente finaliza o pedido.'
          }</p>
        </div>
        <div class="actions">${manager ? `<button class="btn primary" data-action="or-new">${icons.plus} Novo pedido</button>` : ''}</div>
      </section>
      <div class="kpis">
        <div class="kpi"><div class="label">Em andamento</div><div class="value">${int(openN)}</div></div>
        <div class="kpi ${readyN ? 'ok' : ''}"><div class="label">Prontos para finalizar</div><div class="value">${int(readyN)}</div></div>
      </div>
      <div class="chips" style="margin:12px 0">${chips}</div>
      <div id="or-list">${list.length ? list.map((o) => cardHtml(o, alloc)).join('') : '<p class="empty">Nenhum pedido por aqui.</p>'}</div>`;
  }

  // =====================================================================
  //  Formulário (novo / editar)
  // =====================================================================
  function rowHtml(item) {
    const opts = App.state.products
      .map((p) => `<option value="${p.id}" ${item && item.productId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`)
      .join('');
    return `<div class="bom-row">
      <select name="orProd" aria-label="Produto">${opts}</select>
      <input name="orQty" type="number" min="1" step="1" inputmode="numeric" value="${item ? item.qty : 1}" aria-label="Quantidade" />
      <button type="button" class="icon-btn" data-action="or-del-row" aria-label="Remover produto">${icons.x}</button>
    </div>`;
  }

  function openForm(order) {
    if (!App.isManager()) return;
    if (!App.state.products.length) {
      toast('Cadastre os produtos antes de criar um pedido.', 'error');
      return;
    }
    const editing = !!order;
    const rows = (editing ? order.items : [null]).map(rowHtml).join('');
    const body = `
      <label>Cliente
        <input name="customer" type="text" maxlength="80" placeholder="Nome do cliente" value="${editing ? esc(order.customer) : ''}" />
      </label>
      <label>Referência do pedido (opcional)
        <input name="ref" type="text" maxlength="60" placeholder="Ex.: Pedido 1234" value="${editing ? esc(order.ref) : ''}" />
      </label>
      <div>
        <strong style="font-size:.9rem">Produtos e quantidades</strong>
        <div id="or-rows" style="margin-top:6px">${rows}</div>
        <button type="button" class="btn small" data-action="or-add-row">${icons.plus} Adicionar produto</button>
      </div>
      <p class="hint">O nome do cliente só o gerente vê. O funcionário acompanha o pedido pelo número e pelos produtos.</p>`;
    openModal(
      editing ? `Editar pedido #${order.num}` : 'Novo pedido',
      body,
      async (fd) => {
        const ids = fd.getAll('orProd');
        const qtys = fd.getAll('orQty');
        const merged = {};
        for (let i = 0; i < ids.length; i++) {
          const q = Math.floor(Number(qtys[i]));
          if (!(q > 0)) return { error: 'Todo produto do pedido precisa de quantidade maior que zero.' };
          merged[ids[i]] = (merged[ids[i]] || 0) + q;
        }
        const items = Object.keys(merged).map((productId) => ({ productId, qty: merged[productId] }));
        if (!items.length) return { error: 'Adicione ao menos um produto.' };
        const payload = { customer: String(fd.get('customer') || ''), ref: String(fd.get('ref') || ''), items };
        if (editing) await App.commit(() => App.store.editOrder(order.id, payload));
        else await App.commit(() => App.store.createOrder(payload));
        toast(editing ? 'Pedido atualizado.' : 'Pedido criado.');
      },
      editing ? 'Salvar alterações' : 'Criar pedido',
      { wide: true, noFocus: true }
    );
  }

  // =====================================================================
  //  Ações
  // =====================================================================
  const find = (id) => (App.state.orders || []).find((o) => o.id === id);

  Object.assign(App.actions, {
    'or-new': () => openForm(null),
    'or-edit': (id) => {
      const o = find(id);
      if (o && o.status === 'aberto') openForm(o);
    },
    'or-filter': (id) => {
      App.orFilter = id;
      App.render();
    },
    'or-add-row': () => $('#or-rows', $('#modal')).insertAdjacentHTML('beforeend', rowHtml(null)),
    'or-del-row': (id, btn) => {
      if ($$('.bom-row', $('#or-rows', $('#modal'))).length > 1) btn.closest('.bom-row').remove();
    },
    'go-tab': (id) => {
      App.tab = id;
      App.render();
    },
    'or-finish': async (id) => {
      const o = find(id);
      if (!o || !App.isManager()) return;
      const total = o.items.reduce((s, i) => s + i.qty, 0);
      if (!(await confirmBox(`Finalizar o pedido #${o.num}? Saem dos produtos montados ${int(total)} unidade(s) em ${o.items.length} produto(s).`, 'Finalizar e dar baixa'))) return;
      try {
        await App.commit(() => App.store.finishOrder(id));
        toast('Pedido finalizado e baixa dada nos produtos.');
      } catch (e) {
        toast(e.message, 'error');
      }
    },
    'or-cancel': (id) => {
      const o = find(id);
      if (!o || !App.isManager()) return;
      openModal(
        `Cancelar pedido #${o.num}`,
        `<p>O pedido fica registrado como <b>Cancelado</b>. Os produtos montados continuam no estoque de prontos.</p>
         <label>Motivo (obrigatório)
           <input name="reason" type="text" maxlength="120" placeholder="Ex.: cliente desistiu" />
         </label>`,
        async (fd) => {
          const reason = String(fd.get('reason') || '').trim();
          if (!reason) return { error: 'Informe o motivo do cancelamento.' };
          await App.commit(() => App.store.cancelOrder(id, reason));
          toast('Pedido cancelado. O registro foi mantido.');
        },
        'Cancelar pedido'
      );
    },
  });

  App.registerTab({ id: 'pedidos', label: 'Pedidos', order: 31, view });
})(typeof self !== 'undefined' ? self : this);
