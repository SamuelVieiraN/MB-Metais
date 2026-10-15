/*
 * Aba "Usuários" (só gerência, só com o banco online): mudar perfil, renomear e
 * ativar/desativar. Criar a conta (e-mail e senha) é feito no painel do Supabase.
 */
(function (root) {
  'use strict';

  const App = root.App;
  const { esc, icons, toast, $, $$ } = root.UI;

  let users = null; // null = ainda não carregou
  let loadError = null;

  async function load() {
    try {
      users = await App.store.listUsers();
      loadError = null;
    } catch (e) {
      users = [];
      loadError = e.message;
    }
  }

  function view() {
    if (users === null) return `<div class="loading"><span class="spinner"></span> Carregando usuários…</div>`;
    const me = App.user.id;
    const rows = users
      .map((u) => {
        const self = u.id === me;
        const last = u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'nunca entrou';
        return `<tr data-uid="${u.id}">
          <td><input type="text" data-f="name" value="${esc(u.name)}" maxlength="60" aria-label="Nome" /></td>
          <td>${esc(u.email)}${self ? ' <span class="pill ok">você</span>' : ''}</td>
          <td><select data-f="role" ${self ? 'disabled' : ''} aria-label="Perfil">
            <option value="funcionario" ${u.role === 'funcionario' ? 'selected' : ''}>Funcionário</option>
            <option value="gerente" ${u.role === 'gerente' ? 'selected' : ''}>Gerente</option>
          </select></td>
          <td><label class="switch"><input type="checkbox" data-f="active" ${u.active ? 'checked' : ''} ${self ? 'disabled' : ''} /><span>${u.active ? 'Ativo' : 'Inativo'}</span></label></td>
          <td class="hint">${esc(last)}</td>
          <td class="row-actions"><button class="btn small" data-action="user-save" data-id="${u.id}">Salvar</button></td>
        </tr>`;
      })
      .join('');
    return `
      <section class="page-head">
        <div>
          <h1>Usuários</h1>
          <p class="muted">Quem pode entrar no sistema e com qual perfil. Desativar corta o acesso na hora.</p>
        </div>
        <div class="actions"><button class="btn" data-action="users-reload">Atualizar lista</button></div>
      </section>
      ${loadError ? `<div class="banner bad">${esc(loadError)}</div>` : ''}
      <div class="table-wrap"><table>
        <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Acesso</th><th>Último acesso</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="empty">Nenhum usuário.</td></tr>'}</tbody>
      </table></div>
      <div class="card" style="margin-top:16px">
        <h3>${icons.plus} Como criar um novo usuário</h3>
        <ol class="steps">
          <li>No painel do Supabase, abra <b>Authentication → Users → Add user</b>.</li>
          <li>Informe e-mail e senha e marque <b>Auto Confirm User</b>.</li>
          <li>Volte aqui, clique em <b>Atualizar lista</b> e ajuste o perfil. Todo usuário novo começa como <b>Funcionário</b>.</li>
        </ol>
        <p class="hint">Para trocar a senha de alguém, use o mesmo painel (Authentication → Users).</p>
      </div>`;
  }

  Object.assign(App.actions, {
    'users-reload': async () => {
      users = null;
      App.render();
      await load();
      App.render();
    },
    'user-save': async (id, btn) => {
      const row = btn.closest('tr');
      const name = $('[data-f=name]', row).value.trim();
      const role = $('[data-f=role]', row).value;
      const active = $('[data-f=active]', row).checked;
      btn.disabled = true;
      btn.classList.add('busy');
      try {
        await App.store.setUser(id, role, active, name);
        await load();
        toast('Usuário atualizado.');
      } catch (e) {
        toast(e.message, 'error');
      }
      App.render();
    },
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches && t.matches('[data-f=active]')) {
      const label = t.closest('.switch');
      if (label) $('span', label).textContent = t.checked ? 'Ativo' : 'Inativo';
    }
  });

  App.registerTab({
    id: 'usuarios',
    label: 'Usuários',
    order: 80,
    managerOnly: true,
    remoteOnly: true,
    view,
    after: async () => {
      if (users === null) {
        await load();
        if (App.tab === 'usuarios') App.render();
      }
    },
  });
})(typeof self !== 'undefined' ? self : this);
