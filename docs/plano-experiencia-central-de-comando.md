# Tactia — Plano de experiência da central de comando

Data: 28/09/2026. Status: proposta para orientar a refatoração; nenhuma implementação de produto incluída.

## 1. Resultado que a experiência deve entregar

O empresário deve entrar na Tactia e conseguir responder: **estou avançando para meu objetivo, o que merece minha atenção, o que posso delegar e o que aconteceu depois?**

A unidade principal da experiência será um objetivo de negócio com um plano acompanhado: objetivo → diagnóstico com evidências → decisão → execução → resultado observado → ajuste. Dashboard, conversa, análises e automações dão suporte a esse percurso.

Premium significa clareza para decidir, previsibilidade ao delegar, informação verificável e continuidade de acompanhamento. A qualidade visual deve tornar essas características perceptíveis em cada interação.

### Premissa obrigatória — a Tactia absorve o trabalho de acompanhamento

O produto deve funcionar assumindo que donos, gestores e colaboradores **não preencherão informações nem atualizarão status para manter a Tactia funcionando**. Não exigir formulários de acompanhamento, check-ins, relatórios, duplicação de cadastros ou manutenção de um quadro de tarefas no app. A ausência dessas atividades não pode impedir a entrega de valor.

A Tactia prepara objetivos e planos a partir do contexto disponível, acompanha o trabalho nos sistemas já utilizados e registra o que conseguir apurar. O empresário participa das decisões que exigem sua intenção ou autoridade. A equipe continua trabalhando nos canais e sistemas habituais; a Tactia se adapta a essa rotina.

Ordem de obtenção de informação: **consultar sistemas conectados e contexto autorizado → reconciliar evidências e tratar lacunas com Ops → perguntar pontualmente ao envolvido no canal habitual, somente quando necessário**. Ops configura previamente quem pode ser consultado e sobre quais assuntos; perguntas simples podem seguir essa política sem exigir intervenção manual do operador em cada caso. Não transformar WhatsApp em um formulário recorrente de atualização.

Toda proposta de tela ou fluxo deve responder: qual trabalho deixa de ser feito pelo cliente, de onde vem a informação e quem resolve sua ausência? Se a resposta depender de alguém alimentar a Tactia rotineiramente, o fluxo precisa ser redesenhado.

### Usuários e contexto

| Perfil | Necessidade | Experiência prioritária |
|---|---|---|
| Empresário, owner/admin | Crescer com controle de recursos e riscos | Entender prioridades e autorizar uma ação em poucos minutos |
| Gestor ou colaborador, conforme permissões | Executar seu trabalho habitual sem uma camada adicional de reporte | Acompanhamento pelos sistemas existentes; esclarecimento pontual pelo canal da empresa com a Tactia, como WhatsApp, sem precisar acessar o app |
| Equipe Tactia Ops | Preparar contexto, conectar fontes, reconciliar informações e resolver impedimentos | Complexidade operacional concentrada no backoffice; cliente recebe situação, resultado e somente decisões necessárias |

Hipóteses a validar: consulta breve quando houver interesse ou decisão; decisões rápidas no celular; investigação e planejamento no desktop. O acompanhamento continua mesmo quando ninguém acessa o app. O primeiro piloto deve concentrar-se em um resultado comercial suportado pelos dados atuais, como recuperação de clientes inativos. Setor, ciclo de venda, cadência e disponibilidade dos dados podem alterar esse recorte.

### Base e limites deste diagnóstico

Análise estática de rotas, componentes, serviços e modelos do repositório. Não foi realizada inspeção visual no navegador, pesquisa com clientes ou medição de uso e desempenho. As propostas de hierarquia e interação são hipóteses de produto; os comportamentos de código citados abaixo são observações verificáveis. Documentação histórica deve ser confrontada com a implementação atual.

## 2. Diagnóstico do produto atual

| Evidência no repositório | Consequência para a experiência | Refatoração proposta |
|---|---|---|
| `apps/web/src/app/(app)/layout.tsx`: 10 destinos básicos e mais 2 para administradores | Configuração, conceitos internos e trabalho diário disputam atenção | Navegação organizada pelas perguntas do empresário |
| `dashboard/page.tsx`: métricas, gráficos, briefing, insights e recomendações | O usuário precisa sintetizar informação e escolher o próximo passo | Síntese executiva e prioridades antes do detalhamento analítico |
| `dashboard/page.tsx`: falhas podem virar `null` e valores usam `?? 0` | Indisponibilidade pode ser apresentada como resultado zero | Contrato explícito de disponibilidade por métrica |
| `packages/domain/src/services/recommendation-service.ts`: `accept` altera status e registra auditoria | Aceitar uma recomendação não cria, por si só, um plano de execução | Conectar decisão, plano, ação e acompanhamento com identificadores persistentes |
| `approval-queue.tsx`: entrada e saída exibidas por `Object.entries` | O empresário precisa interpretar campos técnicos para autorizar | Resumo de negócio específico por tipo de ação |
| `approvals/page.tsx` promete decisão humana para toda ação; `execution-engine.ts` inclui `ai_direct` e `forceExecute` | A explicação da interface não distingue os regimes de autorização existentes | Exibir aprovação por ação, pedido direto e autorização de rotina de forma fiel |
| `settings/goals`, `settings/facts`, `settings/memory`, `settings/playbooks` | Metas e conhecimento aparecem como manutenção do sistema | Metas no percurso principal; conhecimento organizado como contexto da empresa |
| `onboarding/page.tsx` informa espera pela liberação; com tenant redireciona ao dashboard | Há pouco acompanhamento do primeiro valor entregue | Preparação assistida com etapas, pendências e próximo contato |

