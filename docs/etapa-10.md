# Etapa 10 — Insights v2 (causa, impacto, drivers)

**Status:** concluída
**Data:** 2026-09-09
**Depende de:** [Etapa 9](./etapa-9.md)

Substitui insights superficiais por achados com causa, impacto em R$ e
contribuidores. O LLM não calcula: só interpreta o que regras e tools devolvem.

## Entregue

- Schema Insight v2: `entityType/entityId`, `impactAmount`, `confidence`,
  `score`, `fingerprint`, `drivers`, `autoResolvedAt`, `dismissReason`.
- `variance-decomposition.ts`, `scoring.ts`, regras pluggable em
  `packages/intelligence/src/rules/`.
- Regras novas: margem, desconto, cancelamento, mensagens sem resposta, dados
  velhos, churn por cadência, lead quente parado, concentração e cruzadas.
- RecommendationEngine com drivers, `estimatedImpact` e `suggestedAction`.
- Chat analítico: dois modelos (`LLM_MODEL` / `LLM_CLASSIFIER_MODEL`), prompt
  com fato → causa → impacto → ação, tools `compare_periods`, `explain_change`,
  `get_trend`, `get_insight_detail`, `get_customer_voice`.
- UI: card de insight com impacto, top 3 drivers, “Perguntar no chat” e
  dispensa com motivo.

## Como testar

```bash
pnpm --filter @tactia/intelligence test
pnpm --filter @tactia/ai test
```

No dashboard, rode a análise e confira impacto + causas no card. No chat,
pergunte “por que a receita caiu?” e verifique `explain_change` nas fontes.
