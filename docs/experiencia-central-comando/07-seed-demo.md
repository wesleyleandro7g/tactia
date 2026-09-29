# Dados de demonstração da Central de Comando

O seed padrão de `apps/web` agora inclui um cenário da Central de Comando na
empresa `empresa-demo`. Ele é **sintético** e pode ser repetido sem duplicar
objetivo, plano, fonte, recomendação ou lacuna.

Para gerar no banco de testes já migrado:

```bash
DATABASE_URL=postgresql://tactia:tactia@localhost:5433/tactia_test \
  pnpm --filter @tactia/web seed
```

O comando web carrega `apps/web/.env.local` antes de importar autenticação e
banco. Variáveis exportadas no shell, como `DATABASE_URL` acima, prevalecem.

Este comando foi executado somente em `tactia_test` em 29/09/2026. Não execute
contra desenvolvimento ou produção sem conferir o `DATABASE_URL` e o propósito
do ambiente. O seed existente cria `owner@demo.tactia` com a senha de
demonstração definida em `apps/web/scripts/seed.ts`; ela não é uma credencial
para ambientes reais. Para entrar no Ops, o bootstrap de operador continua
separado:

```bash
pnpm --filter @tactia/admin seed
```

O script do Ops carrega `apps/admin/.env.local` com a mesma precedência do Next.
Defina nele `DATABASE_URL`, `ADMIN_AUTH_SECRET`,
`TACTIA_BOOTSTRAP_OPERATOR_EMAIL` e `TACTIA_BOOTSTRAP_OPERATOR_PASSWORD` antes
de executar o comando. Variáveis exportadas no shell prevalecem sobre o arquivo;
confira o banco de destino antes do bootstrap. A conta criada é um operador de
alto privilégio, então use credenciais próprias de cada ambiente.

O cenário contém:

- empresa com Central habilitada, salvo quando um operador já registrou
  `false` explicitamente;
- fonte ativa `Vendas sintéticas (seed)` e vendas canônicas sintéticas;
- objetivo mensal ativo, com baseline do mês anterior quando há cobertura;
- plano ativo com ação `create_task` preparada, duas etapas e medição de
  receita total pela métrica existente;
- revisão automática com observado calculado dos registros; `null` continua
  representando indisponibilidade;
- recomendação pendente para a carteira sem compra recente e uma lacuna de
  cobertura de contatos para a fila Ops.

A fonte está marcada como **referência prevista**, e a atribuição informa que
a receita total não isola clientes contatados nem prova causalidade. O seed não
executa ações externas nem aprova decisões.

Resultado da execução e repetição em `tactia_test`: 200 clientes, 941 vendas,
2 objetivos (um do seed legado), 1 plano, 1 definição e 1 revisão de medição,
1 recomendação, 1 lacuna e 1 fonte. O teste
`command-center-seed.test.ts` verifica idempotência, resultado observado e
respeito à flag `false` explícita.
