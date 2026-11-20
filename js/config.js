/*
 * Conexão com o banco de dados online (Supabase).
 *
 * Deixe os dois campos vazios para usar o MODO DEMONSTRAÇÃO (dados só no navegador).
 * Depois de criar o projeto no Supabase (passo a passo no README), preencha:
 *   supabaseUrl      -> "Project URL", algo como https://abcdxyz.supabase.co
 *   supabaseAnonKey  -> chave "anon public" (Project Settings > API)
 *
 * A chave "anon" foi feita para ficar pública no site: quem protege os dados é o
 * login e as regras do banco (supabase/schema.sql). Nunca coloque aqui a chave
 * "service_role".
 */
window.APP_CONFIG = {
  supabaseUrl: 'https://ynmznvsqirwcqibpchon.supabase.co',
  supabaseAnonKey: 'sb_publishable_Jwu_NPHYTJILMxy77W_IxA_Vri-1W5z',
};
