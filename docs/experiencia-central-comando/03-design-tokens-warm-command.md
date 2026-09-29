# Design Tokens: Central de comando / Warm Command

Estrutura baseada em `references/design-tokens-template.md`. Especifica somente decisões necessárias ao recurso; a fonte de verdade futura permanece nas CSS variables e no `@theme` Tailwind v4 existentes.

## Overview

**Purpose:** evoluir a identidade Warm Command para leitura executiva, confiança e decisão, preservando reconhecimento e primitivos atuais.

**Theme Support:** claro + escuro, com preferência salva; ambos são critérios de aceite.

**CSS Strategy:** CSS variables semânticas + `@theme inline` do Tailwind v4. Não criar `tailwind.config` legado. Tokens exclusivos do app devem ser isolados quando uma alteração afetar landing/chat. O admin mantém seu tema operacional existente.

## Colors

### Brand Colors

Não criar nova escala decorativa. Reutilizar os valores existentes como âncoras:

```typescript
const commandBrand = {
  light: { primary: '#e24a00', primaryForeground: '#ffffff' },
  dark: { primary: '#ff7a1a', primaryForeground: '#131212' },
  gradient: { from: '#fe2204', to: '#fe7200' },
};
```

O gradiente fica reservado à marca e ação principal; não codifica estado, confiança, progresso ou severidade.

### Semantic Colors

```typescript
const commandSemantic = {
  background: 'var(--background)',
  surface: 'var(--card)',
  foreground: 'var(--foreground)',
  mutedForeground: 'var(--muted-foreground)',
  border: 'var(--border)',
  focus: 'var(--ring)',
  action: 'var(--primary)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--info)',
};
```

| Papel | Uso | Regra |
|---|---|---|
| `background` | página | fundo quente existente |
| `card` | superfícies de leitura | borda discreta; não depender de sombra |
| `primary` | ação principal e foco de marca | no máximo uma ação principal por card |
| `success` | efeito confirmado/estado saudável | nunca significa causalidade ou objetivo atingido por si só |
| `warning` | parcial, antigo, atenção | sempre com texto e data/limitação |
| `danger` | falha, risco destrutivo | não usar para mera prioridade alta |
| `info` | contexto neutro/inferência | não confundir com dado observado |
| `muted` | apoio/metadados | contraste validado, nunca para informação decisória pequena |

### Evidence roles

Evidência não ganha cor exclusiva como significado. Usar rótulo + ícone opcional:

```typescript
const evidenceRoles = {
  observed: { label: 'Observado na fonte', tone: 'neutral' },
  reported: { label: 'Relatado por pessoa', tone: 'info' },
  inferred: { label: 'Inferência da Tactia', tone: 'warning' },
  estimate: { label: 'Estimativa', tone: 'warning' },
  suggestion: { label: 'Sugestão', tone: 'info' },
};
```

### Availability roles

| Estado | Rótulo obrigatório | Tom sugerido |
|---|---|---|
| `ready` | Atualizado / disponível | neutral ou success conforme contexto |
| `empty` | Sem dados disponíveis | neutral |
| `partial` | Dados parciais | warning |
| `stale` | Dados até [data] | warning |
| `error` | Não foi possível atualizar | danger |
| zero válido | Valor `0` + cobertura | neutral |

### Dark Mode Overrides

Usar as variáveis existentes (`#131212` background, `#1c1b1a` card, `#f4efea` foreground, `#2e2c2b` border). Nenhum valor claro hard-coded dentro de componente. Validar contraste por combinação real, especialmente primary/foreground, muted, badges e gráficos.

## Typography

### Font Families

```typescript
const fontFamily = {
  sans: 'IBM Plex Sans, ui-sans-serif, system-ui, sans-serif',
  display: 'Fraunces, ui-serif, Georgia, serif',
};
```

- IBM Plex Sans: operação, corpo, rótulos, números e controles.
- Fraunces: `h1` e títulos executivos selecionados; não em tabelas, status ou texto denso.
- Números comparativos: `font-variant-numeric: tabular-nums`.

### Font Sizes

```typescript
const commandType = {
  metadata: ['0.75rem', '1rem'],      // 12/16, somente não essencial
  auxiliary: ['0.875rem', '1.25rem'],// 14/20
  body: ['1rem', '1.5rem'],           // 16/24
  section: ['1.25rem', '1.75rem'],    // 20/28; até 24/32
  pageMobile: ['1.75rem', '2rem'],    // 28/32
  pageDesktop: ['2rem', '2.25rem'],   // 32/36
};
```

Pesos: 400 corpo, 500 ênfase/controle, 600 somente quando a hierarquia exigir. Evitar bold generalizado. Prosa com máximo de 68 caracteres por linha.

## Spacing

Base 4px, utilizando escala já disponível:

