/*
 * Aba "Calendário": quando cada pedido foi feito, quando é a entrega e quando foi finalizado,
 * cada pedido com a sua cor, e ao lado o andamento (quanto já está montado) dos pedidos em aberto.
 */
(function (root) {
  'use strict';

  const App = root.App;
  const L = root.Logic;
  const { esc, int, icons } = root.UI;

  const HUES = [195, 265, 25, 150, 330, 45, 220, 100];
  const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const DOW = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const TYPE = {
    feito: { label: 'Pedido feito', short: 'feito', mark: '●' },
    entrega: { label: 'Entrega', short: 'entrega', mark: '⚑' },
    fim: { label: 'Finalizado', short: 'finalizado', mark: '✓' },
  };

  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayStr = () => ymd(new Date());
  const colorOf = (o) => `hsl(${HUES[((o.num || 1) - 1) % HUES.length]} 72% 52%)`;
  const fmtDay = (s) => new Date(s + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const fmtShort = (s) => new Date(s + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const daysTo = (s) => Math.round((new Date(s + 'T12:00:00') - new Date(todayStr() + 'T12:00:00')) / 86400000);

  /** Todos os acontecimentos dos pedidos (menos cancelados), como { day, type, o }. */
  function events() {
    const out = [];
    for (const o of App.state.orders || []) {
      if (o.status === 'cancelado') continue;
      out.push({ day: ymd(new Date(o.date)), type: 'feito', o });
      if (o.due) out.push({ day: o.due, type: 'entrega', o });
      const fin = (o.log || []).filter((e) => e.action === 'finalizado').pop();
      if (fin) out.push({ day: ymd(new Date(fin.at)), type: 'fim', o });
    }
    return out;
  }
  App.calendarEvents = events;
  App.calColor = colorOf;

  function progressList() {
    const { orders, products, parts } = App.state;
    const open = (orders || []).filter((o) => o.status === 'aberto');
    const alloc = L.allocateReady(orders || [], products);
    return open
      .map((o) => ({ o, pr: L.orderProgress(o, alloc[o.id], products, parts) }))
      .sort((a, b) => (a.o.due || '9999') < (b.o.due || '9999') ? -1 : 1);
  }
  App.orderProgressList = progressList;

  const dueBadge = (o) => {
    if (!o.due) return '<span class="cal-due muted">sem prazo</span>';
    const d = daysTo(o.due);
    if (d < 0) return `<span class="cal-due late">atrasado ${-d} dia(s)</span>`;
    if (d === 0) return '<span class="cal-due soon">entrega hoje</span>';
    if (d <= 3) return `<span class="cal-due soon">em ${d} dia(s)</span>`;
    return `<span class="cal-due">${fmtShort(o.due)} · em ${d} dias</span>`;
  };

  const label = (o) => `#${o.num}${o.ref ? ' ' + esc(o.ref) : ''}`;

  function monthGrid(ev) {
    const [y, m] = App.calMonth.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const start = new Date(y, m - 1, 1 - first.getDay());
    const byDay = {};
    ev.forEach((e) => (byDay[e.day] = byDay[e.day] || []).push(e));
    const today = todayStr();
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const s = ymd(d);
      const list = byDay[s] || [];
      const shown = list.slice(0, 3);
      cells += `<button class="cal-day ${d.getMonth() === m - 1 ? '' : 'out'} ${s === today ? 'today' : ''} ${s === App.calSel ? 'sel' : ''}" data-action="cal-day" data-id="${s}" aria-label="${fmtDay(s)}${list.length ? ', ' + list.length + ' evento(s)' : ''}">
        <span class="cal-n">${d.getDate()}</span>
        ${shown.map((e) => `<span class="cal-ev ${e.type}" style="--c:${colorOf(e.o)}" title="${TYPE[e.type].label} · pedido #${e.o.num}">${TYPE[e.type].mark} #${e.o.num}</span>`).join('')}
        ${list.length > 3 ? `<span class="cal-more">+${list.length - 3}</span>` : ''}
      </button>`;
    }
    return `<div class="cal-dow">${DOW.map((x) => `<span>${x}</span>`).join('')}</div><div class="cal-grid">${cells}</div>`;
  }

  function dayPanel(ev) {
    const list = ev.filter((e) => e.day === App.calSel);
    const body = list.length
      ? list
          .map(
            (e) => `<button class="cal-item" style="--c:${colorOf(e.o)}" data-action="go-tab" data-id="pedidos">
          <span class="cal-dot"></span>
          <span><b>${TYPE[e.type].mark} ${TYPE[e.type].label}</b><small>Pedido ${label(e.o)}${App.isManager() && e.o.customer ? ' · ' + esc(e.o.customer) : ''}</small></span>
        </button>`
          )
          .join('')
      : '<p class="muted" style="margin:6px 0">Nada marcado neste dia.</p>';
    return `<div class="card cal-side-card"><h3>${esc(fmtDay(App.calSel))}</h3>${body}</div>`;
  }

  function progressCard() {
    const rows = progressList();
    const body = rows.length
      ? rows
          .map(({ o, pr }) => {
            const prods = o.items.map((i) => `${int(i.qty)}× ${esc(i.name)}`).join(', ');
            return `<div class="cal-prog" style="--c:${colorOf(o)}">
          <div class="cal-prog-top"><span class="cal-dot"></span><b>${label(o)}</b>${dueBadge(o)}</div>
          <div class="ord-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pr.pct}"><span class="${pr.complete ? 'full' : ''}" style="width:${pr.pct}%;${pr.complete ? '' : 'background:var(--c)'}"></span></div>
          <small class="muted">${int(pr.have)} de ${int(pr.total)} montados · falta ${int(pr.missing)}${pr.complete ? ' · pronto para finalizar' : ''}</small>
          <small class="cal-prods">${prods}</small>
        </div>`;
          })
          .join('')
      : '<p class="muted">Nenhum pedido em andamento.</p>';
    return `<div class="card cal-side-card"><h3>Andamento dos pedidos</h3>${body}</div>`;
  }

  function view() {
    const ev = events();
    if (!App.calMonth) App.calMonth = todayStr().slice(0, 7);
    if (!App.calSel) App.calSel = todayStr();
    const [y, m] = App.calMonth.split('-').map(Number);
    return `
      <section class="page-head">
        <div>
          <h1>Calendário</h1>
          <p class="muted">Cada pedido tem a sua cor: <b>●</b> quando foi feito, <b>⚑</b> prazo de entrega e <b>✓</b> quando foi finalizado. À direita, quanto de cada pedido já está montado.</p>
        </div>
        ${App.isManager() ? '<button class="btn primary" data-action="go-tab" data-id="pedidos">Ir para Pedidos</button>' : ''}
      </section>
      <div class="cal-layout">
        <div class="card cal-card">
          <div class="cal-head">
            <h2>${MONTHS[m - 1][0].toUpperCase() + MONTHS[m - 1].slice(1)} de ${y}</h2>
            <div class="cal-nav">
              <button class="btn small" data-action="cal-today">Hoje</button>
              <button class="icon-top" data-action="cal-prev" aria-label="Mês anterior">${icons.chevL}</button>
              <button class="icon-top" data-action="cal-next" aria-label="Próximo mês">${icons.chevR}</button>
            </div>
          </div>
          ${monthGrid(ev)}
          <div class="cal-legend"><span>${TYPE.feito.mark} Pedido feito</span><span>${TYPE.entrega.mark} Entrega</span><span>${TYPE.fim.mark} Finalizado</span></div>
        </div>
        <div class="cal-side">${dayPanel(ev)}${progressCard()}</div>
      </div>`;
  }

  const shiftMonth = (d) => {
    const [y, m] = (App.calMonth || todayStr().slice(0, 7)).split('-').map(Number);
    const n = new Date(y, m - 1 + d, 1);
    App.calMonth = `${n.getFullYear()}-${pad(n.getMonth() + 1)}`;
    App.render();
  };
  Object.assign(App.actions, {
    'cal-prev': () => shiftMonth(-1),
    'cal-next': () => shiftMonth(1),
    'cal-today': () => {
      App.calMonth = todayStr().slice(0, 7);
      App.calSel = todayStr();
      App.render();
    },
    'cal-day': (id) => {
      App.calSel = id;
      if (id.slice(0, 7) !== App.calMonth) App.calMonth = id.slice(0, 7);
      App.render();
    },
  });

  App.registerTab({ id: 'calendario', label: 'Calendário', order: 6, view });
  App.dueBadge = dueBadge;
})(typeof self !== 'undefined' ? self : this);
