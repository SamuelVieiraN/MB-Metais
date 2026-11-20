/*
 * "Segurança da conta": ativar ou desativar a verificação em 2 etapas (app autenticador).
 * Só existe no modo online. Depois de ativada, o servidor passa a exigir o código em todo acesso.
 */
(function (root) {
  'use strict';

  const App = root.App;
  const { esc, icons, toast, openModal, confirmBox } = root.UI;

  const safeImg = (src) => (/^data:image\/(svg\+xml|png)/i.test(String(src || '')) ? String(src) : '');

  function showEnroll(r) {
    const qr = safeImg(r.qr);
    openModal(
      'Ativar a verificação em 2 etapas',
      `<ol class="steps">
        <li>Instale um app autenticador no celular (Google Authenticator, Microsoft Authenticator ou Authy).</li>
        <li>No app, escolha <b>adicionar conta</b> e escaneie o QR code abaixo${qr ? '' : ' (ou digite a chave)'}.</li>
        <li>Digite aqui o código de 6 números que o app mostrar.</li>
      </ol>
      ${qr ? `<div class="qr-box"><img src="${esc(qr)}" alt="QR code para o app autenticador" width="180" height="180" /></div>` : ''}
      <p class="hint" style="text-align:center">Chave manual: <code>${esc(r.secret || '')}</code></p>
      <label>Código de 6 números
        <input name="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" required />
      </label>
      <p class="hint">Guarde a chave manual num lugar seguro. Se perder o celular, só dá para entrar de novo com ela ou pedindo ao dono do projeto para remover a verificação no painel do Supabase.</p>`,
      async (fd) => {
        const code = String(fd.get('code') || '').replace(/\D/g, '');
        if (code.length !== 6) return { error: 'Digite os 6 números do código.' };
        await App.auth.mfa.confirm(r.id, code);
        toast('Verificação em 2 etapas ativada. Daqui para frente, o login pede o código.');
      },
      'Confirmar e ativar'
    );
  }

  App.actions.security = async () => {
    if (App.auth.isDemo) return;
    let factors;
    try {
      factors = await App.auth.mfa.list();
    } catch (e) {
      toast(e.message, 'error');
      return;
    }
    if (factors.length) {
      openModal(
        'Segurança da conta',
        `<p><span class="pill ok">${icons.check} Verificação em 2 etapas ativa</span></p>
         <p class="muted">Toda vez que você entrar, além da senha, o sistema pede o código do app autenticador.</p>`,
        async () => {
          const ok = await confirmBox('Desativar a verificação em 2 etapas? A conta fica protegida só pela senha.', 'Desativar', true);
          if (!ok) return { error: 'Nada foi alterado.' };
          for (const f of factors) await App.auth.mfa.disable(f.id);
          toast('Verificação em 2 etapas desativada.');
        },
        'Desativar'
      );
      return;
    }
    openModal(
      'Segurança da conta',
      `<p><span class="pill warn">Verificação em 2 etapas desativada</span></p>
       <p class="muted">Com ela ligada, mesmo que alguém descubra a sua senha não consegue entrar sem o código que só o seu celular gera.
       ${App.isManager() ? '<b>Recomendado para o gerente.</b>' : ''}</p>`,
      async () => {
        const r = await App.auth.mfa.enroll();
        setTimeout(() => showEnroll(r), 80);
      },
      'Ativar agora'
    );
  };
})(typeof self !== 'undefined' ? self : this);
