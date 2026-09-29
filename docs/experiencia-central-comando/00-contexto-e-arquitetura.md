# Central de comando — contexto de usuários e arquitetura da experiência

Status: design-spec para validação e implementação posterior. Fonte: `docs/plano-experiencia-central-de-comando.md`. Este documento não contém UI de produção.

## Resultado do produto

A central deve permitir ao empresário responder, em poucos minutos: **estou avançando para meu objetivo, o que merece atenção, o que posso delegar e o que aconteceu depois?** A unidade de experiência é um ciclo persistente: objetivo → diagnóstico com evidências → decisão → execução → resultado observado → ajuste.

Premium significa clareza para decidir, previsibilidade ao delegar, informação verificável e continuidade mesmo sem acesso frequente ao app. O produto não é um dashboard para o cliente manter; é uma camada que observa os sistemas já usados, prepara trabalho e solicita somente decisões legítimas.

## Usuários e contexto de uso

| Perfil | Trabalho a realizar | Contexto e dispositivo | O que não deve ser exigido |
|---|---|---|---|
| Empresário, owner/admin | Encontrar a prioridade, verificar evidência, entender alcance e autorizar ou ajustar | Consultas de 1–5 min; decisões frequentes no celular; investigação e planejamento no desktop | Atualizar tarefas, preencher check-ins, reconciliar fontes ou registrar andamento |
| Gestor/colaborador autorizado | Continuar o trabalho habitual e responder, quando indispensável, a uma pergunta contextual | CRM/ERP/Trello e canal habitual, como WhatsApp; app opcional | Login para reportar, formulário recorrente ou repetir informação já disponível |
| Tactia Ops | Preparar contexto, fontes, responsáveis e planos; reconciliar lacunas; recuperar falhas | Backoffice desktop, alta densidade e rastreabilidade | Tomar decisão de negócio reservada ao cliente ou ocultar incerteza para “fechar” caso |

## Premissa absoluta: esforço operacional do cliente igual a zero

Ordem obrigatória de obtenção de informação:

1. Consultar sistemas conectados e contexto autorizado.
2. Reconciliar evidências e encaminhar lacunas técnicas ao Ops.
3. Perguntar pontualmente à pessoa que detém o fato, no canal já utilizado, somente quando necessário e dentro da política de contato.

Toda superfície deve responder:

| Pergunta | Resposta de design |
|---|---|
| Qual trabalho deixa de ser feito pelo cliente? | Cadastro de tarefas, atualização de status, conciliação e relatórios de acompanhamento. |
| De onde vem a informação? | Ingestão/eventos de fontes, registros de execução e, excepcionalmente, relato identificado. |
| Quem resolve a ausência? | Ops; a pessoa envolvida só recebe pergunta curta quando a informação não existir em fonte. |
| O que o dono precisa fazer? | Confirmar intenção, limite, condição comercial ou autorização que dependa de sua autoridade. |

Estados vazios nunca devem pedir “cadastre”, “preencha” ou “atualize” para desbloquear o acompanhamento. Correção de contexto é opcional e pode ocorrer por conversa.

## Objetivos por superfície

| Destino | Pergunta principal | Conteúdo e ordem |
|---|---|---|
| **Hoje** `/today` | O que exige minha atenção? | Empresa/período/atualização → síntese → objetivo em foco → até três prioridades → trabalho delegado → resultados recentes |
| **Objetivos** `/objectives` e `/objectives/[id]` | Aonde queremos chegar e como? | Objetivos e planos preparados; intenção e limites a confirmar somente quando necessários |
| **Operação** `/operations` e `/operations/plans/[id]` | O que está sendo feito e o que depende de mim? | Decisões, Em andamento, Rotinas e Histórico, todos alimentados pelas fontes |
| **Resultados** `/results` | O que mudou no negócio? | Meta versus observado, revisões de planos, análises e resumos semanais |
| **Conversar** `/chat/[id]` | Quero investigar ou ajustar em linguagem natural | Acesso global; painel lateral no desktop, tela dedicada no celular; referência persistente de objetivo/plano/decisão |
| **Ops: Lacunas** | O que impede observação confiável? | Fila por impacto, empresa, plano, fonte, tentativas, responsável e próximo passo |

Navegação secundária: Empresa, Ajuda e preferências pessoais essenciais. Conexões, mapeamentos, regras, canais e contexto operacional ficam no Ops; o app apresenta apenas consentimento/autenticação do titular quando inevitável.

## Hierarquia de Hoje

