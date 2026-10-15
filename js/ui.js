/*
 * Utilidades de interface: formatação, avisos, janelas, ícones.
 */
(function (root) {
  'use strict';

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const brl = (n) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const int = (n) => (Number(n) || 0).toLocaleString('pt-BR');
  const pct = (n) =>
    (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  const $ = (sel, scope) => (scope || document).querySelector(sel);
  const $$ = (sel, scope) => Array.from((scope || document).querySelectorAll(sel));

  function uuid() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
    const b = new Uint8Array(16);
    root.crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  // ---------- ícones (traço simples, herdam a cor do texto) ----------
  const ico = (d, extra) =>
    `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}${extra || ''}</svg>`;
  const icons = {
    camera: ico('<path d="M4 8h3l1.6-2.4h6.8L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.6"/>'),
    drop: ico('<path d="M12 3.2S5.6 10.4 5.6 14.6a6.4 6.4 0 0 0 12.8 0C18.4 10.4 12 3.2 12 3.2z"/>'),
    image: ico('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5-5-9 9"/>'),
    download: ico('<path d="M12 4v11"/><path d="m7.5 11 4.5 4.5L16.5 11"/><path d="M5 19h14"/>'),
    upload: ico('<path d="M12 16V5"/><path d="m7.5 9 4.5-4.5L16.5 9"/><path d="M5 19h14"/>'),
    logout: ico('<path d="M9 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H9"/><path d="M15 8l4 4-4 4"/><path d="M19 12H9"/>'),
    eye: ico('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>'),
    eyeOff: ico('<path d="M3 3l18 18"/><path d="M10.6 5.7A9.7 9.7 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3.2 3.9"/><path d="M6.4 7.3A15.6 15.6 0 0 0 2.5 12S6 18.5 12 18.5a9.6 9.6 0 0 0 4-.9"/>'),
    mail: ico('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>'),
    lock: ico('<rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>'),
    trash: ico('<path d="M4.5 7h15"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l.8 12h9.4l.8-12"/>'),
    x: ico('<path d="M6 6l12 12M18 6 6 18"/>'),
    plus: ico('<path d="M12 5v14M5 12h14"/>'),
    file: ico('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M9 13h6M9 17h6"/>'),
    check: ico('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
    alert: ico('<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.4v.1"/>'),
  };

  // ---------- aviso rápido ----------
  let toastTimer;
  function toast(msg, kind) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'show' + (kind === 'error' ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = ''), kind === 'error' ? 5200 : 3200);
  }

  // ---------- janela de formulário ----------
  function openModal(title, bodyHtml, onSubmit, submitLabel, opts) {
    opts = opts || {};
    const modal = $('#modal');
    modal.className = opts.wide ? 'wide' : '';
    modal.innerHTML = `
      <form novalidate>
        <h2>${esc(title)}</h2>
        <div class="modal-body">${bodyHtml}</div>
        <p class="form-error" id="form-error" role="alert" hidden></p>
        <div class="modal-actions">
          <button type="button" class="btn ghost" data-action="close-modal">Cancelar</button>
          <button type="submit" class="btn primary">${esc(submitLabel || 'Salvar')}</button>
        </div>
      </form>`;
    const form = $('form', modal);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submit = $('button[type=submit]', form);
      const errBox = $('#form-error', modal);
      errBox.hidden = true;
      submit.disabled = true;
      submit.classList.add('busy');
      try {
        const res = await onSubmit(new FormData(form), form);
        if (res && res.error) {
          errBox.textContent = res.error;
          errBox.hidden = false;
        } else {
          closeModal();
        }
      } catch (err) {
        errBox.textContent = (err && err.message) || 'Algo deu errado. Tente de novo.';
        errBox.hidden = false;
      } finally {
        submit.disabled = false;
        submit.classList.remove('busy');
      }
    });
    if (!modal.open) modal.showModal();
    const first = $('input:not([type=hidden]), select', form);
    if (first && !opts.noFocus) first.focus();
  }

  function closeModal() {
    const modal = $('#modal');
    if (modal && modal.open) modal.close();
  }

  // ---------- confirmação (no lugar do confirm() do navegador) ----------
  function confirmBox(message, okLabel, danger) {
    return new Promise((resolve) => {
      const dlg = $('#confirm');
      dlg.innerHTML = `
        <form method="dialog">
          <p class="confirm-msg">${esc(message)}</p>
          <div class="modal-actions">
            <button type="button" class="btn ghost" data-confirm="no">Cancelar</button>
            <button type="button" class="btn ${danger ? 'danger-solid' : 'primary'}" data-confirm="yes">${esc(okLabel || 'Confirmar')}</button>
          </div>
        </form>`;
      const done = (v) => {
        dlg.close();
        resolve(v);
      };
      $('[data-confirm=yes]', dlg).onclick = () => done(true);
      $('[data-confirm=no]', dlg).onclick = () => done(false);
      dlg.oncancel = (e) => {
        e.preventDefault();
        done(false);
      };
      dlg.showModal();
      $('[data-confirm=no]', dlg).focus();
    });
  }

  root.UI = { esc, brl, int, pct, $, $$, uuid, icons, toast, openModal, closeModal, confirmBox };
})(typeof self !== 'undefined' ? self : this);
