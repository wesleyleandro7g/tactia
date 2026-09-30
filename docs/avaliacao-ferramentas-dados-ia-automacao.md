# Avaliação de ferramentas para dados, IA e automação

**Projeto:** Tactia  
**Data da avaliação:** 28/09/2026  
**Status:** recomendação para consulta e reavaliação futura; não constitui aprovação de implementação.  
**Escopo:** PyAutoGUI, Selenium, Pandas, Scikit-learn, LangChain, Streamlit e ferramentas complementares.

## 1. Objetivo e contexto

Avaliar quais ferramentas podem contribuir para o objetivo do Tactia: transformar dados empresariais dispersos em entendimento, decisões e execução, com isolamento entre empresas e rastreabilidade.

A avaliação considera a documentação e o código disponíveis nesta data. Não inclui benchmark, auditoria completa de produção ou validação da quantidade e qualidade dos dados de clientes. As recomendações devem ser revisitadas quando houver uma demanda concreta ou mudança de arquitetura.

O projeto já possui:

- Next.js para o produto e o backoffice Tactia Ops.
- PostgreSQL e Prisma para persistência.
- Modelo canônico e pipeline de importação, normalização e qualidade de dados.
- Motor de métricas, regras, insights e recomendações.
- Previsões com sazonalidade semanal e suavização de Holt, além de pontuação determinística de insights.
- Orquestrador próprio de IA, registro de ferramentas, construção de contexto e Vercel AI SDK por meio de um adaptador.
- Fila `pg-boss`, execução de ações e aprovações.
- Browser Agent, integração com Figranium e ingestão HTTP com Scrapling.

Os princípios que orientam a decisão são: isolamento entre empresas, preservação de dados brutos e normalizados, cálculos em código, evidências para respostas e rastreabilidade de ações.

## 2. Recomendação resumida

| Ferramenta | Recomendação nesta data | Aplicação principal | Condição para adoção |
| --- | --- | --- | --- |
| PyAutoGUI | Não incluir agora; considerar por demanda | Automação de aplicativos desktop legados | Cliente com sistema sem integração acessível e rotina que justifique executor dedicado |
| Selenium | Não incluir agora | Automação web com WebDriver | Exigência de integração ou reaproveitamento relevante de automações existentes |
| Pandas | Priorizar um piloto delimitado | Preparação, conciliação e análise de dados | Fluxo real em que simplifique transformações complexas |
| Scikit-learn | Considerar como evolução | Predição, segmentação e detecção de anomalias | Dados adequados e melhoria demonstrada sobre métodos atuais |
| LangChain | Não incluir agora | Abstrações e integrações para agentes | Lacuna concreta com benefício superior ao custo de integração |
| Streamlit | Opcional para uso interno | Exploração e demonstrações analíticas | Necessidade recorrente de experimentar análises rapidamente |

## 3. PyAutoGUI e Selenium

### 3.1. PyAutoGUI

PyAutoGUI controla mouse, teclado e elementos visuais do computador. Seu espaço no Tactia seria automatizar aplicativos desktop que não possam ser atendidos por API, banco, exportação ou navegador.

**Onde:** em um executor instalado em máquina ou VM dedicada, com acesso ao aplicativo do cliente.

**Como:** a camada de execução do Tactia enviaria tarefas ao executor, que operaria o aplicativo e devolveria resultados, arquivos e evidências. Credenciais, autorização, status e auditoria permaneceriam integrados ao Tactia.

**Para quê:** exportar relatórios de um ERP desktop, preencher cadastros ou executar rotinas disponíveis apenas na interface gráfica.

**Por que faria sentido:** ampliaria o alcance do produto para sistemas legados que a automação web não atende.

**Por que não incluir agora:** não foi identificada nesta avaliação uma demanda concreta que justifique o custo de manter uma sessão gráfica, lidar com foco de janelas e adaptar a automação a mudanças de resolução, posição e aparência.

**Gatilho de reavaliação:** cliente com rotina desktop recorrente, acesso autorizado e benefício operacional mensurável.

