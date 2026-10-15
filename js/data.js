/*
 * Dados de exemplo para você ver o sistema funcionando.
 * Depois trocamos por dados reais (e por um banco de dados online).
 * Cada peça tem: estoque atual, estoque mínimo (para alerta) e custo unitário.
 * Cada produto tem: preço de venda e a ficha técnica (bom = quais peças e quantas).
 */
window.SAMPLE_DATA = {
  parts: [
    { id: 'p01', name: 'Corpo de torneira cromado (bica baixa)', stock: 40, min: 10, cost: 18.5 },
    { id: 'p02', name: 'Corpo de torneira cromado (bica alta)', stock: 25, min: 8, cost: 24.9 },
    { id: 'p03', name: 'Cartucho cerâmico 1/4 de volta', stock: 120, min: 30, cost: 6.8 },
    { id: 'p04', name: 'Vedação de borracha', stock: 300, min: 80, cost: 0.35 },
    { id: 'p05', name: 'Arejador', stock: 90, min: 25, cost: 1.9 },
    { id: 'p06', name: 'Canopla cromada', stock: 70, min: 20, cost: 3.2 },
    { id: 'p07', name: 'Alavanca / volante', stock: 85, min: 20, cost: 4.1 },
    { id: 'p08', name: 'Parafuso allen', stock: 400, min: 100, cost: 0.12 },
    { id: 'p09', name: 'Corpo de ducha higiênica', stock: 30, min: 10, cost: 15.0 },
    { id: 'p10', name: 'Registro de pressão', stock: 20, min: 8, cost: 22.0 },
    { id: 'p11', name: 'Mangueira flexível 1,20 m', stock: 45, min: 15, cost: 7.5 },
    { id: 'p12', name: 'Gatilho da ducha', stock: 50, min: 15, cost: 3.9 },
    { id: 'p13', name: 'Suporte de parede cromado', stock: 60, min: 15, cost: 5.4 },
    { id: 'p14', name: 'Flexível de ligação 40 cm', stock: 150, min: 40, cost: 4.8 },
  ],
  products: [
    {
      id: 'pr1',
      name: 'Torneira de lavatório bica baixa',
      category: 'Torneiras',
      price: 79.9,
      bom: [
        { partId: 'p01', qty: 1 },
        { partId: 'p03', qty: 1 },
        { partId: 'p04', qty: 2 },
        { partId: 'p05', qty: 1 },
        { partId: 'p06', qty: 1 },
        { partId: 'p07', qty: 1 },
        { partId: 'p08', qty: 1 },
      ],
    },
    {
      id: 'pr2',
      name: 'Torneira de lavatório bica alta',
      category: 'Torneiras',
      price: 109.9,
      bom: [
        { partId: 'p02', qty: 1 },
        { partId: 'p03', qty: 1 },
        { partId: 'p04', qty: 2 },
        { partId: 'p05', qty: 1 },
        { partId: 'p06', qty: 1 },
        { partId: 'p07', qty: 1 },
        { partId: 'p08', qty: 1 },
        { partId: 'p14', qty: 2 },
      ],
    },
    {
      id: 'pr3',
      name: 'Ducha higiênica com registro',
      category: 'Duchas',
      price: 129.9,
      bom: [
        { partId: 'p09', qty: 1 },
        { partId: 'p10', qty: 1 },
        { partId: 'p11', qty: 1 },
        { partId: 'p12', qty: 1 },
        { partId: 'p13', qty: 1 },
        { partId: 'p04', qty: 3 },
        { partId: 'p03', qty: 1 },
      ],
    },
    {
      id: 'pr4',
      name: 'Ducha higiênica simples',
      category: 'Duchas',
      price: 69.9,
      bom: [
        { partId: 'p09', qty: 1 },
        { partId: 'p11', qty: 1 },
        { partId: 'p12', qty: 1 },
        { partId: 'p04', qty: 2 },
      ],
    },
  ],
  movements: [],
};
