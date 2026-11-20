// aplica o tema (claro/escuro) e o estado do menu antes de desenhar a página (evita piscar).
// Fica num arquivo próprio para a política de segurança (CSP) não precisar permitir scripts dentro da página.
(function () {
  try {
    var t = localStorage.getItem('mb:tema');
    if (t !== 'claro' && t !== 'escuro') t = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro';
    document.documentElement.dataset.theme = t === 'escuro' ? 'dark' : 'light';
    if (localStorage.getItem('mb:menu') === 'min') document.documentElement.classList.add('sb-min');
  } catch (e) {
    document.documentElement.dataset.theme = 'light';
  }
})();