**Critério de sucesso do piloto:** executar a rotina repetidamente com resultado verificável, recuperação de falhas e redução de trabalho manual suficiente para compensar a manutenção.

### 3.2. Selenium

Selenium controla navegadores por WebDriver. Essa capacidade se sobrepõe aos caminhos de automação web já presentes no projeto.

**Onde, se necessário:** como adaptador do contrato `BrowserExecutor`, reutilizando fila, credenciais, auditoria e artefatos existentes.

**Como:** implementar apenas a tradução do contrato para WebDriver, mantendo a semântica do provedor e o pipeline de dados nas camadas atuais.

**Para quê:** atender uma integração que exija WebDriver ou reaproveitar automações Selenium já utilizadas por um cliente.

**Por que não incluir agora:** acrescentaria outro mecanismo de navegador para manter, testar e observar sem uma lacuna prioritária demonstrada.

**Gatilho de reavaliação:** exigência técnica comprovada ou conjunto de automações existentes cujo reaproveitamento economize trabalho significativo.

**Critério de sucesso do piloto:** demonstrar vantagem concreta sobre os mecanismos atuais, preservando isolamento de sessões e rastreabilidade.

## 4. Pandas

**Recomendação:** realizar um piloto em um fluxo real de importação ou conciliação.

Pandas oferece operações de junção, agrupamento, transformação, tratamento de valores ausentes e leitura de formatos tabulares. Pode reduzir o esforço para tratar dados empresariais heterogêneos.

**Onde:** em um serviço Python de processamento de dados, acionado pelos conectores ou pela fila existente. Esse serviço é uma proposta, não uma implementação existente.

**Como:** receber arquivos ou conjuntos de dados delimitados, aplicar transformações versionadas e devolver dados estruturados ao pipeline canônico. Processamentos demorados devem acontecer em segundo plano.

**Para quê:**

- Conciliar exportações de ERP.
- Cruzar vendas, clientes e recebimentos.
- Padronizar datas, códigos e campos inconsistentes.
- Preparar análises por grupos de clientes.
- Construir variáveis de entrada para modelos estatísticos.

**Exemplo de piloto:** receber três exportações com vendas, clientes e pagamentos, identificar divergências e produzir uma base conciliada para o Tactia analisar.

**Por que incluir:** transformações tabulares complexas podem ficar mais simples de implementar e manter.

**Limites:** manter no PostgreSQL e no motor atual as métricas que já são bem atendidas. Evitar definições divergentes de receita, cliente ativo ou ticket médio. Preservar a origem dos dados, o isolamento entre empresas e a validação antes da publicação canônica. Medir consumo de memória e tempo com arquivos representativos.

**Critério de sucesso do piloto:** redução de esforço ou tempo de processamento, resultados reconciliados com a origem e reprocessamento reproduzível.

## 5. Scikit-learn

**Recomendação:** considerar após definir uma pergunta de negócio e verificar a disponibilidade dos dados necessários.

Scikit-learn oferece classificação, regressão, agrupamento, pré-processamento e avaliação de modelos.

**Onde:** em um serviço Python de treinamento e inferência, com resultados consumidos por `packages/intelligence` e apresentados nos insights e no chat.

**Como:** executar treinamentos em segundo plano, versionar modelos e resultados, registrar o período dos dados utilizados e disponibilizar inferências por uma interface interna. Previsões devem ser identificadas como estimativas, com avaliação de qualidade adequada ao caso de uso.

**Para quê:**

- Estimar quais clientes têm maior chance de deixar de comprar.
- Priorizar leads pela probabilidade de conversão.
- Segmentar clientes por comportamento.
- Detectar combinações atípicas de indicadores.

**Por que incluir:** pode capturar padrões que regras fixas não representam bem e melhorar a priorização de ações.

**Por que não adotar indiscriminadamente:** o Tactia já possui previsões com sazonalidade e Holt, além de regras e pontuação determinística. A presença de uma biblioteca de machine learning não garante ganho sobre esses métodos.

