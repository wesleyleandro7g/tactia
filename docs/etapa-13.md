# Etapa 13 — Finanças, estoque, aquisição e dimensões

**Status:** concluída
**Data:** 2026-09-09
**Depende de:** [Etapa 12](./etapa-12.md)

Fecha o ciclo de dados operacionais: despesa, recebível, estoque e campanha,
com métricas, regras, tools e onboarding.

## Entregue

- Entidades `Expense`, `Payment`, `InventoryLevel`, `Campaign` (schema,
  repos, services, API, normalizer).
- Métricas: `expense_total`, `operating_profit`, `break_even_revenue`,
  `receivables_open`, `overdue_amount`, `dso`.
- Regras: pico de despesa, lucro operacional negativo, inadimplência,
  ruptura, estoque parado, CAC, campanha sem leads.
- Tools: `get_profitability`, `get_cash_flow`, `get_inventory_risk`,
  `get_acquisition`.
- Dimensões `channel` / `region` no MetricEngine e em
  `compare_periods` / `explain_change`. Colunas extras em customer/product/sale/lead.
- Wizard e `docs/onboarding-cliente.md` com as entidades novas. Seed demo
  gera despesas, pagamentos, estoque, campanhas, meta e um fato.

## Como testar

```bash
pnpm --filter @tactia/web exec tsx scripts/seed.ts
# Importar CSVs de expense/payment/inventory_level/campaign em /onboarding
```
