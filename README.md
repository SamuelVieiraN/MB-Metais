# Estoque & Montagem

Sistema para controlar o estoque de peças de torneiras, duchas e acessórios e calcular quanto dá para montar de cada produto final.

Esta é a **versão 1**: roda direto no navegador, sem instalar nada, com dados de exemplo.

## O que já funciona

| Aba | Para que serve |
| --- | --- |
| **Mostruário** | Cards com quanto dá para montar de cada produto, qual peça limita e alertas de estoque baixo. |
| **Peças** | Estoque atual, mínimo, entradas e saídas. |
| **Produtos** | Ficha técnica de cada produto (quais peças e quantas) e registro de montagem, que desconta as peças do estoque. |
| **Simulação** | Você digita quanto quer montar de cada produto e vê, ao vivo, o consumo de peças, o que sobra, o que falta e quanto ainda dá para montar depois. Nada muda no estoque até você registrar. |
| **Histórico** | Todas as entradas, saídas e consumos de montagem. |
| **Financeiro** | Custo, preço, lucro e margem por produto, e dinheiro parado em estoque. Só para gerência. |

### Perfis

- **Gerente:** vê tudo, inclusive custos, preços e margens; cadastra e edita peças e produtos.
- **Funcionário:** vê mostruário, peças, produtos, simulação e histórico **sem nenhum valor em reais**; registra entradas, saídas e montagens.

### Como o custo é calculado

O custo de um produto é a soma de `quantidade × custo da peça` da ficha técnica. Quando você registra uma entrada informando o custo da compra, o custo da peça vira a **média ponderada** entre o estoque atual e a compra.

## Limitações desta versão (importante)

- **Os dados ficam só no navegador** de quem está usando. Outro computador ou celular não vê os mesmos dados. Use *Exportar backup* no rodapé para guardar uma cópia.
- **A troca de perfil no topo é uma demonstração.** Qualquer pessoa pode trocar para Gerente, então isso **não protege** os valores financeiros de verdade. A proteção real exige login e banco de dados online (próximo passo abaixo).
- Não há controle de estoque de produto acabado: a montagem consome peças e fica registrada no histórico, mas não soma "unidades prontas".

## Como rodar no seu computador

1. Instale o [VS Code](https://code.visualstudio.com/).
2. Abra esta pasta no VS Code (`Arquivo > Abrir Pasta`).
3. Instale a extensão **Live Server**, clique com o botão direito em `index.html` e escolha **Open with Live Server**. (Também funciona dando duplo clique em `index.html`.)

### Testes das regras de cálculo

Com o [Node.js](https://nodejs.org/) instalado:

```bash
node tests/logic.test.js
```

Deve aparecer `Todos os testes passaram.`

## Como colocar no GitHub

1. No GitHub, crie um repositório novo (sem README, sem .gitignore).
2. Na pasta do projeto, no terminal do VS Code:

```bash
git init
git add .
git commit -m "Primeira versão do sistema de estoque"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/NOME-DO-REPOSITORIO.git
git push -u origin main
```

Depois, a cada ajuste: `git add .`, `git commit -m "o que mudou"` e `git push`.

## Como publicar na Vercel

1. Entre em [vercel.com](https://vercel.com) com sua conta do GitHub.
2. **Add New > Project** e escolha o repositório.
3. Em **Framework Preset**, deixe **Other**. Não precisa de comando de build.
4. Clique em **Deploy**. Você recebe um link público; a cada `git push`, a Vercel atualiza o site sozinha.

## Estrutura

```
index.html        página única
css/style.css     visual
js/data.js        dados de exemplo (peças, produtos)
js/logic.js       regras de cálculo (produção máxima, custo, margem, simulação)
js/app.js         telas e interações
tests/            testes das regras de cálculo
```

## Próximos passos sugeridos

1. **Login e banco de dados online (Supabase):** dados compartilhados entre todos e perfis de verdade, com os valores financeiros protegidos no servidor.
2. **Migrar para Next.js** quando o login entrar, reaproveitando `logic.js` e o visual.
3. Estoque de produto acabado, importação de peças por planilha, e relatórios por período.
