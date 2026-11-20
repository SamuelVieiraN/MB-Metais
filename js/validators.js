/*
 * Validação e máscaras de CPF, CNPJ (inclusive o CNPJ alfanumérico, em vigor desde julho/2026),
 * telefone e CEP. A mesma regra existe no banco (valid_cpf / valid_cnpj): aqui é só para avisar
 * o cliente na hora; quem decide de verdade é o servidor.
 *
 * Atenção: isto confere os dígitos verificadores (o número é matematicamente válido). Não prova que
 * o CPF/CNPJ existe na Receita Federal nem que pertence a quem está digitando.
 */
(function (root) {
  'use strict';

  const digits = (s) => String(s || '').replace(/\D/g, '');
  const alnum = (s) => String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '');

  function validCPF(v) {
    const d = digits(v);
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    const dv = (len) => {
      let s = 0;
      for (let i = 0; i < len; i++) s += Number(d[i]) * (len + 1 - i);
      const r = (s * 10) % 11;
      return r === 10 ? 0 : r;
    };
    return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
  }

  function validCNPJ(v) {
    const d = alnum(v);
    if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(d) || /^(.)\1{13}$/.test(d)) return false;
    const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const val = (c) => c.charCodeAt(0) - 48;
    const dv = (w) => {
      let s = 0;
      for (let i = 0; i < w.length; i++) s += val(d[i]) * w[i];
      const r = s % 11;
      return r < 2 ? 0 : 11 - r;
    };
    return dv(w1) === Number(d[12]) && dv(w2) === Number(d[13]);
  }

  const validDoc = (kind, v) => (kind === 'pj' ? validCNPJ(v) : validCPF(v));
  const cleanDoc = (kind, v) => (kind === 'pj' ? alnum(v).slice(0, 14) : digits(v).slice(0, 11));

  function maskCPF(v) {
    const d = digits(v).slice(0, 11);
    return d.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d)/, '.$1-$2');
  }
  function maskCNPJ(v) {
    const d = alnum(v).slice(0, 14);
    return d
      .replace(/^([0-9A-Z]{2})([0-9A-Z])/, '$1.$2')
      .replace(/^([0-9A-Z]{2})\.([0-9A-Z]{3})([0-9A-Z])/, '$1.$2.$3')
      .replace(/\.([0-9A-Z]{3})([0-9A-Z])/, '.$1/$2')
      .replace(/([0-9A-Z]{4})([0-9A-Z])/, '$1-$2');
  }
  const maskDoc = (kind, v) => (kind === 'pj' ? maskCNPJ(v) : maskCPF(v));
  function maskPhone(v) {
    const d = digits(v).slice(0, 11);
    if (d.length <= 2) return d ? '(' + d : '';
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }
  function maskCEP(v) {
    const d = digits(v).slice(0, 8);
    return d.length > 5 ? d.slice(0, 5) + '-' + d.slice(5) : d;
  }
  const fmtDoc = (kind, v) => (kind === 'pj' ? maskCNPJ(v) : maskCPF(v));
  const validPhone = (v) => [10, 11].includes(digits(v).length);

  root.Validators = { digits, validCPF, validCNPJ, validDoc, cleanDoc, maskCPF, maskCNPJ, maskDoc, maskPhone, maskCEP, fmtDoc, validPhone };
})(typeof self !== 'undefined' ? self : this);
