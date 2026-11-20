# Segurança e LGPD — M&B Metais

Atualizado em 19/11/2026. Textos legais (privacidade.html, termos.html, cookies.html) são **rascunhos**: peça revisão a um(a) advogado(a) antes de divulgar a loja.

## 1. Plano de resposta a incidentes
Incidente = acesso indevido, vazamento, perda ou alteração de dados pessoais.

1. **Conter (primeiras horas):** trocar a senha do gerente; em Supabase > Authentication, encerrar sessões/bloquear contas suspeitas; se preciso, desligar o cadastro (Sign In / Providers) ou pausar o site na Vercel.
2. **Registrar:** data/hora, o que aconteceu, quais dados e quantas pessoas. A aba Gerência > Auditoria ajuda; guarde prints.
3. **Avaliar o risco:** os dados expostos podem causar dano relevante (CPF, endereço, telefone)? Se sim, notificar.
4. **Notificar:** a ANPD e os titulares afetados em prazo razoável (a ANPD orienta **3 dias úteis** a partir do conhecimento; confirmar com advogado(a)). Contar o que houve, quais dados, riscos e o que foi feito.
5. **Corrigir e aprender:** corrigir a causa, rodar `get_advisors` no Supabase, atualizar este plano.

Contatos: encarregado (company.js: dpoName/dpoEmail); Supabase e Vercel: painel > suporte.

## 2. Registro de tratamento e retenção
| Dado | Finalidade | Base legal | Guarda |
|---|---|---|---|
| Nome, CPF/CNPJ, telefone, e-mail, endereço | Atender e entregar | Contrato; obrigação legal | Enquanto a conta existir |
| Solicitações aprovadas | Pedido/fiscal | Contrato; obrigação legal | Até 5 anos (confirmar com contador) |
| Solicitações não aprovadas | Atendimento | Contrato | Apagadas com a conta |
| Aceites (versão/data) | Prova do consentimento | Exercício de direitos | Enquanto a conta existir |
| Auditoria | Segurança | Legítimo interesse | 12 meses (botão "Apagar antigos") |

Direitos dos titulares: na loja (Minha conta > Meus dados / Privacidade) o cliente corrige, baixa cópia (JSON) e exclui a conta sozinho. Outros pedidos: encarregado, resposta em até 15 dias.

## 3. Operadores (contratos)
Supabase (banco/login/fotos), Vercel (site), ViaCEP e BrasilAPI (CEP, só o CEP), Cloudflare Turnstile (opcional). Aceitar o DPA/termos de cada um nos painéis; Supabase e Vercel oferecem DPA online.

## 4. Checklist do que foi pedido
| Item | Situação |
|---|---|
| Autenticação segura, 2 etapas (equipe) | Feito (TOTP; servidor exige) |
| Controle de acesso | Feito (RLS + funções; cliente nunca vê estoque/custos) |
| Criptografia, HTTPS/TLS, hash de senhas | Feito (Supabase/Vercel; HSTS) |
| SQL injection | Feito (RPC com parâmetros; sem SQL dinâmico) |
| XSS / CSRF | Feito (escape, CSP estrita, token no cabeçalho, sem cookies de sessão) |
| Rate limiting | Parcial: limite por usuário no servidor; o catálogo anônimo e o login dependem do limite do Supabase/Vercel |
| Proteção de APIs | Feito (permissões mínimas por função) |
| Auditoria de dependências | Site sem pacotes npm; Dependabot ligado |
| Privacidade, bases legais, finalidades, minimização | Rascunho pronto (revisar) |
| Consentimento e versões | Feito (registrado no banco; novo aceite quando a versão muda) |
| Cookies | Página pronta; sem cookies de rastreio |
| Direitos, exclusão, retenção | Feito (autoatendimento) |
| Contratos com operadores | Pendente: aceitar DPAs |
| Termos, preços, cobrança, cancelamento, reembolso, fornecedor | Rascunho pronto (revisar) |
| Assinaturas | Não se aplica (não há) |
| Publicidade/depoimentos | Não há depoimentos na loja; se criar, só reais |
| Licenças de uso | Texto nos Termos |
| Backups automatizados | **Pendente** (plano Free: backup manual; Pro tem diário) |
| Logs / monitoramento | Auditoria no sistema; logs do Supabase/Vercel; sem alerta automático |
| Resposta/notificação de incidentes | Plano acima |
| Testes de segurança, revisão de código | Testes automáticos (banco, telas, XSS); **pentest formal pendente** |
| Privilégios administrativos | Feito (gerente x funcionário x cliente) |
| Gestão de vulnerabilidades | Dependabot + advisors do Supabase |
| Auditoria de conformidade | Revisão anual sugerida (este documento) |
