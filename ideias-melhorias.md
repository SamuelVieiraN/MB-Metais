# 20 ideias para melhorar o sistema (15/10/2026)

Esforço: P = pequeno (horas), M = médio (1–2 dias), G = grande (vários dias).
Regra de todas as ideias: o funcionário nunca vê valores em reais; isso é garantido no servidor.

## Programador — 10 ideias (por impacto)
1. ✅ **Conferência de estoque (inventário)** [M] — FEITO 15/10 (aba Conferência) — — O funcionário conta peça por peça no celular; o sistema mostra a diferença para o estoque; o gerente aprova o ajuste. Resolve o "bater o estoque".
2. ✅ **Lista de compras / reposição** [P-M] — FEITO 15/10 (aba Reposição) — — Peças abaixo do mínimo e o que falta para produzir uma meta (ex.: 50 do produto X). Exporta em Excel para mandar ao fornecedor.
3. ✅ **Pedidos com status** [G] — FEITO 22/10 (aba Pedidos; sem etapa "saiu para entrega" separada: finalizar = baixa) — Pedido com itens e status (separando, montando, saiu para entrega) com data e hora; baixa automática do estoque. Registra o "saiu para entrega".
4. ✅ **Guia de montagem para o funcionário** [M] — FEITO 22/10 (botão Guia de montagem nos Produtos) — Passo a passo por produto, com foto e checklist de peças; botão "montei" que dá baixa.
5. ✅ **Estorno de lançamento errado** [P] — FEITO 15/10 (Histórico) — — Desfazer uma entrada/saída lançada por engano (gerente), registrando o estorno no histórico em vez de apagar.
6. ✅ **Estoque de produto acabado** [M] — FEITO 22/10 ("montados/prontos" nos Produtos) — Hoje a montagem só consome peças. Passar a contar quantas unidades prontas existem e baixar na venda/entrega.
7. **Relatórios por período (gerente)** [M] — Consumo de peças, saídas, peças paradas, margem por produto, comparação mês a mês.
8. **Leitura de código de barras / QR pela câmera** [M] — Achar a peça ou dar baixa lendo a etiqueta; etiquetas impressas pelo próprio sistema.
9. ✅ **Auditoria e alertas de custo** [P-M] — FEITO 22/10 (Financeiro) — Registrar quem mudou custo/preço e quando; avisar se um custo subir além de um limite.
10. **Aplicativo instalável no celular (PWA)** [P-M] — Ícone na tela inicial e abertura rápida; modo de leitura sem internet.

### Críticas / riscos que apareceram
- O plano gratuito do Supabase **pausa o projeto após cerca de 1 semana sem uso** e **não faz backup automático**. Antes de usar em produção: exportar Excel semanal com valores e avaliar plano pago.
- A senha do gerente é a chave de tudo: usar senha forte e, se possível, ativar verificação em duas etapas no Supabase e no GitHub.
- Ainda não testado em Supabase de teste separado; tratar o primeiro mês como período de acompanhamento.

## Designer — 10 ideias (por impacto)
1. **Identidade da empresa** [P] — Logo no topo, no login e no rodapé; paleta de cores tirada da logo/catálogo; ícone da aba do navegador.
2. **Mostruário em estilo vitrine/catálogo** [M] — Cartões maiores com foto grande, nome, código e selo de disponibilidade; modo tela cheia para mostrar a clientes.
3. **Modo balcão para o funcionário** [M] — Botões grandes, alto contraste, letras maiores, ações principais (Entrada, Saída, Montar) sempre à mão.
4. **Navegação no celular** [P-M] — Abas viram barra inferior com ícones, como em apps de banco; polegar alcança tudo.
5. **Painel de início para o gerente** [M] — Faixa de resumo: peças críticas, quanto dá para montar hoje, valor parado em estoque, com mini gráficos discretos.
6. **Semáforo de estoque claro** [P] — Verde/âmbar/vermelho sempre com ícone e texto (não só cor), e barra de estoque versus mínimo em cada peça.
7. **Estados vazios e carregamento amigáveis** [P] — Telas vazias com ilustração simples e próximo passo ("Cadastre a primeira peça"); esqueleto cinza enquanto carrega.
8. **Modo escuro** [M] — Automático conforme o aparelho; bom para galpão e turno da noite.
9. **Tipografia e tabelas** [P] — Fonte da marca, números alinhados, linhas alternadas suaves, cabeçalho de tabela fixo ao rolar.
10. **Micro-interações e impressão** [P-M] — Check animado ao registrar, aviso com "desfazer", transições suaves; folha de montagem e etiquetas imprimíveis com a logo.

## Sugestão de ordem de ataque
1. Quick wins: estorno (P), semáforo (P), estados vazios (P), tipografia/tabelas (P).
2. Quando a logo chegar: identidade (D1).
3. Para o dia a dia: conferência de estoque (P1), lista de compras (P2), modo balcão (D3), barra inferior no celular (D4).
4. Depois: pedidos com status (P3), guia de montagem (P4), estoque de produto acabado (P6).

## Feito em 22/10/2026 (lote 11)
- Menu em grupos + tela Hoje (antes "Painel de início", D5) e atalhos grandes para o funcionário (parte do "modo balcão", D3).
- Movimentações (produtos e peças) e últimos 5 pedidos.
- Várias fotos por produto (catálogo).
- Ideia futura: barra inferior no celular (D4) agora que há só 6–7 grupos; etiqueta/QR por produto que abre o guia.

## Feito em 19/11/2026 (lote 12)
- Menu lateral recolhível, tema claro/escuro, efeitos de hover/clique, painel do perfil, calendário de pedidos com andamento, prazo de entrega no pedido.
- Próximas ideias: previsão de chegada de fornecedores (pedido de compra) no calendário; financeiro do pedido (parcelas, saldo); notificações (atraso de entrega); busca global (Ctrl+K) no topo.
