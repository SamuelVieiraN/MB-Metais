# Ata do projeto — Sistema de Estoque e Montagem (M&B Metais)

Atualizada em 22/10/2026 (17:00).

## Objetivo
Controlar estoque de peças (torneiras, duchas, acessórios), fichas técnicas dos produtos, quanto dá para montar de cada um (mostruário e simulação), custos/preço/margem, com visões de gerente e funcionário.

## Situação atual
- Site no ar na Vercel (mb-metais.vercel.app), código no GitHub (SamuelVieiraN/MB-Metais).
- Login e banco funcionando no Supabase (projeto "M&B Indústria e Comércio de Metais", região São Paulo). Gerente e funcionário criados e testados.
- Cadastro livre de novos usuários desligado; usuários criados pelo painel do Supabase.

## Funcionalidades
Mostruário com fotos, Peças, Produtos (ficha técnica e montagem), Simulação, Planilhas (Excel), Histórico, Financeiro, Usuários.

## Decisões
1. Site simples (HTML/CSS/JS puro, sem build). Dois modos: demonstração (sem config) e online (Supabase em js/config.js).
2. Valores financeiros ficam em tabelas separadas que o funcionário não lê (regra no servidor, não só na tela).
3. Planilhas (exportar/importar): só gerente. Exportação com ou sem valores.
4. Histórico do funcionário: só tipo, peça, quantidade, data/hora e quem registrou. Saídas aparecem como "Saiu p/ entrega". Observações só o gerente vê e só o gerente digita.
5. Custo da peça = média ponderada das compras.
6. Chave `anon`/`publishable` pode ficar no site; nunca usar `service_role`/`secret`.

## Dados da empresa (usados no rodapé, em js/app.js `renderFoot`)
- Nome fantasia: M&B Industria e Comercio de Metais (grafia como informada, sem acentos)
- CNPJ: 44.702.361/0001-55
- Endereço: Rua A (Lot Laguna Park 6), 107, Lagoa Redonda, Fortaleza/CE, CEP 60831-222
- Logo e catálogo: a receber (previsto 16/10/2026)

## Histórico de entregas
1. Versão 1: estoque, mostruário, simulação, financeiro, perfis (dados no navegador).
2. Versão 2: Excel, visual novo, login, fotos, Supabase.
3. Ajuste do config e das chaves novas do Supabase (`sb_publishable_`).
4. Migração 2: histórico sem observações para funcionário; aba Planilhas só do gerente. CONCLUÍDA em 15/10/2026: `migracao-2-historico.sql` rodada no Supabase e arquivos novos publicados no GitHub/Vercel; sistema funcionando.

5. Rodapé com nome da empresa, CNPJ, endereço e direitos (js/app.js `renderFoot`, css `.foot-brand`). A publicar: subir `js/app.js` em `js/` e `css/style.css` em `css/`.

6. Lote 1 das ideias do programador (ver ideias-melhorias.md): P5 Estorno (gerente, no Histórico), P2 Lista de compras (aba Reposição) e P1 Conferência de estoque (aba Conferência, contagem às cegas, gerente aprova). Exige `supabase/migracao-3-estorno-conferencia.sql` ANTES de publicar os arquivos novos. Testado: 88 verificações SQL (banco novo e banco migrado, com repetição da migração) e 84 verificações de tela no modo demonstração. NÃO testado em Supabase real. STATUS: CONCLUÍDO em 15/10/2026: usuário rodou a migração 3 no Supabase, publicou os arquivos e confirmou que funcionou.
   - Regras: estorno só para entrada/saída (não montagem), não estorna estorno nem duas vezes, não estorna entrada se o estoque não cobre; o custo médio NÃO é revertido no estorno. Conferência aprovada ajusta o estoque para o valor contado (usa o estoque do momento da aprovação). Funcionário vê rótulos Estorno/Conferência no histórico, nunca observações.
   - Decisão: lista de compras = meta + mínimo − estoque (sem meta, mínimo − estoque).

