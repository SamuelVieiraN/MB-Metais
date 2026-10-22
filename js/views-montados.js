/*
 * Aba "Montados": o estoque de produtos já montados (prontos).
 * Entram aqui as montagens registradas em Produtos e os ajustes do gerente (ex.: 10 torneiras
 * montadas a mais, ou que sobraram de um pedido cancelado). Saem quando um pedido é finalizado.
 * Pedidos em andamento usam os montados automaticamente (do mais antigo para o mais novo);
 * o gerente também pode "acionar" montados para um pedido específico, que passa na frente.
 */
(function (root) {
  'use strict';

  const App = root.App;
  const L = root.Logic;
  const { esc, int, icons, toast, openModal, $ } = root.UI;

  App.mtFilter = App.mtFilter || 'com';
  App.mtSearch = App.mtSearch || '';

  const KIND = { montagem: 'Montagem', ajuste: 'Ajuste', pedido: 'Pedido finalizado' };
  const dt = (iso) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

  function data() {
    const { products, orders } = App.state;
    const open = (orders || []).filter((o) => o.status === 'aberto');
    const alloc = L.allocateReady(orders || [], products);
    const q = App.mtSearch.trim().toLowerCase();
    return products
      .map((p) => {
        let used = 0;
        const needs = [];
        for (const o of open) {
          const it = o.items.find((i) => i.productId === p.id);
          if (!it) continue;
          const got = (alloc[o.id] && alloc[o.id][p.id]) || 0;
          used += got;
          needs.push({ o, it, got, missing: it.qty - got });
        }
        return { p, ready: p.ready || 0, used, free: (p.ready || 0) - used, needs };
      })
      .filter((r) => (App.mtFilter === 'todos' || r.ready > 0) && (!q || [r.p.name, r.p.code, r.p.category].join(' ').toLowerCase().includes(q)))
      .sort((a, b) => b.ready - a.ready || a.p.name.localeCompare(b.p.name, 'pt-BR'));
  }

  function rowsHtml() {
    const manager = App.isManager();
    const rows = data();
    if (!rows.length) {
      return `<tr><td colspan="6" class="empty">${App.mtFilter === 'com' && !App.mtSearch ? 'Nenhum produto montado em estoque. Registre montagens em Produtos ou use "Todos" para ajustar um produto.' : 'Nenhum produto encontrado.'}</td></tr>`;
    }
    return rows
      .map((r) => {
        const need = r.needs
          .map((n) => `<span class="pill ${n.missing > 0 ? 'warn' : 'ok'}" title="${n.missing > 0 ? 'Ainda faltam ' + n.missing : 'Completo'}">#${n.o.num}${n.o.ref ? ' ' + esc(n.o.ref) : ''}: ${int(n.got)}/${int(n.it.qty)}</span>`)
          .join(' ');
        return `<tr class="${r.ready === 0 ? 'dim' : ''}">
          <td><div class="ord-prod">${
            r.p.photo ? `<img class="mini" src="${esc(r.p.photo)}" alt="" loading="lazy" />` : ''
          }<span><b>${esc(r.p.name)}</b><br><small class="muted">${esc(r.p.category)}${r.p.code ? ' · ' + esc(r.p.code) : ''}</small></span></div></td>
          <td class="right num"><b>${int(r.ready)}</b></td>
          <td class="right num">${int(r.used)}</td>
          <td class="right num"><b>${int(r.free)}</b></td>
          <td>${need || '<span class="muted">Nenhum pedido precisa</span>'}</td>
          <td class="right nowrap">
            <button class="btn small" data-action="mt-guide" data-id="${r.p.id}">Guia</button>
            ${manager ? `<button class="btn small" data-action="mt-assign" data-id="${r.p.id}" ${r.needs.length && r.ready > 0 ? '' : 'disabled'} title="${r.needs.length ? 'Reservar montados para um pedido' : 'Nenhum pedido em andamento precisa deste produto'}">Acionar a pedido</button>
            <button class="btn small" data-action="mt-adjust" data-id="${r.p.id}">Ajustar</button>` : ''}
          </td>
        </tr>`;
      })
      .join('');
  }

  function historyHtml() {
    const manager = App.isManager();
    const log = (App.state.readyLog || []).slice(0, 30);
    if (!log.length) return '<p class="empty">Nada registrado ainda.</p>';
    const rows = log
      .map(
        (l) => `<tr>
        <td>${dt(l.date)}</td>
        <td>${esc(l.name)}</td>
        <td><span class="pill ${l.kind === 'pedido' ? 'info' : l.kind === 'ajuste' ? 'warn' : 'ok'}">${KIND[l.kind] || l.kind}</span></td>
        <td class="right num ${l.delta > 0 ? 'pos' : 'neg'}">${l.delta > 0 ? '+' : ''}${int(l.delta)}</td>
        <td>${esc(l.who || '')}</td>
        ${manager ? `<td>${esc(l.note || '')}</td>` : ''}
      </tr>`
      )
      .join('');
    return `<div class="table-wrap"><table>
      <thead><tr><th>Quando</th><th>Produto</th><th>Tipo</th><th class="right">Quantidade</th><th>Quem</th>${manager ? '<th>Observação</th>' : ''}</tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }

  function view() {
    const products = App.state.products;
    const total = products.reduce((s, p) => s + (p.ready || 0), 0);
    const kinds = products.filter((p) => (p.ready || 0) > 0).length;
    const alloc = L.allocateReady(App.state.orders || [], products);
    const used = Object.values(alloc).reduce((s, m) => s + Object.values(m).reduce((a, b) => a + b, 0), 0);
    return `
      <section class="page-head">
        <div>
          <h1>Montados</h1>
          <p class="muted">Produtos já montados, prontos para sair. Eles vêm das montagens registradas em Produtos, de sobras (por exemplo, de um pedido cancelado) ou de um ajuste seu. Os pedidos em andamento usam os montados automaticamente, do mais antigo para o mais novo.</p>
        </div>
        <input class="search" id="mt-search" type="search" placeholder="Buscar por nome, código ou categoria…" value="${esc(App.mtSearch)}" aria-label="Buscar produto montado" />
      </section>
      <div class="kpis">
        <div class="kpi"><div class="label">Unidades montadas</div><div class="value">${int(total)}</div></div>
        <div class="kpi"><div class="label">Tipos de produto</div><div class="value">${int(kinds)}</div></div>
        <div class="kpi"><div class="label">Destinadas a pedidos</div><div class="value">${int(used)}</div></div>
        <div class="kpi ${total - used > 0 ? 'ok' : ''}"><div class="label">Livres (sem pedido)</div><div class="value">${int(total - used)}</div></div>
      </div>
      <div class="chips" style="margin:12px 0">
        <button class="chip ${App.mtFilter === 'com' ? 'on' : ''}" data-action="mt-filter" data-id="com">Só com montados</button>
        <button class="chip ${App.mtFilter === 'todos' ? 'on' : ''}" data-action="mt-filter" data-id="todos">Todos os produtos</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Produto</th><th class="right">Montados</th><th class="right">Em pedidos</th><th class="right">Livres</th><th>Pedidos que usam (recebem/precisam)</th><th></th></tr></thead>
        <tbody id="mt-body">${rowsHtml()}</tbody>
      </table></div>
      <h2 style="margin-top:22px">Movimentações de montados</h2>
      ${historyHtml()}`;
  }

  // ---------------- ajustar ----------------
  function openAdjust(id) {
    const p = App.state.products.find((x) => x.id === id);
    if (!p || !App.isManager()) return;
    openModal(
      `Ajustar montados · ${p.name}`,
      `<p class="muted">Agora há <b>${int(p.ready || 0)}</b> montado(s). Use para registrar produtos que já existem montados (sem descontar peças) ou para tirar do estoque.</p>
       <label>O que aconteceu
         <select name="dir">
           <option value="in">Entraram (já estavam montados / montados a mais)</option>
           <option value="out">Saíram (venda direta, perda, correção)</option>
         </select>
       </label>
       <label>Quantidade
         <input name="qty" type="number" min="1" step="1" inputmode="numeric" value="1" required />
       </label>
       <label>Observação (obrigatória se saíram)
         <input name="note" type="text" maxlength="120" placeholder="Ex.: sobraram do pedido 101" />
       </label>
       <p class="hint">As peças <b>não</b> são descontadas por aqui: o ajuste só muda a contagem de montados. Para montar a partir das peças, use Registrar montagem em Produtos.</p>`,
      async (fd) => {
        const qty = Math.floor(Number(fd.get('qty')));
        if (!(qty > 0)) return { error: 'Informe uma quantidade maior que zero.' };
        const delta = fd.get('dir') === 'out' ? -qty : qty;
        await App.commit(() => App.store.adjustReady(id, delta, String(fd.get('note') || '')));
        toast(delta > 0 ? `${int(qty)} montado(s) adicionados.` : `${int(qty)} montado(s) retirados.`);
      },
      'Salvar ajuste'
    );
  }

  // ---------------- acionar a pedido ----------------
  function openAssign(id) {
    const p = App.state.products.find((x) => x.id === id);
    if (!p || !App.isManager()) return;
    const r = data().find((x) => x.p.id === id) || { needs: [] };
    const open = (App.state.orders || []).filter((o) => o.status === 'aberto' && o.items.some((i) => i.productId === id));
    if (!open.length) {
      toast('Nenhum pedido em andamento precisa deste produto.', 'error');
      return;
    }
    const reservedOthers = (oid) => open.filter((o) => o.id !== oid).reduce((s, o) => s + (o.items.find((i) => i.productId === id).reserved || 0), 0);
    const opts = open
      .map((o) => {
        const it = o.items.find((i) => i.productId === id);
        const max = Math.max(0, Math.min(it.qty, (p.ready || 0) - reservedOthers(o.id)));
        return `<option value="${o.id}" data-qty="${it.qty}" data-res="${it.reserved || 0}" data-max="${max}">#${o.num}${o.ref ? ' · ' + esc(o.ref) : ''}${o.customer ? ' · ' + esc(o.customer) : ''} (precisa ${it.qty})</option>`;
      })
      .join('');
    const first = open[0].items.find((i) => i.productId === id);
    const max0 = Math.max(0, Math.min(first.qty, (p.ready || 0) - reservedOthers(open[0].id)));
    openModal(
      `Acionar a pedido · ${p.name}`,
      `<p class="muted">Há <b>${int(p.ready || 0)}</b> montado(s). Reservar para um pedido faz ele passar na frente dos outros.</p>
       <label>Pedido
         <select name="order" id="mt-order">${opts}</select>
       </label>
       <label>Quantidade a reservar (0 libera a reserva)
         <input name="qty" id="mt-qty" type="number" min="0" step="1" inputmode="numeric" value="${Math.min(max0, first.qty)}" required />
       </label>
       <p class="hint" id="mt-hint">Já reservado neste pedido: ${int(first.reserved || 0)}. Máximo possível agora: ${int(max0)}.</p>`,
      async (fd) => {
        const qty = Math.floor(Number(fd.get('qty')));
        if (!(qty >= 0)) return { error: 'Informe uma quantidade a partir de zero.' };
        await App.commit(() => App.store.reserveOrderItem(String(fd.get('order')), id, qty));
        toast(qty === 0 ? 'Reserva liberada.' : `${int(qty)} montado(s) reservados para o pedido.`);
      },
      'Reservar',
      { noFocus: true }
    );
  }

  document.addEventListener('change', (e) => {
    if (e.target.id !== 'mt-order') return;
    const opt = e.target.selectedOptions[0];
    $('#mt-qty').value = opt.dataset.max;
    $('#mt-hint').textContent = `Já reservado neste pedido: ${opt.dataset.res}. Máximo possível agora: ${opt.dataset.max}.`;
  });
  document.addEventListener('input', (e) => {
    if (e.target.id !== 'mt-search') return;
    App.mtSearch = e.target.value;
    const body = $('#mt-body');
    if (body) body.innerHTML = rowsHtml();
  });

  Object.assign(App.actions, {
    'mt-filter': (id) => {
      App.mtFilter = id;
      App.render();
    },
    'mt-guide': (id) => App.openGuide(id),
    'mt-adjust': (id) => openAdjust(id),
    'mt-assign': (id) => openAssign(id),
  });

  App.registerTab({ id: 'montados', label: 'Montados', order: 31.5, view });
})(typeof self !== 'undefined' ? self : this);