Há ativos importantes para preservar: métricas determinísticas, evidências de insights, score de prioridade, metas, briefings, auditoria, isolamento por empresa, motor de execução, agendamentos e chat compartilhado. O plano conecta essas capacidades e adiciona o acompanhamento que falta.

## 3. Arquitetura da experiência

| Destino principal | Pergunta respondida | Conteúdo |
|---|---|---|
| **Hoje** | O que exige minha atenção? | Situação do objetivo, mudanças relevantes, até três prioridades, decisões pendentes e andamento |
| **Objetivos** | Aonde queremos chegar e como? | Objetivos e planos preparados pela Tactia/Ops, com intenção e limites confirmados pelo empresário quando necessário |
| **Operação** | O que está sendo feito e o que depende de mim? | Visão alimentada pelas fontes: Decisões, Em andamento, Rotinas e Histórico; sem obrigação de atualizar tarefas |
| **Resultados** | O que mudou no negócio? | Metas versus realizado, resultados dos planos, análises e resumos semanais |

“Conversar com a Tactia” permanece acessível globalmente e dentro de cada contexto. Desktop: painel lateral sob demanda, com opção de abrir a conversa completa. Celular: tela dedicada que preserva o vínculo com a decisão ou objetivo. Nenhuma tela deve exigir que o usuário formule um prompt para descobrir a ação disponível.

Navegação secundária: **Empresa** (contexto já consolidado, com correção opcional por conversa), **Ajuda** e preferências pessoais essenciais. Saúde dos dados pode ser consultada como evidência. Configuração de conexões, mapeamentos, regras, canais e manutenção de contexto ficam com Ops. Quando o provedor exigir consentimento ou autenticação do titular, oferecer apenas essa etapa indispensável, preparada e acompanhada por Ops. Papéis e permissões continuam determinados no servidor; absorver trabalho operacional não transfere ao Ops a autoridade sobre decisões de negócio do cliente.

Mapeamento proposto: `/today`, `/objectives`, `/objectives/[id]`, `/operations`, `/operations/plans/[id]`, `/results`. Preservar `/chat/[id]`. As rotas são propostas, não funcionalidades existentes.

Migração: manter `/dashboard` funcionando enquanto Hoje amadurece; depois direcionar sua análise detalhada para Resultados preservando filtros. `/approvals` passa a abrir a aba Decisões, incluindo filtros existentes; `/briefings` permanece acessível pelo histórico de Resultados. Não invalidar links de conversas nem links compartilhados.

### Composição de Hoje

1. Empresa ativa, período e atualização dos dados visíveis.
2. Síntese curta: o que mudou, relação com o objetivo e principal atenção.
3. Objetivo em foco: realizado, meta, ritmo necessário e limitações da projeção.
4. Até três prioridades justificadas, cada uma com um próximo passo concreto.
5. Trabalho delegado: responsável, estado, próximo evento esperado e bloqueios.
6. Resultados recentes e acesso às análises detalhadas.

Ordenar prioridades usando o score existente, relevância para o objetivo, urgência e possibilidade real de agir; explicar o motivo da ordem. Bloqueios críticos não podem desaparecer por causa do limite de três: Ops recebe a pendência técnica; o cliente vê a limitação e o impacto quando relevantes, sem herdar a tarefa de investigar. Não produzir urgência quando não houver evidência: “Nenhuma decisão necessária agora” deve ser um estado útil, com a próxima revisão indicada quando conhecida.

Exemplo de composição, com dados fictícios para prototipação:

> **Seu foco: recuperar clientes inativos.**
> Identificamos 24 clientes que atendem aos critérios do plano.
> Preparamos o contato no processo comercial que sua equipe já utiliza, com os responsáveis identificados.
> Precisamos apenas da sua decisão sobre a condição comercial proposta.
> Fonte: vendas importadas até 09h10 · Critério: sem compra há 90 dias.
> **Revisar plano** · Ver evidências · Conversar sobre isso

Só apresentar essas quantidades, critérios e horários quando suportados pelos dados da empresa. O exemplo não é um diagnóstico real de cliente.

## 4. Fluxos e estados

### Fluxo A — Primeiro valor com acompanhamento

**Objetivo:** chegar a um primeiro diagnóstico útil e a um próximo passo acordado. **História:** como empresário, quero saber o que a Tactia fará pelo meu negócio e o que falta para começar. **Entrada:** primeiro acesso ou card de preparação. **Pré-requisito:** sessão válida; acesso liberado pela operação para trabalhar com dados reais.

| Passo | Ação do usuário | Resposta e dados | Transição |
|---|---|---|---|
| 1. Foco | Confirmar ou ajustar em conversa a intenção de negócio, se ainda desconhecida | Tactia/Ops recupera contexto da consultoria e dos sistemas e prepara o objetivo; sem formulário obrigatório | Objetivo preparado; perguntar somente o que falta |
| 2. Preparação | Nenhuma ação operacional; consentir acesso apenas quando indispensável | Ops conduz acesso, fonte, mapeamento e validação; progresso comunicado sem exigir acompanhamento | Integração pronta ou pendência assumida por Ops |
| 3. Diagnóstico | Consultar se desejar; apontar divergência opcionalmente | Tactia/Ops valida números e prepara ponto de partida, meta sugerida e limitações | Dados válidos → proposta; divergência → Ops reconcilia |
| 4. Primeiro plano | Decidir apenas sobre objetivo, compromisso ou limite que exija sua autoridade | Plano pronto com responsáveis obtidos do processo existente e acompanhamento configurado | Plano acompanhado sem cadastro de tarefas pelo cliente |

