/* Preenche os dados da empresa nas páginas legais. Campos vazios aparecem destacados como [preencher]. */
(function () {
  const C = window.COMPANY || {};
  document.querySelectorAll('[data-co]').forEach((el) => {
    const v = C[el.dataset.co];
    if (v) el.textContent = v;
    else {
      el.textContent = '[preencher]';
      el.classList.add('todo');
    }
  });
  document.querySelectorAll('[data-co-mail]').forEach((el) => {
    const v = C[el.dataset.coMail];
    if (v) {
      const a = document.createElement('a');
      a.href = 'mailto:' + v;
      a.textContent = v;
      el.replaceWith(a);
    } else {
      el.textContent = '[preencher]';
      el.classList.add('todo');
    }
  });
  document.querySelectorAll('[data-version]').forEach((el) => (el.textContent = C.termsVersion || ''));
})();
