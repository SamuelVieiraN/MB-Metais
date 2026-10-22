/*
 * Regras de negócio do sistema de estoque.
 * Funções puras (sem tela): recebem dados e devolvem resultados.
 * Funciona no navegador (window.Logic) e no Node (require), para podermos testar.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Logic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

  function partsById(parts) {
    const map = {};
    parts.forEach((p) => (map[p.id] = p));
    return map;
  }

  /** Quantas unidades de UM produto dá para montar com o estoque atual (isolado). */
  function maxProducible(product, stock) {
    if (!product.bom || product.bom.length === 0) return { max: 0, limitingPartId: null };
    let max = Infinity;
    let limitingPartId = null;
    for (const item of product.bom) {
      const have = Math.max(0, stock[item.partId] ?? 0);
      const n = Math.floor(have / item.qty);
      if (n < max) {
        max = n;
        limitingPartId = item.partId;
      }
    }
    return { max: max === Infinity ? 0 : max, limitingPartId };
  }

  function stockMap(parts) {
    const m = {};
    parts.forEach((p) => (m[p.id] = p.stock));
    return m;
  }

  /** Custo de montar 1 unidade do produto, somando custo das peças. */
  function productCost(product, parts) {
    const byId = partsById(parts);
    let total = 0;
    for (const item of product.bom) {
      const part = byId[item.partId];
      if (part) total += item.qty * (part.cost || 0);
    }
    return round2(total);
  }

  function margin(price, cost) {
    const profit = round2((price || 0) - (cost || 0));
    const pct = price > 0 ? (profit / price) * 100 : 0;
    return { profit, pct: round2(pct) };
  }

  /**
   * Simulação: plan = { [productId]: quantidade desejada }.
   * Mostra consumo de cada peça, o que falta e, se der, receita/custo/lucro.
   */
  function simulate(plan, products, parts) {
    const byId = partsById(parts);
    const used = {};
    let revenue = 0;
    let cost = 0;
    let units = 0;

    for (const product of products) {
      const qty = Math.floor(Number(plan[product.id]) || 0);
      if (qty <= 0) continue;
      units += qty;
      revenue += qty * (product.price || 0);
      cost += qty * productCost(product, parts);
      for (const item of product.bom) {
        used[item.partId] = (used[item.partId] || 0) + qty * item.qty;
      }
    }

    const rows = Object.keys(used).map((partId) => {
      const part = byId[partId];
      const stock = part ? part.stock : 0;
      const remaining = stock - used[partId];
      return {
        partId,
        name: part ? part.name : '(peça removida)',
        used: used[partId],
        stock,
        remaining,
        missing: remaining < 0 ? -remaining : 0,
      };
    });

    // Com o que sobrar depois do plano, quanto ainda dá para montar de cada produto?
    const leftover = {};
    parts.forEach((p) => (leftover[p.id] = Math.max(0, p.stock - (used[p.id] || 0))));
    const extra = {};
    products.forEach((p) => (extra[p.id] = maxProducible(p, leftover).max));

    return {
      rows,
      units,
      feasible: rows.every((r) => r.missing === 0),
      revenue: round2(revenue),
      cost: round2(cost),
      profit: round2(revenue - cost),
      extra,
    };
  }

  /** Registra uma montagem: valida e devolve novo estoque (sem alterar o original). */
  function applyProduction(parts, product, qty) {
    qty = Math.floor(Number(qty));
    if (!(qty > 0)) return { ok: false, error: 'Informe uma quantidade maior que zero.' };
    const byId = partsById(parts);
    const shortages = [];
    for (const item of product.bom) {
      const part = byId[item.partId];
      const need = item.qty * qty;
      const have = part ? part.stock : 0;
      if (have < need) shortages.push({ name: part ? part.name : '(peça removida)', need, have });
    }
    if (shortages.length) {
      return {
        ok: false,
        error:
          'Estoque insuficiente: ' +
          shortages.map((s) => `${s.name} (precisa ${s.need}, tem ${s.have})`).join('; ') +
          '.',
        shortages,
      };
    }
    const consumed = {};
    product.bom.forEach((item) => (consumed[item.partId] = item.qty * qty));
    const newParts = parts.map((p) =>
      consumed[p.id] ? { ...p, stock: p.stock - consumed[p.id] } : p
    );
    return { ok: true, parts: newParts, consumed };
  }

  /** Entrada (+) ou saída (-) de uma peça. Devolve nova lista de peças. */
  function applyMovement(parts, partId, type, qty, unitCost) {
    qty = Math.floor(Number(qty));
    if (!(qty > 0)) return { ok: false, error: 'Informe uma quantidade maior que zero.' };
    const part = parts.find((p) => p.id === partId);
    if (!part) return { ok: false, error: 'Peça não encontrada.' };
    if (type === 'saida' && part.stock < qty) {
      return { ok: false, error: `Só há ${part.stock} em estoque; não dá para dar saída de ${qty}.` };
    }
    const newParts = parts.map((p) => {
      if (p.id !== partId) return p;
      if (type === 'entrada') {
        const hasNewCost = unitCost != null && !Number.isNaN(Number(unitCost)) && Number(unitCost) >= 0;
        // Custo médio ponderado: mantém o custo da peça coerente com as compras.
        let cost = p.cost;
        if (hasNewCost) {
          const total = p.stock + qty;
          // Sem custo cadastrado, o da compra vale direto; senão, média ponderada.
          cost =
            p.cost > 0 && total > 0
              ? round2((p.stock * p.cost + qty * Number(unitCost)) / total)
              : round2(Number(unitCost));
        }
        return { ...p, stock: p.stock + qty, cost };
      }
      return { ...p, stock: p.stock - qty };
    });
    return { ok: true, parts: newParts };
  }

  function lowStock(parts) {
    return parts.filter((p) => p.stock <= p.min);
  }

  function stockValue(parts) {
    return round2(parts.reduce((sum, p) => sum + p.stock * (p.cost || 0), 0));
  }

  /**
   * Pedidos em andamento disputam os produtos prontos por ordem de chegada (o mais antigo primeiro).
   * Devolve { idDoPedido: { idDoProduto: quantidade reservada para ele } }.
   */
  function allocateReady(orders, products) {
    const ready = {};
    products.forEach((p) => (ready[p.id] = Math.max(0, Math.floor(p.ready || 0))));
    const open = (orders || []).filter((o) => o.status === 'aberto').sort((a, b) => new Date(a.date) - new Date(b.date));
    const out = {};
    // 1) reservas feitas pelo gerente têm prioridade
    for (const o of open) {
      out[o.id] = {};
      for (const it of o.items) {
        const give = Math.min(ready[it.productId] || 0, it.qty, Math.max(0, it.reserved || 0));
        ready[it.productId] = (ready[it.productId] || 0) - give;
        out[o.id][it.productId] = give;
      }
    }
    // 2) o que sobrou é repartido pelos pedidos mais antigos
    for (const o of open) {
      for (const it of o.items) {
        const give = Math.min(ready[it.productId] || 0, it.qty - (out[o.id][it.productId] || 0));
        ready[it.productId] = (ready[it.productId] || 0) - give;
        out[o.id][it.productId] += give;
      }
    }
    return out;
  }

  /** Andamento de um pedido: o que já está montado, o que falta e se as peças dão para o que falta. */
  function orderProgress(order, alloc, products, parts) {
    const byProd = {};
    products.forEach((p) => (byProd[p.id] = p));
    const mine = alloc || {};
    const done = order.status === 'concluido';
    const lines = order.items.map((it) => {
      const have = done ? it.qty : Math.min(it.qty, mine[it.productId] || 0);
      return { productId: it.productId, name: it.name, code: it.code || '', qty: it.qty, have, missing: it.qty - have, reserved: Math.min(it.qty, it.reserved || 0), gone: !byProd[it.productId] };
    });
    const total = lines.reduce((s, l) => s + l.qty, 0);
    const have = lines.reduce((s, l) => s + l.have, 0);
    const plan = {};
    lines.forEach((l) => {
      if (l.missing > 0 && !l.gone) plan[l.productId] = l.missing;
    });
    const sim = simulate(plan, products, parts);
    return {
      lines,
      total,
      have,
      missing: total - have,
      pct: total ? Math.round((have / total) * 100) : 0,
      complete: total > 0 && have === total && !lines.some((l) => l.gone),
      buildable: Object.keys(plan).length === 0 ? true : sim.feasible,
      partShortages: sim.rows.filter((r) => r.missing > 0),
      gone: lines.some((l) => l.gone),
    };
  }

  return {
    allocateReady,
    orderProgress,
    round2,
    partsById,
    stockMap,
    maxProducible,
    productCost,
    margin,
    simulate,
    applyProduction,
    applyMovement,
    lowStock,
    stockValue,
  };
});
