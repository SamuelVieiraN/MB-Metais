// Rodar com: node tests/sheets.test.js
const assert = require('node:assert');
const L = require('../js/logic.js');
const S = require('../js/sheets.js');
global.window = {};
require('./fixture-data.js');
const sample = () => JSON.parse(JSON.stringify(global.window.SAMPLE_DATA));
let n = 0;
const uidGen = () => (p) => p + 'new' + n++;

// descritores de exportação -> "planilha lida" (cabeçalho + linhas, valores simples)
const toWb = (sheets) => ({
  sheets: sheets.map((s) => ({
    name: s.name,
    rows: [s.columns.map((c) => c.header), ...s.rows.map((r) => r.map((c) => (c && typeof c === 'object' ? c.v : c)))],
  })),
});
const sheetByName = (sheets, name) => sheets.find((s) => s.name === name);
const headers = (sheet) => sheet.columns.map((c) => c.header);

// 1) Exportação sem financeiro não tem nenhuma coluna de valor
let st = sample();
let ex = S.buildExport(st, { finance: false, history: true });
const allHeaders = ex.flatMap(headers).join('|');
assert.ok(!/R\$|Custo|Preço|Lucro|Margem|Valor/i.test(allHeaders), 'sem financeiro: ' + allHeaders);
assert.deepStrictEqual(ex.map((s) => s.name), ['Peças', 'Produtos', 'Ficha técnica', 'Histórico']);
// com financeiro tem
ex = S.buildExport(st, { finance: true });
assert.ok(headers(sheetByName(ex, 'Peças')).includes('Custo unit. (R$)'));
assert.ok(headers(sheetByName(ex, 'Produtos')).includes('Margem'));
const bicaBaixa = sheetByName(ex, 'Produtos').rows[0];
assert.strictEqual(bicaBaixa[1], 'Torneira de lavatório bica baixa');
assert.ok(bicaBaixa.some((c) => c && c.s === 'pct' && c.v === 0.5579));
// ficha técnica nunca tem valores
assert.ok(!/R\$|Custo|Preço/.test(headers(sheetByName(ex, 'Ficha técnica')).join('|')));
// dá para montar vem certo
assert.ok(bicaBaixa.includes(40));

// 2) Ida e volta: exportar (com e sem financeiro) e importar não muda nada
for (const finance of [true, false]) {
  const plan = S.planImport(toWb(S.buildExport(sample(), { finance })), sample(), { uid: uidGen() });
  assert.strictEqual(plan.ok, true);
  assert.strictEqual(plan.changes, 0, 'ida e volta (finance=' + finance + ') mudou: ' + JSON.stringify(plan.summary));
  assert.strictEqual(plan.movements.length, 0);
  assert.deepStrictEqual(plan.warnings, []);
  assert.deepStrictEqual(plan.next.parts, sample().parts);
}

// 3) Atualização: substituir estoque, custo e mínimo; registra movimentos
let wb = {
  sheets: [{ name: 'Peças', rows: [
    ['Código', 'Peça', 'Estoque', 'Mínimo', 'Custo unit. (R$)'],
    [null, 'Cartucho cerâmico 1/4 de volta', 100, 30, '7,50'],          // 120 -> 100, custo 6.8 -> 7.5
    [null, 'Arejador', 90, 25, 1.9],                                    // igual
    [null, 'Peça nova de teste', 15, 5, 'R$ 1.234,56'],                 // criada
  ] }],
};
let plan = S.planImport(wb, sample(), { uid: uidGen() });
assert.strictEqual(plan.ok, true);
assert.strictEqual(plan.summary.partsCreated.length, 1);
assert.strictEqual(plan.summary.partsUpdated.length, 1);
assert.strictEqual(plan.summary.partsUnchanged, 1);
const cart = plan.next.parts.find((p) => p.id === 'p03');
assert.strictEqual(cart.stock, 100);
assert.strictEqual(cart.cost, 7.5);
const novo = plan.next.parts.find((p) => p.name === 'Peça nova de teste');
assert.strictEqual(novo.stock, 15);
assert.strictEqual(novo.cost, 1234.56);
assert.strictEqual(plan.movements.find((m) => m.partId === 'p03').type, 'saida');
assert.strictEqual(plan.movements.find((m) => m.partId === 'p03').qty, 20);
assert.strictEqual(plan.movements.find((m) => m.partName === 'Peça nova de teste').type, 'entrada');
// o original não é alterado
assert.strictEqual(sample().parts.find((p) => p.id === 'p03').stock, 120);

// 4) Modo somar: planilha traz entradas
plan = S.planImport({ sheets: [{ name: 'Peças', rows: [['Peça', 'Quantidade'], ['Arejador', 10]] }] }, sample(), { stockMode: 'add', uid: uidGen() });
assert.strictEqual(plan.next.parts.find((p) => p.id === 'p05').stock, 100);
// sem a coluna de custo, o custo não muda
assert.strictEqual(plan.next.parts.find((p) => p.id === 'p05').cost, 1.9);

