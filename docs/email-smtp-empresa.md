# Envio de e-mails (SMTP) por empresa

A Tactia envia e-mails (ação `send_email`) usando a caixa configurada **por
empresa** no Tactia Ops. Não há caixa global por variável de ambiente: cada
empresa cadastra o próprio provedor e credenciais, guardados criptografados
(AES-256-GCM, mesma `ENCRYPTION_KEY` das demais credenciais).

## Onde configurar

Tactia Ops → **Empresas** → selecione a empresa → aba **Email**.

Campos:

- **Provedor**: Gmail/Google Workspace, Outlook.com, Microsoft 365, Yahoo, Zoho
  ou **SMTP personalizado**.
- **Nome do remetente** (opcional): aparece no cabeçalho `From`.
- **E-mail remetente**: endereço que envia (`From`).
- **Usuário SMTP**: normalmente o mesmo e-mail.
- **Senha**: senha de app do provedor (veja abaixo). Fica criptografada e nunca
  é reexibida — para trocar, basta preencher de novo.
- Para **SMTP personalizado**: **Host**, **Porta** e **Segurança**.

Depois de salvar, use **Enviar e-mail de teste** para validar a conexão
(autentica no servidor via `verify()` e dispara uma mensagem real).

## Provedores e portas

| Provedor        | Host                    | Porta | Segurança            |
| --------------- | ----------------------- | ----- | -------------------- |
| Gmail/Workspace | `smtp.gmail.com`        | 465   | TLS implícito        |
| Outlook.com     | `smtp-mail.outlook.com` | 587   | STARTTLS             |
| Microsoft 365   | `smtp.office365.com`    | 587   | STARTTLS             |
| Yahoo           | `smtp.mail.yahoo.com`   | 465   | TLS implícito        |
| Zoho            | `smtp.zoho.com`         | 465   | TLS implícito        |
| Personalizado   | (informado pelo cliente)| 465/587 | 465 = TLS, 587 = STARTTLS |

Para o SMTP personalizado a regra é: **porta 465 → TLS implícito** (`secure`),
**porta 587 → STARTTLS** (`secure` desligado; a conexão é elevada após o EHLO).

## Senhas de app

Gmail, Outlook, Microsoft 365, Yahoo e Zoho não aceitam a senha da conta no
SMTP quando há verificação em duas etapas (MFA). É preciso gerar uma **senha de
app**:

- **Gmail/Workspace**: ative a verificação em duas etapas e gere em
  _Conta Google → Segurança → Senhas de app_.
- **Outlook/Microsoft 365**: gere em _Segurança da conta → Senhas de app_. No
  Microsoft 365 o envio SMTP autenticado precisa estar habilitado para a caixa
  (política do tenant/Exchange).
- **Yahoo/Zoho**: gere nas configurações de segurança da conta.

## Como funciona no envio

- A ação `send_email` resolve a config da empresa em tempo de envio
  (`TenantAwareEmailSender`). Empresas **sem** configuração continuam usando o
  driver de console (log), sem quebrar execuções.
- O envio real usa `nodemailer` sobre SMTP. Nenhuma credencial é exposta em logs
  ou respostas de API — o `GET` da config retorna a senha mascarada.

## Envio direto pelo agente (chat) × proposta com aprovação

Há dois caminhos para o `send_email`, com rastreabilidade diferente:

| Caminho | Como é disparado | Aprovação | `origin` | Auditoria |
| --- | --- | --- | --- | --- |
| **Envio direto** | Usuário pede no **chat** e o agente chama a tool `send_email` | Não | `ai_direct` | `ACTION_EXECUTED_DIRECT` |
| **Proposta** | Agente usa `propose_action` (ou canal **MCP**), ou a empresa exige aprovação | Sim | `ai` / `mcp` | `ACTION_PROPOSED` → `ACTION_APPROVED` → `ACTION_EXECUTED` |

- **Envio direto** (`origin: ai_direct`) executa imediatamente, sem passar pela
  fila de `/approvals`. É restrito à ação `send_email` e disponível para
  qualquer usuário `member+`. Relaxa deliberadamente o guardrail de "a IA nunca
  dispara efeito colateral sozinha" **apenas** para e-mail no chat.
- O canal **MCP** (ChatGPT) **não** ganha envio direto: continua sempre
  propondo com aprovação humana.
- `create_task` continua exigindo aprovação em todos os canais.
- Para diferenciar nos relatórios/auditoria, filtre por `origin = 'ai_direct'`
  nas execuções ou pela ação de auditoria `ACTION_EXECUTED_DIRECT`. Execuções de
  envio direto **não** aparecem na fila de aprovações porque não geram um
  `Approval`.

## Solução de problemas

- **`535` / autenticação falhou**: senha de app incorreta ou MFA exigindo senha
  de app; no Microsoft 365, verifique se o SMTP autenticado está liberado.
- **Timeout / conexão recusada**: porta/segurança incompatíveis. Tente 587 com
  STARTTLS ou 465 com TLS implícito.
- **Mensagem cai em spam**: configure SPF/DKIM/DMARC no domínio do remetente e
  use um `From` do mesmo domínio autenticado.
- **Teste falha mas salvar funciona**: o teste roda `verify()` (autentica antes
  de enviar); um erro aqui indica credencial/host inválidos, não um problema de
  gravação.