**Decisões:** sem acesso à empresa, mostrar somente preparação autorizada para aquela pessoa; com dados parciais, explicitar quais conclusões são possíveis. A criação de empresa e usuários continua com Ops. Evitar reintroduzir um wizard técnico de conectores para o empresário.

**Saídas:** rascunho salvo, preparação pendente ou primeiro plano iniciado. Fechar a tela não perde o objetivo. Não inventar percentual de integração ou prazo de atendimento. Se o status não estiver disponível, informar isso e oferecer o canal real de acompanhamento.

**Persistência:** objetivo preparado, contexto reutilizado e etapas de preparação no servidor; URL com etapa quando aplicável. **Eventos:** `activation_started`, `objective_drafted`, `first_diagnosis_viewed`, `first_plan_started`. **Aceite:** nenhum preenchimento operacional obrigatório; o usuário sabe o próximo passo, quem o realiza e o que falta, inclusive durante a espera. Não perguntar novamente algo já informado na consultoria ou disponível em fonte autorizada.

### Fluxo B — Entender, decidir e delegar

**Objetivo:** transformar uma prioridade em trabalho acompanhado. **História:** como empresário, quero entender uma proposta e delegar sabendo seu alcance. **Entradas:** Hoje, Objetivo, Operação ou conversa contextual. **Pré-requisitos:** tenant autorizado, evidências disponíveis e capacidade de execução conhecida.

```text
Prioridade → evidência → plano em rascunho → revisão de alcance
                                             │
                   ┌─────────────────────────┼────────────────────────┐
                   ▼                         ▼                        ▼
          Aprovação necessária      Autorização já válida     Capacidade ausente
          decisão autorizada        identificar seu escopo    tratamento por Ops
                   └─────────────────────────┘
                                  ▼
                      Execução acompanhada → medição
```

| Passo | Componente | Entrada/ação | Resposta e transição |
|---|---|---|---|
| 1. Entender | `PriorityCard` + `EvidencePanel` | Abrir prioridade | Evidência, período, fonte, hipóteses e limitações; prosseguir ou dispensar |
| 2. Planejar | `PlanDetail` | Consultar plano preparado; pedir ajuste em linguagem natural se desejar | Tactia/Ops prepara escopo, responsáveis, prazo, indicador e fonte de acompanhamento; rascunho versionado sem execução implícita |
| 3. Decidir | `DecisionCard` | Revisar pessoas/registros afetados e conteúdo | Aprovar, solicitar ajuste ou recusar; autorização verificada no servidor |
| 4. Delegar | `ExecutionTimeline` | Nenhuma confirmação repetida após autorização válida da etapa anterior | Execução identificada e idempotente no fluxo existente; acompanhamento configurado pela Tactia/Ops |
| 5. Acompanhar | `OutcomeReview` | Consultar quando quiser; decidir somente uma mudança que exija sua autoridade | Tactia coleta andamento e efeitos, prepara a revisão e sinaliza exceções; sem reporte manual |

**Validação:** responsável válido e autorizado; capacidade disponível; payload validado; versão aprovada igual à executada; evidências dentro da política de atualização pertinente. Estimativas comerciais não são campos obrigatórios quando não houver base.

**Saídas:** fechar detalhes preserva o rascunho; recusar registra a decisão; aprovar mostra “Aprovada”, “Na fila” ou o estado efetivo retornado. Uma tarefa criada ainda não é uma tarefa realizada; ação concluída ainda não é objetivo atingido.

**URL:** identificador persistente do plano/decisão e retorno ao contexto. **Estado local:** ajuste opcional em elaboração e foco. **Persistência:** versão do plano, responsáveis, evidência utilizada, autorização e vínculos com execuções. **Eventos:** `priority_opened`, `evidence_opened`, `plan_created`, `decision_resolved`, `execution_state_changed`.

**Aceite:** acompanhar todo o percurso sem reconstruir contexto nem preencher status; recarregar ou clicar duas vezes não duplica o efeito; decisões concorrentes não aprovam uma versão diferente; restrição de acesso vale também nos links diretos. Acompanhar não depende de abrir a tela, responder check-in ou concluir uma tarefa na Tactia.

### Fluxo C — Revisar o resultado

**Objetivo:** saber se a iniciativa está contribuindo para o objetivo. **História:** como empresário, quero comparar intenção e resultado e decidir o próximo passo. **Gatilho:** revisão acordada, mudança relevante ou visita a Resultados. **Pré-requisito:** plano e definição de medição registrados.

1. A Tactia coleta evidências nas fontes conectadas e prepara a síntese: objetivo, baseline, alvo, realizado e qualidade dos dados.
2. Se houver lacuna relevante, Ops reconcilia ou a Tactia esclarece pontualmente pelo canal autorizado; a ausência de resposta permanece explícita.
3. A Tactia compara períodos/coortes compatíveis e separa execução de resultado: contatos, respostas e compras, somente quando sustentados por evidência.
4. O empresário recebe a síntese e, se necessário, uma proposta pronta de ajuste ou encerramento. A Tactia registra a decisão e a próxima revisão; nenhuma justificativa digitada é obrigatória.

**Decisões:** sem janela de observação suficiente → “Em medição”; sem dados de resultado → “Não foi possível medir”; resultado abaixo do esperado → propor revisão sem encerrar automaticamente. Alterar meta não reescreve a avaliação histórica.

