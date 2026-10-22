# Estoque & Montagem — M&B Metais

Sistema para controlar o estoque de peças de torneiras, duchas e acessórios e calcular quanto dá para montar de cada produto final.

Funciona em **dois modos**, escolhidos pelo arquivo `js/config.js`:

- **Modo demonstração** (arquivo vazio, como vem): dados de exemplo, guardados só no navegador, login de mentira.
- **Modo online** (com Supabase preenchido): login de verdade, banco de dados compartilhado, fotos na nuvem e valores financeiros protegidos no servidor.

## O que tem

| Aba | Para que serve |
| --- | --- |
| **Mostruário** | Catálogo com foto: quanto dá para montar de cada produto, qual peça limita, alertas. |
| **Peças** | Estoque, mínimo, código, foto, entradas e saídas. |
| **Produtos** | Ficha técnica, foto do produto montado, **Guia de montagem** (foto do resultado, checklist de peças e passo a passo) e registro de montagem (desconta as peças). |
| **Recebimento** | Chegou mercadoria (pela nota fiscal)? Qualquer pessoa registra o lote; o gerente autoriza e só então entra no estoque. Fica o registro: Aguardando autorização, Concluído, Concluído (editado) ou Excluído, com motivo. |
| **Reposição** | Lista de compras: o que falta para o mínimo e, se quiser, para uma meta de produção. Copia a lista ou baixa em Excel. |
| **Simulação** | Quanto montar e o que sobra/falta, sem mexer no estoque. |
| **Conferência** | Contagem de estoque: qualquer pessoa conta às cegas, o gerente vê as diferenças e aprova o ajuste. |
| **Planilhas** | Só gerente: exportar tudo para Excel (com ou sem valores) e importar uma planilha para atualizar. |
| **Histórico** | Entradas, saídas e montagens, com quem fez. O gerente pode estornar um lançamento errado (o estorno fica registrado). |
| **Financeiro** | Custo, preço, lucro, margem e **auditoria de custos e preços** (quem mudou, de quanto para quanto, de onde veio; alerta de aumento de 10% ou mais). Só gerente. |
| **Usuários** | Só gerente, só no modo online: nome, perfil, ativar/desativar. |

### Perfis
- **Gerente:** vê tudo, edita tudo, importa planilhas.
- **Funcionário:** vê estoque, fotos, produtos, simulação e histórico **sem valores em reais**; registra entradas, saídas e montagens. Não vê a aba Planilhas. No histórico, vê só tipo, peça, quantidade, data/hora e quem registrou (as observações são do gerente), e as saídas aparecem como "Saiu p/ entrega".

No modo online, a regra vale no servidor: custos e preços ficam em tabelas que o funcionário não consegue ler, nem mexendo no navegador.

## Planilhas (Excel)

- **Exportar:** gera `estoque-AAAA-MM-DD.xlsx`. A opção de incluir custos/preços só aparece para o gerente.
- **Importar (gerente):** aceita `.xlsx` ou `.csv`. Baixe o modelo na própria aba. Antes de aplicar, mostra uma prévia do que vai mudar e baixa uma cópia de segurança do estoque atual. Você escolhe se a quantidade da planilha **substitui** ou **soma** ao estoque.
- Arquivos `.xls` antigos precisam ser salvos como `.xlsx` no Excel.

## Colocar o login e o banco de dados online (Supabase)

