/*
 * Telas e interações. Os cálculos ficam em logic.js; os dados de exemplo em data.js.
 * Os dados ficam salvos no navegador (localStorage) nesta primeira versão.
 */
(function () {
  'use strict';

  const L = window.Logic;
  const KEY = 'estoque-torneiras:v1';
  const ROLE_KEY = 'estoque-torneiras:role';

  // ---------- utilidades ----------
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const brl = (n) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const int = (n) => (Number(n) || 0).toLocaleString('pt-BR');
  const pct = (n) =>
    (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const $ = (sel, root = document) => root.querySelector(sel);

  // ---------- estado ----------
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && Array.isArray(d.parts) && Array.isArray(d.products)) {
          d.movements = Array.isArray(d.movements) ? d.movements : [];
          return d;
        }
      }
    } catch (e) {
      /* ignora e usa os dados de exemplo */
    }
    return clone(window.SAMPLE_DATA);
  }

  let state = load();
  let role = 'gerente';
  try {
    role = localStorage.getItem(ROLE_KEY) === 'funcionario' ? 'funcionario' : 'gerente';
  } catch (e) {
    /* segue com o padrão */
  }
  let tab = 'mostruario';
  let filter = '';
  let simPlan = {};

  const isManager = () => role === 'gerente';

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      toast('Não foi possível salvar neste navegador.', 'error');
    }
  }

  function addMovement(part, type, qty, note) {
    state.movements.unshift({
      id: uid('m'),
      date: new Date().toISOString(),
      partId: part.id,
      partName: part.name,
      type,
      qty,
      note: note || '',
      role,
    });
    if (state.movements.length > 1000) state.movements.length = 1000;
  }

  // ---------- mensagens e janelas ----------
  let toastTimer;
  function toast(msg, kind) {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'show' + (kind === 'error' ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = ''), 3200);
  }

  const modal = $('#modal');
  function openModal(title, bodyHtml, onSubmit, submitLabel) {
    modal.innerHTML = `
      <form>
        <h2>${esc(title)}</h2>
        <div class="modal-body">${bodyHtml}</div>
        <p class="form-error" id="form-error" hidden></p>
        <div class="modal-actions">
          <button type="button" class="btn ghost" data-action="close-modal">Cancelar</button>
          <button type="submit" class="btn primary">${esc(submitLabel || 'Salvar')}</button>
        </div>
      </form>`;
    const form = $('form', modal);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const res = onSubmit(new FormData(form), form);
      if (res && res.error) {
        const box = $('#form-error', modal);
        box.textContent = res.error;
        box.hidden = false;
      } else {
        closeModal();
      }
    });
    if (!modal.open) modal.showModal();
  }
  function closeModal() {
    if (modal.open) modal.close();
  }

  function requireManager() {
    if (isManager()) return true;
    toast('Essa ação é só para o perfil Gerente.', 'error');
    return false;
  }

  // ---------- abas ----------
  const TABS = [
    { id: 'mostruario', label: 'Mostruário' },
    { id: 'pecas', label: 'Peças' },
    { id: 'produtos', label: 'Produtos' },
    { id: 'simulacao', label: 'Simulação' },
    { id: 'historico', label: 'Histórico' },
    { id: 'financeiro', label: 'Financeiro', managerOnly: true },
  ];

  function renderTabs() {
    const visible = TABS.filter((t) => !t.managerOnly || isManager());
    if (!visible.some((t) => t.id === tab)) tab = 'mostruario';
    $('#tabs').innerHTML = visible
      .map(
        (t) =>
          `<button class="tab" data-tab="${t.id}" ${t.id === tab ? 'aria-current="page"' : ''}>${t.label}${
            t.managerOnly ? '<span class="lock">gerência</span>' : ''
          }</button>`
      )
      .join('');
  }

  // ---------- Mostruário ----------
  function viewMostruario() {
    const stock = L.stockMap(state.parts);
    const zero = state.products.filter((p) => L.maxProducible(p, stock).max === 0).length;
    const low = L.lowStock(state.parts);
    return `
      <section class="page-head">
        <div>
          <h1>Mostruário</h1>
          <p class="muted">Quanto dá para montar de cada produto com o estoque de agora. Cada número considera só aquele produto; as peças em comum são disputadas entre eles (veja a aba Simulação).</p>
        </div>
        <input class="search" id="filter" type="search" placeholder="Buscar produto…" value="${esc(filter)}" aria-label="Buscar produto" />
      </section>
      <div class="kpis">
        <div class="kpi"><div class="label">Produtos cadastrados</div><div class="value">${int(state.products.length)}</div></div>
        <div class="kpi ${zero ? 'bad' : 'ok'}"><div class="label">Sem estoque para montar</div><div class="value">${int(zero)}</div></div>
        <div class="kpi ${low.length ? 'warn' : 'ok'}"><div class="label">Peças no mínimo ou abaixo</div><div class="value">${int(low.length)}</div></div>
      </div>
      ${
        low.length
          ? `<div class="card" style="margin-bottom:16px"><h3>Atenção ao estoque</h3><div class="chips">${low
              .map(
                (p) =>
                  `<span class="pill ${p.stock === 0 ? 'bad' : 'warn'}">${esc(p.name)} · ${int(p.stock)}/${int(p.min)}</span>`
              )
              .join('')}</div></div>`
          : ''
      }
      <div id="grid" class="grid">${cardsHtml()}</div>`;
  }

  function cardsHtml() {
    const q = filter.trim().toLowerCase();
    const list = state.products.filter((p) => !q || (p.name + ' ' + p.category).toLowerCase().includes(q));
    if (!list.length) return `<div class="empty card" style="grid-column:1/-1">Nenhum produto encontrado.</div>`;
    const stock = L.stockMap(state.parts);
    const byId = L.partsById(state.parts);
    return list
      .map((p) => {
        const { max, limitingPartId } = L.maxProducible(p, stock);
        const lim = limitingPartId ? byId[limitingPartId] : null;
        const limItem = p.bom.find((i) => i.partId === limitingPartId);
        const level = max === 0 ? 'bad' : max < 5 ? 'warn' : 'ok';
        let limitText;
        if (!p.bom.length) limitText = 'Sem ficha técnica cadastrada.';
        else if (max === 0) limitText = `Falta: <b>${esc(lim ? lim.name : '(peça removida)')}</b>`;
        else
          limitText = `Limitado por <b>${esc(lim ? lim.name : '(peça removida)')}</b> (${int(
            lim ? lim.stock : 0
          )} em estoque, ${int(limItem.qty)} por unidade)`;
        let money = '';
        if (isManager()) {
          const cost = L.productCost(p, state.parts);
          const m = L.margin(p.price, cost);
          money = `<div class="money-row">
            <div><span>Custo</span><b>${brl(cost)}</b></div>
            <div><span>Preço de venda</span><b>${brl(p.price)}</b></div>
            <div><span>Lucro / un.</span><b>${brl(m.profit)} (${pct(m.pct)})</b></div>
            <div><span>Se montar o máximo</span><b>${brl(max * p.price)}</b></div>
          </div>`;
        }
        return `<article class="card prod-card ${level}">
          <div><div class="cat">${esc(p.category)}</div><h3>${esc(p.name)}</h3></div>
          <div class="big"><strong>${int(max)}</strong><span class="muted">unidades possíveis</span></div>
          <div class="limit">${limitText}</div>
          ${money}
        </article>`;
      })
      .join('');
  }

  // ---------- Peças ----------
  function viewPecas() {
    const manager = isManager();
    const rows = state.parts
      .map((p) => {
        const level = p.stock === 0 ? 'bad' : p.stock <= p.min ? 'warn' : 'ok';
        const label = p.stock === 0 ? 'Zerado' : p.stock <= p.min ? 'Baixo' : 'OK';
        return `<tr>
          <td><b>${esc(p.name)}</b></td>
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
    return `
      <section class="page-head">
        <div>
          <h1>Peças</h1>
          <p class="muted">Estoque atual de cada peça. Entradas e saídas ficam registradas no Histórico.</p>
        </div>
        <div class="actions">${manager ? '<button class="btn primary" data-action="new-part">+ Nova peça</button>' : ''}</div>
      </section>
      <div class="table-wrap"><table>
        <thead><tr>
          <th>Peça</th><th class="right">Estoque</th><th class="right">Mínimo</th><th>Situação</th>
          ${manager ? '<th class="right">Custo unit.</th><th class="right">Valor em estoque</th>' : ''}
          <th></th>
        </tr></thead>
        <tbody>${rows || `<tr><td colspan="7" class="empty">Nenhuma peça cadastrada.</td></tr>`}</tbody>
      </table></div>`;
  }

  function openMovement(partId, type) {
    const part = state.parts.find((p) => p.id === partId);
    if (!part) return;
    const isIn = type === 'entrada';
    const body = `
      <p>${esc(part.name)}<br><span class="muted">Em estoque agora: <b>${int(part.stock)}</b></span></p>
      <label>Quantidade
        <input name="qty" type="number" min="1" step="1" required />
      </label>
      ${
        isIn && isManager()
          ? `<label>Custo unitário desta compra (opcional)
              <input name="cost" type="number" min="0" step="0.01" placeholder="Ex.: 18,50" />
            </label>
            <p class="hint">Se informar, o custo da peça passa a ser a média ponderada entre o estoque atual e esta compra.</p>`
          : ''
      }
      <label>Observação (opcional)
        <input name="note" type="text" maxlength="120" placeholder="${isIn ? 'Ex.: compra do fornecedor X' : 'Ex.: perda, ajuste, venda direta'}" />
      </label>`;
    openModal(isIn ? 'Entrada de peças' : 'Saída de peças', body, (fd) => {
      const qty = Number(fd.get('qty'));
      const rawCost = fd.get('cost');
      const cost = rawCost === null || rawCost === '' ? null : Number(rawCost);
      const res = L.applyMovement(state.parts, partId, type, qty, cost);
      if (!res.ok) return { error: res.error };
      state.parts = res.parts;
      addMovement(part, type, Math.floor(qty), String(fd.get('note') || '').trim());
      save();
      render();
      toast(isIn ? 'Entrada registrada.' : 'Saída registrada.');
    }, isIn ? 'Registrar entrada' : 'Registrar saída');
  }

  function openPartForm(partId) {
    if (!requireManager()) return;
    const editing = partId ? state.parts.find((p) => p.id === partId) : null;
    const body = `
      <label>Nome da peça
        <input name="name" type="text" required maxlength="80" value="${esc(editing ? editing.name : '')}" />
      </label>
      ${
        editing
          ? ''
          : `<label>Estoque inicial
              <input name="stock" type="number" min="0" step="1" value="0" />
            </label>`
      }
      <label>Estoque mínimo (para o alerta)
        <input name="min" type="number" min="0" step="1" value="${editing ? editing.min : 0}" />
      </label>
      <label>Custo unitário (R$)
        <input name="cost" type="number" min="0" step="0.01" value="${editing ? editing.cost : 0}" />
      </label>
      ${editing ? '<p class="hint">Para mudar a quantidade em estoque, use Entrada ou Saída, assim fica no Histórico.</p>' : ''}`;
    openModal(editing ? 'Editar peça' : 'Nova peça', body, (fd) => {
      const name = String(fd.get('name') || '').trim();
      const min = Math.floor(Number(fd.get('min')) || 0);
      const cost = Number(fd.get('cost')) || 0;
      if (!name) return { error: 'Informe o nome da peça.' };
      if (min < 0 || cost < 0) return { error: 'Mínimo e custo não podem ser negativos.' };
      if (editing) {
        Object.assign(editing, { name, min, cost });
      } else {
        const stock = Math.max(0, Math.floor(Number(fd.get('stock')) || 0));
        const part = { id: uid('p'), name, stock, min, cost };
        state.parts.push(part);
        if (stock > 0) addMovement(part, 'entrada', stock, 'Estoque inicial');
      }
      save();
      render();
      toast('Peça salva.');
    });
    if (editing) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn danger';
      del.dataset.action = 'del-part';
      del.dataset.id = editing.id;
      del.textContent = 'Excluir';
      $('.modal-actions', modal).prepend(del);
    }
  }

  function deletePart(partId) {
    if (!requireManager()) return;
    const part = state.parts.find((p) => p.id === partId);
    if (!part) return;
    const usedBy = state.products.filter((pr) => pr.bom.some((i) => i.partId === partId));
    if (usedBy.length) {
      toast(`Não dá para excluir: usada em ${usedBy.map((p) => p.name).join(', ')}.`, 'error');
      return;
    }
    if (!confirm(`Excluir a peça "${part.name}"? O histórico dela será mantido.`)) return;
    state.parts = state.parts.filter((p) => p.id !== partId);
    save();
    closeModal();
    render();
    toast('Peça excluída.');
  }

  // ---------- Produtos ----------
  function viewProdutos() {
    const manager = isManager();
    const byId = L.partsById(state.parts);
    const stock = L.stockMap(state.parts);
    const cards = state.products
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
          const cost = L.productCost(p, state.parts);
          const m = L.margin(p.price, cost);
          money = `<div class="money-row">
            <div><span>Custo</span><b>${brl(cost)}</b></div>
            <div><span>Preço de venda</span><b>${brl(p.price)}</b></div>
            <div><span>Lucro / un.</span><b>${brl(m.profit)}</b></div>
            <div><span>Margem</span><b>${pct(m.pct)}</b></div>
          </div>`;
        }
        return `<article class="card prod-card" style="border-top-color:var(--brand)">
          <div><div class="cat">${esc(p.category)}</div><h3>${esc(p.name)}</h3></div>
          <div><span class="hint">Ficha técnica (por unidade)</span><ul class="bom">${items || '<li class="muted">Nenhuma peça cadastrada.</li>'}</ul></div>
          ${money}
          <div class="actions">
            <button class="btn primary small" data-action="produce" data-id="${p.id}" ${max === 0 ? 'disabled' : ''}>Registrar montagem</button>
            ${manager ? `<button class="btn small" data-action="edit-product" data-id="${p.id}">Editar</button>` : ''}
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
        <div class="actions">${manager ? '<button class="btn primary" data-action="new-product">+ Novo produto</button>' : ''}</div>
      </section>
      <div class="grid">${cards || '<div class="empty card" style="grid-column:1/-1">Nenhum produto cadastrado.</div>'}</div>`;
  }

  function bomRow(selectedId, qty) {
    const opts = state.parts
      .map((p) => `<option value="${p.id}" ${p.id === selectedId ? 'selected' : ''}>${esc(p.name)}</option>`)
      .join('');
    return `<div class="bom-row">
      <select name="bomPart" aria-label="Peça">${opts}</select>
      <input name="bomQty" type="number" min="1" step="1" value="${qty || 1}" aria-label="Quantidade" />
      <button type="button" class="icon-btn" data-action="del-bom-row" aria-label="Remover peça">×</button>
    </div>`;
  }

  function openProductForm(productId) {
    if (!requireManager()) return;
    if (!state.parts.length) {
      toast('Cadastre as peças antes de criar um produto.', 'error');
      return;
    }
    const editing = productId ? state.products.find((p) => p.id === productId) : null;
    const rows = (editing && editing.bom.length ? editing.bom : [{ partId: state.parts[0].id, qty: 1 }])
      .map((i) => bomRow(i.partId, i.qty))
      .join('');
    const body = `
      <label>Nome do produto
        <input name="name" type="text" required maxlength="80" value="${esc(editing ? editing.name : '')}" />
      </label>
      <label>Categoria
        <input name="category" type="text" maxlength="40" list="cats" placeholder="Ex.: Torneiras, Duchas, Acessórios" value="${esc(editing ? editing.category : '')}" />
        <datalist id="cats">${[...new Set(state.products.map((p) => p.category))].map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
      </label>
      <label>Preço de venda (R$)
        <input name="price" type="number" min="0" step="0.01" value="${editing ? editing.price : 0}" />
      </label>
      <div>
        <strong style="font-size:.9rem">Ficha técnica: peças em 1 unidade</strong>
        <div id="bom-rows" style="margin-top:6px">${rows}</div>
        <button type="button" class="btn small" data-action="add-bom-row">+ Adicionar peça</button>
      </div>`;
    openModal(editing ? 'Editar produto' : 'Novo produto', body, (fd) => {
      const name = String(fd.get('name') || '').trim();
      const category = String(fd.get('category') || '').trim() || 'Sem categoria';
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
      if (editing) Object.assign(editing, { name, category, price, bom });
      else state.products.push({ id: uid('pr'), name, category, price, bom });
      save();
      render();
      toast('Produto salvo.');
    });
    if (editing) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn danger';
      del.dataset.action = 'del-product';
      del.dataset.id = editing.id;
      del.textContent = 'Excluir';
      $('.modal-actions', modal).prepend(del);
    }
  }

  function deleteProduct(productId) {
    if (!requireManager()) return;
    const p = state.products.find((x) => x.id === productId);
    if (!p) return;
    if (!confirm(`Excluir o produto "${p.name}"?`)) return;
    state.products = state.products.filter((x) => x.id !== productId);
    delete simPlan[productId];
    save();
    closeModal();
    render();
    toast('Produto excluído.');
  }

  function recordProduction(parts, product, qty) {
    const res = L.applyProduction(parts, product, qty);
    if (!res.ok) return res;
    const byId = L.partsById(parts);
    for (const partId of Object.keys(res.consumed)) {
      addMovement(byId[partId], 'producao', res.consumed[partId], `Montagem: ${qty}× ${product.name}`);
    }
    return res;
  }

  function openProduce(productId) {
    const product = state.products.find((p) => p.id === productId);
    if (!product) return;
    const { max } = L.maxProducible(product, L.stockMap(state.parts));
    const body = `
      <p><b>${esc(product.name)}</b><br><span class="muted">Dá para montar até <b>${int(max)}</b> com o estoque atual.</span></p>
      <label>Quantidade a montar
        <input name="qty" type="number" min="1" max="${max}" step="1" value="1" required />
      </label>
      <p class="hint">As peças da ficha técnica serão descontadas do estoque automaticamente.</p>`;
    openModal('Registrar montagem', body, (fd) => {
      const qty = Math.floor(Number(fd.get('qty')));
      const res = recordProduction(state.parts, product, qty);
      if (!res.ok) return { error: res.error };
      state.parts = res.parts;
      save();
      render();
      toast(`Montagem registrada: ${int(qty)}× ${product.name}.`);
    }, 'Registrar montagem');
  }

  // ---------- Simulação ----------
  function viewSimulacao() {
    const manager = isManager();
    const stock = L.stockMap(state.parts);
    const rows = state.products
      .map((p) => {
        const { max } = L.maxProducible(p, stock);
        return `<div class="sim-row">
          <label for="sim-${p.id}"><b>${esc(p.name)}</b></label>
          <input id="sim-${p.id}" type="number" min="0" step="1" placeholder="0" data-sim="${p.id}" value="${simPlan[p.id] || ''}" />
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
          <div class="actions" style="margin-top:12px">
            <button class="btn small" data-action="sim-clear">Limpar</button>
          </div>
        </div>
        <div id="sim-result"></div>
      </div>`;
  }

  function renderSimResult() {
    const box = $('#sim-result');
    if (!box) return;
    const manager = isManager();
    const sim = L.simulate(simPlan, state.products, state.parts);
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
    const extra = state.products.filter((p) => sim.extra[p.id] > 0);
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

  function applySimulation() {
    const sim = L.simulate(simPlan, state.products, state.parts);
    if (!sim.feasible || sim.units === 0) return;
    if (!confirm(`Registrar a montagem de ${sim.units} unidade(s) e descontar as peças do estoque?`)) return;
    let working = state.parts;
    for (const product of state.products) {
      const qty = Math.floor(Number(simPlan[product.id]) || 0);
      if (qty <= 0) continue;
      const res = recordProduction(working, product, qty);
      if (!res.ok) {
        toast(res.error, 'error');
        return;
      }
      working = res.parts;
    }
    state.parts = working;
    simPlan = {};
    save();
    render();
    toast('Produção registrada e estoque atualizado.');
  }

  // ---------- Histórico ----------
  function viewHistorico() {
    const label = { entrada: 'Entrada', saida: 'Saída', producao: 'Montagem' };
    const pill = { entrada: 'ok', saida: 'warn', producao: 'bad' };
    const rows = state.movements
      .slice(0, 200)
      .map((m) => {
        const sign = m.type === 'entrada' ? '+' : '−';
        return `<tr>
          <td class="num">${new Date(m.date).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
          <td><span class="pill ${pill[m.type] || 'ok'}">${label[m.type] || esc(m.type)}</span></td>
          <td>${esc(m.partName)}</td>
          <td class="right num">${sign}${int(m.qty)}</td>
          <td>${esc(m.note)}</td>
          <td>${m.role === 'gerente' ? 'Gerente' : 'Funcionário'}</td>
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
        <thead><tr><th>Quando</th><th>Tipo</th><th>Peça</th><th class="right">Qtd.</th><th>Observação</th><th>Quem</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6" class="empty">Ainda não há movimentações.</td></tr>`}</tbody>
      </table></div>`;
  }

  // ---------- Financeiro (só gerência) ----------
  function viewFinanceiro() {
    if (!isManager()) return viewMostruario();
    const stock = L.stockMap(state.parts);
    const data = state.products
      .map((p) => {
        const cost = L.productCost(p, state.parts);
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
    const partRows = [...state.parts]
      .sort((a, b) => b.stock * b.cost - a.stock * a.cost)
      .slice(0, 8)
      .map(
        (p) => `<tr><td>${esc(p.name)}</td><td class="right num">${int(p.stock)}</td>
          <td class="right num">${brl(p.cost)}</td><td class="right num">${brl(p.stock * p.cost)}</td></tr>`
      )
      .join('');
    return `
      <section class="page-head">
        <div>
          <h1>Financeiro</h1>
          <p class="muted">Custo de cada produto (soma das peças da ficha técnica), preço de venda e margem. Visível só para a gerência.</p>
        </div>
      </section>
      <div class="kpis">
        <div class="kpi"><div class="label">Valor parado em estoque</div><div class="value">${brl(L.stockValue(state.parts))}</div></div>
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

  // ---------- renderização ----------
  const VIEWS = {
    mostruario: viewMostruario,
    pecas: viewPecas,
    produtos: viewProdutos,
    simulacao: viewSimulacao,
    historico: viewHistorico,
    financeiro: viewFinanceiro,
  };

  function renderFoot() {
    $('#foot').innerHTML = isManager()
      ? `<span>Dados salvos neste navegador.</span>
         <button class="btn small" data-action="export">Exportar backup</button>
         <button class="btn small" data-action="import">Importar backup</button>
         <button class="btn small danger" data-action="reset">Restaurar dados de exemplo</button>`
      : `<span>Visão de funcionário: valores financeiros ocultos.</span>`;
  }

  function render() {
    renderTabs();
    $('#view').innerHTML = VIEWS[tab]();
    renderFoot();
    $('#role').value = role;
    if (tab === 'simulacao') renderSimResult();
  }

  // ---------- backup ----------
  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `estoque-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(String(reader.result));
        if (!d || !Array.isArray(d.parts) || !Array.isArray(d.products)) throw new Error('formato');
        if (!confirm('Substituir todos os dados atuais pelos do arquivo?')) return;
        d.movements = Array.isArray(d.movements) ? d.movements : [];
        state = d;
        simPlan = {};
        save();
        render();
        toast('Backup importado.');
      } catch (e) {
        toast('Arquivo inválido. Use um backup exportado por este sistema.', 'error');
      }
    };
    reader.readAsText(file);
  }

  // ---------- eventos ----------
  const ACTIONS = {
    'close-modal': () => closeModal(),
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
      const wrap = $('#bom-rows', modal);
      if (wrap) wrap.insertAdjacentHTML('beforeend', bomRow(state.parts[0].id, 1));
    },
    'del-bom-row': (id, btn) => {
      const rows = modal.querySelectorAll('.bom-row');
      if (rows.length > 1) btn.closest('.bom-row').remove();
    },
    'sim-max': (id) => {
      const p = state.products.find((x) => x.id === id);
      if (!p) return;
      simPlan[id] = L.maxProducible(p, L.stockMap(state.parts)).max;
      const input = $(`#sim-${id}`);
      if (input) input.value = simPlan[id] || '';
      renderSimResult();
    },
    'sim-clear': () => {
      simPlan = {};
      document.querySelectorAll('[data-sim]').forEach((i) => (i.value = ''));
      renderSimResult();
    },
    'sim-apply': () => applySimulation(),
    export: () => requireManager() && exportData(),
    import: () => requireManager() && $('#import-file').click(),
    reset: () => {
      if (!requireManager()) return;
      if (!confirm('Apagar tudo e voltar aos dados de exemplo?')) return;
      state = clone(window.SAMPLE_DATA);
      simPlan = {};
      save();
      render();
      toast('Dados de exemplo restaurados.');
    },
  };

  document.addEventListener('click', (e) => {
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) {
      tab = tabBtn.dataset.tab;
      render();
      window.scrollTo({ top: 0 });
      return;
    }
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const fn = ACTIONS[btn.dataset.action];
    if (fn) fn(btn.dataset.id, btn);
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'filter') {
      filter = t.value;
      const grid = $('#grid');
      if (grid) grid.innerHTML = cardsHtml();
    } else if (t.dataset && t.dataset.sim) {
      const v = Math.max(0, Math.floor(Number(t.value) || 0));
      if (v > 0) simPlan[t.dataset.sim] = v;
      else delete simPlan[t.dataset.sim];
      renderSimResult();
    }
  });

  $('#role').addEventListener('change', (e) => {
    role = e.target.value === 'funcionario' ? 'funcionario' : 'gerente';
    try {
      localStorage.setItem(ROLE_KEY, role);
    } catch (err) {
      /* sem problema */
    }
    closeModal();
    render();
  });

  $('#import-file').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) importData(file);
    e.target.value = '';
  });

  render();
})();