**Saída/persistência:** revisão registrada com valores, versão da definição, período, evidências e decisão; URL do plano/revisão. **Eventos:** `outcome_reviewed`, `plan_adjusted`, `plan_closed`. **Aceite:** não confundir variação observada com receita causada pela Tactia; atribuição causal só com método que a sustente.

### Fluxo D — Obter informação sem criar uma rotina de reporte

**Objetivo:** resolver uma lacuna de acompanhamento com o menor esforço possível para a empresa. **Gatilho:** ausência, conflito ou envelhecimento de uma evidência necessária. **Entradas:** monitoramento de planos, ingestão ou fila Ops. **Pré-requisitos:** vínculo com empresa/plano, fontes e canais autorizados, política de consulta e responsável operacional.

1. Consultar CRM, ERP, tarefas, vendas e interações já disponíveis, conforme a integração. Reutilizar informação existente antes de perguntar.
2. Correlacionar registros com o plano e distinguir fato observado, relato de pessoa e inferência. Compra posterior não prova que uma ligação ocorreu; mensagem enviada não prova entrega ou resposta.
3. Encaminhar divergência técnica ou ambiguidade para a fila Ops, com evidências e próximo passo sugerido. Resolver acesso, mapeamento e reconciliação no backoffice.
4. Quando a informação só existir com uma pessoa, preparar uma pergunta curta, contextual e necessária no canal já utilizado, como WhatsApp: “Sobre o contato com a Empresa X: houve retorno?”. Consultar diretamente o envolvido, sem usar o gestor como intermediário.
5. Processar a resposta no mesmo canal e registrar automaticamente a informação, autoria, referência, horário e vínculo. Não pedir que a pessoa replique a resposta em tela ou formulário.
6. Se não houver resposta ou ela for ambígua, manter “sem confirmação”, respeitar a política de contato e devolver a lacuna a Ops. Continuar etapas independentes; suspender somente o que depende da evidência ausente.

**Regras de contato:** configuração e limites ficam com Ops, respeitando o canal e as preferências da empresa; agrupar perguntas relacionadas, limitar frequência por pessoa, respeitar horários e evitar cobrança duplicada entre canais ou planos. Toda tentativa reconcilia novamente a fonte: se o dado chegou, cancelar a pergunta pendente. Não substituir formulários por uma sequência de mensagens obrigatórias.

**Saídas:** evidência coletada, relato registrado, conflito em tratamento ou informação ainda desconhecida. Silêncio não equivale a conclusão, confirmação ou aprovação. Uma resposta de status não autoriza outra ação de negócio.

**Persistência:** lacuna, fonte procurada, tentativas, pessoa/canal, referência da resposta, tipo da evidência, timestamps, responsável Ops e próxima tentativa permitida. **Eventos propostos:** `evidence_gap_detected`, `evidence_resolved_from_source`, `clarification_requested`, `clarification_received`, `ops_gap_resolved`. **Aceite:** o ciclo funciona sem atualização manual na Tactia e sem repetição de perguntas já resolvidas; acesso à conversa e decisão respeitam identidade e permissões.

### Estados transversais e recuperação

| Estado | Comportamento |
|---|---|
| Carregando | Skeleton de dimensão estável por seção; progresso textual real para ações longas |
| Sem dados | Explicar preparação/fonte necessária; não renderizar valores zero como substitutos |
| Zero verdadeiro | Mostrar zero somente com consulta válida e cobertura conhecida |
| Parcial/desatualizado | Exibir última informação válida com data e limitação; restringir apenas decisões que dependem do dado inválido |
| Sem prioridades | Mostrar operação acompanhada e próxima revisão, se conhecida |
| Falha | Mensagem compreensível, o que foi preservado e recuperação; detalhes técnicos no suporte |
| Sem permissão | Explicar o papel necessário sem expor dados de outra empresa |
| Decisão já tomada | Atualizar autor/horário/status; impedir nova execução |
| Plano alterado | Exigir revisão da versão atual antes da ação; não reutilizar aprovação de conteúdo diferente |
| Timeout após envio | Consultar a execução existente antes de permitir repetição; nunca presumir que falhou |
| Offline | Sinalizar indisponibilidade de comandos; manter rascunho sem enfileirar aprovação silenciosamente |
| Sessão expirada | Reautenticar preservando retorno e rascunho autorizado |
| Troca de empresa | Limpar contexto/cache da anterior e revalidar links; não transportar rascunhos entre tenants |
| Cancelamento | Explicar se ainda pode impedir o efeito; confirmar cancelamento somente após o servidor |
| Informação faltante | Tactia consulta fontes; Ops assume a lacuna; cliente vê limitação relevante, sem receber tarefa de preenchimento |
| Pergunta sem resposta | Permanecer sem confirmação, respeitar limites de contato e seguir com etapas independentes; não escalar automaticamente ao dono |
| Fontes em conflito | Manter proveniência de cada versão e encaminhar reconciliação ao Ops; não sobrescrever silenciosamente |

## 5. Confiança como parte do produto

Todo número decisivo deve carregar definição, unidade, período, fonte, data da última ingestão relevante, data do cálculo e limitações. Atualizar um cálculo sobre dados antigos não torna a fonte recente. Divergência deve abrir um caminho de revisão com a equipe responsável.

Separar visualmente **fato**, **estimativa** e **sugestão**. O `confidence` dos insights é uma heurística do sinal; não convertê-lo em “probabilidade de sucesso do plano”. Valores padrão usados para ranking, incluindo impacto não monetário, não devem aparecer como retorno financeiro estimado.

