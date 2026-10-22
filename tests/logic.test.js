// Rodar com: node tests/logic.test.js
const assert = require('node:assert');
const L = require('../js/logic.js');

global.window = {};
require('./fixture-data.js');
const { parts, products } = global.window.SAMPLE_DATA;
const byProd = Object.fromEntries(products.map((p) => [p.id, p]));
const stock = L.stockMap(parts);

// 1) Produção máxima isolada: gargalo correto
//    bica baixa: p01=40, p03=120, p04=300/2=150, p05=90, p06=70, p07=85, p08=400 -> 40 (corpo)
let r = L.maxProducible(byProd.pr1, stock);
assert.strictEqual(r.max, 40);
assert.strictEqual(r.limitingPartId, 'p01');
//    ducha com registro: p10=20 é o gargalo
r = L.maxProducible(byProd.pr3, stock);
assert.strictEqual(r.max, 20);
assert.strictEqual(r.limitingPartId, 'p10');

// 2) Custo da ficha técnica (bica baixa)
//    18.5 + 6.8 + 2*0.35 + 1.9 + 3.2 + 4.1 + 0.12 = 35.32
assert.strictEqual(L.productCost(byProd.pr1, parts), 35.32);

// 3) Margem
let m = L.margin(79.9, 35.32);
assert.strictEqual(m.profit, 44.58);
assert.strictEqual(m.pct, 55.79);

// 4) Simulação com peças compartilhadas (cartucho p03 e vedação p04)
let sim = L.simulate({ pr1: 30, pr2: 20 }, products, parts);
const cart = sim.rows.find((x) => x.partId === 'p03');
assert.strictEqual(cart.used, 50);
assert.strictEqual(cart.remaining, 70);
assert.strictEqual(sim.feasible, true);
assert.strictEqual(sim.units, 50);
assert.strictEqual(sim.revenue, L.round2(30 * 79.9 + 20 * 109.9));

// 5) Simulação inviável: pede mais do que há de corpo bica alta (25)
sim = L.simulate({ pr2: 30 }, products, parts);
assert.strictEqual(sim.feasible, false);
assert.strictEqual(sim.rows.find((x) => x.partId === 'p02').missing, 5);

// 6) "Extra": depois de montar 40 bica baixa, o corpo p01 zera -> 0 de bica baixa
sim = L.simulate({ pr1: 40 }, products, parts);
assert.strictEqual(sim.extra.pr1, 0);

// 7) Montagem desconta estoque; original não muda
let prod = L.applyProduction(parts, byProd.pr1, 10);
assert.strictEqual(prod.ok, true);
assert.strictEqual(prod.parts.find((p) => p.id === 'p01').stock, 30);
assert.strictEqual(parts.find((p) => p.id === 'p01').stock, 40);

// 8) Montagem sem estoque suficiente é recusada
prod = L.applyProduction(parts, byProd.pr3, 21);
assert.strictEqual(prod.ok, false);
assert.ok(prod.error.includes('Registro de pressão'));

// 9) Entrada com custo atualiza custo médio; saída acima do estoque é recusada
let mv = L.applyMovement(parts, 'p01', 'entrada', 10, 28.5); // (40*18.5+10*28.5)/50 = 20.5
assert.strictEqual(mv.ok, true);
assert.strictEqual(mv.parts.find((p) => p.id === 'p01').stock, 50);
assert.strictEqual(mv.parts.find((p) => p.id === 'p01').cost, 20.5);
mv = L.applyMovement(parts, 'p01', 'saida', 41);
assert.strictEqual(mv.ok, false);
assert.strictEqual(L.applyMovement(parts, 'p01', 'saida', 0).ok, false);

// 9b) Peça sem custo cadastrado: o custo da primeira compra vale direto (sem diluir)
const semCusto = parts.map((p) => (p.id === 'p01' ? { ...p, cost: 0 } : p));
mv = L.applyMovement(semCusto, 'p01', 'entrada', 10, 30);
assert.strictEqual(mv.parts.find((p) => p.id === 'p01').cost, 30);

// 10) Produto sem ficha técnica não produz nada
assert.strictEqual(L.maxProducible({ bom: [] }, stock).max, 0);

// 11) Pedidos: produtos prontos são repartidos entre pedidos abertos, o mais antigo primeiro
const prodsReady = products.map((p) => (p.id === 'pr1' ? { ...p, ready: 6 } : p));
const orders = [
  { id: 'o2', status: 'aberto', date: '2026-10-02', items: [{ productId: 'pr1', name: 'A', qty: 4 }] },
  { id: 'o1', status: 'aberto', date: '2026-10-01', items: [{ productId: 'pr1', name: 'A', qty: 4 }, { productId: 'pr3', name: 'B', qty: 2 }] },
  { id: 'o3', status: 'concluido', date: '2026-09-01', items: [{ productId: 'pr1', name: 'A', qty: 9 }] },
];
const al = L.allocateReady(orders, prodsReady);
assert.strictEqual(al.o1.pr1, 4);
assert.strictEqual(al.o2.pr1, 2); // sobraram só 2 para o pedido mais novo
assert.strictEqual(al.o3, undefined); // concluído não disputa
let pg = L.orderProgress(orders[1], al.o1, prodsReady, parts);
assert.strictEqual(pg.have, 4);
assert.strictEqual(pg.missing, 2);
assert.strictEqual(pg.complete, false);
assert.strictEqual(pg.pct, 67);
assert.strictEqual(pg.buildable, true); // faltam 2 ducha pr3 e há peças
pg = L.orderProgress({ id: 'x', status: 'aberto', items: [{ productId: 'pr3', name: 'B', qty: 25 }] }, {}, prodsReady, parts);
assert.strictEqual(pg.buildable, false);
assert.ok(pg.partShortages.some((r) => r.partId === 'p10')); // registro de pressão é o gargalo
pg = L.orderProgress(orders[0], al.o2, prodsReady, parts);
assert.strictEqual(pg.have, 2);
pg = L.orderProgress(orders[2], undefined, prodsReady, parts);
assert.strictEqual(pg.complete, true);

console.log('Todos os testes passaram.');
