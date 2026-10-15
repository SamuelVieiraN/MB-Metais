/*
 * Abas "Reposição" (lista de compras) e "Conferência" (contagem de estoque).
 * Reposição: o que comprar para voltar ao mínimo e/ou para cumprir uma meta de produção.
 * Conferência: qualquer pessoa conta as peças; o gerente confere as diferenças e aprova.
 */
(function (root) {
  'use strict';

  const App = root.App;
  const X = root.XlsxLite;
  const { esc, int, brl, toast, confirmBox, $ } = root.UI;

  App.buyPlan = App.buyPlan || {};
  App.countInputs = App.countInputs || {};
  App.countFilter = App.countFilter || '';

  const stamp = () => new Date().toISOString().slice(0, 10);
  const dt = (iso) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const byName = (a, b) => a.name.localeCompare(b.name, 'pt-BR');

  // =====================================================================
  //  Reposição
  // =====================================================================
  function buyList() {
    const need = {};
    for (const p of App.state.products) {
      const q = App.buyPlan[p.id] || 0;
      if (q > 0) for (const b of p.bom) need[b.partId] = (need[b.partId] || 0) + q * b.qty;
    }
    return App.state.parts
      .map((part) => {
        const goal = need[part.id] || 0;
        // para fazer a meta e ainda ficar com o mínimo (sem meta, só o que falta para o mínimo)
        const buy = Math.max(0, goal + part.min - part.stock);
        return { part, goal, buy, cost: buy * (part.cost || 0) };
      })
      .filter((r) => r.buy > 0)
      .sort((a, b) => byName(a.part, b.part));
  }

  function viewReposicao() {
    const rows = App.state.products
      .map(
        (p) => `<div class="sim-row">
          <label for="buy-${p.id}"><b>${esc(p.name)}</b></label>
          <input id="buy-${p.id}" type="number" min="0" step="1" inputmode="numeric" placeholder="0" data-buy="${p.id}" value="${App.buyPlan[p.id] || ''}" />
        </div>`
      )
      .join('');
    return `
      <section class="page-head">
        <div>
          <h1>Reposição</h1>
          <p class="muted">O que comprar. Sem meta, a lista mostra o que falta para chegar ao <b>mínimo</b> de cada peça. Se você informar uma meta de produção, ela soma o que as montagens vão consumir.</p>
        </div>
      </section>
      <div class="sim-layout">
        <div class="card">
          <h2>Meta de produção <small class="muted">(opcional)</small></h2>
          ${rows || '<p class="empty">Cadastre produtos para usar metas.</p>'}
          <div class="actions" style="margin-top:12px"><button class="btn small" data-action="buy-clear">Limpar metas</button></div>
        </div>
        <div id="buy-result"></div>
      </div>`;
  }

  function renderBuyResult() {
    const box = $('#buy-result');
    if (!box) return;
    const manager = App.isManager();
    const list = buyList();
    if (!list.length) {
      box.innerHTML = `<div class="card"><p class="empty">Nada a comprar: todas as peças estão no mínimo ou acima${
        Object.keys(App.buyPlan).length ? ', mesmo com a meta informada' : ''
      }.</p></div>`;
      return;
    }
    const total = list.reduce((s, r) => s + r.cost, 0);
    const body = list
      .map(
        (r) => `<tr>
        <td><b>${esc(r.part.name)}</b>${r.part.code ? `<br><small class="muted">${esc(r.part.code)}</small>` : ''}</td>
        <td class="right num">${int(r.part.stock)}</td>
        <td class="right num">${int(r.part.min)}</td>
        <td class="right num">${r.goal ? int(r.goal) : '–'}</td>
        <td class="right num"><b>${int(r.buy)}</b></td>
        ${manager ? `<td class="right num">${brl(r.cost)}</td>` : ''}
      </tr>`
      )
      .join('');
    box.innerHTML = `
      <div class="card">
        <div class="page-head" style="margin-bottom:10px">
          <h2 style="margin:0">Lista de compras <small class="muted">(${list.length} peça${list.length > 1 ? 's' : ''})</small></h2>
          <div class="actions">
            <button class="btn small" data-action="buy-copy">Copiar lista</button>
            <button class="btn small primary" data-action="buy-xlsx">Baixar Excel</button>
          </div>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Peça</th><th class="right">Estoque</th><th class="right">Mínimo</th><th class="right">Meta usa</th><th class="right">Comprar</th>${manager ? '<th class="right">Custo estimado</th>' : ''}</tr></thead>
          <tbody>${body}</tbody>
          ${manager ? `<tfoot><tr><td colspan="5"><b>Total estimado</b></td><td class="right num"><b>${brl(total)}</b></td></tr></tfoot>` : ''}
        </table></div>
        <p class="hint" style="margin-top:8px">Comprar = o que falta para fazer a meta e ainda ficar com o mínimo.${manager ? ' O custo estimado usa o último custo médio da peça.' : ''}</p>
      </div>`;
  }

  // =====================================================================
  //  Conferência
  // =====================================================================
  function countRowsHtml() {
    const q = App.countFilter.trim().toLowerCase();
    const parts = App.state.parts
      .filter((p) => !q || p.name.toLowerCase().includes(q) || String(p.code || '').toLowerCase().includes(q))
      .slice()
      .sort(byName);
    return (
      parts
        .map(
          (p) => `<tr>
        <td><b>${esc(p.name)}</b>${p.code ? `<br><small class="muted">${esc(p.code)}</small>` : ''}</td>
        <td class="right"><input type="number" min="0" step="1" inputmode="numeric" class="count-input" data-count="${p.id}" aria-label="Quantidade contada de ${esc(p.name)}" value="${esc(App.countInputs[p.id] ?? '')}" /></td>
      </tr>`
        )
        .join('') || `<tr><td colspan="2" class="empty">Nenhuma peça encontrada.</td></tr>`
    );
  }

  const counted = () => Object.keys(App.countInputs).filter((id) => String(App.countInputs[id]).trim() !== '');

  function countSummaryHtml() {
    const n = counted().length;
    return `<span class="muted">${n ? `<b>${n}</b> peça${n > 1 ? 's' : ''} contada${n > 1 ? 's' : ''}` : 'Nenhuma peça contada ainda'}</span>`;
  }

  function countsListHtml() {
    const list = App.state.counts || [];
    if (!list.length) return `<p class="empty">Nenhuma contagem enviada ainda.</p>`;
    const manager = App.isManager();
    const parts = root.Logic.partsById(App.state.parts);
    const pill = { pendente: 'warn', aprovada: 'ok', rejeitada: 'bad' };
    return list
      .map((c) => {
        const diffs = c.items.filter((i) => i.counted !== i.system).length;
        const pending = c.status === 'pendente';
        const rows = c.items
          .map((i) => {
            const d = i.counted - i.system;
            const now = parts[i.partId] ? parts[i.partId].stock : null;
            const moved = pending && now !== null && now !== i.system;
            return `<tr>
              <td>${esc(i.name)}</td>
              <td class="right num">${int(i.system)}</td>
              <td class="right num">${int(i.counted)}</td>
              <td class="right num ${d ? (d > 0 ? 'pos' : 'neg') : ''}">${d > 0 ? '+' : ''}${int(d)}</td>
              ${manager && pending ? `<td class="right num">${now === null ? '–' : int(now)}${moved ? ' <small class="muted">(mudou)</small>' : ''}</td>` : ''}
            </tr>`;
          })
          .join('');
        return `<details class="changes" ${pending ? 'open' : ''}>
          <summary>${dt(c.date)} · ${esc(c.who || 'Alguém')} · ${c.items.length} peça${c.items.length > 1 ? 's' : ''} ·
            ${diffs ? `${diffs} com diferença` : 'tudo bateu'} <span class="pill ${pill[c.status] || 'ok'}">${esc(c.status)}</span></summary>
          <div style="padding:0 14px 14px">
            ${c.note ? `<p class="muted">${esc(c.note)}</p>` : ''}
            <div class="table-wrap"><table>
              <thead><tr><th>Peça</th><th class="right">Sistema</th><th class="right">Contado</th><th class="right">Diferença</th>${manager && pending ? '<th class="right">Agora</th>' : ''}</tr></thead>
              <tbody>${rows}</tbody>
            </table></div>
            ${c.reviewedBy && !pending ? `<p class="hint" style="margin-top:8px">${esc(c.status)} por ${esc(c.reviewedBy)}${c.reviewedAt ? ' em ' + dt(c.reviewedAt) : ''}.</p>` : ''}
            ${
              manager && pending
                ? `<div class="actions" style="margin-top:10px">
                    <button class="btn primary" data-action="count-approve" data-id="${c.id}">Aprovar e ajustar estoque</button>
                    <button class="btn danger" data-action="count-reject" data-id="${c.id}">Rejeitar</button>
                  </div>
                  <p class="hint" style="margin-top:6px">Ao aprovar, o estoque de cada peça vira o valor contado. Se a coluna <b>Agora</b> mudou desde a contagem, confira antes.</p>`
                : ''
            }
          </div>
        </details>`;
      })
      .join('');
  }

  function viewConferencia() {
    const manager = App.isManager();
    return `
      <section class="page-head">
        <div>
          <h1>Conferência de estoque</h1>
          <p class="muted">Conte as peças na prateleira e digite o que encontrou. Deixe em branco o que não contou. A quantidade do sistema fica escondida de propósito, para a contagem ser honesta. ${
            manager ? 'Depois de enviada, você vê as diferenças e decide se ajusta o estoque.' : 'Depois de enviada, o gerente confere as diferenças.'
          }</p>
        </div>
      </section>
      <div class="card">
        <div class="actions" style="margin-bottom:10px">
          <input id="count-filter" type="search" placeholder="Buscar por nome ou código" value="${esc(App.countFilter)}" style="flex:1;min-width:200px" />
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Peça</th><th class="right">Contado</th></tr></thead>
          <tbody id="count-body">${countRowsHtml()}</tbody>
        </table></div>
        <label style="display:block;margin-top:12px">Observação (opcional)
          <input id="count-note" type="text" maxlength="120" placeholder="Ex.: prateleira 3, turno da manhã" />
        </label>
        <div class="actions" style="margin-top:12px;justify-content:space-between">
          <div id="count-summary">${countSummaryHtml()}</div>
          <div class="actions">
            <button class="btn small" data-action="count-clear">Limpar</button>
            <button class="btn primary" data-action="count-submit">Enviar contagem</button>
          </div>
        </div>
      </div>
      <h2 style="margin:22px 0 10px">Contagens enviadas</h2>
      <div id="counts-list">${countsListHtml()}</div>`;
  }

  // =====================================================================
  //  Ações e eventos
  // =====================================================================
  Object.assign(App.actions, {
    'buy-clear': () => {
      App.buyPlan = {};
      App.render();
    },
    'buy-copy': async () => {
      const list = buyList();
      const text =
        `Lista de compras (${new Date().toLocaleDateString('pt-BR')})\n` +
        list.map((r) => `- ${r.part.name}${r.part.code ? ' (' + r.part.code + ')' : ''}: comprar ${r.buy}`).join('\n');
      try {
        await navigator.clipboard.writeText(text);
        toast('Lista copiada. É só colar no WhatsApp ou e-mail.');
      } catch (e) {
        toast('Não consegui copiar automaticamente. Use "Baixar Excel".', 'error');
      }
    },
    'buy-xlsx': () => {
      const manager = App.isManager();
      const list = buyList();
      const columns = [
        { header: 'Código', width: 12 },
        { header: 'Peça', width: 42 },
        { header: 'Estoque', width: 11 },
        { header: 'Mínimo', width: 11 },
        { header: 'Meta usa', width: 11 },
        { header: 'Comprar', width: 11 },
      ];
      if (manager) columns.push({ header: 'Custo estimado (R$)', width: 20 });
      const rows = list.map((r) => {
        const row = [r.part.code || '', r.part.name, r.part.stock, r.part.min, r.goal, r.buy];
        if (manager) row.push({ v: r.cost, s: 'money' });
        return row;
      });
      App.download(X.build([{ name: 'Reposição', columns, rows }]), `lista-de-compras-${stamp()}.xlsx`);
      toast('Planilha gerada.');
    },

    'count-clear': () => {
      App.countInputs = {};
      App.render();
    },
    'count-submit': async () => {
      const ids = counted();
      if (!ids.length) return toast('Digite a quantidade de pelo menos uma peça.', 'error');
      const items = [];
      for (const id of ids) {
        const part = App.state.parts.find((p) => p.id === id);
        const n = Number(String(App.countInputs[id]).trim());
        if (!Number.isInteger(n) || n < 0) return toast(`Quantidade inválida em "${part ? part.name : 'uma peça'}". Use números inteiros, a partir de zero.`, 'error');
        items.push({ partId: id, counted: n });
      }
      if (!(await confirmBox(`Enviar a contagem de ${items.length} peça(s)?`, 'Enviar contagem'))) return;
      const note = ($('#count-note') || {}).value || '';
      await App.commit(() => App.store.submitCount(items, note));
      App.countInputs = {};
      App.render();
      toast('Contagem enviada.');
    },
    'count-approve': async (id) => {
      if (!App.isManager()) return;
      if (!(await confirmBox('Aprovar a contagem? O estoque de cada peça será ajustado para o valor contado e isso ficará no histórico.', 'Aprovar contagem'))) return;
      await App.commit(() => App.store.reviewCount(id, true));
      toast('Contagem aprovada e estoque ajustado.');
    },
    'count-reject': async (id) => {
      if (!App.isManager()) return;
      if (!(await confirmBox('Rejeitar a contagem? O estoque não será alterado.', 'Rejeitar contagem', true))) return;
      await App.commit(() => App.store.reviewCount(id, false));
      toast('Contagem rejeitada.');
    },
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.buy) {
      const v = Math.max(0, Math.floor(Number(t.value) || 0));
      if (v > 0) App.buyPlan[t.dataset.buy] = v;
      else delete App.buyPlan[t.dataset.buy];
      renderBuyResult();
    } else if (t.dataset && t.dataset.count) {
      App.countInputs[t.dataset.count] = t.value;
      const s = $('#count-summary');
      if (s) s.innerHTML = countSummaryHtml();
    } else if (t.id === 'count-filter') {
      App.countFilter = t.value;
      const body = $('#count-body');
      if (body) body.innerHTML = countRowsHtml();
    }
  });

  App.registerTab({ id: 'reposicao', label: 'Reposição', order: 35, view: viewReposicao, after: renderBuyResult });
  App.registerTab({ id: 'conferencia', label: 'Conferência', order: 45, view: viewConferencia });
})(typeof self !== 'undefined' ? self : this);
