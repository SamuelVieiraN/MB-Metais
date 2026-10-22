/*
 * Aba "Movimentações": registro geral de tudo que entra e sai.
 * Zona 1 – Produtos (montagens, pedidos finalizados, vendas diretas, desmontagens, ajustes).
 * Zona 2 – Peças (entradas, saídas, consumo das montagens, recebimentos, conferências, estornos).
 * Um botão lateral fixo leva direto ao início de cada zona.
 */
(function (root) {
  'use strict';

  const App = root.App;
  const { esc, int, $ } = root.UI;

  App.mvFilter = App.mvFilter || 'todos';

  const KIND = { montagem: 'Montagem', pedido: 'Pedido finalizado', venda: 'Venda direta', desmontagem: 'Desmontagem', ajuste: 'Ajuste' };
  const PILL = { montagem: 'ok', pedido: 'info', venda: 'warn', desmontagem: 'bad', ajuste: 'warn' };
  const dt = (iso) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

  function productRows() {
    const mgr = App.isManager();
    const f = App.mvFilter;
    const log = (App.state.readyLog || []).filter((l) => f === 'todos' || l.kind === f).slice(0, 200);
    if (!log.length) return `<tr><td colspan="${mgr ? 6 : 5}" class="empty">Nada registrado${f === 'todos' ? ' ainda' : ' com este filtro'}.</td></tr>`;
    return log
      .map(
        (l) => `<tr>
        <td class="num">${dt(l.date)}</td>
        <td><span class="pill ${PILL[l.kind] || 'ok'}">${KIND[l.kind] || esc(l.kind)}</span></td>
        <td>${esc(l.name)}</td>
        <td class="right num ${l.delta > 0 ? 'pos' : 'neg'}">${l.delta > 0 ? '+' : ''}${int(l.delta)}</td>
        <td>${esc(l.who || '')}</td>
        ${mgr ? `<td>${esc(l.note || '')}</td>` : ''}
      </tr>`
      )
      .join('');
  }

  function view() {
    const mgr = App.isManager();
    const chips = [['todos', 'Todos'], ...Object.entries(KIND)]
      .map(([k, v]) => `<button class="chip ${App.mvFilter === k ? 'on' : ''}" data-action="mv-filter" data-id="${k}">${v}</button>`)
      .join('');
    return `
      <nav class="zone-nav" aria-label="Ir para">
        <button data-action="mv-zone" data-id="zona-produtos" title="Ir para Produtos">Produtos</button>
        <button data-action="mv-zone" data-id="zona-pecas" title="Ir para Peças">Peças</button>
      </nav>
      <section class="page-head">
        <div>
          <h1>Movimentações</h1>
          <p class="muted">Registro geral: primeiro o que aconteceu com os <b>produtos</b> (montagem, pedidos, venda direta, desmontagem) e, logo abaixo, com as <b>peças</b>. Use os botões do lado para pular entre as duas partes.</p>
        </div>
      </section>
      <section id="zona-produtos" class="zone">
        <h2>Produtos</h2>
        <div class="chips" style="margin:8px 0 12px">${chips}</div>
        <div class="table-wrap"><table>
          <thead><tr><th>Quando</th><th>Tipo</th><th>Produto</th><th class="right">Quantidade</th><th>Quem</th>${mgr ? '<th>Observação</th>' : ''}</tr></thead>
          <tbody id="mv-body">${productRows()}</tbody>
        </table></div>
      </section>
      <section id="zona-pecas" class="zone">
        <h2>Peças</h2>
        <p class="muted" style="margin:4px 0 12px">Entradas, saídas e consumo das montagens.${mgr ? ' Lançou algo por engano? Use <b>Estornar</b>: o estoque volta e o estorno fica registrado.' : ''}</p>
        ${App.partsHistoryHtml()}
      </section>`;
  }

  Object.assign(App.actions, {
    'mv-filter': (id) => {
      App.mvFilter = id;
      const y = window.scrollY;
      App.render();
      window.scrollTo(0, y);
    },
    'mv-zone': (id) => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
  });

  App.registerTab({ id: 'movimentacoes', label: 'Movimentações', order: 60, view });
})(typeof self !== 'undefined' ? self : this);
