/*
 * Login.
 *
 * ATENÇÃO: esta é a versão de DEMONSTRAÇÃO. As contas abaixo ficam escritas no
 * próprio código do site, então qualquer pessoa que abra o site consegue ver as
 * senhas. Serve para testar telas e perfis, NÃO para proteger dados reais.
 *
 * O resto do sistema só usa estas quatro funções (signIn, signInDemo, current,
 * signOut). Quando o banco de dados online (Supabase) entrar, basta trocar o
 * conteúdo deste arquivo por um que use o login do Supabase; as telas não mudam.
 */
(function (root) {
  const SESSION_KEY = 'estoque-torneiras:session';

  const DEMO_USERS = [
    { email: 'gerente@mbmetais.demo', password: 'gerente123', name: 'Gerente', role: 'gerente' },
    { email: 'funcionario@mbmetais.demo', password: 'funcionario123', name: 'Funcionário', role: 'funcionario' },
  ];

  const publicUser = (u) => ({ email: u.email, name: u.name, role: u.role });

  function current() {
    try {
      const email = localStorage.getItem(SESSION_KEY);
      const u = DEMO_USERS.find((x) => x.email === email);
      return u ? publicUser(u) : null;
    } catch (e) {
      return null;
    }
  }

  function start(u) {
    try {
      localStorage.setItem(SESSION_KEY, u.email);
    } catch (e) {
      /* sem armazenamento: a sessão vale só até recarregar */
    }
    return { ok: true, user: publicUser(u) };
  }

  function signIn(email, password) {
    const e = String(email || '').trim().toLowerCase();
    const u = DEMO_USERS.find((x) => x.email === e && x.password === String(password || ''));
    if (!u) return { ok: false, error: 'E-mail ou senha incorretos.' };
    return start(u);
  }

  function signInDemo(role) {
    const u = DEMO_USERS.find((x) => x.role === role);
    return u ? start(u) : { ok: false, error: 'Perfil não encontrado.' };
  }

  function signOut() {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch (e) {
      /* ok */
    }
  }

  root.Auth = { isDemo: true, demoUsers: DEMO_USERS.map(publicUser), current, signIn, signInDemo, signOut };
})(typeof self !== 'undefined' ? self : this);
