# Etapa 12 — Metas, funil, memória e feedback

**Status:** concluída
**Data:** 2026-09-09
**Depende de:** [Etapa 11](./etapa-11.md)

A Tactia passa a saber o que a empresa quer (metas), o que aconteceu no
funil, o que o dono já sabe (fatos) e quais insights são ruído.

## Entregue

- `Goal` + `/settings/goals` + `get_goals_progress` + regras
  `goal_pace_behind` / `goal_reached`. Metas entram no ContextBuilder.
- Ingestão de lead/activity no normalizer. `LeadStageTransition` no
  `LeadService.update` e no upsert de import. Tool `get_funnel` e regras
  de gargalo / velocidade.
- `BusinessFact` + tools `remember_fact` / `list_business_facts` +
  `/settings/facts`. Fatos no contexto do chat e no `RuleEngine`
  (`isSuppressed`).
- `InsightFeedback` (polegar no card) + `ThresholdCalibrator`: 3+ “não
  útil” afrouxa o limiar em 20% (teto 2× o default); 3+ “útil” mantém.
  Resultado gravado em `TenantSettings.thresholds` e lido pelo pipeline.
- Analytics: `get_cohorts`, `get_rfm`, `simulate` + regras
  `retention_drop` / `champions_at_risk`.

## Como testar

```bash
pnpm --filter @tactia/domain test -- threshold-calibrator
# UI: /settings/goals, /settings/facts, polegar no insight do dashboard
```