Não foi verificado nesta avaliação se os clientes já possuem histórico suficiente, representativo e confiável. Modelos supervisionados também exigem resultados históricos observáveis, como quais leads converteram.

**Condições para produção:**

1. Definir a decisão que o modelo pretende melhorar.
2. Comparar com uma regra simples e, quando aplicável, com o método atual do Tactia.
3. Avaliar em dados não usados no treinamento; para problemas temporais, usar períodos posteriores e evitar informações do futuro nas variáveis.
4. Medir qualidade por empresa ou segmento relevante e preservar isolamento dos dados.
5. Acompanhar degradação, versionar o modelo e manter uma alternativa quando a previsão não for confiável.

**Critério de sucesso do piloto:** melhoria mensurável, como menos alertas irrelevantes, melhor priorização ou menor erro de previsão, suficiente para compensar treinamento e manutenção.

## 6. LangChain

**Recomendação:** não incluir no núcleo neste momento.

LangChain oferece abstrações para modelos, ferramentas e execução de agentes. O Tactia já atende boa parte dessas responsabilidades com seu orquestrador, registro de ferramentas, construção de contexto e adaptadores.

**Por que não incluir agora:** seria necessário integrar duas camadas que precisam concordar sobre contexto, erros, ferramentas e estado, preservando autorização, evidências e controles existentes. Não foi identificada uma lacuna concreta que compense esse custo.

**Onde e como poderia entrar:** em uma integração delimitada, por meio de um adaptador, caso um componente do ecossistema ofereça reaproveitamento relevante. A adoção não deve implicar automaticamente substituir o orquestrador inteiro.

**Gatilho de reavaliação:** integração específica ou aumento comprovado de complexidade que torne a manutenção atual mais custosa que a adoção.

### LangGraph como avaliação separada

Se surgir necessidade de fluxos longos com ramificações, checkpoints e retomada, avaliar LangGraph separadamente. Ele é direcionado à orquestração persistente e pode ser utilizado sem LangChain.

Nesse cenário, deve ficar explícito qual estado pertence ao fluxo de IA e qual pertence à execução de negócio. Sua relação com `pg-boss`, aprovações, tentativas e registros existentes precisa ser definida para evitar duas fontes de verdade.

**Critério de sucesso do piloto:** simplificar um fluxo real e demonstrar retomada correta após interrupção, sem duplicar efeitos externos.

## 7. Streamlit

**Recomendação:** uso opcional como laboratório interno.

Streamlit permite construir aplicações analíticas com backend Python e interface no navegador.

**Onde:** em uma aplicação interna separada do produto e do Tactia Ops.

**Como:** consumir conjuntos de dados autorizados e os mesmos serviços analíticos usados pelos experimentos. Se publicado para múltiplos usuários, integrar autenticação e escopo de acesso adequados.

**Para quê:** comparar modelos, explorar dados, testar parâmetros e demonstrar análises em consultorias.

**Por que incluir:** validar hipóteses rapidamente antes de investir em uma interface definitiva.

**Por que não substituir as interfaces atuais:** funcionalidades permanentes de clientes e operadores já têm espaço em Next.js e no Tactia Ops. Outra aplicação acrescentaria integração de identidade, permissões, implantação e experiência de uso.

**Gatilho de reavaliação:** experimentos recorrentes que precisem de uma interface compartilhável e sejam demorados de validar pela interface principal.

**Critério de sucesso do piloto:** diminuir o tempo de validação de uma análise sem criar regras de negócio paralelas.

## 8. Ferramentas complementares

