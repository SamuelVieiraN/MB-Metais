/*
 * Aba "Recebimento": entrada de mercadoria por lote (nota fiscal).
 * Qualquer pessoa registra o que chegou; o gerente autoriza, e só então entra no estoque.
 * Todo recebimento fica guardado com o registro do que aconteceu: Aguardando autorização,
 * Concluído, Concluído (editado) ou Excluído (com o motivo).
 */
(function (root) {
  'use strict';

  const App = root.App;
  const { esc, int, icons, toast, confirmBox, openModal, uuid, $, $$ } = root.UI;

  App.rcFilter = App.rcFilter || 'todos';

  const STATUS = {
    pendente: { label: 'Aguardando autorização', pill: 'warn' },
    concluido: { label: 'Concluído', pill: 'ok' },
    concluido_editado: { label: 'Concluído (editado)', pill: 'info' },
    excluido: { label: 'Excluído', pill: 'bad' },
  };
  const FILTERS = [
    ['todos', 'Todos'],
    ['pendente', 'Aguardando'],
    ['concluidos', 'Concluídos'],
    ['excluido', 'Excluídos'],
  ];
  const dt = (iso) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const matches = (r) =>
    App.rcFilter === 'todos' ||
    (App.rcFilter === 'concluidos' ? r.status === 'concluido' || r.status === 'concluido_editado' : r.status === App.rcFilter);

  // =====================================================================
  //  Lista
  // =====================================================================
  function cardHtml(r) {
    const manager = App.isManager();
    const st = STATUS[r.status] || STATUS.pendente;
    const rows = r.items
      .map((i) => {
        const d = i.expected === null || i.expected === undefined ? null : i.received - i.expected;
        return `<tr>
          <td>${esc(i.name)}${i.code ? `<br><small class="muted">${esc(i.code)}</small>` : ''}</td>
          <td class="right num">${i.expected === null || i.expected === undefined ? '–' : int(i.expected)}</td>
          <td class="right num"><b>${int(i.received)}</b></td>
          <td class="right num ${d ? (d > 0 ? 'pos' : 'neg') : ''}">${d === null ? '–' : (d > 0 ? '+' : '') + int(d)}</td>
        </tr>`;
      })
      .join('');
    const log = (r.log || [])
      .map((e) => `<li><b>${dt(e.at)}</b> · ${esc(e.by || '')} · ${esc(e.action)}${manager && e.detail ? ` — <i>${esc(e.detail)}</i>` : ''}</li>`)
      .join('');
    const actions = [];
    if (manager && r.status === 'pendente') actions.push(`<button class="btn primary" data-action="rc-approve" data-id="${r.id}">Autorizar e lançar no estoque</button>`);
    if (manager && r.status !== 'excluido') {
      actions.push(`<button class="btn" data-action="rc-edit" data-id="${r.id}">Editar</button>`);
      actions.push(`<button class="btn danger" data-action="rc-delete" data-id="${r.id}">Excluir</button>`);
    }
    return `<details class="changes rc-card" ${r.status === 'pendente' ? 'open' : ''}>
      <summary><b>#${r.num}</b> · ${dt(r.date)} · ${esc(r.who || 'Alguém')}${r.ref ? ` · ${esc(r.ref)}` : ''} · ${r.items.length} peça${r.items.length > 1 ? 's' : ''}
        <span class="pill ${st.pill}">${st.label}</span></summary>
      <div style="padding:0 14px 14px">
        ${manager && r.supplier ? `<p class="muted">Fornecedor: <b>${esc(r.supplier)}</b></p>` : ''}
        <div class="table-wrap"><table>
          <thead><tr><th>Peça</th><th class="right">Na nota</th><th class="right">Chegou</th><th class="right">Diferença</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        ${!manager && r.status === 'pendente' ? '<p class="hint" style="margin-top:8px">Aguardando o gerente autorizar. Só depois disso as peças entram no estoque.</p>' : ''}
        <p class="hint" style="margin:10px 0 4px"><b>Registro</b></p>
        <ul class="rc-log">${log}</ul>
        ${actions.length ? `<div class="actions" style="margin-top:10px">${actions.join('')}</div>` : ''}
      </div>
    </details>`;
  }

  function listHtml() {
    const list = (App.state.receipts || []).filter(matches);
    return list.length ? list.map(cardHtml).join('') : '<p class="empty">Nenhum recebimento por aqui.</p>';
  }

  function view() {
    const pending = (App.state.receipts || []).filter((r) => r.status === 'pendente').length;
    const chips = FILTERS.map(
      ([id, label]) => `<button class="chip ${App.rcFilter === id ? 'on' : ''}" data-action="rc-filter" data-id="${id}">${label}</button>`
    ).join('');
    return `
      <section class="page-head">
        <div>
          <h1>Recebimento</h1>
          <p class="muted">Chegou mercadoria? Registre as peças e quantidades (pode ser pela nota fiscal). O gerente confere e autoriza; só então entra no estoque. Tudo fica registrado, mesmo o que for editado ou excluído.${
            App.isManager() && pending ? ` <b>${pending} aguardando sua autorização.</b>` : ''
          }</p>
        </div>
        <div class="actions"><button class="btn primary" data-action="rc-new">${icons.plus} Novo recebimento</button></div>
      </section>
      <div class="chips" style="margin-bottom:12px">${chips}</div>
      <div id="rc-list">${listHtml()}</div>`;
  }

  // =====================================================================
  //  Formulário (novo / editar)
  // =====================================================================
  const labelOf = (p) => (p.code ? `${p.code} · ${p.name}` : p.name);

  function resolvePart(text) {
    const t = String(text || '').trim().toLowerCase();
    if (!t) return null;
    const parts = App.state.parts;
    return (
      parts.find((p) => labelOf(p).toLowerCase() === t) ||
      parts.find((p) => p.code && p.code.toLowerCase() === t) ||
      parts.find((p) => p.name.toLowerCase() === t) ||
      null
    );
  }

  function rowHtml(item) {
    const part = item ? App.state.parts.find((p) => p.id === item.partId) : null;
    return `<div class="rc-row">
      <input class="rc-part" list="rc-parts" placeholder="Código ou nome da peça" autocomplete="off" value="${part ? esc(labelOf(part)) : ''}" aria-label="Peça" />
      <input class="rc-exp" type="number" min="0" step="1" inputmode="numeric" placeholder="Na nota" aria-label="Quantidade na nota" value="${item && item.expected !== null && item.expected !== undefined ? item.expected : ''}" />
      <input class="rc-rec" type="number" min="0" step="1" inputmode="numeric" placeholder="Chegou" aria-label="Quantidade que chegou" value="${item ? item.received : ''}" />
      <button type="button" class="icon-btn" data-action="rc-del-row" aria-label="Remover linha">${icons.x}</button>
    </div>`;
  }

  function openForm(receipt) {
    const manager = App.isManager();
    const editing = !!receipt;
    const concluded = editing && receipt.status !== 'pendente';
    const options = App.state.parts
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
      .map((p) => `<option value="${esc(labelOf(p))}"></option>`)
      .join('');
    const rows = (editing ? receipt.items : [null, null, null]).map(rowHtml).join('');
    const body = `
      <label>Nota fiscal / referência do lote (opcional)
        <input name="ref" type="text" maxlength="60" placeholder="Ex.: NF 1234" value="${editing ? esc(receipt.ref) : ''}" />
      </label>
      ${
        manager
          ? `<label>Fornecedor (opcional, só o gerente vê)
              <input name="supplier" type="text" maxlength="80" value="${editing ? esc(receipt.supplier) : ''}" />
            </label>`
          : ''
      }
      <div class="rc-head"><span>Peça</span><span>Na nota</span><span>Chegou</span><span></span></div>
      <datalist id="rc-parts">${options}</datalist>
      <div id="rc-rows">${rows}</div>
      <button type="button" class="btn small" data-action="rc-add-row">${icons.plus} Adicionar peça</button>
      <p class="hint">Digite o código ou o nome e escolha na lista (um leitor de código de barras também serve). ${manager ? 'Se a peça for nova, o sistema oferece cadastrá-la na hora.' : 'A peça precisa estar cadastrada; se for nova, peça ao gerente.'} <b>Enter</b> avança; no campo "Chegou", cria uma linha nova. "Na nota" é opcional: serve para ver se chegou diferente do que veio na nota.</p>
      ${
        concluded
          ? `<label>Motivo da edição (obrigatório)
              <input name="reason" type="text" maxlength="120" placeholder="Ex.: contagem errada" />
            </label>
            <p class="hint">Este recebimento já entrou no estoque. Ao salvar, o estoque é ajustado pela diferença e o recebimento fica como <b>Concluído (editado)</b>.</p>`
          : ''
      }`;
    openModal(
      editing ? `Editar recebimento #${receipt.num}` : 'Novo recebimento',
      body,
      async (fd) => {
        const items = [];
        for (const row of $$('.rc-row', $('#modal'))) {
          const text = $('.rc-part', row).value.trim();
          const exp = $('.rc-exp', row).value.trim();
          const rec = $('.rc-rec', row).value.trim();
          if (!text && !exp && !rec) continue;
          if (!text) return { error: 'Há uma linha com quantidade mas sem peça.' };
          let part = resolvePart(text);
          if (!part) {
            const low = text.toLowerCase();
            const near = App.state.parts.filter((p) => p.name.toLowerCase().includes(low) || (p.code && low.includes(p.code.toLowerCase()))).slice(0, 3);
            const hint = near.length ? ` Você quis dizer: ${near.map((p) => `"${p.name}"`).join(', ')}?` : '';
            if (!manager) {
              return { error: `A peça "${text}" ainda não está cadastrada.${hint} Se ela for nova, peça ao gerente para cadastrá-la em Peças.` };
            }
            const ok = await confirmBox(
              `A peça "${text}" ainda não está cadastrada.${hint} Quer cadastrá-la agora (estoque 0, o recebimento é que vai somar)?`,
              'Cadastrar peça nova'
            );
            if (!ok) return { error: `Peça "${text}" não cadastrada. Corrija o nome ou escolha uma da lista.` };
            const id = uuid();
            await App.store.saveParts([{ id, code: '', name: text, stock: 0, min: 0 }], 'Cadastro pelo recebimento');
            await App.refresh();
            part = App.state.parts.find((p) => p.id === id);
            if (!part) return { error: 'Não consegui cadastrar a peça. Tente em Peças > Nova peça.' };
          }
          items.push({ partId: part.id, expected: exp === '' ? null : Number(exp), received: rec === '' ? 0 : Number(rec) });
        }
        if (!items.length) return { error: 'Inclua pelo menos uma peça.' };
        for (const i of items) {
          if (!Number.isInteger(i.received) || i.received < 0 || (i.expected !== null && (!Number.isInteger(i.expected) || i.expected < 0))) {
            return { error: 'Use apenas números inteiros, a partir de zero.' };
          }
        }
        const payload = { ref: String(fd.get('ref') || ''), items, supplier: manager ? String(fd.get('supplier') || '') : '' };
        if (editing) await App.commit(() => App.store.editReceipt(receipt.id, { ...payload, reason: String(fd.get('reason') || '') }));
        else await App.commit(() => App.store.createReceipt(payload));
        toast(editing ? 'Recebimento atualizado.' : manager ? 'Recebimento registrado. Falta autorizar.' : 'Recebimento enviado para o gerente autorizar.');
      },
      editing ? 'Salvar alterações' : 'Registrar recebimento',
      { wide: true, noFocus: false }
    );
  }

  // =====================================================================
  //  Ações
  // =====================================================================
  const find = (id) => (App.state.receipts || []).find((r) => r.id === id);

  Object.assign(App.actions, {
    'rc-new': () => openForm(null),
    'rc-edit': (id) => {
      const r = find(id);
      if (r && App.isManager()) openForm(r);
    },
    'rc-filter': (id) => {
      App.rcFilter = id;
      App.render();
    },
    'rc-add-row': () => {
      const wrap = $('#rc-rows', $('#modal'));
      wrap.insertAdjacentHTML('beforeend', rowHtml(null));
      $('.rc-part', wrap.lastElementChild).focus();
    },
    'rc-del-row': (id, btn) => {
      if ($$('.rc-row', $('#modal')).length > 1) btn.closest('.rc-row').remove();
    },
    'rc-approve': async (id) => {
      const r = find(id);
      if (!r || !App.isManager()) return;
      const total = r.items.reduce((s, i) => s + i.received, 0);
      if (!(await confirmBox(`Autorizar o recebimento #${r.num}? Entram no estoque ${int(total)} unidade(s) em ${r.items.length} peça(s).`, 'Autorizar recebimento'))) return;
      await App.commit(() => App.store.approveReceipt(id));
      toast('Recebimento autorizado e lançado no estoque.');
    },
    'rc-delete': (id) => {
      const r = find(id);
      if (!r || !App.isManager()) return;
      const inStock = r.status !== 'pendente';
      openModal(
        `Excluir recebimento #${r.num}`,
        `<p>${
          inStock
            ? 'Este recebimento já entrou no estoque. Ao excluir, a mercadoria <b>sai do estoque</b> (se houver quantidade suficiente) e o registro continua aqui como <b>Excluído</b>.'
            : 'Este recebimento ainda não entrou no estoque. O registro continua aqui como <b>Excluído</b>.'
        }</p>
        <label>Motivo (obrigatório)
          <input name="reason" type="text" maxlength="120" placeholder="Ex.: mercadoria devolvida ao fornecedor" />
        </label>`,
        async (fd) => {
          const reason = String(fd.get('reason') || '').trim();
          if (!reason) return { error: 'Informe o motivo da exclusão.' };
          await App.commit(() => App.store.deleteReceipt(id, reason));
          toast('Recebimento excluído. O registro foi mantido.');
        },
        'Excluir recebimento'
      );
    },
  });

  // Enter avança de campo (e cria linha nova ao terminar a quantidade): bom para leitor de código de barras
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const t = e.target;
    if (!t.classList || !t.closest || !t.closest('.rc-row')) return;
    e.preventDefault();
    const row = t.closest('.rc-row');
    if (t.classList.contains('rc-part')) $('.rc-exp', row).focus();
    else if (t.classList.contains('rc-exp')) $('.rc-rec', row).focus();
    else {
      const next = row.nextElementSibling;
      if (next && next.classList.contains('rc-row')) $('.rc-part', next).focus();
      else App.actions['rc-add-row']();
    }
  });

  App.registerTab({ id: 'recebimento', label: 'Recebimento', order: 32, view });
})(typeof self !== 'undefined' ? self : this);
