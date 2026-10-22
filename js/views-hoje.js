/*
 * Tela "Hoje": a porta de entrada do sistema.
 * Funcionário: três botões grandes (receber, montar, contar) + o que ainda precisa ser montado.
 * Gerente: pendências que esperam uma decisão + atalhos.
 */
(function (root) {
  'use strict';

  const App = root.App;
  const L = root.Logic;
  const { esc, int } = root.UI;

  function toBuild() {
    const { products, orders } = App.state;
    const open = (orders || []).filter((o) => o.status === 'aberto');
    const alloc = L.allocateReady(orders || [], products);
    const need = {};
    for (const o of open) {
      for (const it of o.items) {
        const got = (alloc[o.id] && alloc[o.id][it.productId]) || 0;
        if (it.qty - got > 0) need[it.productId] = (need[it.productId] || 0) + it.qty - got;
      }
    }
    return Object.keys(need)
      .map((id) => ({ p: products.find((x) => x.id === id), qty: need[id] }))
      .filter((r) => r.p)
      .sort((a, b) => b.qty - a.qty);
  }

  const bigBtn = (tab, icon, title, sub, badge) =>
    `<button class="hoje-btn" data-action="go-tab" data-id="${tab}"><span class="hoje-ico">${icon}</span><b>${title}</b><small>${sub}</small>${badge ? `<span class="hoje-badge">${badge}</span>` : ''}</button>`;

  function buildList() {
    const rows = toBuild();
    if (!rows.length) return '<p class="empty">Nada para montar agora. Nenhum pedido em andamento está esperando produto.</p>';
    return `<div class="table-wrap"><table>
      <thead><tr><th>Produto</th><th class="right">Falta montar</th><th></th></tr></thead>
      <tbody>${rows
        .map(
          (r) => `<tr>
        <td><div class="ord-prod">${r.p.photo ? `<img class="mini" src="${esc(r.p.photo)}" alt="" loading="lazy" />` : ''}<span><b>${esc(r.p.name)}</b><br><small class="muted">${esc(r.p.code || r.p.category || '')}</small></span></div></td>
        <td class="right num"><b>${int(r.qty)}</b></td>
        <td class="right nowrap"><button class="btn small" data-action="mt-guide" data-id="${r.p.id}">Guia</button> <button class="btn small primary" data-action="go-tab" data-id="produtos">Montar</button></td>
      </tr>`
        )
        .join('')}</tbody></table></div>`;
  }

  function pendingCards() {
    const s = App.state;
    const receipts = (s.receipts || []).filter((r) => r.status === 'pendente').length;
    const counts = (s.counts || []).filter((c) => c.status === 'pendente').length;
    const alloc = L.allocateReady(s.orders || [], s.products);
    const ready = (s.orders || []).filter((o) => o.status === 'aberto' && L.orderProgress(o, alloc[o.id], s.products, s.parts).complete).length;
    const low = L.lowStock(s.parts).length;
    const items = [];
    if (receipts) items.push(['recebimento', `${int(receipts)} recebimento(s) esperando autorização`, 'As peças só entram no estoque depois que você autoriza.', 'Revisar']);
    if (ready) items.push(['pedidos', `${int(ready)} pedido(s) pronto(s) para finalizar`, 'Já há produtos montados suficientes; falta dar baixa.', 'Ver pedidos']);
    if (counts) items.push(['conferencia', `${int(counts)} contagem(ns) para aprovar`, 'O estoque só é corrigido depois da sua aprovação.', 'Revisar']);
    if (low) items.push(['reposicao', `${int(low)} peça(s) com estoque baixo`, 'No mínimo ou abaixo dele. Veja o que comprar.', 'Ver reposição']);
    if (!items.length) return '<div class="card hoje-ok"><b>Tudo em dia.</b><p class="muted">Nada esperando por você agora.</p></div>';
    return `<div class="hoje-list">${items
      .map(([tab, t, d, b]) => `<div class="card hoje-item"><div><b>${t}</b><p class="muted">${d}</p></div><button class="btn primary" data-action="go-tab" data-id="${tab}">${b}</button></div>`)
      .join('')}</div>`;
  }

  function view() {
    const mgr = App.isManager();
    const first = String((App.user && App.user.name) || '').split(' ')[0];
    const date = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
    const ic = (d) => `<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
    const I = {
      box: ic('<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>'),
      tool: ic('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.4 2.4-2.6-.6-.6-2.6z"/>'),
      list: ic('<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>'),
      cart: ic('<path d="M6 6h15l-2 9H8zM6 6L5 3H2M9 20h.01M18 20h.01"/>'),
    };
    return `
      <section class="page-head">
        <div>
          <h1>Olá${first ? ', ' + esc(first) : ''}</h1>
          <p class="muted">${date}. ${mgr ? 'Aqui estão as coisas que esperam uma decisão sua.' : 'O que você precisa fazer hoje.'}</p>
        </div>
      </section>
      ${
        mgr
          ? `<h2>Pendências</h2>${pendingCards()}
             <h2 style="margin-top:22px">Atalhos</h2>
             <div class="hoje-grid">
               ${bigBtn('recebimento', I.box, 'Receber mercadoria', 'Conferir o que chegou')}
               ${bigBtn('pedidos', I.cart, 'Pedidos', 'Novo pedido, finalizar')}
               ${bigBtn('produtos', I.tool, 'Montar produto', 'Registrar montagem')}
               ${bigBtn('conferencia', I.list, 'Contar estoque', 'Conferência')}
             </div>`
          : `<div class="hoje-grid">
               ${bigBtn('recebimento', I.box, 'Receber mercadoria', 'Chegou peça nova')}
               ${bigBtn('produtos', I.tool, 'Montar produto', 'Registrar uma montagem')}
               ${bigBtn('conferencia', I.list, 'Contar estoque', 'Conferir o que tem na prateleira')}
             </div>
             <h2 style="margin-top:22px">O que ainda precisa ser montado</h2>
             <p class="muted" style="margin:4px 0 12px">Soma dos pedidos em andamento, já descontando o que está montado.</p>
             ${buildList()}`
      }`;
  }

  App.registerTab({ id: 'hoje', label: 'Hoje', order: 5, view });
})(typeof self !== 'undefined' ? self : this);
