/*
 * Conexão com o Supabase usando só fetch (sem bibliotecas):
 *   - SupabaseAuth: login por e-mail e senha, sessão guardada no navegador.
 *   - createSupabaseStore: mesmas funções do armazenamento local, mas no banco online.
 * As regras de segurança ficam NO BANCO (supabase/schema.sql), não aqui.
 */
(function (root) {
  'use strict';

  const cfg = root.APP_CONFIG || {};
  const enabled = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);
  const base = String(cfg.supabaseUrl || '').replace(/\/+$/, '');
  const anon = cfg.supabaseAnonKey || '';
  const SESSION_KEY = 'estoque-torneiras:sb-session';
  const BUCKET = 'fotos';

  let session = null;
  let onSessionLost = () => {};

  function loadSession() {
    try {
      session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    } catch (e) {
      session = null;
    }
  }
  function saveSession(s) {
    session = s;
    try {
      if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else localStorage.removeItem(SESSION_KEY);
    } catch (e) {
      /* a sessão vale até recarregar */
    }
  }

  function toSession(r) {
    return {
      access_token: r.access_token,
      refresh_token: r.refresh_token,
      expires_at: r.expires_at || Math.floor(Date.now() / 1000) + (r.expires_in || 3600),
      user: { id: r.user && r.user.id, email: r.user && r.user.email },
    };
  }

  function friendly(status, body) {
    const msg = body && (body.message || body.msg || body.error_description || body.error);
    const code = body && (body.code || body.error_code);
    if (status === 401 || (msg && /jwt/i.test(msg))) return 'Sua sessão expirou. Entre de novo.';
    if (code === '23503') return 'Não dá para excluir: este item está em uso.';
    if (code === '23505') return 'Já existe um item com esse código.';
    if (code === '22P02') return 'Algum dos dados está em formato inválido.';
    if (msg) return String(msg);
    return `Erro inesperado do servidor (${status}).`;
  }

  async function refreshIfNeeded() {
    if (!session) return;
    if (session.expires_at - 60 > Date.now() / 1000) return;
    const res = await fetch(`${base}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    if (!res.ok) {
      saveSession(null);
      onSessionLost();
      throw new Error('Sua sessão expirou. Entre de novo.');
    }
    saveSession(toSession(await res.json()));
  }

  /** Chamada ao servidor. path começa com /rest/v1/... ou /storage/v1/... */
  async function api(path, opts) {
    opts = opts || {};
    await refreshIfNeeded();
    const headers = {
      apikey: anon,
      // chaves novas (sb_publishable_...) não são JWT: só vão no cabeçalho apikey
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : anon.startsWith('eyJ') ? { Authorization: `Bearer ${anon}` } : {}),
      ...(opts.headers || {}),
    };
    let body = opts.body;
    if (body !== undefined && !(body instanceof Blob) && typeof body !== 'string') {
      body = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
    let res;
    try {
      res = await fetch(base + path, { method: opts.method || 'GET', headers, body });
    } catch (e) {
      throw new Error('Sem conexão com o servidor. Confira a internet e tente de novo.');
    }
    const text = await res.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch (e) {
        json = null;
      }
    }
    if (!res.ok) {
      if (res.status === 401 && session) {
        saveSession(null);
        onSessionLost();
      }
      throw new Error(friendly(res.status, json));
    }
    return json;
  }

  const rpc = (fn, args) => api(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args || {} });

  /** Lê uma tabela inteira, de 1000 em 1000 (limite padrão do servidor). */
  async function getAll(table, query) {
    const out = [];
    for (let offset = 0; ; offset += 1000) {
      const rows = await api(`/rest/v1/${table}?${query}&limit=1000&offset=${offset}`);
      out.push(...rows);
      if (rows.length < 1000) break;
    }
    return out;
  }

  // ---------------- login ----------------
  async function fetchProfile(userId) {
    const rows = await api(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,name,role,active`);
    return rows && rows[0];
  }

  async function userFromSession() {
    const p = await fetchProfile(session.user.id);
    if (!p) return { ok: false, error: 'Seu usuário ainda não tem perfil no sistema. Fale com o gerente.' };
    if (!p.active) return { ok: false, error: 'Seu acesso está desativado. Fale com o gerente.' };
    return { ok: true, user: { id: p.id, email: session.user.email, name: p.name || session.user.email, role: p.role } };
  }

  const SupabaseAuth = {
    isDemo: false,
    onSessionLost(fn) {
      onSessionLost = fn;
    },
    async current() {
      loadSession();
      if (!session) return null;
      try {
        const r = await userFromSession();
        if (!r.ok) {
          saveSession(null);
          return null;
        }
        return r.user;
      } catch (e) {
        if (/conexão/i.test(e.message)) throw e;
        saveSession(null);
        return null;
      }
    },
    async signIn(email, password) {
      const e = String(email || '').trim();
      if (!e || !password) return { ok: false, error: 'Informe e-mail e senha.' };
      let res;
      try {
        res = await fetch(`${base}/auth/v1/token?grant_type=password`, {
          method: 'POST',
          headers: { apikey: anon, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: e, password }),
        });
      } catch (err) {
        return { ok: false, error: 'Sem conexão com o servidor. Confira a internet e tente de novo.' };
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const bad = res.status === 400 || res.status === 422;
        return { ok: false, error: bad ? 'E-mail ou senha incorretos.' : friendly(res.status, json) };
      }
      saveSession(toSession(json));
      try {
        const r = await userFromSession();
        if (!r.ok) {
          saveSession(null);
          return r;
        }
        return r;
      } catch (err) {
        saveSession(null);
        return { ok: false, error: err.message };
      }
    },
    async signOut() {
      const token = session && session.access_token;
      saveSession(null);
      if (token) {
        try {
          await fetch(`${base}/auth/v1/logout`, { method: 'POST', headers: { apikey: anon, Authorization: `Bearer ${token}` } });
        } catch (e) {
          /* sair localmente já basta */
        }
      }
    },
  };

  // ---------------- dados ----------------
  function createSupabaseStore(getUser) {
    const isManager = () => (getUser() || {}).role === 'gerente';
    const publicUrl = (path) => `${base}/storage/v1/object/public/${BUCKET}/${path}`;
    const pathFromUrl = (url) => {
      const marker = `/object/public/${BUCKET}/`;
      const i = String(url || '').indexOf(marker);
      return i < 0 ? null : url.slice(i + marker.length);
    };

    return {
      kind: 'supabase',

      async load() {
        const manager = isManager();
        const [parts, products, bom, moves, costs, prices, counts] = await Promise.all([
          getAll('parts', 'select=id,code,name,stock,min,photo_url&order=name.asc'),
          getAll('products', 'select=id,code,name,category,photo_url&order=name.asc'),
          getAll('bom', 'select=product_id,part_id,qty'),
          api('/rest/v1/rpc/list_movements', { method: 'POST', body: { p_limit: 500 } }),
          manager ? getAll('part_costs', 'select=part_id,cost') : [],
          manager ? getAll('product_prices', 'select=product_id,price') : [],
          api('/rest/v1/rpc/list_counts', { method: 'POST', body: { p_limit: 30 } }),
        ]);
        const costOf = {};
        costs.forEach((c) => (costOf[c.part_id] = Number(c.cost)));
        const priceOf = {};
        prices.forEach((p) => (priceOf[p.product_id] = Number(p.price)));
        const bomOf = {};
        bom.forEach((b) => (bomOf[b.product_id] = (bomOf[b.product_id] || []).concat({ partId: b.part_id, qty: b.qty })));
        return {
          parts: parts.map((p) => ({
            id: p.id,
            code: p.code || '',
            name: p.name,
            stock: p.stock,
            min: p.min,
            cost: costOf[p.id] || 0,
            photo: p.photo_url || undefined,
          })),
          products: products.map((p) => ({
            id: p.id,
            code: p.code || '',
            name: p.name,
            category: p.category,
            price: priceOf[p.id] || 0,
            photo: p.photo_url || undefined,
            bom: bomOf[p.id] || [],
          })),
          movements: moves.map((m) => ({
            id: m.id,
            date: m.created_at,
            partId: m.part_id,
            partName: m.part_name,
            type: m.type,
            qty: m.qty,
            note: m.note,
            role: m.user_role,
            who: m.user_name,
            reverts: m.reverts || null,
            revertedBy: m.reverted_by || null,
            origin: m.origin || '',
          })),
          counts: (counts || []).map((c) => ({
            id: c.id,
            date: c.created_at,
            who: c.user_name,
            note: c.note,
            status: c.status,
            items: (c.items || []).map((i) => ({ partId: i.part_id, name: i.name, code: i.code || '', system: i.system, counted: i.counted })),
            reviewedBy: c.reviewed_by_name,
            reviewedAt: c.reviewed_at,
          })),
        };
      },

      async saveParts(items, note) {
        await rpc('save_parts', { items, p_note: note || 'Ajuste manual' });
      },
      async saveProducts(items) {
        await rpc('save_products', { items });
      },
      async deletePart(id) {
        await api(`/rest/v1/parts?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      },
      async deleteProduct(id) {
        await api(`/rest/v1/products?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      },
      async move({ partId, type, qty, note, unitCost }) {
        await rpc('apply_movement', {
          p_part: partId,
          p_type: type,
          p_qty: Math.floor(Number(qty)),
          p_note: note || '',
          p_unit_cost: unitCost === undefined ? null : unitCost,
        });
      },
      async produce(productId, qty) {
        await rpc('apply_production', { p_product: productId, p_qty: Math.floor(Number(qty)) });
      },

      /** photo: { blob } para trocar, ou null para remover. oldUrl: foto atual (para limpar). */
      async setPhoto(kind, id, photo, oldUrl) {
        let url = null;
        if (photo && photo.blob) {
          const path = `${kind}s/${id}-${Date.now()}.jpg`;
          await api(`/storage/v1/object/${BUCKET}/${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'false' },
            body: photo.blob,
          });
          url = publicUrl(path);
        }
        await rpc('set_photo', { p_kind: kind, p_id: id, p_url: url });
        const old = pathFromUrl(oldUrl);
        if (old) {
          try {
            await api(`/storage/v1/object/${BUCKET}/${old}`, { method: 'DELETE' });
          } catch (e) {
            /* sobra um arquivo no armazenamento; não atrapalha */
          }
        }
      },

      async reverse(id) {
        await rpc('reverse_movement', { p_id: id });
      },
      async submitCount(items, note) {
        await rpc('submit_count', {
          p_items: items.map((i) => ({ part_id: i.partId, counted: Math.floor(Number(i.counted)) })),
          p_note: note || '',
        });
      },
      async reviewCount(id, approve) {
        await rpc('review_count', { p_id: id, p_approve: !!approve });
      },

      async listUsers() {
        return (await rpc('list_users')) || [];
      },
      async setUser(id, role, active, name) {
        await rpc('set_user', { p_id: id, p_role: role, p_active: active, p_name: name || null });
      },
    };
  }

  root.SupabaseAuth = SupabaseAuth;
  root.createSupabaseStore = createSupabaseStore;
  root.supabaseEnabled = enabled;
})(typeof self !== 'undefined' ? self : this);