Uma proposta executável precisa informar: objetivo relacionado, motivo, ação concreta, alcance, responsável, canal, momento, custo/limite quando aplicável, autorização necessária e resultado esperado em termos verificáveis. Ausência de integração deve gerar tratamento pelo Ops ou impedimento explícito. Se uma atividade de negócio exige execução humana, ela ocorre no fluxo que a equipe já usa; não acrescentar uma obrigação de registrar seu andamento na Tactia.

Informação importada, relato obtido no canal e inferência são tipos diferentes de evidência. Exibir origem e horário pertinentes. A Tactia pode absorver a coleta e o registro, mas não fabricar certeza para evitar uma lacuna visível.

Apresentar o regime real de autorização: revisão por ação, pedido direto registrado ou rotina previamente autorizada. Uma eventual ampliação de autonomia é uma entrega de produto separada, com políticas persistidas e aplicadas no servidor. Um seletor visual de “autonomia” sem essa base não faz parte do MVP.

Exibir pausar, cancelar ou desfazer apenas quando a capacidade correspondente existir. Cancelar envios futuros não desfaz e-mails enviados. Histórico registra o ocorrido, inclusive execução parcial e intervenções humanas.

## 6. Componentes para o handoff

Componentes de produto propostos em `apps/web/src/components/app/command-center/`, compostos com os primitivos existentes. A tabela define o contrato mínimo; a implementação deve tipá-lo explicitamente.

| Componente / propósito | Dados necessários | Variantes e estados | Interação e aceite |
|---|---|---|---|
| `ExecutiveSummary`: orientar a leitura | Objetivo, período, síntese, referências e atualização | Pronto, sem objetivo, parcial, indisponível | Referências abrem evidência; síntese não é requisito para renderizar o restante |
| `ObjectiveProgress`: mostrar direção | ID, métrica, unidade, baseline, alvo, realizado, prazo, ritmo e disponibilidade | No ritmo, em atenção, atingido, não avaliável | Abrir objetivo; distinguir realizado/projeção; sem percentual inventado |
| `PriorityCard`: tornar a próxima decisão clara | Insight/objetivo, motivo da prioridade, evidência, ação suportada, estado | Oportunidade, risco, bloqueio, em acompanhamento | Uma ação principal; dispensar com motivo opcional; não duplicar prioridade já em execução |
| `EvidencePanel`: permitir verificar | Definição, fontes, períodos, ingestão, cálculo, cobertura/limitações | Completo, parcial, antigo, falha | Drill-down paginado e caminho para relatar divergência |
| `DecisionCard`: explicitar compromisso | ID/versão, payload formatado, alcance, custo quando aplicável, política, capacidades e permissões | Pendente, decidida, expirada/alterada, bloqueada, enviando, erro | Aprovação ligada à versão; retorno persistente; conteúdo sensível não pode ficar escondido em tooltip |
| `ExecutionTimeline`: dar previsibilidade | Execuções vinculadas, eventos das fontes, relatos identificados, responsáveis e próxima etapa conhecida | Na fila, executando, parcial, bloqueada, sem confirmação, falhou, concluída, cancelada | Alimentação automática; sem botão obrigatório de atualização de status; proveniência legível |
| `OutcomeReview`: fechar o ciclo | Plano, definição da medição, baseline, janela, observado, evidências e revisão | Em medição, medido, sem medição, revisão necessária | Separar efeito operacional e resultado comercial; registrar ajuste |

No backoffice, acrescentar `EvidenceGapQueue`: lista de lacunas e conflitos por impacto, com plano afetado, fontes consultadas, tentativas, responsável Ops e próximo passo. Estados: nova, em tratamento, aguardando fonte/resposta, resolvida e sem resolução. Ações: reconciliar, corrigir configuração, preparar consulta ou registrar limitação. Deduplicar lacunas, aplicar permissões e manter histórico; dados de outra empresa não entram no contexto da consulta. Esse componente é uma entrega proposta para `apps/admin`, sujeita às instruções locais antes da implementação.

### Regras compartilhadas dos componentes

- **Composição:** título, contexto, conteúdo, evidência e ações; cabeçalho de status com rótulo textual. Evitar um componente genérico com dezenas de flags para todos os casos.
- **Estados:** hover discreto; foco visível; botão pressionado com feedback; loading mantém dimensão; disabled explica o impedimento; erro preserva o conteúdo que o usuário estava revisando.
- **Responsividade:** abaixo de 640px, uma coluna e detalhes em tela inteira; entre 640–1023px, uma ou duas colunas conforme conteúdo; a partir de 1024px, conteúdo principal e apoio lateral sob demanda. Informações de autorização ficam visíveis em todos os tamanhos.
- **Acessibilidade:** headings e listas semânticas; Tab percorre ações; Enter/Espaço ativam botões; Escape fecha detalhes sem decidir; abertura de diálogo gerencia foco e fechamento devolve ao acionador. Estados assíncronos usam anúncio resumido, sem narrar cada token da IA.
- **Texto longo e ausência:** títulos quebram linha; conteúdo aprovado pode ser expandido integralmente; fontes ausentes recebem estado explícito. Nunca truncar silenciosamente destinatários, condições ou limites da decisão.
- **Dependências:** reutilizar Button, Card, Dialog/Sheet, Alert, Badge e tabelas do projeto; mudanças visuais nos primitivos precisam considerar outros consumidores, especialmente chat e landing.
- **Esforço do cliente:** conteúdo operacional vem pronto; correções são opcionais e podem ser feitas por conversa; nenhuma variante vazia pode exigir cadastro ou reporte rotineiro para desbloquear o acompanhamento.