7. Recebimento de mercadoria por lote (aba Recebimento, migração `supabase/migracao-4-recebimento.sql`). Pedido do usuário: chega mercadoria com nota fiscal; funcionário registra, gerente autoriza o lançamento no estoque; tudo fica salvo, editável/excluível pelo gerente com registro: Aguardando autorização / Concluído / Concluído (editado) / Excluído.
   - Regras: funcionário cria (pendente, não mexe no estoque); só o gerente autoriza, edita e exclui. Editar concluído exige motivo e ajusta o estoque pela diferença (recusa se ficaria negativo). Excluir exige motivo; se já tinha entrado, a mercadoria sai do estoque (recusa se não houver quantidade). Nada é apagado; cada recebimento tem número (#) e registro de eventos. Fornecedor e motivos só o gerente vê. Movimentos no Histórico aparecem como "Recebimento" e não podem ser estornados pelo Histórico (usa-se a aba Recebimento). Campo "Na nota" opcional compara com o que chegou.
   - Peça não cadastrada no formulário: o gerente recebe a oferta de cadastrá-la na hora (estoque 0; o recebimento soma depois); o funcionário recebe aviso claro e sugestões parecidas, e deve pedir ao gerente para cadastrar em Peças. (Ajuste feito após teste do usuário, 15/10 06:20.)
   - Compatível com leitor de código de barras USB/Bluetooth (ele digita o código da peça; Enter avança e cria nova linha). Câmera/etiquetas: não feito.
   - Testado: 41 verificações SQL (banco novo e banco migrado, migração repetida) e 22 de tela (demo), mais 85 de regressão. NÃO testado em Supabase real. STATUS: CONCLUÍDO em 22/10/2026: migração 4 rodada e site publicado (usuário confirmou).

8. Estoque fictício de demonstração + guia de montagem + auditoria de custos + custo de compra no recebimento (pedido de 22/10/2026; o cliente ainda está contando o estoque real). Exige `supabase/migracao-5-auditoria-guia.sql` ANTES de publicar os arquivos novos.
   - Estoque fictício (js/data.js): 49 peças compartilhadas e 17 produtos: 5 torneiras básicas, 5 torneiras alto padrão, 2 duchas higiênicas, 2 chuveiros básicos, 1 médio, 2 alto padrão. Cada produto tem ficha técnica consistente, guia de montagem (passo a passo) e foto ilustrativa do produto montado (img/demo/*.jpg, geradas por código, não são fotos reais). Estoques variam de propósito: chave seletora zerada (chuveiro elétrico não monta), kit dourado baixo, vários perto do mínimo. No modo demonstração entra sozinho (chave do localStorage agora `estoque-torneiras:v2`). No modo online: aba Planilhas, cartão "Estoque fictício" (só gerente) com Carregar e Remover; ids fixos (prefixo de000000/de000001) para remover só o que foi carregado. Antes de lançar o estoque real: remover o fictício.
   - Guia de montagem: botão "Guia de montagem" em cada produto (todos os perfis, sem valores): foto do resultado final, checklist das peças (avisa "falta peça"), passos com marcação e contador de progresso (marcações não são salvas), botão Registrar montagem. Gerente edita os passos no formulário do produto (um por linha). Coluna `products.guide` (jsonb).
   - Auditoria de custos e preços (aba Financeiro, só gerente): tabela `price_log` preenchida por gatilhos em `part_costs` e `product_prices`; lida só pela função `list_price_log`. Mostra quando, antes/depois, % de variação, origem (cadastro, ajuste manual, compra, recebimento) e quem. Alerta para aumento de custo de 10% ou mais; filtros Tudo/Alertas/Custos/Preços.
   - Custo de compra no Recebimento: coluna "Custo unit." (só gerente informa e vê; funcionário que enviar valor é ignorado no servidor). Ao autorizar, o custo da peça vira média ponderada (estoque atual x custo atual + recebido x custo da compra) e a mudança vai para a auditoria. Editar recebimento já concluído não recalcula custo. Entrada manual com custo (aba Peças) também registra na auditoria, origem "compra".
   - Testado: banco novo, banco migrado (migrações 2 a 5) e migração repetida (16 verificações novas, todas ok); 26 verificações de tela novas (estoque fictício, guia, auditoria, custo no recebimento, funcionário sem acesso, celular); regressão 59 + 26 + 22 de tela e testes de lógica/planilha (usam tests/fixture-data.js, dados pequenos fixos). NÃO testado em Supabase real.
   - STATUS: CONCLUÍDO em 22/10/2026: usuário rodou o schema (inclui a migração 5), publicou os arquivos, carregou o estoque fictício e confirmou que ficou ótimo.

9. Produto pronto + Pedidos de clientes com acompanhamento (pedido de 22/10/2026). Exige `supabase/migracao-6-pedidos.sql` ANTES de publicar os arquivos novos.
   - Decisões do usuário: (a) registrar montagem desconta as peças E soma ao estoque de produto pronto (`products.ready`); (b) gerente cria, edita, cancela e finaliza pedidos; funcionário só acompanha, sem nome do cliente; (c) o pedido não monta direto: mostra o que falta e se as peças dão, e a montagem é registrada em Produtos.
   - Aba Pedidos (js/views-orders.js, ordem 31): barra de progresso, tabela por produto (pedido / montados / situação), aviso "tudo montado", "faltam X, as peças dão" ou "as peças não dão: faltam Y (n)", registro de eventos, filtros Em andamento/Concluídos/Cancelados/Todos. Finalizar só habilita com tudo montado e dá baixa nos prontos; cancelar exige motivo e não mexe no estoque; só pedido em andamento edita ou cancela. Atalho "Ir para Produtos (montar)".
   - Regra de repartição: os produtos prontos são repartidos entre os pedidos em andamento, do mais antigo para o mais novo (Logic.allocateReady; reservas manuais do gerente vêm primeiro, ver item 10). A conta de "peças dão" vale para o pedido sozinho (não considera outros pedidos disputando as mesmas peças).
   - Produtos/Mostruário mostram "N montados (prontos)". Gerente pode corrigir a contagem no formulário do produto (campo "Montados em estoque"); essa correção não gera histórico.
   - Limitações: montagens feitas ANTES da migração 6 não entram nos prontos (começa em 0; ajustar manualmente). Estoque de pronto não tem histórico próprio (o rastro é o registro do pedido). Estorno de montagem continua não existindo.
   - Estoque fictício: agora com produtos prontos (8 produtos) e 3 pedidos de exemplo ("[Demonstração] ...": um pronto para finalizar, um parcial com falta de peça, um parcial em que as peças dão). No modo online o botão Carregar cria os pedidos; Remover cancela os pedidos de demonstração em andamento.
   - Chave do localStorage do modo demonstração: `estoque-torneiras:v3`.
   - Testado: 24 verificações SQL novas (banco novo, migrado e migração repetida, junto com as 17 da migração 5), 23 de tela novas (pedidos), regressão 59 + 26 + 22 + 26 de tela e testes de lógica (incluindo repartição de prontos). NÃO testado em Supabase real.
   - STATUS: CONCLUÍDO em 22/10/2026 (usuário confirmou "perfeito").

10. Aba Montados, reserva para pedido, guia dentro do pedido e busca em Produtos (pedido de 22/10/2026). Exige `supabase/migracao-7-montados.sql` ANTES de publicar os arquivos novos.
   - Aba Montados (js/views-montados.js, entre Pedidos e Recebimento): estoque de produtos já montados. Por produto: montados, em pedidos, livres, e quais pedidos usam (recebe/precisa). Filtro "Só com montados"/"Todos", busca por nome/código/categoria, botão Guia (todos), e para o gerente "Ajustar" e "Acionar a pedido". Histórico de movimentações de montados (montagem, ajuste, pedido finalizado) em `ready_log`, lido só por `list_ready_log` (funcionário não vê observações).
   - Ajustar (gerente, `adjust_ready`): entrou (já existiam/montados a mais, SEM descontar peças) ou saiu (motivo obrigatório); não deixa ficar negativo. O campo "Montados em estoque" saiu do formulário de produto (o ajuste é pela aba Montados, com histórico).
   - Acionar a pedido (gerente, `reserve_order_item`): reserva N montados para um item de um pedido em andamento; a reserva passa na frente da repartição automática; não excede o que o pedido precisa nem o livre (descontadas as reservas de outros pedidos); 0 libera; fica no registro do pedido. Editar o pedido mantém a reserva (limitada à nova quantidade). Pedido cancelado/concluído libera a reserva; os montados de pedido cancelado continuam no estoque.
   - Repartição automática confirmada por teste: 100 montados para pedidos de 50, 40 e 30 = 50, 40 e 10 (mais antigo primeiro).
   - Pedidos: botão (ícone de documento) antes do nome do produto abre o guia de montagem (peças, passos e Registrar montagem). Badge "N reservados" na linha.
   - Produtos: busca por nome, código (referência) ou categoria. Pedidos: seleção de produto no formulário continua por lista (não tem busca).
   - Testado: 17 verificações SQL novas (banco novo, migrado, migração repetida) + 41 anteriores; 23 de tela novas (Montados) + regressão 59/26/22/26/23; testes de lógica (distribuição e reserva). NÃO testado em Supabase real.
   - STATUS: entregue em 22/10/2026, aguardando rodar a migração 7 e publicar os arquivos.

11. Várias fotos por produto, Movimentações, menu em grupos, tela Hoje e últimos 5 pedidos (pedido de 22/10/2026). Exige `supabase/migracao-8-fotos-desmontagem.sql` ANTES de publicar os arquivos novos (e as imagens novas em `img/demo/`).
   - Fotos: cada produto aceita até 6 fotos (`products.photos`; a primeira é a principal). Carrossel no Mostruário e em Produtos: clique no terço direito = próxima, terço esquerdo = anterior (volta ao início/fim), centro = ampliar; pontinhos mostram a posição. Ampliada: setas, miniaturas, Adicionar foto, Tornar principal, Remover esta foto. Pode ser uma foto de medidas. Peças seguem com foto única. Estoque fictício agora traz 3 fotos por produto (montado, detalhe, medidas): para o banco online, "Remover" e "Carregar" o estoque fictício de novo.
   - Aba Movimentações (substitui Histórico): uma página só; zona 1 Produtos (montagem, pedido finalizado, venda direta, desmontagem, ajuste; filtros por tipo) e zona 2 Peças (antigo Histórico, com Estornar). Botão lateral fixo (Produtos / Peças) rola até o início de cada zona. Funcionário não vê observações.
   - Montados: "Ajustar" virou "Movimentar" com 4 opções: Entraram, Venda direta (sem motivo obrigatório), Desmontar (as peças da ficha técnica voltam ao estoque; lançadas como entrada com origem "desmontagem", sem estorno) e Perda/correção (motivo obrigatório). RPCs `adjust_ready(p_kind)` e `unassemble_product`.
   - Menu em dois níveis: Hoje · Mostruário · Estoque (Peças, Recebimento, Reposição, Conferência) · Produção (Produtos, Montados, Simulação) · Pedidos · Movimentações · Gerência (Financeiro, Planilhas, Usuários; só gerente). Cada grupo lembra a última tela aberta.
   - Tela Hoje (entrada do sistema): funcionário vê 3 botões grandes (Receber mercadoria, Montar produto, Contar estoque) e a lista do que ainda precisa ser montado (pedidos em andamento menos montados), com Guia e Montar; gerente vê pendências (recebimentos a autorizar, pedidos prontos para finalizar, contagens a aprovar, peças com estoque baixo, ou "Tudo em dia") e atalhos.
   - Pedidos: faixa "Últimos 5 pedidos" no topo (número, o que foi pedido, pedido em, situação, finalizado em); cliente só para o gerente.
   - Testado: SQL da migração 8 (banco novo, migrado 2→8, repetida); e2e 60/26/22/26/23/23 + carrossel 22 + navegação/Hoje/Movimentações 34. NÃO testado em Supabase real.
   - STATUS: entregue em 22/10/2026, aguardando rodar a migração 8 e publicar os arquivos.

12. Visual novo: menu lateral, tema claro/escuro, calendário e prazo de entrega (pedido de 19/11/2026, inspirado em template comercial, sem copiar código dele). Exige `supabase/migracao-9-prazo-pedidos.sql` (compatível com o site antigo: pode rodar antes ou depois de publicar, mas rode).
   - Casca: menu lateral fixo à esquerda (gradiente verde-azulado), botão para recolher só em ícones (lembrado no navegador, chave `mb:menu`), gaveta no celular, painel do perfil + Sair no pé do menu; topo fino com caminho (ex.: Estoque > Peças), botão de tema e selo Demonstração. As subabas (Peças/Recebimento/…) viram pílulas abaixo do topo.
   - Tema claro/escuro: botão no topo, escolha lembrada (`mb:tema`), segue o aparelho na primeira vez. Cores em variáveis no `:root` e `:root[data-theme="dark"]` do css/style.css.
   - Efeitos: item ativo do menu com barra luminosa e destaque; elevação ao passar o mouse (botões, cartões clicáveis, chips, dias do calendário); "onda" no clique; respeita "reduzir movimento" do sistema.
   - Menu (8 grupos): Hoje · Calendário · Mostruário · Estoque · Produção · Pedidos · Movimentações · Gerência.
   - Calendário (js/views-calendar.js): mês com cada pedido numa cor (● pedido feito, ⚑ entrega, ✓ finalizado); clicar no dia lista o que há nele; à direita, "Andamento dos pedidos" com barra de montados e quanto falta para a entrega (atrasado / em N dias). Funcionário vê sem nome de cliente. A tela Hoje ganhou "Próximas entregas".
   - Prazo de entrega: campo opcional no pedido (`orders.due_date`; RPCs create_order/edit_order com `p_due`, list_orders devolve `due_date`). Pedidos de demonstração têm datas relativas a hoje.
   - Ainda não existe: previsão de chegada de fornecedor (o Recebimento registra só o que já chegou). Sugestão: pedido de compra com previsão, para entrar no calendário.
   - Testado: SQL da migração 9 (banco novo, migrado do 8, repetida; funcionário não vê cliente); e2e novo de menu/tema/calendário/prazo/celular 46 verificações + regressão 14; testes de lógica e planilhas. NÃO testado em Supabase real (o banco de produção estava na migração 8, sem due_date, quando conferido em 19/11/2026).
   - STATUS: entregue em 19/11/2026, aguardando rodar a migração 9 e publicar os arquivos.

### Loja online, contas de cliente e segurança/LGPD (19/11/2026)
- Pedido: catálogo público de demonstração com cadastro de clientes (PF/PJ, validação de CPF/CNPJ, busca de CEP, cadastro aberto) e solicitações que chegam ao sistema; aba Catálogo para o gerente marcar itens e precificar (padrão "Sob consulta"); checklist de segurança e LGPD.
- Feito: migração 10 (papel "cliente", clientes, consentimentos, catálogo, solicitações, auditoria, limite de tentativas, exportar/excluir dados, 2 etapas exigida pelo servidor); loja.html/js; abas Loja online e Auditoria; 2FA TOTP; CSP e cabeçalhos no vercel.json; páginas privacidade/termos/cookies (rascunhos); docs/seguranca-lgpd.md.
- Testes: 126 de banco, e2e 46 + 14 (equipe) + 40 (loja) + 31 (abas do gerente e 2FA), teste de XSS. NÃO testado em Supabase real; migração 10 ainda não aplicada em produção.
- Decisões do dono: Supabase Pro adiado (backup segue manual); Dependabot ligado; cadastro aberto sem aprovação.
- Pendências: preencher company.js; ajustes no painel do Supabase; revisão jurídica; pentest formal; backup automático; limite do catálogo anônimo.

## Pendências / próximos passos
- Identidade visual da empresa: o usuário vai buscar catálogo/logo (previsto para 16/10) para personalizar cores, logo e rodapé.
- Habilidade "designer-mb-metais" salva (10 ideias de visual/cores/estrutura); aplicar quando a logo chegar.
- Enviar uma planilha Excel real da empresa para ajustar a importação.
- Cadastrar peças, fichas técnicas e fotos reais.
- Backup: o plano gratuito do Supabase não faz backup automático; exportar o Excel com valores toda semana.
- Código de barras pela câmera e etiquetas imprimíveis (segunda etapa do recebimento).
- Próximo lote do programador (sugestão): P7 relatórios, P8 código de barras, P10 PWA (P3 pedidos, P4 guia, P6 produto pronto e P9 auditoria: feitos em 22/10).
- Ideias para discutir com o consultor: conferência de estoque (contagem), guia de montagem para o funcionário, alerta de reposição, relatórios por período, estoque de produto acabado, status do pedido (concluído / saiu para entrega).

## Lições aprendidas
- O ambiente de trabalho do Claude pode ser reiniciado e perder os arquivos; a fonte de verdade é o repositório GitHub (SamuelVieiraN/MB-Metais) e este Project. O conector do Supabase está ligado (somente leitura/consulta por padrão; mudanças em produção só com aval do dono).
- Fotos do estoque fictício são ilustrações geradas por código; trocar por fotos reais dos produtos (botão da câmera no card) quando houver.
- Ordem de atualização quando há mudança no banco: rodar a migração no Supabase E publicar os arquivos do site. Se um dos dois ficar para trás, o site mostra erro (ex.: "permission denied for table movements").
- Ao subir arquivos no GitHub, conferir o endereço da pasta: arquivos JS vão em `js/`, SQL em `supabase/`. Na 3ª atualização eles foram parar na raiz e o site seguiu usando os antigos; foi corrigido movendo para as pastas certas.
- O `estoque-torneiras.zip` na raiz do repositório não é usado pelo site e pode ser apagado.

## Limites conhecidos
- O schema foi testado em PostgreSQL 16 com simulador do Supabase (64 verificações), não em um Supabase de teste separado.
- Modo demonstração: senhas de teste estão no código público; dados só no navegador.
- Habilidade "consultor-mb-metais" proposta para dar ideias e críticas (salvar no cartão da conversa).
