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
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlubXpudnNxaXJ3Y3FpYnBjaG9uIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIwMzc5MzgsImV4cCI6MjEwNzYxMzkzOH0.5GiV3ZJf4FGTpoT8SLmkLPjIC_OFeMXDgZCm4uSsReA',
};
