/*
 * Armazenamento do MODO DEMONSTRAÇÃO: tudo fica no navegador (localStorage).
 * Tem as mesmas funções do armazenamento do Supabase (js/supabase.js), então as
 * telas funcionam igual nos dois modos. As regras espelham as do banco.
 */
(function (root) {
  'use strict';

  const L = root.Logic;
  const KEY = 'estoque-torneiras:v3';
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const uuid = () => root.UI.uuid();

  function readDb() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && Array.isArray(d.parts) && Array.isArray(d.products)) {
          d.movements = Array.isArray(d.movements) ? d.movements : [];
          d.counts = Array.isArray(d.counts) ? d.counts : [];
          d.receipts = Array.isArray(d.receipts) ? d.receipts : [];
          d.priceLog = Array.isArray(d.priceLog) ? d.priceLog : [];
          d.orders = Array.isArray(d.orders) ? d.orders : [];
          d.readyLog = Array.isArray(d.readyLog) ? d.readyLog : [];
          d.products.forEach((p) => (p.ready = Math.max(0, Math.floor(p.ready || 0))));
          return d;
        }
      }
    } catch (e) {
      /* usa os dados de exemplo */
    }
    const fresh = clone(root.SAMPLE_DATA);
    fresh.counts = [];
    fresh.receipts = [];
    fresh.priceLog = [];
    fresh.orders = fresh.orders || [];
    fresh.readyLog = [];
    return fresh;
  }

  function writeDb(db) {
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
    } catch (e) {
      throw new Error('Sem espaço no navegador para guardar isso (provavelmente as fotos). Remova algumas fotos ou use o banco de dados online.');
    }
  }


  /** Valida e normaliza os itens de um recebimento (mesmas regras do banco). */
  function receiptItems(db, items, canCost) {
    if (!Array.isArray(items) || !items.length) throw new Error('Inclua pelo menos uma peça no recebimento.');
    const seen = new Set();
    let any = false;
    const out = items.map((it) => {
      const part = db.parts.find((p) => p.id === it.partId);
      if (!part) throw new Error('Uma das peças do recebimento não existe mais.');
      if (seen.has(part.id)) throw new Error(`A peça "${part.name}" aparece duas vezes. Some as quantidades em uma linha só.`);
      seen.add(part.id);
      const received = Math.floor(Number(it.received));
      const expected = it.expected === null || it.expected === undefined || it.expected === '' ? null : Math.floor(Number(it.expected));
      if (!(received >= 0) || (expected !== null && !(expected >= 0))) throw new Error('As quantidades não podem ser negativas.');
      if (received > 0) any = true;
      const uc = canCost && it.unitCost !== null && it.unitCost !== undefined && it.unitCost !== '' ? L.round2(Number(it.unitCost)) : null;
      if (uc !== null && !(uc >= 0)) throw new Error('O custo de compra não pode ser negativo.');
      return { partId: part.id, name: part.name, code: part.code || '', expected, received, unitCost: uc };
    });
    if (!any) throw new Error('Informe a quantidade recebida de pelo menos uma peça.');
    return out;
  }

  /** Valida os itens de um pedido (mesmas regras do banco). */
  function orderItems(db, items) {
    if (!Array.isArray(items) || !items.length) throw new Error('Inclua pelo menos um produto no pedido.');
    const seen = new Set();
    return items.map((it) => {
      const p = db.products.find((x) => x.id === it.productId);
      if (!p) throw new Error('Um dos produtos do pedido não existe mais.');
      if (seen.has(p.id)) throw new Error(`O produto "${p.name}" aparece duas vezes. Some as quantidades em uma linha só.`);
      seen.add(p.id);
      const qty = Math.floor(Number(it.qty));
      if (!(qty > 0)) throw new Error('A quantidade de cada produto deve ser maior que zero.');
      return { productId: p.id, name: p.name, code: p.code || '', qty, reserved: 0 };
    });
  }

  function createLocalStore(getUser) {
    const me = () => getUser() || { name: '', role: 'funcionario' };

    function logMove(db, part, type, qty, note, extra) {
      const u = me();
      const mv = {
        id: uuid(),
        date: new Date().toISOString(),
        partId: part.id,
        partName: part.name,
        type,
        qty,
        note: note || '',
        role: u.role,
        who: u.name || '',
        reverts: (extra && extra.reverts) || null,
        revertedBy: null,
        origin: (extra && extra.origin) || '',
      };
      db.movements.unshift(mv);
      if (db.movements.length > 1000) db.movements.length = 1000;
      return mv;
    }

    function logPrice(db, kind, item, oldV, newV, source, detail) {
      if (oldV !== null && oldV === newV) return;
      db.priceLog.unshift({ id: uuid(), date: new Date().toISOString(), kind, itemId: item.id, name: item.name, oldValue: oldV, newValue: newV, source, detail: detail || '', who: me().name || '' });
      if (db.priceLog.length > 1000) db.priceLog.length = 1000;
    }

    function logReady(db, product, delta, kind, note) {
      db.readyLog.unshift({ id: uuid(), date: new Date().toISOString(), productId: product.id, name: product.name, delta, kind, note: note || '', who: me().name || '' });
      if (db.readyLog.length > 500) db.readyLog.length = 500;
    }

    const needManager = () => {
      if (me().role !== 'gerente') throw new Error('Apenas o gerente pode fazer isso.');
    };

    return {
      kind: 'local',

      async load() {
        const db = clone(readDb());
        if (me().role !== 'gerente') {
          // igual ao banco online: funcionário não recebe fornecedor nem os motivos do registro
          db.receipts.forEach((r) => {
            r.supplier = '';
            r.log = r.log.map((e) => ({ ...e, detail: '' }));
            r.items.forEach((i) => delete i.unitCost);
          });
          db.priceLog = [];
          db.readyLog.forEach((l) => (l.note = ''));
          db.orders.forEach((o) => {
            o.customer = '';
            o.log = o.log.map((e) => ({ ...e, detail: '' }));
          });
        }
        return db;
      },

      async saveParts(items, note) {
        needManager();
        const db = readDb();
        for (const it of items) {
          const name = String(it.name || '').trim();
          if (!name) throw new Error('Toda peça precisa de um nome.');
          const found = db.parts.find((p) => p.id === it.id);
          // estoque ou mínimo ausentes = não mexe (igual ao banco online)
          const stock = typeof it.stock === 'number' ? Math.floor(it.stock) : found ? found.stock : 0;
          const min = typeof it.min === 'number' ? Math.floor(it.min) : found ? found.min : 0;
          if (stock < 0 || min < 0) throw new Error('Estoque e mínimo não podem ser negativos.');
          const code = String(it.code === undefined && found ? found.code || '' : it.code || '').trim();
          if (code && db.parts.some((p) => p.id !== it.id && String(p.code || '').toLowerCase() === code.toLowerCase())) {
            throw new Error(`Já existe uma peça com o código ${code}.`);
          }
          const cost = typeof it.cost === 'number' && Number.isFinite(it.cost) ? L.round2(it.cost) : null;
          if (cost !== null && cost < 0) throw new Error('O custo não pode ser negativo.');
          const existing = db.parts.find((p) => p.id === it.id);
          if (existing) {
            const old = existing.stock;
            Object.assign(existing, { code, name, min, stock });
            if (cost !== null) {
              logPrice(db, 'custo', existing, existing.cost, cost, 'manual');
              existing.cost = cost;
            }
            if (stock !== old) logMove(db, existing, stock > old ? 'entrada' : 'saida', Math.abs(stock - old), note || 'Ajuste manual');
          } else {
            const part = { id: it.id, code, name, stock, min, cost: cost === null ? 0 : cost };
            db.parts.push(part);
            if (cost !== null) logPrice(db, 'custo', part, null, cost, 'cadastro');
            if (stock > 0) logMove(db, part, 'entrada', stock, !note || note === 'Ajuste manual' ? 'Estoque inicial' : `Estoque inicial · ${note}`);
          }
        }
        writeDb(db);
      },

      async saveProducts(items) {
        needManager();
        const db = readDb();
        for (const it of items) {
          const name = String(it.name || '').trim();
          if (!name) throw new Error('Todo produto precisa de um nome.');
          const price = typeof it.price === 'number' && Number.isFinite(it.price) ? L.round2(it.price) : null;
          if (price !== null && price < 0) throw new Error('O preço não pode ser negativo.');
          const code = String(it.code || '').trim();
          if (code && db.products.some((p) => p.id !== it.id && String(p.code || '').toLowerCase() === code.toLowerCase())) {
            throw new Error(`Já existe um produto com o código ${code}.`);
          }
          const category = String(it.category || '').trim() || 'Sem categoria';
          let product = db.products.find((p) => p.id === it.id);
          let isNew = false;
          if (!product) {
            product = { id: it.id, code, name, category, price: 0, bom: [], guide: [], ready: 0 };
            db.products.push(product);
            isNew = true;
          }
          Object.assign(product, { code, name, category });
          if (price !== null) {
            logPrice(db, 'preco', product, isNew ? null : product.price, price, isNew ? 'cadastro' : 'manual');
            product.price = price;
          }
          if (typeof it.ready === 'number') {
            if (!Number.isInteger(it.ready) || it.ready < 0) throw new Error('A quantidade de produtos prontos deve ser um número inteiro, a partir de zero.');
            product.ready = it.ready;
          }
          if (Array.isArray(it.guide)) product.guide = it.guide.map((x) => String(x).trim()).filter(Boolean);
          if (Array.isArray(it.bom)) {
            const merged = {};
            for (const b of it.bom) {
              const q = Math.floor(Number(b.qty));
              if (!(q > 0)) throw new Error('Toda peça da ficha técnica precisa de quantidade maior que zero.');
              merged[b.partId] = (merged[b.partId] || 0) + q;
            }
            product.bom = Object.keys(merged).map((partId) => ({ partId, qty: merged[partId] }));
          }
        }
        writeDb(db);
      },

      async deletePart(id) {
        needManager();
        const db = readDb();
        const used = db.products.filter((p) => p.bom.some((i) => i.partId === id));
        if (used.length) throw new Error(`Não dá para excluir: a peça está na ficha técnica de ${used.map((p) => p.name).join(', ')}.`);
        db.parts = db.parts.filter((p) => p.id !== id);
        writeDb(db);
      },

      async deleteProduct(id) {
        needManager();
        const db = readDb();
        db.products = db.products.filter((p) => p.id !== id);
        writeDb(db);
      },

      async move({ partId, type, qty, note, unitCost }) {
        const db = readDb();
        const part = db.parts.find((p) => p.id === partId);
        const cost = me().role === 'gerente' ? unitCost : null; // só o gerente mexe em custo
        const before = part ? part.cost : 0;
        const res = L.applyMovement(db.parts, partId, type, qty, cost);
        if (!res.ok) throw new Error(res.error);
        db.parts = res.parts;
        const after = db.parts.find((p) => p.id === partId);
        if (type === 'entrada' && cost != null && after.cost !== before) logPrice(db, 'custo', after, before, after.cost, 'compra', `Entrada de ${Math.floor(Number(qty))} un. a R$ ${Number(cost).toFixed(2).replace('.', ',')}`);
        logMove(db, part, type, Math.floor(Number(qty)), me().role === 'gerente' ? note : '');
        writeDb(db);
      },

      async produce(productId, qty) {
        const db = readDb();
        const product = db.products.find((p) => p.id === productId);
        if (!product) throw new Error('Produto não encontrado.');
        if (!product.bom.length) throw new Error('Este produto não tem ficha técnica.');
        const res = L.applyProduction(db.parts, product, qty);
        if (!res.ok) throw new Error(res.error);
        const byId = L.partsById(db.parts);
        for (const partId of Object.keys(res.consumed)) {
          logMove(db, byId[partId], 'producao', res.consumed[partId], `Montagem: ${Math.floor(Number(qty))}× ${product.name}`);
        }
        db.parts = res.parts;
        product.ready = (product.ready || 0) + Math.floor(Number(qty));
        logReady(db, product, Math.floor(Number(qty)), 'montagem', '');
        writeDb(db);
      },

      /** photo: { dataUrl } para trocar, ou null para remover. */
      async setPhoto(kind, id, photo) {
        const db = readDb();
        const item = (kind === 'part' ? db.parts : db.products).find((x) => x.id === id);
        if (!item) throw new Error('Item não encontrado.');
        if (photo && photo.dataUrl) item.photo = photo.dataUrl;
        else delete item.photo;
        writeDb(db);
      },

      /** Estorno (gerente): desfaz uma entrada ou saída lançada por engano. */
      async reverse(id) {
        needManager();
        const db = readDb();
        const m = db.movements.find((x) => x.id === id);
        if (!m) throw new Error('Movimentação não encontrada.');
        if (m.type === 'producao') throw new Error('Montagens não podem ser estornadas aqui. Se preciso, registre uma entrada das peças.');
        if (m.reverts) throw new Error('Isto já é um estorno e não pode ser estornado.');
        if (m.revertedBy) throw new Error('Esta movimentação já foi estornada.');
        const part = db.parts.find((p) => p.id === m.partId);
        if (!part) throw new Error('A peça desta movimentação não existe mais.');
        if (m.type === 'entrada') {
          if (part.stock < m.qty) throw new Error(`Não dá para estornar: a entrada foi de ${m.qty} e só há ${part.stock} em estoque.`);
          part.stock -= m.qty;
        } else {
          part.stock += m.qty;
        }
        const when = new Date(m.date).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
        const back = logMove(db, part, m.type === 'entrada' ? 'saida' : 'entrada', m.qty, `Estorno do lançamento de ${when}`, { reverts: m.id, origin: 'estorno' });
        m.revertedBy = back.id;
        writeDb(db);
      },

      /** Conferência: qualquer usuário envia a contagem; o gerente aprova. items: [{ partId, counted }] */
      async submitCount(items, note) {
        if (!Array.isArray(items) || !items.length) throw new Error('Conte pelo menos uma peça.');
        const db = readDb();
        const out = items.map((it) => {
          const counted = Math.floor(Number(it.counted));
          if (!(counted >= 0)) throw new Error('A quantidade contada não pode ser negativa.');
          const part = db.parts.find((p) => p.id === it.partId);
          if (!part) throw new Error('Uma das peças contadas não existe mais.');
          return { partId: part.id, name: part.name, code: part.code || '', system: part.stock, counted };
        });
        db.counts.unshift({
          id: uuid(),
          date: new Date().toISOString(),
          who: me().name || '',
          note: String(note || ''),
          status: 'pendente',
          items: out,
          reviewedBy: '',
          reviewedAt: null,
        });
        if (db.counts.length > 100) db.counts.length = 100;
        writeDb(db);
      },

      async reviewCount(id, approve) {
        needManager();
        const db = readDb();
        const c = db.counts.find((x) => x.id === id);
        if (!c) throw new Error('Contagem não encontrada.');
        if (c.status !== 'pendente') throw new Error(`Esta contagem já foi ${c.status}.`);
        if (approve) {
          for (const it of c.items) {
            const part = db.parts.find((p) => p.id === it.partId);
            if (!part) continue; // peça apagada depois da contagem
            const diff = it.counted - part.stock;
            if (diff !== 0) {
              part.stock = it.counted;
              logMove(db, part, diff > 0 ? 'entrada' : 'saida', Math.abs(diff), `Conferência de estoque (contagem de ${c.who})`, { origin: 'conferencia' });
            }
          }
        }
        c.status = approve ? 'aprovada' : 'rejeitada';
        c.reviewedBy = me().name || '';
        c.reviewedAt = new Date().toISOString();
        writeDb(db);
      },

      // ---- Recebimento de mercadoria por lote ----
      /** items: [{ partId, expected (opcional), received }] */
      async createReceipt({ ref, items, supplier }) {
        const db = readDb();
        const u = me();
        const out = receiptItems(db, items, u.role === 'gerente');
        db.receipts.unshift({
          id: uuid(),
          num: (db.receipts.reduce((m, r) => Math.max(m, r.num || 0), 0) || 0) + 1,
          date: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          who: u.name || '',
          ref: String(ref || '').trim(),
          supplier: u.role === 'gerente' ? String(supplier || '').trim() : '',
          status: 'pendente',
          items: out,
          log: [{ at: new Date().toISOString(), by: u.name || '', action: 'criado', detail: '' }],
        });
        writeDb(db);
      },

      async approveReceipt(id) {
        needManager();
        const db = readDb();
        const r = db.receipts.find((x) => x.id === id);
        if (!r) throw new Error('Recebimento não encontrado.');
        if (r.status !== 'pendente') throw new Error('Este recebimento não está aguardando autorização.');
        for (const it of r.items) {
          if (it.received <= 0) continue;
          const part = db.parts.find((p) => p.id === it.partId);
          if (!part) throw new Error(`A peça "${it.name}" não existe mais.`);
          const before = part.stock;
          part.stock += it.received;
          logMove(db, part, 'entrada', it.received, `Recebimento #${r.num}`, { origin: 'recebimento' });
          if (it.unitCost !== null && it.unitCost !== undefined) {
            const oldCost = part.cost || 0;
            const avg = oldCost > 0 && before > 0 ? L.round2((before * oldCost + it.received * it.unitCost) / (before + it.received)) : L.round2(it.unitCost);
            logPrice(db, 'custo', part, oldCost, avg, 'recebimento', `Recebimento #${r.num}: ${it.received} un. a R$ ${it.unitCost.toFixed(2).replace('.', ',')}`);
            part.cost = avg;
          }
        }
        r.status = 'concluido';
        r.updatedAt = new Date().toISOString();
        r.log.push({ at: r.updatedAt, by: me().name || '', action: 'autorizado', detail: '' });
        writeDb(db);
      },

      async editReceipt(id, { ref, items, supplier, reason }) {
        needManager();
        const db = readDb();
        const r = db.receipts.find((x) => x.id === id);
        if (!r) throw new Error('Recebimento não encontrado.');
        if (r.status === 'excluido') throw new Error('Recebimentos excluídos não podem ser editados.');
        const out = receiptItems(db, items, true);
        let status = r.status;
        if (r.status === 'concluido' || r.status === 'concluido_editado') {
          if (!String(reason || '').trim()) throw new Error('Informe o motivo da edição.');
          const diff = {};
          out.forEach((i) => (diff[i.partId] = (diff[i.partId] || 0) + i.received));
          r.items.forEach((i) => (diff[i.partId] = (diff[i.partId] || 0) - i.received));
          const names = {};
          [...out, ...r.items].forEach((i) => (names[i.partId] = i.name));
          const ids = Object.keys(diff).filter((k) => diff[k] !== 0);
          for (const pid of ids) {
            const part = db.parts.find((p) => p.id === pid);
            if (!part) throw new Error(`A peça "${names[pid]}" não existe mais.`);
            if (part.stock + diff[pid] < 0) throw new Error(`Não dá para reduzir: o estoque de "${names[pid]}" é ${part.stock} e a redução é de ${-diff[pid]}.`);
          }
          for (const pid of ids) {
            const part = db.parts.find((p) => p.id === pid);
            part.stock += diff[pid];
            logMove(db, part, diff[pid] > 0 ? 'entrada' : 'saida', Math.abs(diff[pid]), `Edição do recebimento #${r.num}`, { origin: 'recebimento' });
          }
          status = 'concluido_editado';
        }
        r.ref = String(ref || '').trim();
        r.supplier = String(supplier || '').trim();
        r.items = out;
        r.status = status;
        r.updatedAt = new Date().toISOString();
        r.log.push({ at: r.updatedAt, by: me().name || '', action: 'editado', detail: String(reason || '').trim() });
        writeDb(db);
      },

      async deleteReceipt(id, reason) {
        needManager();
        if (!String(reason || '').trim()) throw new Error('Informe o motivo da exclusão.');
        const db = readDb();
        const r = db.receipts.find((x) => x.id === id);
        if (!r) throw new Error('Recebimento não encontrado.');
        if (r.status === 'excluido') throw new Error('Este recebimento já foi excluído.');
        if (r.status === 'concluido' || r.status === 'concluido_editado') {
          for (const it of r.items) {
            const part = db.parts.find((p) => p.id === it.partId);
            if (part && it.received > 0 && part.stock < it.received) {
              throw new Error(`Não dá para excluir: o estoque de "${it.name}" é ${part.stock} e o recebimento tinha ${it.received}.`);
            }
          }
          for (const it of r.items) {
            const part = db.parts.find((p) => p.id === it.partId);
            if (!part || it.received <= 0) continue;
            part.stock -= it.received;
            logMove(db, part, 'saida', it.received, `Exclusão do recebimento #${r.num}`, { origin: 'recebimento' });
          }
        }
        r.status = 'excluido';
        r.updatedAt = new Date().toISOString();
        r.log.push({ at: r.updatedAt, by: me().name || '', action: 'excluído', detail: String(reason).trim() });
        writeDb(db);
      },

      // ---- Pedidos de clientes ----
      /** items: [{ productId, qty }] */
      async createOrder({ customer, ref, items }) {
        needManager();
        const db = readDb();
        const out = orderItems(db, items);
        db.orders.unshift({
          id: uuid(),
          num: (db.orders.reduce((m, o) => Math.max(m, o.num || 0), 0) || 0) + 1,
          date: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          who: me().name || '',
          customer: String(customer || '').trim(),
          ref: String(ref || '').trim(),
          status: 'aberto',
          items: out,
          log: [{ at: new Date().toISOString(), by: me().name || '', action: 'criado', detail: '' }],
        });
        writeDb(db);
      },
      async editOrder(id, { customer, ref, items }) {
        needManager();
        const db = readDb();
        const o = db.orders.find((x) => x.id === id);
        if (!o) throw new Error('Pedido não encontrado.');
        if (o.status !== 'aberto') throw new Error('Só pedidos em andamento podem ser editados.');
        const kept = {};
        o.items.forEach((i) => (kept[i.productId] = i.reserved || 0));
        o.items = orderItems(db, items).map((i) => ({ ...i, reserved: Math.min(i.qty, kept[i.productId] || 0) }));
        o.customer = String(customer || '').trim();
        o.ref = String(ref || '').trim();
        o.updatedAt = new Date().toISOString();
        o.log.push({ at: o.updatedAt, by: me().name || '', action: 'editado', detail: '' });
        writeDb(db);
      },
      async finishOrder(id) {
        needManager();
        const db = readDb();
        const o = db.orders.find((x) => x.id === id);
        if (!o) throw new Error('Pedido não encontrado.');
        if (o.status !== 'aberto') throw new Error('Este pedido não está em andamento.');
        const short = [];
        for (const it of o.items) {
          const p = db.products.find((x) => x.id === it.productId);
          if (!p) throw new Error(`O produto "${it.name}" não existe mais. Edite o pedido.`);
          if ((p.ready || 0) < it.qty) short.push(`${it.name} (precisa ${it.qty}, prontos ${p.ready || 0})`);
        }
        if (short.length) throw new Error(`Ainda faltam produtos montados: ${short.join('; ')}.`);
        for (const it of o.items) {
          const p = db.products.find((x) => x.id === it.productId);
          p.ready -= it.qty;
          logReady(db, p, -it.qty, 'pedido', `Pedido #${o.num}`);
        }
        o.status = 'concluido';
        o.updatedAt = new Date().toISOString();
        o.log.push({ at: o.updatedAt, by: me().name || '', action: 'finalizado', detail: '' });
        writeDb(db);
      },
      /** Ajuste manual dos montados (gerente): delta positivo = entrou, negativo = saiu. */
      async adjustReady(productId, delta, note) {
        needManager();
        const db = readDb();
        const p = db.products.find((x) => x.id === productId);
        if (!p) throw new Error('Produto não encontrado.');
        delta = Math.trunc(Number(delta));
        if (!delta) throw new Error('Informe uma quantidade diferente de zero.');
        if (delta < 0 && !String(note || '').trim()) throw new Error('Informe o motivo da saída.');
        if ((p.ready || 0) + delta < 0) throw new Error(`Só há ${p.ready || 0} montado(s) de "${p.name}"; não dá para tirar ${-delta}.`);
        p.ready = (p.ready || 0) + delta;
        logReady(db, p, delta, 'ajuste', String(note || '').trim());
        writeDb(db);
      },
      /** Reserva montados para um item do pedido (total reservado; 0 libera). */
      async reserveOrderItem(orderId, productId, qty) {
        needManager();
        const db = readDb();
        const o = db.orders.find((x) => x.id === orderId);
        if (!o) throw new Error('Pedido não encontrado.');
        if (o.status !== 'aberto') throw new Error('Só pedidos em andamento aceitam reserva.');
        const it = o.items.find((i) => i.productId === productId);
        if (!it) throw new Error('Este produto não está no pedido.');
        qty = Math.trunc(Number(qty));
        if (!(qty >= 0)) throw new Error('Informe uma quantidade a partir de zero.');
        if (qty > it.qty) throw new Error(`O pedido só precisa de ${it.qty} unidade(s) de "${it.name}".`);
        const p = db.products.find((x) => x.id === productId);
        const other = db.orders.filter((x) => x.status === 'aberto' && x.id !== orderId).reduce((s, x) => s + (x.items.find((i) => i.productId === productId)?.reserved || 0), 0);
        if (qty + other > ((p && p.ready) || 0)) throw new Error(`Só há ${Math.max(((p && p.ready) || 0) - other, 0)} montado(s) livre(s) de "${it.name}" (os outros já estão reservados em outros pedidos).`);
        it.reserved = qty;
        o.updatedAt = new Date().toISOString();
        o.log.push({ at: o.updatedAt, by: me().name || '', action: qty === 0 ? 'reserva liberada' : 'reservado', detail: `${qty} un. de ${it.name}` });
        writeDb(db);
      },
      async cancelOrder(id, reason) {
        needManager();
        if (!String(reason || '').trim()) throw new Error('Informe o motivo do cancelamento.');
        const db = readDb();
        const o = db.orders.find((x) => x.id === id);
        if (!o) throw new Error('Pedido não encontrado.');
        if (o.status !== 'aberto') throw new Error('Só pedidos em andamento podem ser cancelados.');
        o.status = 'cancelado';
        o.updatedAt = new Date().toISOString();
        o.log.push({ at: o.updatedAt, by: me().name || '', action: 'cancelado', detail: String(reason).trim() });
        writeDb(db);
      },

      // ---- só no modo demonstração ----
      async reset() {
        const fresh = clone(root.SAMPLE_DATA);
        fresh.counts = [];
        fresh.receipts = [];
        fresh.priceLog = [];
        fresh.orders = fresh.orders || [];
        fresh.readyLog = [];
        writeDb(fresh);
      },
      async exportJson() {
        return readDb();
      },
      async importJson(d) {
        if (!d || !Array.isArray(d.parts) || !Array.isArray(d.products)) throw new Error('Arquivo inválido.');
        d.movements = Array.isArray(d.movements) ? d.movements : [];
        d.counts = Array.isArray(d.counts) ? d.counts : [];
        d.receipts = Array.isArray(d.receipts) ? d.receipts : [];
        d.priceLog = Array.isArray(d.priceLog) ? d.priceLog : [];
        d.orders = Array.isArray(d.orders) ? d.orders : [];
        d.readyLog = Array.isArray(d.readyLog) ? d.readyLog : [];
        writeDb(d);
      },
    };
  }

  root.createLocalStore = createLocalStore;
})(typeof self !== 'undefined' ? self : this);
