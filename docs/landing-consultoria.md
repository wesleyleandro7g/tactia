# Landing de consultoria (Astro)

Aplicação independente em `apps/landing` (`@tactia/landing`). A LP e o formulário de `apps/web` continuam disponíveis. A nova página entrega HTML estático, fontes locais e um script pequeno para animações, formulário e eventos de funil.

## Desenvolvimento

Requer Node >=22.12 e pnpm na versão do workspace.

```bash
pnpm install
pnpm --filter @tactia/database generate
# No banco local escolhido, aplique as migrations antes de capturar leads.
pnpm --filter @tactia/database migrate:deploy
pnpm --filter @tactia/web dev
pnpm --filter @tactia/landing dev
```

Abra http://localhost:4321. O proxy local usa `http://localhost:3000`. Para outro backend:

```bash
LANDING_API_ORIGIN=http://localhost:3102 pnpm --filter @tactia/landing dev
```

A variável do proxy é lida pelo processo do Astro; forneça-a no shell. `PUBLIC_SITE_URL` também é lida no build, por exemplo:

```bash
PUBLIC_SITE_URL=https://consultoria.suaempresa.com pnpm --filter @tactia/landing build
pnpm --filter @tactia/landing typecheck
pnpm --filter @tactia/landing lint
```

`astro preview` serve os arquivos estáticos para inspeção, mas não inclui o proxy de desenvolvimento. Para testar a captura em produção, use o container Nginx.

## Captura e compatibilidade

`POST /api/v1/consultation-leads` recebe JSON com `submissionId` (UUID), `name`, `company`, `email`, `whatsapp`, `context` opcional, `website` (honeypot) e `attribution` opcional. A atribuição aceita somente `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, com até 200 caracteres cada.

A resposta segue o envelope existente: `{ data: { received: true }, ... }`. Nenhum dado de contato é retornado. O servidor define `source=landing`, `status=new` e deixa a qualificação desconhecida. A rota antiga mantém seu schema estrito; os registros antigos recebem `source=web` pela migration. O admin mostra a origem e a atribuição, e trata qualificações ausentes como “Não informado”.

O limite compartilhado de aquisição é de cinco tentativas por IP em dez minutos, por processo, conforme a infraestrutura atual. O endpoint limita o corpo lido a 16 KB, valida no servidor, descarta honeypots e usa o UUID para evitar duplicações. O navegador preserva o UUID em tentativas da mesma página; um recarregamento inicia uma nova tentativa. Contatos não são armazenados em localStorage/sessionStorage.

Após salvar, o usuário recebe um link para a agenda atual do Google. Não há iframe ou script do Google na página. Abrir a agenda não confirma uma reunião e não muda o status para `scheduled`. A confirmação continua no Google; o atendimento atualiza o status no admin. Sem JavaScript, há um link alternativo para a agenda (esse caminho não captura previamente no admin).

## Docker e proxy

O Compose de produção inclui o serviço `landing`, servido por Nginx. Configure:

- `LANDING_SITE_URL`: URL pública absoluta, usada no build para canonical e Open Graph. Reconstruir a imagem quando mudar.
- `LANDING_PORT`: porta externa, padrão `3002`.
- `LANDING_API_ORIGIN`: origem interna do backend no Nginx, padrão `http://web:3000`; configurável no container para testes isolados.
- `LANDING_BIND`: interface de escuta, padrão `127.0.0.1`.
- `LANDING_TRUSTED_PROXY`: IP/CIDR exato do proxy TLS visto pelo container; padrão `127.0.0.1`. Nunca usar `0.0.0.0/0`.

```bash
docker compose -f docker/docker-compose.prod.yml --env-file .env.production up -d --build landing
```

