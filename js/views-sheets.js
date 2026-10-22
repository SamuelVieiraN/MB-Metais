/*
 * Aba "Planilhas": exportar o estoque para Excel (com ou sem valores financeiros)
 * e importar uma planilha para atualizar o sistema, sempre com prévia antes.
 * A leitura/escrita do .xlsx é do js/xlsx-lite.js; as regras, do js/sheets.js.
 */
(function (root) {
  'use strict';

  const App = root.App;
  const L = root.Logic;
  const S = root.Sheets;
  const X = root.XlsxLite;
  const { esc, int, icons, toast, confirmBox, uuid, $ } = root.UI;

  const exportOpts = { finance: false, history: false };
  let imp = null; // { fileName, wb, stockMode, backup, plan }
  const stamp = () => new Date().toISOString().slice(0, 10);

  // ---------------- leitura do arquivo ----------------
  async function readFile(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.xlsx') || name.endsWith('.xlsm')) return X.read(await file.arrayBuffer());
    if (name.endsWith('.csv')) {
      const buf = await file.arrayBuffer();
      let text;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
      } catch (e) {
        text = new TextDecoder('windows-1252').decode(buf); // CSV salvo pelo Excel em português
      }
      return X.readCsv(text);
    }
    if (name.endsWith('.xls')) {
      throw new Error('Este é um arquivo .xls (Excel antigo). Abra no Excel e use Salvar como > Pasta de Trabalho do Excel (.xlsx).');
    }
    throw new Error('Formato não reconhecido. Envie uma planilha .xlsx (ou .csv).');
  }

  function replan() {
    imp.plan = S.planImport(imp.wb, App.state, { stockMode: imp.stockMode, uid: () => uuid() });
  }

  async function loadFile(file) {
    if (!App.isManager()) return toast('Só o gerente pode importar planilhas.', 'error');
    if (!file) return;
    try {
      const wb = await readFile(file);
      imp = { fileName: file.name, wb, stockMode: 'replace', backup: true, plan: null };
      replan();
    } catch (e) {
      imp = null;
      toast(e.message || 'Não consegui ler a planilha.', 'error');
    }
    refreshPreview();
  }

  // ---------------- diferenças a gravar ----------------
  const bomKey = (bom) => JSON.stringify([...bom].sort((a, b) => a.partId.localeCompare(b.partId)).map((i) => [i.partId, i.qty]));

  function diff(oldState, next) {
    const oldParts = L.partsById(oldState.parts);
    const partItems = [];
    for (const p of next.parts) {
      const o = oldParts[p.id];
      if (!o) {
        partItems.push({ id: p.id, code: p.code || '', name: p.name, stock: p.stock, min: p.min, cost: p.cost });
        continue;
      }
      if ((o.code || '') !== (p.code || '') || o.name !== p.name || o.stock !== p.stock || o.min !== p.min || o.cost !== p.cost) {
        const it = { id: p.id, code: p.code || '', name: p.name, min: p.min };
        if (o.stock !== p.stock) it.stock = p.stock;
        if (o.cost !== p.cost) it.cost = p.cost;
        partItems.push(it);
      }
    }
    const oldProducts = {};
    oldState.products.forEach((p) => (oldProducts[p.id] = p));
    const productItems = [];
    for (const p of next.products) {
      const o = oldProducts[p.id];
      const base = { id: p.id, code: p.code || '', name: p.name, category: p.category };
      if (!o) {
        productItems.push({ ...base, price: p.price, bom: p.bom });
        continue;
      }
      const metaChanged = (o.code || '') !== (p.code || '') || o.name !== p.name || o.category !== p.category || o.price !== p.price;
      const bomChanged = bomKey(o.bom) !== bomKey(p.bom);
      if (metaChanged || bomChanged) {
        const it = { ...base };
        if (o.price !== p.price) it.price = p.price;
        if (bomChanged) it.bom = p.bom;
        productItems.push(it);
      }
    }
    return { partItems, productItems };
  }

  // ---------------- telas ----------------
  function view() {
    const manager = App.isManager();
    return `
      <section class="page-head">
        <div>
          <h1>Planilhas</h1>
          <p class="muted">Leve o estoque para o Excel ou atualize o sistema a partir de uma planilha, sem perder o costume de trabalhar com ela.</p>
        </div>
      </section>
      <div class="two-col">
        <div class="card sheet-card">
          <div class="card-icon">${icons.download}</div>
          <h2>Exportar para Excel</h2>
          <p class="muted">Gera um arquivo .xlsx com as abas <b>Peças</b>, <b>Produtos</b> e <b>Ficha técnica</b>, com todos os dados cadastrados.</p>
          <label class="check"><input type="checkbox" id="opt-history" ${exportOpts.history ? 'checked' : ''} /> Incluir o histórico de movimentações</label>
          ${
            manager
              ? `<label class="check"><input type="checkbox" id="opt-finance" ${exportOpts.finance ? 'checked' : ''} /> Incluir valores financeiros (custos, preços, lucro e margem)</label>
                 <p class="hint">Desmarcado, a planilha não leva nenhum valor em reais e pode ser compartilhada com a equipe.</p>`
              : `<p class="hint">Esta planilha não inclui valores financeiros.</p>`
          }
          <button class="btn primary" data-action="sheet-export">${icons.download} Baixar planilha (.xlsx)</button>
        </div>
        <div class="card sheet-card">
          <div class="card-icon">${icons.upload}</div>
          <h2>Atualizar a partir de uma planilha</h2>
          ${
            manager
              ? `<p class="muted">Envie uma planilha para criar e atualizar peças, produtos e fichas técnicas. Antes de aplicar, você vê tudo o que vai mudar.</p>
                 <label class="dropzone" for="sheet-file" id="dropzone">
                   ${icons.file}
                   <span><b>Escolher arquivo</b> ou arrastar aqui</span>
                   <small>.xlsx ou .csv</small>
                 </label>
                 <input type="file" id="sheet-file" accept=".xlsx,.xlsm,.csv,.xls" hidden />
                 <p class="hint">Não sabe como montar? <button class="link-btn" data-action="sheet-template">Baixe a planilha modelo</button> ou use uma exportada pelo sistema, que já está no formato certo.</p>`
              : `<p class="muted">Só o gerente pode atualizar o estoque por planilha.</p>`
          }
        </div>
      </div>
      ${
        manager && App.store.kind === 'supabase'
          ? `<div class="card sheet-card" style="margin-top:16px">
              <h2>Estoque fictício para demonstração</h2>
              <p class="muted">Carrega 49 peças, 17 produtos (torneiras, duchas e chuveiros) com ficha técnica, guia de montagem, 3 fotos por produto (montado, detalhe e medidas), alguns produtos já montados e 3 pedidos de exemplo. Serve para mostrar o sistema funcionando. Depois, remova antes de lançar o estoque real: <b>só sai o que foi carregado por aqui</b>.</p>
              <div class="actions"><button class="btn" data-action="demo-load">Carregar estoque fictício</button>
              <button class="btn danger" data-action="demo-remove">Remover estoque fictício</button></div>
            </div>`
          : ''
      }
      <div id="import-preview">${previewHtml()}</div>`;
  }

  const listBlock = (title, items, tone, open) =>
    items.length
      ? `<details class="changes ${tone || ''}" ${open ? 'open' : ''}><summary>${esc(title)} <span class="count">${int(items.length)}</span></summary>
          <ul>${items.slice(0, 100).map((x) => `<li>${esc(x)}</li>`).join('')}${items.length > 100 ? `<li class="muted">… e mais ${int(items.length - 100)}</li>` : ''}</ul></details>`
      : '';

  function previewHtml() {
    if (!imp) return '';
    const { plan } = imp;
    const head = `<div class="preview-head"><div><span class="hint">Arquivo</span><b>${esc(imp.fileName)}</b></div>
      <button class="btn small ghost" data-action="sheet-cancel">${icons.x} Descartar</button></div>`;
    if (!plan.ok) {
      return `<div class="card preview">${head}<div class="banner bad">${esc(plan.errors.join(' '))}</div></div>`;
    }
    const s = plan.summary;
    // listas curtas já abertas: dá para conferir tudo sem clicar
    const openAll = plan.changes <= 30;
    const tiles = [
      ['Peças novas', s.partsCreated.length],
      ['Peças atualizadas', s.partsUpdated.length],
      ['Produtos novos', s.productsCreated.length],
      ['Produtos atualizados', s.productsUpdated.length],
      ['Fichas técnicas', s.bomUpdated.length],
    ]
      .map(([l, n]) => `<div class="kpi ${n ? 'ok' : ''}"><div class="label">${l}</div><div class="value">${int(n)}</div></div>`)
      .join('');
    return `<div class="card preview">
      ${head}
      ${
        plan.changes === 0
          ? `<div class="banner ok">Nenhuma diferença: a planilha já está igual ao sistema.</div>`
          : `<div class="banner ok">Prévia pronta: ${int(plan.changes)} alteração(ões). Nada foi gravado ainda.</div>`
      }
      <div class="kpis">${tiles}</div>
      <fieldset class="opts">
        <legend>Como tratar o estoque</legend>
        <label class="check"><input type="radio" name="stockMode" value="replace" ${imp.stockMode === 'replace' ? 'checked' : ''} /> <span><b>Substituir</b> o estoque pelos números da planilha (contagem de estoque)</span></label>
        <label class="check"><input type="radio" name="stockMode" value="add" ${imp.stockMode === 'add' ? 'checked' : ''} /> <span><b>Somar</b> os números da planilha ao estoque atual (chegada de mercadoria)</span></label>
        <p class="hint">Peças que não estão na planilha ficam como estão. Custos e preços só mudam se a planilha trouxer essas colunas.</p>
      </fieldset>
      ${listBlock('Peças novas', s.partsCreated, '', openAll)}
      ${listBlock('Peças atualizadas', s.partsUpdated, '', openAll)}
      ${listBlock('Produtos novos', s.productsCreated, '', openAll)}
      ${listBlock('Produtos atualizados', s.productsUpdated, '', openAll)}
      ${listBlock('Fichas técnicas atualizadas', s.bomUpdated, '', openAll)}
      ${listBlock('Avisos (linhas ignoradas ou ajustadas)', plan.warnings, 'warn', true)}
      <label class="check"><input type="checkbox" id="opt-backup" ${imp.backup ? 'checked' : ''} /> Baixar uma cópia do estoque atual antes de aplicar (para poder voltar atrás)</label>
      <div class="actions" style="margin-top:14px">
        <button class="btn primary" data-action="sheet-apply" ${plan.changes ? '' : 'disabled'}>Aplicar importação</button>
        <button class="btn" data-action="sheet-cancel">Cancelar</button>
      </div>
    </div>`;
  }

  function refreshPreview() {
    const box = $('#import-preview');
    if (box) box.innerHTML = previewHtml();
  }

  // ---------------- ações ----------------
  // ---------------- estoque fictício (modo online) ----------------
  const hex12 = (n) => String(n).padStart(12, '0');
  const demoId = (id) => {
    const n = parseInt(String(id).replace(/\D/g, ''), 10);
    return `de00000${id.startsWith('pr') ? 1 : 0}-0000-4000-8000-${hex12(n)}`;
  };
  async function loadDemo() {
    if (!App.isManager()) return;
    const D = root.SAMPLE_DATA;
    if (!(await confirmBox(`Carregar ${D.parts.length} peças e ${D.products.length} produtos fictícios? Se já houver peças com os mesmos códigos (P001, PR001...), o sistema avisa e nada é gravado.`, 'Carregar'))) return;
    try {
      toast('Carregando... pode levar alguns segundos.');
      await App.store.saveParts(
        D.parts.map((p) => ({ id: demoId(p.id), code: p.code, name: p.name, stock: p.stock, min: p.min, cost: p.cost })),
        'Estoque fictício de demonstração'
      );
      await App.store.saveProducts(
        D.products.map((p) => ({
          id: demoId(p.id), code: p.code, name: p.name, category: p.category, price: p.price, guide: p.guide || [], ready: p.ready || 0,
          bom: p.bom.map((b) => ({ partId: demoId(b.partId), qty: b.qty })),
        }))
      );
      for (const o of [...(D.orders || [])].reverse()) {
        if ((App.state.orders || []).some((x) => x.ref === o.ref && String(x.customer).startsWith('[Demonstração]'))) continue;
        await App.store.createOrder({ customer: o.customer, ref: o.ref, items: o.items.map((i) => ({ productId: demoId(i.productId), qty: i.qty })) });
      }
      for (const p of D.products) {
        const have = ((App.state.products.find((x) => x.id === demoId(p.id)) || {}).photos || []).length;
        if (have) continue; // já tem foto (carregamento repetido)
        for (const url of p.photos || (p.photo ? [p.photo] : [])) {
          try {
            const res = await fetch(url);
            if (res.ok) await App.store.addPhoto(demoId(p.id), { blob: await res.blob() });
          } catch (e) {
            /* sem a foto, o produto continua válido */
          }
        }
      }
      await App.refresh();
      App.render();
      toast('Estoque fictício carregado.');
    } catch (e) {
      toast(e.message || 'Não foi possível carregar.', 'error');
    }
  }
  async function removeDemo() {
    if (!App.isManager()) return;
    if (!(await confirmBox('Remover o estoque fictício? Somem as peças e os produtos fictícios (os seus cadastros reais ficam). O histórico de movimentações continua registrado.', 'Remover', true))) return;
    try {
      const D = root.SAMPLE_DATA;
      for (const o of App.state.orders || []) {
        if (o.status === 'aberto' && String(o.customer).startsWith('[Demonstração]')) await App.store.cancelOrder(o.id, 'Remoção do estoque fictício');
      }
      for (const p of D.products) if (App.state.products.some((x) => x.id === demoId(p.id))) await App.store.deleteProduct(demoId(p.id));
      for (const p of D.parts) if (App.state.parts.some((x) => x.id === demoId(p.id))) await App.store.deletePart(demoId(p.id));
      await App.refresh();
      App.render();
      toast('Estoque fictício removido.');
    } catch (e) {
      toast(e.message || 'Não foi possível remover.', 'error');
    }
  }

  Object.assign(App.actions, {
    'demo-load': loadDemo,
    'demo-remove': removeDemo,
    'sheet-export': () => {
      const finance = App.isManager() && exportOpts.finance;
      const blob = X.build(S.buildExport(App.state, { finance, history: exportOpts.history }));
      App.download(blob, `estoque-${stamp()}${finance ? '-com-valores' : ''}.xlsx`);
      toast(finance ? 'Planilha gerada, com valores financeiros.' : 'Planilha gerada.');
    },
    'sheet-template': () => {
      App.download(X.build(S.buildTemplate()), 'modelo-importacao-estoque.xlsx');
    },
    'sheet-cancel': () => {
      imp = null;
      refreshPreview();
    },
    'sheet-apply': async (id, btn) => {
      if (!App.isManager() || !imp || !imp.plan.ok || !imp.plan.changes) return;
      const msg = `Aplicar ${imp.plan.changes} alteração(ões) no estoque?`;
      if (!(await confirmBox(msg, 'Aplicar importação'))) return;
      btn.disabled = true;
      btn.classList.add('busy');
      try {
        if (imp.backup) {
          const now = new Date();
          const hhmm = now.toTimeString().slice(0, 5).replace(':', 'h');
          App.download(
            X.build(S.buildExport(App.state, { finance: true, history: false })),
            `copia-antes-da-importacao-${stamp()}-${hhmm}.xlsx`
          );
        }
        const { partItems, productItems } = diff(App.state, imp.plan.next);
        if (partItems.length) await App.store.saveParts(partItems, 'Importação de planilha');
        if (productItems.length) await App.store.saveProducts(productItems);
        const total = imp.plan.changes;
        imp = null;
        await App.refresh();
        App.render();
        toast(`Importação concluída: ${total} alteração(ões) aplicada(s).`);
      } catch (e) {
        await App.refresh().catch(() => {});
        App.render();
        toast(`A importação parou: ${e.message} Confira o estoque antes de tentar de novo.`, 'error');
      }
    },
  });

  // ---------------- eventos ----------------
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'opt-history') exportOpts.history = t.checked;
    else if (t.id === 'opt-finance') exportOpts.finance = t.checked;
    else if (t.id === 'opt-backup' && imp) imp.backup = t.checked;
    else if (t.name === 'stockMode' && imp) {
      imp.stockMode = t.value;
      replan();
      refreshPreview();
    } else if (t.id === 'sheet-file') {
      const file = t.files && t.files[0];
      t.value = '';
      loadFile(file);
    }
  });

  document.addEventListener('dragover', (e) => {
    if (e.target.closest && e.target.closest('#dropzone')) {
      e.preventDefault();
      $('#dropzone').classList.add('over');
    }
  });
  document.addEventListener('dragleave', (e) => {
    const dz = $('#dropzone');
    if (dz && !dz.contains(e.relatedTarget)) dz.classList.remove('over');
  });
  document.addEventListener('drop', (e) => {
    if (e.target.closest && e.target.closest('#dropzone')) {
      e.preventDefault();
      $('#dropzone').classList.remove('over');
      loadFile(e.dataTransfer.files && e.dataTransfer.files[0]);
    }
  });

  App.registerTab({ id: 'planilhas', label: 'Planilhas', order: 50, managerOnly: true, view });
})(typeof self !== 'undefined' ? self : this);
