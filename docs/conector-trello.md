# Conector Trello

O conector Trello importa quadros como uma fonte de dados da Tactia. Ele é somente leitura e suporta vários quadros por fonte, estado atual, histórico de ações, webhooks e reconciliação horária.

## Pré-requisitos

1. Crie um app **sem capacidades de Power-Up** em <https://trello.com/apps/admin>.
2. Na aba OAuth 2.0, escolha cliente **Confidential**, habilite `read:board:trello` e `read:member:trello` e cadastre as URLs de callback do Ops.
3. Configure `TRELLO_OAUTH_CLIENT_ID`, `TRELLO_OAUTH_CLIENT_SECRET` e `TRELLO_OAUTH_REDIRECT_URI` no web e no admin.
4. Configure uma origem HTTPS pública para o app web. O Trello chama o webhook em `POST` e exige que `HEAD` responda `200`.
5. No Tactia Ops, abra a empresa, escolha **Nova fonte → Trello**, clique em **Conectar com Trello**, selecione os quadros e a janela histórica.

Access e refresh tokens são gravados em `Credential.encryptedData` com AES-256-GCM. O navegador recebe apenas o ID não secreto da credencial. O access token é enviado como Bearer e renovado automaticamente antes de expirar ou após um `401`; refresh tokens rotativos são persistidos de forma atômica.

## Variáveis de ambiente

```env
# Configure no apps/admin e no apps/web.
TRELLO_OAUTH_CLIENT_ID=
TRELLO_OAUTH_CLIENT_SECRET=
TRELLO_OAUTH_REDIRECT_URI=https://bko.desencoder.com/api/v1/oauth/trello/callback

# Origem pública do apps/web usada para criar e validar webhooks.
TRELLO_CALLBACK_BASE_URL=https://tactia.desencoder.com

# Opcional para apps públicos que armazenam dados pessoais.
TRELLO_PLUGIN_ID=

# Necessário para reconciliação e compliance automáticos.
JOBS_ENABLED=true
```

Para desenvolvimento, cadastre também `http://localhost:3001/api/v1/oauth/trello/callback` no Trello e use esse valor em `TRELLO_OAUTH_REDIRECT_URI`. O valor enviado no authorize e no token exchange precisa coincidir exatamente com uma callback cadastrada.

A callback OAuth fica no Ops (`bko`); o callback de webhook fica no produto (`tactia`). Ao trocar de domínio, adicione primeiro a callback nova no Trello, publique ambos os domínios durante a transição e só então remova a URL antiga. Access/refresh tokens existentes continuam vinculados ao mesmo Client ID; webhooks precisam ser recriados quando sua URL muda.

A URL pública de webhook precisa corresponder exatamente à URL usada na criação. Alterar domínio, protocolo, porta, path ou parâmetros invalida a assinatura. Em produção use TLS válido na porta 443.

## Dados importados

Os snapshots são mantidos em `RawRecord` com os namespaces:

- `trello:boards`, `trello:lists`, `trello:cards`;
- `trello:members`, `trello:labels`;
- `trello:checklists`, `trello:check_items`;
- `trello:comments`, `trello:actions`, `trello:custom_fields`;
- `trello:webhook` para a inbox idempotente.

A chave externa e o checksum tornam cargas e entregas repetidas idempotentes. Ações recebidas por webhook também são preservadas em `trello:actions`, inclusive tipos que a API histórica não retorna.

Mapeamentos são opcionais. O estado Trello é sincronizado mesmo sem mappings; quando configurados, os recursos também são projetados em `RawRecord` canônico e seguem o normalizador existente. Exemplos úteis são `comments → interaction`, `actions → activity` e `members → seller`.

## Sincronização e webhooks

- A carga manual importa todos os recursos dos quadros selecionados.
- A janela de ações pode ser 30, 90, 180 dias ou todo o histórico.
- Um webhook é criado por quadro. Falhas de criação deixam `webhookStatus: pending`; a reconciliação tenta completar inscrições ausentes.
- O callback verifica `X-Trello-Webhook` em tempo constante sobre `rawBody + callbackURL` antes de fazer parse do JSON.
- Eventos válidos são persistidos antes de disparar o sync incremental.
- O job `trello.reconcile` roda pelo tick horário do pg-boss com singleton por fonte/hora.
- Ao desativar a fonte, a Tactia tenta excluir cada webhook; callbacks posteriores recebem `410 Gone`.

O Trello faz somente três retries por entrega. A reconciliação repara o estado atual após eventos perdidos, mas ações exclusivas de webhook não podem ser reconstruídas se nunca forem entregues.

## Limites e resiliência

O cliente respeita os limites publicados pelo Trello (300 requisições/10 s por key e 100/10 s por token), observa os headers `x-rate-limit-*` e repete `429`, `5xx`, timeout e falhas de rede com exponential backoff. Erros `401 invalid token` não são repetidos indefinidamente e colocam a fonte em `error` para reconexão pelo Ops.

Evite selecionar quadros desnecessários. Recursos aninhados por board são usados para reduzir chamadas; ações são paginadas em lotes de até 1000 com cursor `before`.

## LGPD e retenção

Payloads de ações, comentários e webhooks removem cópias de e-mail, nome completo, username, bio e avatar, preservando member IDs. O perfil do recurso `trello:members` existe para uso explícito e pode ser anonimizado pela rotina de compliance.

Com `TRELLO_PLUGIN_ID`, `TRELLO_OAUTH_CLIENT_ID` e `TRELLO_OAUTH_CLIENT_SECRET`, o job diário `trello.privacy` obtém um token `client_credentials` com `read:client.privacy`, consulta eventos de exclusão, atualização, expiração e revogação e anonimiza os perfis locais encontrados. O mesmo job remove `trello:actions` e `trello:webhook` antigos conforme `historyDays`; snapshots atuais de cards e quadros não são removidos.

## Métricas Kanban

O endpoint Ops da fonte calcula WIP, throughput em 30 dias, cards vencidos/bloqueados, idade média, lead time, cycle time e backflow. As listas são classificadas pela configuração:

```json
{
  "kanban": {
    "inProgressListIds": ["LIST_ID_DOING"],
    "doneListIds": ["LIST_ID_DONE"],
    "blockedListIds": ["LIST_ID_BLOCKED"],
    "windowDays": 30
  }
}
```

Sem `doneListIds`, todos os cards abertos entram no WIP e métricas de conclusão permanecem vazias.

## OAuth 2.0

O Ops usa authorization code com cliente confidencial, `state` vinculado ao operador e tenant e PKCE S256. O verifier fica somente em cookie HttpOnly criptografado, com validade de dez minutos. O callback troca o code no backend e salva access/refresh tokens criptografados.

O authorize solicita `read:board:trello read:member:trello offline_access`. O access token dura cerca de uma hora; o refresh token é single-use e rotativo. A renovação usa compare-and-swap no banco para que dois workers não sobrescrevam o token vencedor. Grants expirados/revogados colocam a fonte em `error`, exigindo nova autorização. Ao desconectar uma fonte Trello, os tokens locais são removidos.
