# Browser Automation Runtime

O Browser Agent executa tarefas sob demanda em perfis configurados pelo operador no BKO. O web enfileira `browser.task`, o worker usa este runtime privado, e o cartão da conversa consulta o status e os artefatos. Perfis, sessões, tarefas, aprovações e logs ficam no banco; arquivos ficam no storage configurado.

## Desenvolvimento local

1. Aplique as migrações e gere o Prisma Client.
2. Configure `ENCRYPTION_KEY`, LLM e storage no web. Defina `JOBS_ENABLED=true`, `BROWSER_RUNTIME_URL=http://127.0.0.1:8765` e use exatamente o mesmo `BROWSER_RUNTIME_TOKEN` no Web, no runtime e no proxy de egress. Tokens diferentes fazem a criação da sessão falhar com `BROWSER_RUNTIME_UNAUTHORIZED`.
3. Inicie os containers usando a configuração do Web como último arquivo de ambiente: `docker compose -f docker/docker-compose.yml --profile browser-automation --env-file .env --env-file apps/web/.env.local up -d --build browser-runtime-gateway browser-runtime browser-egress browser-test`.
4. Inicie o web e seu worker com a configuração usual do projeto. No BKO, crie um perfil com URL `http://browser-test:8080/`, domínio `browser-test` e credencial `financeiro@example.com` / `browser-test-password`. A opção `BROWSER_TEST_LOCAL=true` libera HTTP apenas neste ambiente de teste.
5. Peça no chat: “Entre no ERP, gere o relatório de ontem e retorne o CSV”. O resultado chega no cartão da mesma conversa.

Para testar o navegador sem LLM ou banco, execute `docker exec docker-browser-runtime-1 python /app/tests/smoke.py`. O teste cobre login, SPA, filtro, espera, extração, download, screenshot, persistência e restauração da sessão.

Em produção, o web e o runtime compartilham somente a rede interna `browser_control`; o runtime sai para domínios aprovados pelo proxy `browser-egress`. Configure `BROWSER_RUNTIME_TOKEN` com um segredo forte e mantenha `BROWSER_TEST_LOCAL` desligado. O gateway e o ERP de teste existem apenas no Compose de desenvolvimento.