## 7. Direção visual e tokens

Evoluir a identidade “Warm Command” existente: fundos quentes, superfícies claras e grafite, tipografia editorial comedida e laranja como destaque. Preservar reconhecimento da marca e concentrar o refinamento em proporção, densidade, legibilidade e consistência.

| Sistema | Especificação proposta |
|---|---|
| Temas | Claro e escuro existentes, ambos verificados; respeitar preferência salva |
| Cores | Reutilizar `background`, `card`, `foreground`, `muted-foreground`, `primary`, `border` e estados semânticos; validar contraste de cada combinação |
| Tipografia | IBM Plex Sans para operação e números; Fraunces para títulos selecionados; números tabulares em comparações |
| Escala | Corpo 16px/24px; informações auxiliares 14px/20px; títulos de seção 20–24px; título da página 28–32px; limitar 12px a metadados não essenciais |
| Espaçamento | Base de 4px; 16–24px dentro de blocos; 24–32px entre seções; relações importantes próximas |
| Layout | Conteúdo até 1280px; leitura de prosa até 68 caracteres por linha; margem móvel de 16px |
| Formas | Raio atual de 10px como base; bordas discretas; elevação para sobreposição e hierarquia |
| Movimento | 120–180ms para feedback, até 240ms para painéis; respeitar redução de movimento; evitar movimento contínuo na operação |
| Gráficos | Título responde uma pergunta; unidade/período explícitos; alvo e comparação quando relevantes; tabela alternativa |
| Interações | Meta interna de alvo confortável de 44px para toque; ações de risco com alcance legível antes de confirmar |

Manter CSS variables e `@theme` do Tailwind v4, sem transplantar configuração de versões antigas. Isolar tokens novos do app quando alterarem superfícies compartilhadas com a landing.