```typescript
const commandSpacing = {
  inlineTight: '0.5rem',  // 8
  inline: '0.75rem',      // 12
  blockCompact: '1rem',   // 16
  block: '1.25rem',       // 20
  card: '1rem–1.5rem',    // 16–24
  section: '1.5rem–2rem', // 24–32
  pageMobile: '1rem',     // 16
  pageDesktop: '2rem',    // 32
};
```

Relações semânticas ficam mais próximas que seções. Não aumentar whitespace a ponto de esconder a próxima decisão no celular.

## Border Radius

```typescript
const commandRadius = {
  base: '0.625rem', // 10px, token atual
  small: 'calc(var(--radius) * 0.8)',
  large: 'calc(var(--radius) * 1.4)',
  full: '9999px',
};
```

Base para cards e controles. Full apenas para badges/chips, nunca para grandes superfícies.

## Shadows

- Cards no fluxo normal: sem sombra; borda cria separação.
- Painéis/Dialog/Sheet: elevação discreta apenas para sobreposição.
- Hover: mudança sutil de borda/1px; não deslocar conteúdo decisório de forma perceptível.
- Não usar glow para confiança, IA ou estado.

## Z-Index Layers

```typescript
const layers = {
  base: 0,
  sticky: 30,
  sidebar: 40,
  modalBackdrop: 45,
  modal: 50,
  popover: 60,
  toast: 70,
  skipLink: 80,
};
```

Foco não pode ficar encoberto por cabeçalhos/painéis; skip link permanece acima de overlays normais.

## Breakpoints

```typescript
const commandScreens = {
  mobileAcceptance: '360px',
  sm: '640px',
  tabletAcceptance: '768px',
  lg: '1024px',
  desktopAcceptance: '1280px',
};

const commandContainer = {
  max: '1280px',
  prose: '68ch',
  mobileGutter: '16px',
  desktopGutter: '32px',
};
```

- `<640`: uma coluna; detalhes/conversa em tela inteira.
- `640–1023`: 1–2 colunas conforme legibilidade, não por obrigação de preencher grade.
- `≥1024`: principal + apoio sob demanda.
- 360/768/1280 são viewports obrigatórios de verificação visual e funcional.

## Animations

### Durations and timing

```typescript
const commandMotion = {
  feedback: '120–180ms',
  panel: '180–240ms',
  easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
};
```

| Trigger | Animation | Limite |
|---|---|---|
| Hover/focus/press | cor, borda, opacidade, translate 1px no press | 120–180ms |
| Panel enter/exit | fade + deslocamento curto | até 240ms |
| Async update | realce curto, sem pulse contínuo | até 180ms |
| Skeleton | discreto; dimensão estável | sem sugerir progresso falso |

`prefers-reduced-motion: reduce` reduz a 0.01ms e remove repetições, seguindo o comportamento global. Nenhuma animação contínua na operação.

## Interaction and feedback

- Alvo de toque interno: 44×44px para ações primárias e ícones isolados importantes.
- Foco: outline de 2px com offset de 2px via `--ring`; não remover.
- Loading: mantém rótulo/contexto e usa `aria-busy`; não trocar toda a superfície por spinner.
- Disabled: somente quando a ação existe mas está temporariamente indisponível; explicar motivo. Se capacidade não existe, omitir controle e mostrar limitação.
- Risco: alcance legível antes da confirmação; confirmação não depende de cor.
- Toast: confirma evento global; erro/limitação contextual permanece junto ao conteúdo.

## Charts

- Título responde uma pergunta; unidade e período no cabeçalho.
- Alvo e comparação só aparecem quando compatíveis.
- Paleta semântica não substitui rótulos/séries.
- Tabela acessível equivalente é obrigatória.
- Empty/partial/stale/error ficam fora da área de plotagem com explicação; zero válido pode ser plotado.
- Não usar área verde para sugerir causalidade ou “ganho da Tactia”.

## Admin / EvidenceGapQueue

O componente de Ops usa as variáveis próprias de `apps/admin`: fundo frio, âmbar operacional, IBM Plex Sans/Mono e raio de 6px. Reutiliza papéis semânticos (success/warning/danger/info), mas não importa cores, Fraunces, raio ou gradiente do app. Contratos de disponibilidade/evidência podem ser compartilhados; tokens visuais, não.

## Implementation Notes

**For Engineering Agents:**
- Usar nomes semânticos (`bg-background`, `text-muted-foreground`, `border-border`) e CSS variables, não hex no componente.
- Manter Tailwind v4 e `@theme`; não gerar configuração v3.
- Avaliar consumidores de primitivos antes de qualquer mudança global.
- Verificar temas e 360/768/1280px; incluir zoom 200%/400% conforme contexto.

**Accessibility:**
- WCAG 2.2 AA: texto normal ≥4.5:1; texto grande e componentes ≥3:1; foco visível e não encoberto.
- Estado, tendência, evidência e severidade nunca apenas por cor.
- Headings/listas/tabelas semânticos; live regions resumidas.
- Testes de contraste devem usar valores finais nos dois temas, não somente tokens isolados.