Aponte o host da campanha no proxy TLS para `127.0.0.1:3002`. O proxy externo deve substituir cabeçalhos encaminhados pelo cliente e transmitir o IP real em `X-Forwarded-For`. Se o proxy roda no host, o endereço visto pelo container pode ser o gateway da rede Docker; use esse endereço exato em `LANDING_TRUSTED_PROXY`. O Nginx aceita o IP encaminhado apenas do proxy configurado e sobrescreve os cabeçalhos enviados ao backend. Isso evita que o visitante burle o rate limit com `X-Forwarded-For` forjado. Mantenha também o backend protegido pelo proxy da infraestrutura.

O container expõe somente a rota de captura pelo proxy para `web:3000`, fornece `/_health`, revalida HTML e usa cache imutável nos arquivos com hash em `/_astro/`. O upstream usa o DNS interno do Docker para tolerar reinicializações de `web`.

Build isolado:

```bash
docker build -f docker/Dockerfile.landing --build-arg PUBLIC_SITE_URL=https://consultoria.suaempresa.com -t tactia-landing .
```

Nenhuma publicação, mudança de DNS ou reserva real é feita pela implementação.

## Funil e acessibilidade

O navegador emite `CustomEvent('tactia:funnel')` em `window`, com `detail.event` e, para CTA, `detail.location`. Eventos: `cta_click`, `form_start`, `lead_submitted`, `calendar_open`. Não há provedor de analytics instalado, nem transmissão automática desses eventos. Nome, e-mail, telefone, contexto e valores de UTM não são enviados nos eventos.

Integre um coletor autorizado para medir visitantes e abandono. Para reuniões confirmadas, use os status do admin; não substitua essa métrica por cliques na agenda. Compare também o comparecimento, que depende do processo de atendimento.

A página usa landmarks, rótulos, erros vinculados aos campos, foco após sucesso, FAQ nativo e movimento reduzido. O CTA móvel some quando a seção do formulário está visível. O conteúdo permanece disponível sem JavaScript.

## Verificação

```bash
pnpm --filter @tactia/shared test
pnpm --filter @tactia/domain test src/__tests__/acquisition-leads.test.ts
pnpm --filter @tactia/web test
pnpm --filter @tactia/landing typecheck
pnpm --filter @tactia/landing lint
pnpm --filter @tactia/landing build
```

Testes de integração usam `tactia_test`. Validar também o formulário pelo proxy Nginx, dados persistidos no admin, erro de rede e nova tentativa, estado 429, teclado, telas estreitas e `prefers-reduced-motion`. Medir performance sobre o build de produção, não o servidor de desenvolvimento.

## Validação desta entrega — 18/09/2026

- Astro: build estático, checagem de tipos e lint aprovados; imagem Docker construída.
- Testes: 33 em shared, 53 em web e 7 de aquisição no domínio aprovados (93 no total).
- Chrome: larguras de 320, 390, 768 e 1440 px sem overflow ou erros de JavaScript. Captura real via Nginx no banco de testes, UTM persistida, nova tentativa com mesmo UUID, erro 429, navegação por teclado, movimento reduzido e alternativa sem JavaScript verificados. Nenhuma reunião real foi reservada.
- axe (WCAG 2 A/AA e 2.1 AA, com conteúdo visível): zero violações detectadas.
- Lighthouse mobile no container local: Performance 100, Acessibilidade 100, Boas práticas 100, SEO 100; LCP 1,7 s, CLS 0, TBT 0 ms. Resultado de laboratório; hospedagem e rede reais podem mudar as métricas.
- JavaScript próprio: aproximadamente 1,8 KB gzip, sem framework de UI ou scripts de terceiros.
- A migration foi aplicada somente ao banco `tactia_test`. A publicação exige aplicá-la no banco de destino antes de habilitar a nova captura.

A checagem de tipos do admin apontou erros fora desta mudança, em tipos gerados de handlers (`RouteContext`) e em `packages/ai/src/infographics/layout.ts` / `render.ts`. A aplicação Astro e o pacote de domínio passaram nas suas checagens. A verificação global do monorepo não deve ser considerada aprovada até resolver esses erros.