Adotar WCAG 2.2 AA como critério de aceite, incluindo teclado, foco não encoberto, contraste e identificação textual de estados. A meta interna de 44px é uma escolha de conforto e não a definição do mínimo AA. Referência: [W3C — WCAG 2.2](https://www.w3.org/WAI/WCAG22/quickref/).

### Linguagem

| Hoje | Direção proposta |
|---|---|
| “Rodar análise” / “regras determinísticas” | “Atualizar diagnóstico”, com atualização automática quando já houver infraestrutura para isso |
| “Aceitar” | “Preparar plano” antes do rascunho; “Aprovar envio” apenas quando autorizar esse envio |
| “Playbooks” | “Formas de trabalhar” |
| “Fatos” / “Memória” | Contexto da empresa e histórico de decisões |
| “Verifique os logs do servidor” | “Esta informação está desatualizada. A equipe Tactia está verificando.”, somente quando houver tratamento efetivamente registrado; caso contrário, informar a limitação sem inventar atendimento |
| “Execução registrada” com campos crus | “Tarefa criada para [responsável]”, com link e estado confirmado |

## 8. Refatoração técnica e contratos

**Alvo de engenharia:** Next.js App Router, perfil `nextjs-senior-engineer`, pela arquitetura já existente de Server Components e handlers. Esta identificação orienta o handoff; não implica delegação ou execução neste planejamento. Ler os guias locais exigidos por `apps/web/AGENTS.md` antes de implementar.

### Reutilizar e conectar

- `apps/web`: shell, navegação, páginas e modelos de apresentação tipados. Leitura no servidor; interatividade localizada; mutações pelos handlers existentes ou novos.
- `apps/admin`: preparação dos objetivos/planos, fontes de acompanhamento, fila de lacunas, reconciliação, políticas de contato e configuração assistida. Modelar o trabalho Ops como parte da entrega, com responsáveis e rastreabilidade.
- `packages/connectors`: reutilizar ingestão e sinais dos sistemas existentes para observar andamento; mapear cobertura antes de prometer acompanhamento de uma etapa.
- `packages/domain`: regras de objetivos, planos, responsáveis e revisões; autorização e composição de leituras, sem lógica de negócio escondida nos componentes.
- `packages/intelligence`: preservar cálculo, evidências e ranking; acrescentar relação com objetivo e justificativa de prioridade onde necessário.
- `packages/execution`: manter fonte única do estado da ação e da aprovação; conectar execuções aos planos. Não criar executor paralelo no frontend.
- `packages/chat`: reutilizar `ChatPanel` e protocolo; acrescentar referência contextual estruturada, resolvida e autorizada no servidor. Texto em `?q=` não substitui vínculo persistente.
- `packages/database`: migrações aditivas para relações, versões e medição. Registros históricos sem vínculos permanecem como histórico sem atribuição.

### Modelo mínimo a acrescentar

1. Estender `Goal` com título de negócio, responsável, baseline/referência e versão quando necessário. Reutilizar a entidade existente como base de Objetivos.
2. Criar plano vinculado ao objetivo e, opcionalmente, à recomendação/insight: escopo, versão, status, responsável e próxima revisão.
3. Passos de plano com vínculo opcional à execução real, capacidade disponível e resultado operacional. Validar se uma relação de associação é necessária para ações com várias execuções.
4. Definição de medição e revisões: indicador, unidade, coorte, janela, baseline, observado, fontes e limitações de atribuição.
5. Preservar evidência/versionamento usados na decisão: o snapshot atual de métricas é atualizável e não basta, sozinho, para reproduzir uma decisão histórica.
6. Associar evidências operacionais ao plano e ao registro de origem: sistema ou pessoa/canal, referência externa, tipo (`observed`, `reported`, `inferred`), momento do evento, ingestão e validade. Reutilizar interações existentes quando suficientes.
7. Persistir lacunas e sua resolução: responsável Ops, tentativas de obtenção, pergunta contextual e limites de contato. Deduplicar por empresa, assunto, pessoa e contexto relevante; impedir novas cobranças após resolução.

Separar os eixos: estado do plano, decisão de aprovação, estado da execução e estado da medição. A conclusão da execução não marca automaticamente sucesso comercial.

### Contratos propostos

- Leitura agregada de Hoje com objetivo em foco, prioridades, pendências, execuções e disponibilidade por bloco. Pode começar como composição de services no servidor; criar endpoint compartilhado somente se necessário.
- Envelope de métrica: valor anulável, unidade, período, comparação, disponibilidade (`ready`, `empty`, `partial`, `stale`, `error`), referências e timestamps. Não calcular resultado comercial no navegador.
- Novos recursos de planos e revisões em `/api/v1/plans` e sub-recursos; criação de plano a partir de recomendação explícita e idempotente. Endpoint exato deve ser fechado com a modelagem.
- Reutilizar `/api/v1/goals`, `/recommendations`, `/approvals` e `/action-executions` para suas responsabilidades atuais. Não alterar silenciosamente `recommendations/:id/accept` para disparar efeitos, pois outros clientes podem depender da semântica atual.
- Prévia de decisão inclui versão e capacidade real de executar/cancelar; servidor valida novamente no momento da mutação. Empresa e permissões vêm do contexto autorizado.
- Observação de andamento por ingestão, eventos ou consultas periódicas conforme capacidade real de cada fonte, sem depender de navegação ou sessão aberta. Processamento idempotente, reconciliação de eventos atrasados e preservação de conflitos.
- Esclarecimentos pelo canal existente devem reutilizar identidade, permissões e processamento de interações. Validar suporte atual a contatos proativos e respostas correlacionadas antes de implementá-los; não presumir que receber mensagens já oferece essa capacidade. Configuração e eventual tratamento manual ficam com Ops, sem criar cadastro de atualização para o cliente.

### Responsabilidade operacional do Ops

Ops assume configuração, saneamento, mapeamento de responsáveis, preparação de planos, fontes de monitoramento, reconciliação e recuperação de falhas. O dono recebe apenas intenção a esclarecer, autorização necessária ou decisão de negócio que não possa ser resolvida pelas regras acordadas. Consentimentos que dependem do titular permanecem com ele, apresentados com contexto e esforço mínimo.

Para evitar que o backoffice vire uma fila opaca de trabalho manual, cada exceção tem responsável, impacto e próximo passo; casos repetidos alimentam melhorias de integração e automação. Medir tempo e custo Ops por empresa e por lacuna. Limites de capacidade são tratados pela operação e pelo escopo do serviço, sem repassar preenchimentos ao cliente. Não prometer resolução ou prazo antes de existir cobertura operacional.

## 9. Entregas e critérios de saída

Estimativa relativa: P = concentrada em poucos componentes; M = cruza páginas/services; G = exige modelagem, integrações e validação de ponta a ponta. Prazo em semanas depende de equipe, dados e resultado escolhido para o piloto.

| Ordem | Entrega | Porte | Dependência | Critério de saída |
|---|---|---|---|---|
| 0 | Validar jornada com 5–8 empresários e mapear fontes, canais e capacidade Ops | P/M | Acesso a participantes | Resultado piloto e caminho de coleta definidos; protótipo funciona sem reporte manual do cliente |
| 1 | Corrigir semântica de confiança: indisponível ≠ zero, políticas reais, entradas/saídas legíveis | M | Auditoria por capacidade | Nenhuma tela crítica apresenta falha como valor válido ou promete autorização diferente da real |
| 2 | Novo shell e Hoje; objetivos preparados; configuração assistida e fila de lacunas no Ops | M/G | Contratos de disponibilidade e protótipo | Usuário identifica prioridade e decisão; Ops absorve pendências técnicas; rotas antigas funcionam |
| 3 | Primeiro ciclo completo de plano → decisão → execução → coleta → medição | G | Modelagem aditiva, fontes e capacidade Ops/canal | Caso real chega à revisão sem reporte manual, com evidência importada ou relato identificado e limitações explícitas |
| 4 | Operação consolidada, revisão semanal e conversa contextual | M/G | Ciclo completo validado | Usuário acompanha pendências e efeitos sem buscar contexto em várias telas |
| 5 | Piloto ampliado, refinamento e liberação gradual | M | Uso real e instrumentação | Critérios de qualidade cumpridos; retenção e compreensão avaliadas; rollback de UI disponível |

Entregas 0 e a investigação da 1 podem ocorrer em paralelo. Tokens e acessibilidade entram na entrega 2 e são verificados em todas as seguintes. A medição mínima faz parte da entrega 3, para que o piloto já feche o ciclo.

**Primeiro recorte recomendado:** recuperar clientes inativos a partir dos dados de vendas disponíveis; Tactia/Ops prepara lista, responsáveis e abordagem no processo comercial existente. O dono decide somente condições que exijam sua autoridade. A Tactia acompanha contatos pelas fontes disponíveis e compras posteriores pelo sistema de vendas. Lacunas vão para Ops e, quando necessário, geram uma pergunta pontual ao envolvido no canal habitual. Sem resposta, manter informação desconhecida; não exigir formulário, check-in ou login para atualizar status. Envio automático em massa não é pré-requisito do piloto.

**Fora do primeiro recorte:** customizador de dashboard, marketplace de agentes, criador genérico de workflows, novo CRM, novas integrações apenas para preencher telas e autonomia irrestrita. Expandir os resultados cobertos somente após validar o primeiro ciclo.

### Estratégia de migração e liberação

- Feature flag por empresa para shell/Hoje e para o ciclo de planos; não oferecer botões para etapas ainda indisponíveis.
- Migrações aditivas, links estáveis e manutenção das APIs já consumidas por chat/canais externos.
- Rodar composição nova com dados reais em piloto controlado e comparar métricas com os services atuais.
- Rollback de interface preserva planos, auditoria e execuções. Nunca reverter execução externa como se fosse reversão de layout.
- Rotinas e autorizações existentes não ganham permissões novas por causa da refatoração visual.

## 10. Validação e métricas

### Pesquisa e usabilidade

No protótipo, pedir que o empresário encontre a prioridade, explique sua fonte, diga o que acontecerá ao aprovar e descubra como acompanhar. Validar também falta de dados, falha de execução e uso móvel. Simular empresa que não acessa a Tactia para reportar nada: testar coleta, lacunas, tratamento Ops e ausência de resposta a perguntas. Medir compreensão e trabalho adicional imposto à empresa antes de otimizar cliques.

Metas iniciais propostas para o piloto, a calibrar após baseline: pelo menos 80% identificam a prioridade e o próximo passo em até 60 segundos; pelo menos 80% concluem a jornada sem ajuda; nenhum participante deve interpretar aprovação como garantia de crescimento. Amostra pequena fornece diagnóstico qualitativo, não evidência estatística de toda a base.

### Métricas de produto

| Métrica | Definição e uso |
|---|---|
| Tempo até primeiro valor | Do acesso com dados utilizáveis ao primeiro diagnóstico compreendido/plano revisado; medir separadamente espera de integração |
| Ciclos acompanhados | Percentual de planos elegíveis cuja execução e revisão ocorreram no prazo acordado |
| Resultado observado | Indicador do plano versus baseline/alvo, com janela e qualidade; não somar planos sobrepostos como impacto independente |
| Clareza da delegação | Usuário consegue explicar alcance, responsável e próxima etapa após revisar |
| Confiabilidade operacional | Falhas, duplicações, reversões de decisão e bloqueios; segmentar por capacidade |
| Coleta sem intervenção | Percentual das evidências necessárias obtidas de fontes autorizadas sem perguntar a alguém |
| Esforço adicional do cliente | Campos/reportes obrigatórios para acompanhamento: zero; medir separadamente tempo de decisões legítimas e de esclarecimentos pontuais |
| Carga de interrupções | Perguntas por pessoa/período, repetidas ou evitáveis, respeitando orçamento de contato configurado por Ops |
| Resolução pelo Ops | Lacunas resolvidas sem envolver o cliente, tempo de resolução, recorrência e custo por empresa |
| Acompanhamento contínuo | Planos com evidência e revisão atualizadas mesmo sem acesso ao app; retorno para decidir é sinal auxiliar, não obrigação de uso |

Instrumentar eventos sem payload de mensagens ou dados pessoais desnecessários; medir decisões/execuções confirmadas no servidor. Hipótese de indicador principal: empresas ativas que completam um ciclo de ação e revisão por período, adequado à cadência do negócio. Resultado comercial e ausência de incidentes funcionam como contrapesos para evitar otimizar apenas atividade.

### Aceite de engenharia

- Testes de integração para indisponibilidade versus zero, isolamento por tenant, permissões, versão da aprovação, idempotência, concorrência e timeout com reconciliação.
- Ponta a ponta para primeiro acesso, plano revisado, aprovação, execução, revisão e retomada após refresh; cenários de falha parcial e canal indisponível.
- Ponta a ponta sem preenchimento ou atualização de status pelo cliente: ingestão atualiza andamento; lacunas chegam a Ops; resposta no canal vira relato vinculado sem redigitação.
- Verificar ausência de resposta, conflito de fontes, evento atrasado, cancelamento de pergunta já resolvida, deduplicação entre canais e limites de contato; silêncio nunca confirma uma ação.
- Verificação visual de temas e larguras 360/768/1280px, teclado, leitor de tela e zoom; gráficos com acesso tabular equivalente.
- Validar chat compartilhado, agendamentos e links antigos; estados de execução não dependem de o usuário manter a página aberta.
- Executar lint, typecheck, testes relevantes e build conforme pacotes afetados, após implementação.
- Meta de desempenho em campo no percentil 75, separando móvel/desktop: LCP ≤ 2,5s, INP ≤ 200ms e CLS ≤ 0,1; medir antes/depois. Renderizar conteúdo útil sem esperar geração de texto da IA. Referência: [Web Vitals](https://web.dev/articles/vitals).

## 11. Decisões ainda sujeitas à validação

O plano assume onboarding assistido, foco comercial inicial e permissões atuais. A ausência de alimentação manual pelo cliente e a absorção de complexidade pelo Ops são requisitos definidos, não hipóteses a validar. Confirmar com pesquisa o segmento prioritário, os sistemas e canais habituais, o resultado piloto, a política de contato/revisão e quais dados podem medir resultado. Essas respostas ajustam o conteúdo e a sequência de expansão; não impedem corrigir as lacunas de confiança já identificadas.

O pacote de handoff segue a estrutura da skill `frontend-design-ui-ux`: contexto, fluxos e estados, contratos de componentes, tokens, alvo de engenharia e critérios de aceite. A próxima implementação deve começar pela semântica de confiança e por um ciclo completo de resultado, com a nova hierarquia visual acompanhando essas entregas.