1. Cabeçalho: empresa ativa, período analisado e atualização real das fontes.
2. `ExecutiveSummary`: mudança, relação com o objetivo e atenção principal.
3. `ObjectiveProgress`: realizado, meta, ritmo e limitações.
4. Até três `PriorityCard`, ordenados por score existente + relação com objetivo + urgência + ação possível; o motivo da ordem é legível.
5. `ExecutionTimeline` resumida: responsável, estado, próximo evento e bloqueios.
6. Resultados recentes e acesso a `OutcomeReview`/Resultados.

Bloqueio crítico não desaparece com o limite de três: a limitação e o impacto aparecem ao cliente quando relevantes; a investigação pertence ao Ops. Se nada exigir decisão, “Nenhuma decisão necessária agora” é um resultado útil e inclui próxima revisão conhecida, sem urgência fabricada.

## Princípios de confiança

- Todo número decisivo leva definição, unidade, período, fonte, última ingestão, cálculo e limitação.
- `null`/indisponível nunca vira zero. Zero só aparece com consulta válida e cobertura conhecida.
- Fato observado, relato identificado, inferência, estimativa e sugestão têm rótulos textuais distintos; cor é reforço, nunca significado único.
- `confidence` do insight não é probabilidade de sucesso. Ranking interno e impacto não monetário não viram promessa financeira.
- Aprovação mostra objetivo, motivo, ação, alcance, responsável, canal, momento, custo/limite, regime de autorização e resultado verificável.
- Estado do plano, decisão, execução e medição são eixos separados. “Executado” não significa “objetivo atingido”.
- Pausar, cancelar e desfazer aparecem apenas se a capacidade real existir. Execução parcial e intervenção humana permanecem no histórico.

## Linguagem

| Evitar | Usar |
|---|---|
| Rodar análise | Atualizar diagnóstico (ou atualização automática quando real) |
| Aceitar recomendação | Preparar plano |
| Aprovar e executar, sem esclarecer efeito | Aprovar envio/ação, seguido do estado efetivo retornado |
| Playbooks | Formas de trabalhar |
| Fatos / Memória | Contexto da empresa / histórico de decisões |
| Verifique os logs | Informar limitação e tratamento real, sem prometer atendimento inexistente |
| Execução registrada | Tarefa criada para [responsável], envio confirmado ou estado real específico |

## Restrições do produto existente

- Preservar Next.js App Router, Server Components no shell/leitura e interatividade localizada.
- Reutilizar `Sidebar`, `Button`, `Card`, `Alert`, `Badge`, `Dialog`/`Sheet`, tabelas e `ChatPanel` compartilhado.
- Evoluir tokens CSS/Tailwind v4 existentes; não importar configuração antiga nem mudar primitivos globais sem avaliar chat e landing.
- Preservar links `/chat/[id]`, APIs existentes e isolamento por tenant.
- Admin mantém identidade visual operacional própria; `EvidenceGapQueue` usa tokens do Ops, não superfícies Warm Command do cliente.

## Responsividade e acessibilidade esperadas

- Referências de aceite: 360px, 768px e 1280px; conteúdo até 1280px; margem móvel de 16px.
- 360px: uma coluna; detalhes e conversa contextuais em tela inteira; ações e autorização sempre visíveis.
- 768px: uma ou duas colunas conforme conteúdo; painel secundário não comprime decisões críticas.
- 1280px: conteúdo principal + apoio lateral sob demanda, sem duplicar a hierarquia.
- WCAG 2.2 AA: teclado, foco visível e não encoberto, contraste, zoom, headings/listas, mensagens assíncronas resumidas e tabelas alternativas para gráficos.
- Alvo interno de toque: 44×44px nas ações primárias, sem confundir essa escolha com o mínimo normativo.

## Hipóteses a validar e não negociáveis

**Validar com 5–8 empresários:** resultado comercial piloto, sistemas/canais habituais, cadência, política de contato, dados disponíveis, compreensão móvel e expectativa de revisão.

**Não validar como opcional:** ausência de reporte rotineiro, tratamento de lacunas pelo Ops, proveniência, autorização no servidor, isolamento por empresa e distinção entre execução e resultado.

## Primeiro recorte e fora de escopo

Primeiro recorte: recuperação de clientes inativos com dados de vendas existentes. Tactia/Ops prepara lista, responsáveis e abordagem no processo atual; o dono decide apenas condições sob sua autoridade; acompanhamento vem das fontes e relatos pontuais.

Fora do primeiro recorte: customizador de dashboard, marketplace de agentes, criador genérico de workflows, novo CRM, integrações criadas apenas para preencher telas, autonomia irrestrita e envio automático em massa como pré-requisito.