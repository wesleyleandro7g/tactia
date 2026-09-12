# Etapa 14 — Confiança (Onda 1)

**Status:** concluída
**Data:** 2026-09-11
**Depende de:** [Etapa 13](./etapa-13.md)
**Spec:** seções 3.4, 34, 41–45, 47, 48, 58
**Plano:** [onda-1-confianca.md](./onda-1-confianca.md)

Fecha o contrato de confiança do chat: números só passam com evidência,
conteúdo importado não vira instrução, PII não entra em log, e `viewer`
não vê tools mutáveis.

## Entregue

- Números compartilhados em `packages/domain/src/ai-safety/numbers.ts`.
  Briefing e orchestrator importam o mesmo módulo (`extractNumberTokens`,
  `canonicalizeNumber`, `unsourcedNumbers`, `buildClaimAllowlist`).
- Guardrail `claim_mismatch` no `Orchestrator.finalize()`: allowlist de
  `sources` + métricas do contexto; fallback pt-BR sem número.
- Envelope `<untrusted origin="user|tool|fact|briefing">` + sanitização
  de frases de injeção (`[instrução-removida]`).
- `redactSensitive` (CPF, CNPJ, PAN, `sk-`, Bearer) em logs e em
  `executed[].input`. E-mail e telefone permanecem no payload do LLM.
- `Tool.minRole`: `propose_action` e `remember_fact` exigem `member`.
  `definitions(role)` omite; `execute` recusa com `AUTHORIZATION_ERROR`.
- Evals determinísticos em `packages/ai/src/__evals__/` (`MockLLMAdapter`,
  sem rede). Pilot-flow passos 10–12 permanece.
- `logChatTurn` com `tool_names` e `guardrail`, sem `content`.
- Ajuste no piloto: `calculateBulk` deixa de exigir exatamente 7 métricas
  (o catálogo cresceu nas etapas 10–13).

## Decisões

- O regex de milhar exige pelo menos um grupo `.000`, senão `1500` virava
  os tokens `150` e `0` e disparava mismatch falso.
- Retry do briefing **não** foi replicado no chat: mismatch substitui a
  resposta pelo fallback.
- `definitions()` sem role continua listando todas as tools (testes
  antigos); o orchestrator sempre passa `request.ctx.role`.

## Como testar

```bash
pnpm --filter @tactia/ai test
pnpm --filter @tactia/shared test
pnpm --filter @tactia/domain exec vitest run src/__tests__/ai-safety.test.ts
# Grep dos casos nomeados:
rg "E14:" packages --glob '*.test.ts'
```

## Pendências

- Banda de tolerância 0,5% em números (fora desta etapa).
- Anos soltos (`2026`) em prosa ainda podem disparar `claim_mismatch`
  se não estiverem na allowlist — mesmo limite do briefing.
- `pnpm lint` no monorepo já falhava antes desta etapa (unused vars em
  intelligence/domain/ai, `react-hooks/set-state-in-effect` no web).
