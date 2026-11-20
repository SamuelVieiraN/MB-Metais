/*
 * Dados da empresa usados no rodapé, na loja online e nos textos legais
 * (Política de Privacidade, Termos de Uso, Cookies).
 *
 * PREENCHA os campos vazios (e-mail, telefone, encarregado de dados) antes de divulgar a loja.
 * Enquanto estiverem vazios, os textos legais mostram "[preencher]".
 *
 * termsVersion: mude a data sempre que alterar os Termos ou a Política. Ela precisa ser igual à
 * função terms_version() do banco (supabase/migracao-10-loja-clientes.sql). Quando mudar, os
 * clientes já cadastrados precisam aceitar de novo.
 */
window.COMPANY = {
  name: 'M&B Industria e Comercio de Metais',
  cnpj: '44.702.361/0001-55',
  address: 'Rua A (Lot Laguna Park 6), 107 · Lagoa Redonda · Fortaleza/CE · CEP 60831-222',
  email: '',
  phone: '',
  whatsapp: '',
  // Encarregado pelo tratamento de dados pessoais (LGPD, art. 41). Pode ser o próprio dono.
  dpoName: '',
  dpoEmail: '',
  termsVersion: '2026-11-19',
};