1. Crie uma conta em [supabase.com](https://supabase.com) e um projeto novo (guarde a senha do banco).
2. No projeto: **SQL Editor > New query**, cole **todo** o conteúdo de `supabase/schema.sql` e clique em **Run**.
3. **Authentication > Users > Add user > Create new user**: informe seu e-mail e uma senha e marque **Auto Confirm User**.
4. No SQL Editor, torne esse usuário gerente (troque o e-mail):
   ```sql
   update public.profiles set role = 'gerente'
   where id = (select id from auth.users where email = 'seu@email.com');
   ```
5. **Authentication > Sign In / Providers** (ou *Settings*): desligue **Allow new users to sign up**. Assim só entra quem você criar.
6. **Project Settings > API**: copie **Project URL** e a chave **anon / public**. Cole em `js/config.js`:
   ```js
   window.APP_CONFIG = { supabaseUrl: 'https://xxxx.supabase.co', supabaseAnonKey: 'eyJ...' };
   ```
   **Nunca** use a chave `service_role` aqui; a `anon` é feita para ficar no site.
7. Suba para o GitHub (`git add .`, `git commit`, `git push`); a Vercel republica sozinha.
8. Para cada funcionário: repita o passo 3 (ele entra como *funcionário* por padrão). Depois, na aba **Usuários**, ajuste nome e perfil.

Para desligar alguém: aba **Usuários**, desmarque *Ativo*.

### Atualizando um banco que já existe
Se o `schema.sql` já foi rodado antes, rode as migrações que faltam, em ordem, no SQL Editor (podem ser repetidas sem problema):
1. `supabase/migracao-2-historico.sql`
2. `supabase/migracao-3-estorno-conferencia.sql` (estorno, reposição e conferência)
3. `supabase/migracao-4-recebimento.sql` (recebimento por lote)
4. `supabase/migracao-5-auditoria-guia.sql` (auditoria de custos, custo de compra no recebimento, guia de montagem)

Antes de publicar o site novo, rode a migração; se o site subir antes, as telas dão erro até ela rodar.

### Estoque fictício para demonstração
O site já vem com 49 peças e 17 produtos de exemplo (torneiras, duchas e chuveiros), com ficha técnica, guia de montagem e foto ilustrativa. No modo demonstração ele aparece sozinho. No modo online, o gerente usa **Planilhas > Estoque fictício > Carregar** (e **Remover** antes de lançar o estoque real).

### Aviso sobre o modo demonstração
As senhas de demonstração (`gerente@mbmetais.demo`) estão no código público e os dados ficam só no navegador. É para mostrar o sistema, **não para dados reais**.

### Sobre os testes do banco
O `schema.sql` foi testado em um PostgreSQL 16 com um simulador das funções do Supabase (regras de acesso, estoque, montagem atômica, funcionário sem acesso a custos). Ainda não foi rodado no seu projeto Supabase real: se aparecer erro ao executar, copie a mensagem e me envie.

## Rodar no computador
Abra a pasta no VS Code e use **Live Server** em `index.html` (ou dê duplo clique).

Testes das regras (precisa de Node.js):
```bash
node tests/logic.test.js
node tests/sheets.test.js
```

## Publicar (GitHub + Vercel)
Suba o **conteúdo** da pasta (não o .zip) para o repositório. Na Vercel: *Add New > Project*, preset **Other**, sem comando de build, **Deploy**. A cada `git push` o site atualiza.

## Estrutura
```
index.html            página única (login + app)
css/style.css         visual
js/config.js          liga o modo online (vazio = demonstração)
js/data.js            estoque fictício (49 peças, 17 produtos)
img/demo/             fotos ilustrativas dos produtos montados
js/logic.js           regras de cálculo
js/app.js             telas, abas e login
js/store.js           armazenamento do modo demonstração
js/supabase.js        armazenamento/login do modo online
js/auth.js            login do modo demonstração
js/xlsx-lite.js       leitura/escrita de .xlsx e .csv
js/sheets.js          montagem do Excel e plano de importação
js/views-sheets.js    aba Planilhas
js/views-users.js     aba Usuários
js/views-extra.js     abas Reposição e Conferência
js/views-recebimento.js aba Recebimento
js/images.js          redução das fotos antes de guardar
supabase/schema.sql   tabelas, regras de acesso e funções do banco
tests/                testes (fixture-data.js = dados pequenos fixos dos testes)
```

## Próximos passos sugeridos
Estoque de produto acabado, relatórios por período, alerta de reposição por e-mail.
