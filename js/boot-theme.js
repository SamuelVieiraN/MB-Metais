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

// o link de confirmação do e-mail pode cair na página inicial (painel da equipe): leva para a loja, com o código
(function () {
  try {
    var pn = location.pathname.replace(/\/+$/, '') || '/';
    if (/^(\/|\/index(\.html)?)$/.test(pn) && /access_token=|error_description=/.test(location.hash)) {
      location.replace('/loja' + location.hash);
    }
  } catch (e) {
    /* segue normalmente */
  }
})();
