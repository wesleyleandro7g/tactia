# Etapa 11 — Histórico, baseline, forecast e jobs

**Status:** concluída
**Data:** 2026-09-09
**Depende de:** [Etapa 10](./etapa-10.md)

Dá memória temporal ao motor: snapshots diários, baseline estatístico,
projeção e um ciclo diário confiável.

## Entregue

- `MetricSnapshot` + `SnapshotEngine`/`SnapshotService`: backfill desde a
  primeira venda e recompute dos últimos 3 dias. O pipeline materializa
  snapshots no passo 0.
- `baseline.ts`: média móvel 7/28, z-score, sazonalidade de weekday, YoY,
  dias úteis. Regras disparam no limiar **ou** `|z| ≥ anomalyZScore`.
- `forecast.ts`: sazonalidade × Holt com banda P10/P90. Tool `get_forecast`.
- `PgBossJobQueue` (pg-boss v12). Com `JOBS_ENABLED=true`,
  `intelligence.tick` enfileira `intelligence.daily` às 03:00 no fuso do
  tenant; segundas também geram briefing semanal. Fallback
  `POST /api/v1/intelligence/daily` com `CRON_SECRET`.
- Briefing semanal: fatos determinísticos → LLM narra → rejeita número sem
  fonte. UI `/briefings`, card no dashboard, tool `get_latest_briefing`.

## Como testar

```bash
pnpm --filter @tactia/intelligence test
# JOBS_ENABLED=true no .env; logs: intelligence.tick / intelligence.daily
```