// 5) Planilha própria da empresa, cabeçalhos diferentes, título antes, uma só aba, casamento por código
plan = S.planImport({ sheets: [{ name: 'Planilha1', rows: [
  ['ESTOQUE M&B - OUTUBRO'],
  [],
  ['COD', 'DESCRIÇÃO', 'QTD', 'ESTOQUE MÍNIMO', 'CUSTO'],
  ['X1', 'Vedação de borracha', 250, 80, 0.4],
  ['X2', 'Item sem estoque informado', null, null, null],
] }] }, sample(), { uid: uidGen() });
assert.strictEqual(plan.ok, true);
assert.strictEqual(plan.next.parts.find((p) => p.id === 'p04').stock, 250);
// peça já cadastrada com outro código: mantém o cadastrado e avisa
assert.strictEqual(plan.next.parts.find((p) => p.id === 'p04').code, 'P004');
assert.ok(plan.warnings.some((w) => /código "X1".*cadastrada com "P004"/.test(w)));
// peça cadastrada sem código recebe o código da planilha
const semCodigo = sample();
semCodigo.parts.forEach((p) => delete p.code);
plan = S.planImport({ sheets: [{ name: 'Planilha1', rows: [['COD', 'DESCRIÇÃO', 'QTD'], ['X1', 'Vedação de borracha', 250]] }] }, semCodigo, { uid: uidGen() });
assert.strictEqual(plan.next.parts.find((p) => p.id === 'p04').code, 'X1');
plan = S.planImport({ sheets: [{ name: 'Planilha1', rows: [
  ['ESTOQUE M&B - OUTUBRO'],
  [],
  ['COD', 'DESCRIÇÃO', 'QTD', 'ESTOQUE MÍNIMO', 'CUSTO'],
  ['X1', 'Vedação de borracha', 250, 80, 0.4],
  ['X2', 'Item sem estoque informado', null, null, null],
] }] }, sample(), { uid: uidGen() });
assert.strictEqual(plan.next.parts.find((p) => p.name === 'Item sem estoque informado').stock, 0);

// 6) Avisos: negativo, texto no estoque, linha repetida; linhas ruins não alteram nada
plan = S.planImport({ sheets: [{ name: 'Peças', rows: [
  ['Peça', 'Estoque'],
  ['Arejador', -5],
  ['Alavanca / volante', 'muitos'],
  ['Canopla cromada', 50],
  ['Canopla cromada', 60],
] }] }, sample(), { uid: uidGen() });
assert.strictEqual(plan.next.parts.find((p) => p.id === 'p05').stock, 90);
assert.strictEqual(plan.next.parts.find((p) => p.id === 'p07').stock, 85);
assert.strictEqual(plan.next.parts.find((p) => p.id === 'p06').stock, 60);
assert.ok(plan.warnings.some((w) => /negativo/.test(w)));
assert.ok(plan.warnings.some((w) => /não é um número/.test(w)));
assert.ok(plan.warnings.some((w) => /mais de uma vez/.test(w)));

// 7) Produtos e ficha técnica: cria produto, substitui ficha, avisa peça inexistente e quantidade inválida
plan = S.planImport({ sheets: [
  { name: 'Produtos', rows: [['Produto', 'Categoria', 'Preço de venda (R$)'], ['Torneira de parede', 'Torneiras', '95,00'], ['Ducha higiênica simples', 'Duchas', 74.9]] },
  { name: 'Ficha técnica', rows: [
    ['Produto', 'Peça', 'Quantidade'],
    ['Torneira de parede', 'Corpo de torneira cromado (bica alta)', 1],
    ['Torneira de parede', 'Cartucho cerâmico 1/4 de volta', 1],
    ['Torneira de parede', 'Peça que não existe', 1],
    ['Torneira de parede', 'Arejador', 0],
    ['Ducha higiênica simples', 'Corpo de ducha higiênica', 1],
    ['Ducha higiênica simples', 'Mangueira flexível 1,20 m', 2],
  ] },
] }, sample(), { uid: uidGen() });
const tp = plan.next.products.find((p) => p.name === 'Torneira de parede');
assert.strictEqual(tp.price, 95);
assert.strictEqual(tp.bom.length, 2);
assert.strictEqual(plan.next.products.find((p) => p.name === 'Ducha higiênica simples').price, 74.9);
assert.deepStrictEqual(plan.next.products.find((p) => p.name === 'Ducha higiênica simples').bom.map((i) => i.qty).sort(), [1, 2]);
assert.ok(plan.warnings.some((w) => /Peça que não existe.*não encontrada/.test(w)));
assert.ok(plan.warnings.some((w) => /precisa ser um número inteiro maior que zero/.test(w)));
assert.strictEqual(plan.summary.productsCreated.length, 1);
// produto não citado na ficha mantém a ficha antiga
assert.strictEqual(plan.next.products.find((p) => p.id === 'pr1').bom.length, 7);

// 8) Arquivo sem colunas conhecidas dá erro claro; modelo é válido e não muda nada
plan = S.planImport({ sheets: [{ name: 'Qualquer', rows: [['foo', 'bar'], [1, 2]] }] }, sample(), {});
assert.strictEqual(plan.ok, false);
assert.ok(plan.errors[0].includes('planilha modelo'));
plan = S.planImport(toWb(S.buildTemplate()), sample(), {});
assert.strictEqual(plan.ok, true);
assert.strictEqual(plan.changes, 0);

// 9) Números em formato brasileiro
assert.strictEqual(S.parseNum('1.234,56'), 1234.56);
assert.strictEqual(S.parseNum('R$ 10,5'), 10.5);
assert.strictEqual(S.parseNum('12'), 12);
assert.strictEqual(S.parseNum('abc'), null);
assert.strictEqual(S.parseNum(''), null);

console.log('Testes de planilhas: todos passaram.');
