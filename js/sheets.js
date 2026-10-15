/*
 * Regras de planilhas: o que vai na exportação e como uma planilha enviada
 * vira alterações no estoque (com prévia, antes de aplicar).
 * Funções puras: não mexem na tela nem no armazenamento.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./logic.js'));
  else root.Sheets = factory(root.Logic);
})(typeof self !== 'undefined' ? self : this, function (L) {
  // ---------------- utilidades ----------------
  const norm = (s) =>
    String(s ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';
  const text = (v) => (isBlank(v) ? '' : String(v).trim());

  /** Número vindo da planilha: aceita 12,5 / 1.234,56 / R$ 10,00. Devolve null se não for número. */
  function parseNum(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (isBlank(v)) return null;
    let s = String(v).replace(/R\$/gi, '').replace(/\s/g, '');
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    return Number(s);
  }

  const key = (s) => norm(s);
  const brl = (n) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  // ---------------- mapeamento de cabeçalhos ----------------
  const RULES = {
    parts: {
      code: (h) => ['codigo', 'cod', 'sku', 'ref', 'referencia'].includes(h) || h.startsWith('codigo '),
      min: (h) => h.includes('minimo') || h === 'min',
      stock: (h) =>
        ['estoque', 'estoque atual', 'quantidade', 'qtd', 'qtde', 'saldo', 'quantidade em estoque', 'estoque disponivel'].includes(h),
      cost: (h) =>
        (h.startsWith('custo') || h.startsWith('preco de custo') || h.startsWith('valor unit')) &&
        !h.includes('valor em estoque'),
      name: (h) =>
        ['peca', 'nome', 'descricao', 'descricao da peca', 'item', 'material', 'nome da peca', 'produto'].includes(h),
    },
    products: {
      code: (h) => ['codigo', 'cod', 'sku', 'ref', 'referencia'].includes(h) || h.startsWith('codigo '),
      name: (h) => ['produto', 'nome', 'descricao', 'nome do produto', 'item'].includes(h),
      category: (h) => ['categoria', 'grupo', 'linha', 'tipo'].includes(h),
      price: (h) => (h.startsWith('preco') && !h.includes('custo')) || h === 'valor de venda' || h === 'valor venda',
    },
    bom: {
      productCode: (h) => ['codigo do produto', 'cod produto', 'codigo produto'].includes(h),
      productName: (h) => ['produto', 'nome do produto'].includes(h),
      partCode: (h) => ['codigo da peca', 'cod peca', 'codigo peca'].includes(h),
      partName: (h) => ['peca', 'nome da peca', 'item', 'material'].includes(h),
      qty: (h) => ['quantidade', 'qtd', 'qtde', 'quantidade por unidade', 'quantidade na ficha'].includes(h),
    },
  };

  function mapHeaders(headerRow, rules) {
    const map = {};
    const taken = new Set();
    const heads = (headerRow || []).map(norm);
    for (const field of Object.keys(rules)) {
      for (let i = 0; i < heads.length; i++) {
        if (taken.has(i) || !heads[i]) continue;
        if (rules[field](heads[i])) {
          map[field] = i;
          taken.add(i);
          break;
        }
      }
    }
    return map;
  }

  /** Acha a linha de cabeçalho (às vezes há títulos antes) olhando as 10 primeiras linhas. */
  function findHeader(rows, rules, required) {
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const map = mapHeaders(rows[i], rules);
      if (required.every((f) => map[f] !== undefined)) return { index: i, map };
    }
    return null;
  }

  function findSheet(wb, names) {
    return wb.sheets.find((s) => names.includes(norm(s.name)));
  }

  // ---------------- exportação ----------------
  function buildExport(state, opts) {
    opts = opts || {};
    const finance = !!opts.finance;
    const byId = L.partsById(state.parts);
    const stock = L.stockMap(state.parts);

    const partCols = [
      { header: 'Código', width: 12 },
      { header: 'Peça', width: 42 },
      { header: 'Estoque', width: 11 },
      { header: 'Mínimo', width: 11 },
      { header: 'Situação', width: 12 },
    ];
    if (finance) partCols.push({ header: 'Custo unit. (R$)', width: 16 }, { header: 'Valor em estoque (R$)', width: 22 });
    const partRows = state.parts.map((p) => {
      const row = [p.code || '', p.name, p.stock, p.min, p.stock === 0 ? 'Zerado' : p.stock <= p.min ? 'Baixo' : 'OK'];
      if (finance) row.push({ v: p.cost, s: 'money' }, { v: L.round2(p.stock * p.cost), s: 'money' });
      return row;
    });

    const prodCols = [
      { header: 'Código', width: 12 },
      { header: 'Produto', width: 42 },
      { header: 'Categoria', width: 18 },
    ];
    if (finance) {
      prodCols.push(
        { header: 'Preço de venda (R$)', width: 20 },
        { header: 'Custo (R$)', width: 14 },
        { header: 'Lucro por unidade (R$)', width: 22 },
        { header: 'Margem', width: 10 }
      );
    }
    prodCols.push({ header: 'Dá para montar', width: 16 }, { header: 'Peça que limita', width: 36 });
    const prodRows = state.products.map((p) => {
      const { max, limitingPartId } = L.maxProducible(p, stock);
      const row = [p.code || '', p.name, p.category];
      if (finance) {
        const cost = L.productCost(p, state.parts);
        const m = L.margin(p.price, cost);
        row.push({ v: p.price, s: 'money' }, { v: cost, s: 'money' }, { v: m.profit, s: 'money' }, { v: m.pct / 100, s: 'pct' });
      }
      row.push(max, limitingPartId && byId[limitingPartId] ? byId[limitingPartId].name : '');
      return row;
    });

    const bomRows = [];
    for (const p of state.products) {
      for (const i of p.bom) {
        const part = byId[i.partId];
        bomRows.push([p.code || '', p.name, part ? part.code || '' : '', part ? part.name : '(peça removida)', i.qty]);
      }
    }

    const sheets = [
      { name: 'Peças', columns: partCols, rows: partRows },
      { name: 'Produtos', columns: prodCols, rows: prodRows },
      {
        name: 'Ficha técnica',
        columns: [
          { header: 'Código do produto', width: 18 },
          { header: 'Produto', width: 42 },
          { header: 'Código da peça', width: 16 },
          { header: 'Peça', width: 42 },
          { header: 'Quantidade', width: 12 },
        ],
        rows: bomRows,
      },
    ];

    if (opts.history) {
      const label = { entrada: 'Entrada', saida: 'Saída', producao: 'Montagem' };
      sheets.push({
        name: 'Histórico',
        columns: [
          { header: 'Data', width: 18 },
          { header: 'Tipo', width: 12 },
          { header: 'Peça', width: 42 },
          { header: 'Quantidade', width: 12 },
          { header: 'Observação', width: 36 },
          { header: 'Quem', width: 14 },
        ],
        rows: state.movements.map((m) => [
          new Date(m.date).toLocaleString('pt-BR'),
          label[m.type] || m.type,
          m.partName,
          m.qty,
          m.note || '',
          m.role === 'gerente' ? 'Gerente' : 'Funcionário',
        ]),
      });
    }
    return sheets;
  }

  /** Planilha modelo: só cabeçalhos e uma folha de instruções. */
  function buildTemplate() {
    return [
      {
        name: 'Peças',
        columns: [
          { header: 'Código', width: 12 },
          { header: 'Peça', width: 42 },
          { header: 'Estoque', width: 11 },
          { header: 'Mínimo', width: 11 },
          { header: 'Custo unit. (R$)', width: 16 },
        ],
        rows: [],
      },
      {
        name: 'Produtos',
        columns: [
          { header: 'Código', width: 12 },
          { header: 'Produto', width: 42 },
          { header: 'Categoria', width: 18 },
          { header: 'Preço de venda (R$)', width: 20 },
        ],
        rows: [],
      },
      {
        name: 'Ficha técnica',
        columns: [
          { header: 'Código do produto', width: 18 },
          { header: 'Produto', width: 42 },
          { header: 'Código da peça', width: 16 },
          { header: 'Peça', width: 42 },
          { header: 'Quantidade', width: 12 },
        ],
        rows: [],
      },
      {
        name: 'Instruções',
        columns: [{ header: 'Como preencher', width: 110 }],
        rows: [
          ['Preencha as abas Peças, Produtos e Ficha técnica. Não precisa preencher todas: só as que quiser atualizar.'],
          ['Peças: informe Código (opcional) e Peça. Estoque, Mínimo e Custo unit. são opcionais; o que não vier na planilha não é alterado.'],
          ['Produtos: informe Produto, Categoria e Preço de venda. Produto novo é criado; produto existente é atualizado.'],
          ['Ficha técnica: uma linha para cada peça de cada produto, com a Quantidade usada em 1 unidade. A ficha do produto é substituída pelas linhas da planilha.'],
          ['O sistema reconhece peças e produtos primeiro pelo Código e, se não houver, pelo nome. Use sempre o mesmo código ou nome.'],
          ['Você pode usar a planilha exportada pelo próprio sistema: ela já está no formato certo. Colunas calculadas (Situação, Dá para montar, Lucro, Margem) são ignoradas.'],
          ['Antes de aplicar, o sistema mostra uma prévia do que vai mudar e baixa uma cópia da situação atual. Se precisar voltar atrás, envie essa cópia de novo.'],
        ],
      },
    ];
  }

  // ---------------- importação ----------------
  function lookup(list, code, name) {
    const c = key(code);
    if (c) {
      const hit = list.find((x) => key(x.code) === c);
      if (hit) return hit;
    }
    const n = key(name);
    return n ? list.find((x) => key(x.name) === n) : undefined;
  }

  /**
   * Lê as planilhas e calcula o que mudaria. Não altera "state".
   * opts: { stockMode: 'replace' | 'add', uid: () => string }
   * Devolve { ok, errors, warnings, summary, next: {parts, products}, movements }.
   */
  function planImport(wb, state, opts) {
    opts = opts || {};
    const stockMode = opts.stockMode === 'add' ? 'add' : 'replace';
    let counter = 0;
    const uid = opts.uid || ((p) => p + Date.now().toString(36) + (counter++).toString(36));
    const warnings = [];
    const warn = (sheet, row, msg) => warnings.push(`${sheet}, linha ${row}: ${msg}`);

    const parts = state.parts.map((p) => ({ ...p }));
    const products = state.products.map((p) => ({ ...p, bom: p.bom.map((i) => ({ ...i })) }));
    const movements = [];
    const summary = {
      partsCreated: [],
      partsUpdated: [],
      partsUnchanged: 0,
      productsCreated: [],
      productsUpdated: [],
      bomUpdated: [],
    };

    const partsSheet = findSheet(wb, ['pecas', 'estoque', 'materiais', 'itens', 'csv']);
    const productsSheet = findSheet(wb, ['produtos', 'catalogo']);
    const bomSheet = findSheet(wb, ['ficha tecnica', 'ficha', 'fichas tecnicas', 'composicao']);

    // ---- peças ----
    let partsHeader = null;
    if (partsSheet) partsHeader = findHeader(partsSheet.rows, RULES.parts, ['name']);
    if (!partsHeader && !partsSheet && wb.sheets.length === 1) {
      partsHeader = findHeader(wb.sheets[0].rows, RULES.parts, ['name']);
      if (partsHeader) partsHeader.sheet = wb.sheets[0];
    }
    const partsSrc = partsHeader ? partsSheet || partsHeader.sheet : null;

    if (partsHeader && partsSrc) {
      const { map, index } = partsHeader;
      const seen = {};
      partsSrc.rows.forEach((row, r) => {
        if (r <= index || !row || row.every(isBlank)) return;
        const rowNo = r + 1;
        const name = text(row[map.name]);
        const code = map.code !== undefined ? text(row[map.code]) : '';
        if (!name) {
          if (code) warn(partsSrc.name, rowNo, 'linha sem nome da peça, ignorada.');
          return;
        }
        const k = key(code) || key(name);
        if (seen[k]) warn(partsSrc.name, rowNo, `"${name}" aparece mais de uma vez; vale a última.`);
        seen[k] = true;

        const stockRaw = map.stock !== undefined ? parseNum(row[map.stock]) : null;
        const minRaw = map.min !== undefined ? parseNum(row[map.min]) : null;
        const costRaw = map.cost !== undefined ? parseNum(row[map.cost]) : null;
        if (map.stock !== undefined && !isBlank(row[map.stock]) && stockRaw === null) {
          warn(partsSrc.name, rowNo, `estoque de "${name}" não é um número; linha ignorada.`);
          return;
        }
        if ([stockRaw, minRaw, costRaw].some((n) => n !== null && n < 0)) {
          warn(partsSrc.name, rowNo, `"${name}" tem valor negativo; linha ignorada.`);
          return;
        }
        if (stockRaw !== null && !Number.isInteger(stockRaw)) {
          warn(partsSrc.name, rowNo, `estoque de "${name}" não é inteiro; arredondado para baixo.`);
        }
        const stockVal = stockRaw === null ? null : Math.floor(stockRaw);
        const minVal = minRaw === null ? null : Math.floor(minRaw);

        const existing = lookup(parts, code, name);
        if (!existing) {
          const part = {
            id: uid('p'),
            code,
            name,
            stock: stockVal === null ? 0 : stockVal,
            min: minVal === null ? 0 : minVal,
            cost: costRaw === null ? 0 : L.round2(costRaw),
          };
          parts.push(part);
          summary.partsCreated.push(part.name);
          if (part.stock > 0) {
            movements.push({ partId: part.id, partName: part.name, type: 'entrada', qty: part.stock, note: 'Importação de planilha (estoque inicial)' });
          }
          return;
        }

        const changes = [];
        if (code && !existing.code) {
          existing.code = code;
          changes.push('código');
        } else if (code && key(code) !== key(existing.code)) {
          warn(partsSrc.name, rowNo, `"${name}" tem código "${code}" na planilha, mas está cadastrada com "${existing.code}"; mantive o cadastrado.`);
        }
        if (name !== existing.name && key(name) !== key(existing.name)) {
          changes.push(`nome: "${existing.name}" → "${name}"`);
          existing.name = name;
        }
        if (stockVal !== null) {
          const target = stockMode === 'add' ? existing.stock + stockVal : stockVal;
          if (target !== existing.stock) {
            const diff = target - existing.stock;
            changes.push(`estoque: ${existing.stock} → ${target}`);
            movements.push({
              partId: existing.id,
              partName: existing.name,
              type: diff > 0 ? 'entrada' : 'saida',
              qty: Math.abs(diff),
              note: stockMode === 'add' ? 'Importação de planilha (entrada)' : 'Importação de planilha (ajuste de estoque)',
            });
            existing.stock = target;
          }
        }
        if (minVal !== null && minVal !== existing.min) {
          changes.push(`mínimo: ${existing.min} → ${minVal}`);
          existing.min = minVal;
        }
        if (costRaw !== null && L.round2(costRaw) !== existing.cost) {
          changes.push(`custo: ${brl(existing.cost)} → ${brl(L.round2(costRaw))}`);
          existing.cost = L.round2(costRaw);
        }
        if (changes.length) summary.partsUpdated.push(`${existing.name} (${changes.join('; ')})`);
        else summary.partsUnchanged++;
      });
    }

    // ---- produtos ----
    const productsHeader = productsSheet ? findHeader(productsSheet.rows, RULES.products, ['name']) : null;
    if (productsHeader) {
      const { map, index } = productsHeader;
      productsSheet.rows.forEach((row, r) => {
        if (r <= index || !row || row.every(isBlank)) return;
        const rowNo = r + 1;
        const name = text(row[map.name]);
        if (!name) return;
        const code = map.code !== undefined ? text(row[map.code]) : '';
        const category = map.category !== undefined ? text(row[map.category]) : '';
        const priceRaw = map.price !== undefined ? parseNum(row[map.price]) : null;
        if (map.price !== undefined && !isBlank(row[map.price]) && priceRaw === null) {
          warn(productsSheet.name, rowNo, `preço de "${name}" não é um número; linha ignorada.`);
          return;
        }
        if (priceRaw !== null && priceRaw < 0) {
          warn(productsSheet.name, rowNo, `preço de "${name}" é negativo; linha ignorada.`);
          return;
        }
        const existing = lookup(products, code, name);
        if (!existing) {
          products.push({ id: uid('pr'), code, name, category: category || 'Sem categoria', price: priceRaw === null ? 0 : L.round2(priceRaw), bom: [] });
          summary.productsCreated.push(name);
          return;
        }
        const changes = [];
        if (code && !existing.code) {
          existing.code = code;
          changes.push('código');
        }
        if (category && category !== existing.category) {
          changes.push(`categoria: ${existing.category} → ${category}`);
          existing.category = category;
        }
        if (priceRaw !== null && L.round2(priceRaw) !== existing.price) {
          changes.push(`preço: ${brl(existing.price)} → ${brl(L.round2(priceRaw))}`);
          existing.price = L.round2(priceRaw);
        }
        if (changes.length) summary.productsUpdated.push(`${existing.name} (${changes.join('; ')})`);
      });
    }

    // ---- ficha técnica ----
    const bomHeader = bomSheet ? findHeader(bomSheet.rows, RULES.bom, ['qty']) : null;
    if (bomSheet && bomHeader && (bomHeader.map.productName !== undefined || bomHeader.map.productCode !== undefined) &&
        (bomHeader.map.partName !== undefined || bomHeader.map.partCode !== undefined)) {
      const { map, index } = bomHeader;
      const groups = new Map(); // produto -> { product, items: {partId: qty} }
      bomSheet.rows.forEach((row, r) => {
        if (r <= index || !row || row.every(isBlank)) return;
        const rowNo = r + 1;
        const pName = map.productName !== undefined ? text(row[map.productName]) : '';
        const pCode = map.productCode !== undefined ? text(row[map.productCode]) : '';
        const partName = map.partName !== undefined ? text(row[map.partName]) : '';
        const partCode = map.partCode !== undefined ? text(row[map.partCode]) : '';
        if (!pName && !pCode) return;
        if (!partName && !partCode) return;
        const qty = parseNum(row[map.qty]);
        if (qty === null || !(qty > 0) || !Number.isInteger(qty)) {
          warn(bomSheet.name, rowNo, `quantidade de "${partName || partCode}" em "${pName || pCode}" precisa ser um número inteiro maior que zero; linha ignorada.`);
          return;
        }
        let product = lookup(products, pCode, pName);
        if (!product) {
          if (!pName) {
            warn(bomSheet.name, rowNo, `produto com código "${pCode}" não encontrado; linha ignorada.`);
            return;
          }
          product = { id: uid('pr'), code: pCode, name: pName, category: 'Sem categoria', price: 0, bom: [] };
          products.push(product);
          summary.productsCreated.push(pName);
          warn(bomSheet.name, rowNo, `produto "${pName}" não existia e foi criado sem preço e sem categoria.`);
        }
        const part = lookup(parts, partCode, partName);
        if (!part) {
          warn(bomSheet.name, rowNo, `peça "${partName || partCode}" não encontrada; linha ignorada. Cadastre a peça na aba Peças.`);
          return;
        }
        if (!groups.has(product.id)) groups.set(product.id, { product, items: {} });
        const g = groups.get(product.id);
        g.items[part.id] = (g.items[part.id] || 0) + qty;
      });
      for (const { product, items } of groups.values()) {
        const bom = Object.keys(items).map((partId) => ({ partId, qty: items[partId] }));
        if (!bom.length) continue;
        const before = JSON.stringify([...product.bom].sort((a, b) => a.partId.localeCompare(b.partId)));
        const after = JSON.stringify([...bom].sort((a, b) => a.partId.localeCompare(b.partId)));
        if (before !== after) {
          product.bom = bom;
          summary.bomUpdated.push(`${product.name} (${bom.length} peça${bom.length > 1 ? 's' : ''})`);
        }
      }
    }

    const nothing = !partsHeader && !productsHeader && !(bomSheet && bomHeader);
    const errors = [];
    if (nothing) {
      errors.push(
        'Não encontrei colunas conhecidas. Use a planilha modelo (ou uma exportada pelo sistema): a aba "Peças" precisa ter ao menos a coluna "Peça".'
      );
    }
    const total =
      summary.partsCreated.length +
      summary.partsUpdated.length +
      summary.productsCreated.length +
      summary.productsUpdated.length +
      summary.bomUpdated.length;
    return {
      ok: !errors.length,
      errors,
      warnings,
      summary,
      changes: total,
      next: { parts, products },
      movements,
    };
  }

  return { norm, parseNum, buildExport, buildTemplate, planImport };
});