| Ferramenta | Onde e como usar | Benefício esperado | Condição |
| --- | --- | --- | --- |
| Playwright Test | Testes de navegador dos fluxos de login, chat, aprovação e operação no backoffice, executados no CI | Verificar a experiência completa do usuário com integração ao ecossistema TypeScript | Priorizar fluxos críticos e complementar a cobertura existente |
| Pandera | Validar tipos, campos obrigatórios e regras dos conjuntos de dados no eventual serviço Pandas | Impedir publicação de resultados inválidos e produzir erros úteis para operação | Adotar junto ao piloto de processamento tabular, mantendo coerência com as validações canônicas |
| LangGraph | Orquestração de fluxos persistentes complexos dentro da camada de IA | Estruturar ramificações e retomadas | Demonstrar necessidade que justifique a integração com a execução existente |

Playwright Test é sugerido inicialmente para qualidade do produto. Isso não implica substituir os executores de automação operacional existentes.

## 9. Ordem sugerida de investimento

1. **Ampliar a verificação dos fluxos atuais:** cobrir experiências críticas e tornar falhas observáveis.
2. **Experimentar Pandas e Pandera em uma conciliação real:** medir esforço, qualidade e custo operacional.
3. **Testar um único modelo Scikit-learn:** escolher um problema relevante e comparar com os métodos existentes.
4. **Adicionar Streamlit se os experimentos justificarem:** manter seu papel de laboratório claramente definido.
5. **Reavaliar automação desktop, Selenium e frameworks de agentes por demanda:** exigir um caso concreto antes de expandir a infraestrutura.

Cada nova dependência deve estar ligada a um resultado mensurável para o cliente. Esta ordem é uma recomendação, não um cronograma aprovado.

## 10. Roteiro para reavaliação futura

Ao retomar este documento, registrar para cada ferramenta:

| Questão | Registro da próxima avaliação |
| --- | --- |
| Qual cliente ou problema concreto motiva a adoção? | A preencher |
| Como o Tactia resolve isso atualmente? | A preencher |
| Qual limitação foi demonstrada? | A preencher |
| Que alternativa mais simples foi comparada? | A preencher |
| Quais dados, acessos e infraestrutura estão disponíveis? | A preencher |
| Qual métrica determina o sucesso do piloto? | A preencher |
| Como preservar isolamento, evidências e rastreabilidade? | A preencher |
| Quem manterá a solução e qual é o custo operacional? | A preencher |
| Qual foi o resultado e a decisão: adotar, adiar ou descartar? | A preencher |
| Data e responsável pela revisão | A preencher |

## 11. Referências

### Projeto

- [Especificação do Tactia](../spec.md): visão e princípios arquiteturais.
- [README](../README.md): stack e organização do projeto.
- [Arquitetura de integrações por navegador](integrations/browser-architecture.md): contratos, execução e responsabilidades.
- [Browser Automation Runtime](../services/browser-runtime/README.md): operação do Browser Agent.
- [HTML ingest](../services/html-ingest/README.md): ingestão HTTP com Scrapling.
- [Previsão atual](../packages/intelligence/src/forecast.ts): sazonalidade semanal e Holt.
- [Pontuação atual de insights](../packages/intelligence/src/scoring.ts): critérios determinísticos.
- [Dependências da camada de IA](../packages/ai/package.json): SDK e integrações.

### Documentação oficial consultada

- [PyAutoGUI — Quickstart](https://pyautogui.readthedocs.io/en/latest/quickstart.html).
- [Selenium — Overview](https://www.selenium.dev/documentation/overview/).
- [Pandas — Package overview](https://pandas.pydata.org/docs/getting_started/overview.html).
- [Scikit-learn — Getting started](https://scikit-learn.org/stable/getting_started.html).
- [LangChain — Overview](https://docs.langchain.com/oss/python/langchain/overview).
- [LangGraph — Overview](https://docs.langchain.com/oss/python/langgraph/overview).
- [Streamlit — Client-server architecture](https://docs.streamlit.io/develop/concepts/architecture/architecture).
- [Playwright Test — Introduction](https://playwright.dev/docs/intro).
- [Pandera — Documentation](https://pandera.readthedocs.io/en/stable/).

As recomendações arquiteturais são julgamentos aplicados ao contexto do Tactia. As referências externas sustentam as capacidades descritas das ferramentas; sua documentação pode evoluir após esta avaliação.
