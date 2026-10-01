# Contexto do agente e pesquisa pública

O chat web e o WhatsApp usam o mesmo perfil oficial da empresa e os mesmos resumos de conversas anteriores. O perfil é editável por owner/admin em **Perfil da empresa**. O agente pode sugerir complementos a partir de resumos e fatos registrados; as sugestões só entram no perfil depois de revisadas e salvas.

Depois de uma resposta, o agente resume informações duradouras relatadas pelos usuários. Os resumos são compartilhados dentro da empresa, com autoria e data. Mensagens antigas de outras pessoas não são enviadas ao modelo. Owner/admin pode corrigir ou excluir um resumo em **Memória**; a correção permanece autoritativa e uma exclusão não é recriada automaticamente pela próxima mensagem. Indicadores internos continuam vindo das ferramentas de dados, não dos resumos.

## Ativação

1. Aplique as migrações Prisma `20261001020000_agent_context` e `20261001030000_agent_context_curated` no banco da aplicação.
2. Configure `TAVILY_API_KEY` no servidor web para habilitar busca e extração de páginas públicas. Sem ela, o agente informa que não pode verificar fatos externos atuais.
3. Execute `pnpm --filter @tactia/web backfill:agent-context` uma vez para gerar resumos das conversas já armazenadas. O comando usa o LLM configurado e pode consumir créditos; pode ser repetido, pois ignora conversas já resumidas.

A busca pública usa Tavily Search e Extract. Consultas removem e-mails, UUIDs, valores monetários e sequências numéricas longas. A ferramenta limita resultados e tempo de resposta. Fontes aparecem como links com data; números externos precisam estar na página citada. Sistemas autenticados continuam dependendo dos perfis do Browser Agent.

## Verificação

- Pergunte sobre dados internos: o agente deve usar as ferramentas da empresa, sem pesquisa pública desnecessária.
- Pergunte por tendências atuais do setor: o agente deve consultar fontes públicas, citar URLs e distinguir o contexto externo dos indicadores da empresa.
- Registre uma decisão em uma conversa e abra outra com outro membro da mesma empresa: a decisão resumida deve ser recuperável, sem mostrar mensagens antigas.
- Corrija e exclua uma memória; confirme que a busca seguinte usa a correção ou deixa de trazer o resumo excluído.
