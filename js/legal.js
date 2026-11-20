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

/* Layout institucional: cabeçalho fixo com botão de voltar, menu lateral, índice da página e rodapé. */
(function () {
  const C = window.COMPANY || {};
  const main = document.querySelector('main.legal');
  if (!main) return;
  const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const here = location.pathname.replace(/\/$/, '').split('/').pop().replace('.html', '');
  const pages = [
    ['privacidade', 'Política de Privacidade', 'privacidade'],
    ['termos', 'Termos de Uso', 'termos'],
    ['cookies', 'Cookies e armazenamento', 'cookies'],
    ['direitos', 'Seus direitos (LGPD)', 'privacidade#direitos'],
  ];
  const h1 = main.querySelector('h1');
  const title = h1 ? h1.textContent : 'Informações legais';
  const sub = main.querySelector('h1 + p.muted');
  const draft = main.querySelector('.draft');
  const drop = '<svg class="lg-drop" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3C16 3 6 14.2 6 20.5a10 10 0 0 0 20 0C26 14.2 16 3 16 3z" fill="currentColor"/></svg>';
  const arrow = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>';

  // índice: usa os títulos de seção (h2) e dá um id a cada um
  const heads = [...main.querySelectorAll('h2')];
  heads.forEach((h, i) => { if (!h.id) h.id = 'sec-' + (i + 1); });
  const toc = heads.map((h) => `<a href="#${h.id}">${esc(h.textContent)}</a>`).join('');

  if (h1) h1.remove();
  if (sub) sub.remove();
  if (draft) draft.classList.add('lg-draft');

  const head = document.createElement('header');
  head.className = 'lg-head';
  head.innerHTML = `
    <div class="lg-bar">
      <a class="lg-back" href="loja">${arrow}<span>Voltar à loja</span></a>
      <a class="lg-brand" href="loja" aria-label="${esc(C.name || 'M&B Metais')}">${drop}<span><b>${esc(C.name ? 'M&B Metais' : 'M&B Metais')}</b><small>Informações institucionais</small></span></a>
      <button type="button" class="lg-theme" id="lg-theme" aria-label="Alternar tema"></button>
    </div>`;

  const wrap = document.createElement('div');
  wrap.className = 'lg-wrap';
  wrap.innerHTML = `
    <nav class="lg-crumb" aria-label="Você está aqui"><a href="loja">Início</a><span>/</span><span>Institucional</span><span>/</span><b>${esc(title)}</b></nav>
    <div class="lg-grid">
      <aside class="lg-side">
        <h2>Institucional</h2>
        <nav aria-label="Páginas institucionais">${pages.map((p) => `<a href="${p[2]}"${p[0] === here ? ' aria-current="page"' : ''}>${p[1]}</a>`).join('')}</nav>
        <h3>Nesta página</h3>
        <nav class="lg-toc" aria-label="Nesta página">${toc}</nav>
      </aside>
      <article class="lg-art">
        <h1>${esc(title)}</h1>
        <p class="lg-meta">${esc(C.name || '')} · CNPJ ${esc(C.cnpj || '')} · Versão ${esc(C.termsVersion || '')}</p>
        <div class="lg-body"></div>
        <div class="lg-help"><b>Ficou com alguma dúvida?</b> Fale com o nosso atendimento ou com o encarregado de dados (veja a Política de Privacidade). <a href="loja">Voltar à loja</a></div>
      </article>
    </div>`;
  wrap.querySelector('.lg-body').append(...main.childNodes);
  main.replaceChildren(wrap);
  document.querySelectorAll('.legal-top').forEach((e) => e.remove());
  document.body.prepend(head);

  const foot = document.createElement('footer');
  foot.className = 'lg-foot';
  foot.innerHTML = `<div class="lg-wrap">© ${new Date().getFullYear()} ${esc(C.name || '')} · CNPJ ${esc(C.cnpj || '')}<br>${esc(C.address || '')}</div>`;
  document.body.append(foot);

  // tema claro/escuro (mesma chave da loja)
  const btn = document.getElementById('lg-theme');
  const paint = () => { btn.textContent = document.documentElement.dataset.theme === 'dark' ? 'Tema claro' : 'Tema escuro'; };
  paint();
  btn.addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme !== 'dark';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    try { localStorage.setItem('mb:tema', dark ? 'escuro' : 'claro'); } catch (e) { /* sem armazenamento */ }
    paint();
  });

  // marca no índice a seção que está na tela
  const links = [...document.querySelectorAll('.lg-toc a')];
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => {
      es.forEach((e) => { if (e.isIntersecting) links.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id)); });
    }, { rootMargin: '-80px 0px -70% 0px' });
    heads.forEach((h) => io.observe(h));
  }
})();
