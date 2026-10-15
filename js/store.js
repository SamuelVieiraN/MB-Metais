/*
 * Armazenamento do MODO DEMONSTRAÇÃO: tudo fica no navegador (localStorage).
 * Tem as mesmas funções do armazenamento do Supabase (js/supabase.js), então as
 * telas funcionam igual nos dois modos. As regras espelham as do banco.
 */
(function (root) {
  'use strict';

  const L = root.Logic;
  const KEY = 'estoque-torneiras:v1';
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
          return d;
        }
      }
    } catch (e) {
      /* usa os dados de exemplo */
    }
    const fresh = clone(root.SAMPLE_DATA);
    fresh.counts = [];
    return fresh;
  }

  function writeDb(db) {
    try {
      localStorage.setItem(KEY, JSON.stringify(db));
    } catch (e) {
      throw new Error('Sem espaço no navegador para guardar isso (provavelmente as fotos). Remova algumas fotos ou use o banco de dados online.');
    }
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

    const needManager = () => {
      if (me().role !== 'gerente') throw new Error('Apenas o gerente pode fazer isso.');
    };

    return {
      kind: 'local',

      async load() {
        return clone(readDb());
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
            if (cost !== null) existing.cost = cost;
            if (stock !== old) logMove(db, existing, stock > old ? 'entrada' : 'saida', Math.abs(stock - old), note || 'Ajuste manual');
          } else {
            const part = { id: it.id, code, name, stock, min, cost: cost === null ? 0 : cost };
            db.parts.push(part);
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
          if (!product) {
            product = { id: it.id, code, name, category, price: 0, bom: [] };
            db.products.push(product);
          }
          Object.assign(product, { code, name, category });
          if (price !== null) product.price = price;
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
        const res = L.applyMovement(db.parts, partId, type, qty, cost);
        if (!res.ok) throw new Error(res.error);
        db.parts = res.parts;
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

      // ---- só no modo demonstração ----
      async reset() {
        const fresh = clone(root.SAMPLE_DATA);
        fresh.counts = [];
        writeDb(fresh);
      },
      async exportJson() {
        return readDb();
      },
      async importJson(d) {
        if (!d || !Array.isArray(d.parts) || !Array.isArray(d.products)) throw new Error('Arquivo inválido.');
        d.movements = Array.isArray(d.movements) ? d.movements : [];
        d.counts = Array.isArray(d.counts) ? d.counts : [];
        writeDb(d);
      },
    };
  }

  root.createLocalStore = createLocalStore;
})(typeof self !== 'undefined' ? self : this);
