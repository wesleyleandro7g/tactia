
# Tactia — Flexible Business Data & Agent Tools

**Tipo:** Technical Specification (SPEC)

**Status:** In progress (v1 adapted)

**Objetivo:** Implementar suporte a dados customizados por tenant usando PostgreSQL JSONB, adaptar as ferramentas de consulta e ação do agente de IA e estabelecer um contrato estruturado de dados para análises e correlações.

### Adaptação v1 (execução)

A spec original descreve um desenho genérico. A v1 adapta-o ao código existente:

* Banco: Prisma + PostgreSQL. Sem tabela `business_records`, sem `service_orders`, sem `integration_raw_data` (payloads brutos já estão em `raw_records`).
* Entidades com `custom_data` nesta entrega: `customers`, `products`, `sales`, `sale_items`. `metadata` permanece para flags de sistema.
* Isolamento: filtro `tenantId` + authz (spec.md §34). Postgres RLS / `app.current_tenant_id` fica fora desta entrega.
* Tools novas: `get_data_catalog`, `query_business_data`, `aggregate_business_data`. Sem tools de nicho (`get_equipment_performance`, etc.).
* Envelope do agente: manter `ToolResult { data, sources }`. Meta de consulta vai dentro de `data`.
* UI: CRUD de definições no Admin Ops. Sem telas de entidade no app web.
* Catálogo de campos (`get_data_catalog`) não se confunde com a tool `search_catalog` (busca semântica de produtos/clientes).

---

## 1. Contexto e problema

A Tactia utiliza um único banco de dados PostgreSQL compartilhado entre todos os clientes, com isolamento rigoroso por `tenant_id`.

O modelo relacional atual contém entidades e campos fixos. Entretanto, clientes de diferentes nichos possuem informações específicas do negócio que não são compartilhadas entre os demais clientes.

Exemplos:

* Óticas: receitas oftalmológicas, medidas de lentes, armações e informações de laboratório.
* Distribuidoras: representantes, comissões, condições comerciais e regiões de venda.
* Assistências técnicas: equipamentos, número de série, horas técnicas e tipo de manutenção.

O modelo atual exigiria alterações de schema para cada novo campo, dificultando a implantação de clientes e a evolução do produto.

### Decisão arquitetural

Manter PostgreSQL como banco principal e adicionar suporte a dados flexíveis por meio de `JSONB`, com catálogo de metadados, validação de campos e ferramentas de negócio que abstraem a estrutura física do banco.

O agente não deverá depender de SQL arbitrário nem conhecer diretamente a implementação das tabelas.

---

## 2. Objetivos

### 2.1 Objetivos funcionais

1. Permitir que cada tenant armazene atributos específicos sem migrations frequentes.
2. Manter os dados comuns em colunas relacionais e relacionamentos tradicionais.
3. Permitir a definição de campos customizados por entidade e tenant.
4. Permitir que as tools consultem campos customizados e comuns.
5. Fornecer ao agente um catálogo de dados com nomes, tipos e descrições.
6. Retornar resultados em formato estruturado e previsível.
7. Permitir correlações entre entidades, dados relacionais e atributos JSONB.
8. Manter isolamento de dados em todas as operações.
9. Permitir que integrações preservem payloads originais sem poluir o modelo canônico.
10. Facilitar a evolução futura para tabelas especializadas quando necessário.

### 2.2 Não objetivos

* Migrar para MongoDB ou outro banco NoSQL.
* Criar um ERP completo dentro da Tactia.
* Permitir SQL livre executado pelo modelo de IA.
* Criar uma tool exclusiva para cada campo customizado.
* Implementar uma plataforma genérica de BI ou data warehouse.
* Substituir todas as tools de negócio existentes por uma única query tool.
* Criar um sistema de schema totalmente livre, sem validação ou catálogo.

---

## 3. Arquitetura proposta

### 3.1 Componentes

A solução deverá conter:

1. PostgreSQL compartilhado com RLS.
2. Modelo de dados canônico com colunas fixas.
3. Coluna `custom_data JSONB` nas entidades que suportam atributos flexíveis.
4. Tabela de definições de campos customizados.
5. Catálogo de dados por tenant.
6. Camada de consulta estruturada.
7. Tools específicas de negócio.
8. Camada de normalização de resultados para o agente.
9. Camada de agregação analítica.
10. Camada de ações com validação de permissões.

### 3.2 Fluxo de dados

```text
ERP / CRM / WhatsApp / Arquivos
            |
            v
       Ingestion
            |
            v
     Normalization
            |
            v
       PostgreSQL
            |
     +------+------+
     |             |
     v             v
Canonical      Custom Data
Data           (JSONB)
     |             |
     +------+------+
            |
            v
       Data Catalog
            |
            v
       Agent Tools
            |
            v
        AI Agent
            |
            v
   Analysis / Planning / Actions
```

---

## 4. Modelo de dados

### 4.1 Entidades existentes

As entidades canônicas existentes deverão continuar usando colunas relacionais para dados comuns.

Exemplos:

* `tenants`
* `users`
* `customers`
* `products`
* `sales`
* `service_orders`
* `integrations`

Cada tabela que armazena dados de negócio deve possuir `tenant_id` quando aplicável e utilizar a estratégia de isolamento já adotada no projeto.

### 4.2 Coluna JSONB

Adicionar a coluna `custom_data` às entidades que suportam atributos customizados.

Exemplo:

```sql
ALTER TABLE business_records
ADD COLUMN custom_data JSONB NOT NULL DEFAULT '{}'::jsonb;
```

A migration deverá ser adaptada à estrutura real do projeto. Não criar uma tabela genérica se o projeto já possuir entidades canônicas adequadas para armazenar os registros.

Requisitos:

* Tipo `JSONB`.
* Valor padrão `{}`.
* Não aceitar `NULL`.
* Armazenar apenas JSON válido.
* Permitir objetos aninhados.
* Não utilizar JSONB para substituir relacionamentos que precisam de integridade referencial.

### 4.3 Definições de campos customizados

Criar uma tabela de metadados para descrever os campos disponíveis por tenant.

```sql
CREATE TABLE custom_field_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  entity_type TEXT NOT NULL,
  field_key TEXT NOT NULL,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL,
  description TEXT,
  required BOOLEAN NOT NULL DEFAULT false,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, entity_type, field_key)
);
```

Tipos de campos inicialmente suportados:

* `text`
* `number`
* `boolean`
* `date`
* `datetime`
* `select`
* `multiselect`
* `object`
* `array`

A implementação deverá validar `field_type` e rejeitar tipos desconhecidos.

### 4.4 Exemplo de definição

```json
{
  "tenant_id": "assistencia-001",
  "entity_type": "service_order",
  "field_key": "estimated_hours",
  "label": "Horas estimadas",
  "field_type": "number",
  "description": "Quantidade de horas previstas para execução",
  "required": false,
  "config": {
    "min": 0,
    "unit": "hours"
  }
}
```

### 4.5 Validação dos dados

A API deverá validar os valores de `custom_data` contra as definições de campos.

Regras:

* Campos desconhecidos podem ser rejeitados por padrão.
* Campos desconhecidos poderão ser preservados em uma área de dados de origem quando vierem de integrações.
* Campos obrigatórios devem ser validados.
* Tipos devem ser validados.
* `number` não pode aceitar strings arbitrárias.
* Campos `select` e `multiselect` devem respeitar opções válidas quando configuradas.
* Os valores devem pertencer ao tenant correto.

---

## 5. Tenancy e segurança

O isolamento de tenants é requisito crítico.

### 5.1 Regras

1. O `tenant_id` deverá ser derivado do contexto autenticado da requisição.
2. Nenhuma tool poderá confiar exclusivamente em `tenant_id` fornecido pelo modelo.
3. Toda consulta deverá respeitar o tenant atual.
4. Toda operação de escrita deverá validar o tenant.
5. RLS deverá permanecer habilitado nas tabelas protegidas.
6. O contexto do tenant deverá ser configurado de forma segura na transação.
7. Tools de integração, consulta e ação deverão compartilhar o mesmo mecanismo de autorização.

### 5.2 RLS

Para cada tabela aplicável, criar políticas de `SELECT`, `INSERT`, `UPDATE` e `DELETE`.

O uso de `current_setting('app.current_tenant_id')` deverá ser compatível com o mecanismo de conexão e transações utilizado pelo backend.

Não permitir que um agente ou usuário altere o contexto de tenant por meio de um parâmetro comum da API.

### 5.3 Auditoria

Registrar operações de escrita e ações executadas pelo agente:

* `tenant_id`
* usuário ou agente responsável
* tool executada
* entidade e registro afetados
* parâmetros sanitizados
* resultado
* timestamp
* status da operação

---

## 6. Catálogo de dados

Criar um serviço de catálogo capaz de retornar as entidades e campos disponíveis para um tenant.

### 6.1 Tool: `get_data_catalog`

**Objetivo:** Permitir que o agente descubra os campos e entidades disponíveis antes de realizar consultas.

Entrada:

```json
{
  "entity_type": "service_order"
}
```

Saída:

```json
{
  "tenant_id": "assistencia-001",
  "entities": [
    {
      "entity_type": "service_order",
      "fields": [
        {
          "key": "id",
          "label": "ID",
          "type": "uuid",
          "source": "canonical",
          "description": "Identificador da ordem"
        },
        {
          "key": "equipment_type",
          "label": "Tipo de equipamento",
          "type": "text",
          "source": "custom",
          "description": "Categoria do equipamento"
        },
        {
          "key": "estimated_hours",
          "label": "Horas estimadas",
          "type": "number",
          "source": "custom",
          "description": "Horas previstas para execução"
        }
      ]
    }
  ]
}
```

O catálogo deverá diferenciar:

* Campos canônicos.
* Campos customizados.
* Campos de origem.
* Campos calculados, quando houver.
* Campos disponíveis para filtro.
* Campos disponíveis para agregação.

### 6.2 Cache

O catálogo poderá ser cacheado por tenant e invalidado quando houver alterações nas definições de campos.

---

## 7. Camada de consulta estruturada

Criar uma camada de serviço responsável por traduzir uma consulta estruturada em SQL parametrizado.

Essa camada deverá ser utilizada pelas tools genéricas e poderá ser reutilizada pelas tools analíticas.

### 7.1 Tool: `query_business_data`

**Objetivo:** Consultar dados de negócio de forma estruturada, respeitando o catálogo e o tenancy.

Entrada:

```json
{
  "entity_type": "service_order",
  "fields": [
    "id",
    "equipment_type",
    "estimated_hours"
  ],
  "filters": [
    {
      "field": "equipment_type",
      "operator": "eq",
      "value": "Compressor"
    }
  ],
  "limit": 100
}
```

Saída:

```json
{
  "entity_type": "service_order",
  "rows": [
    {
      "id": "os-123",
      "equipment_type": "Compressor",
      "estimated_hours": 4
    }
  ],
  "meta": {
    "count": 1,
    "has_more": false,
    "fields": [
      "id",
      "equipment_type",
      "estimated_hours"
    ]
  }
}
```

### 7.2 Operadores

Implementar inicialmente:

* `eq`
* `neq`
* `gt`
* `gte`
* `lt`
* `lte`
* `contains`
* `in`
* `is_null`

Os operadores deverão ser validados de acordo com o tipo do campo.

### 7.3 SQL

A implementação deverá:

1. Validar a entidade.
2. Validar os campos.
3. Validar os operadores.
4. Validar os valores.
5. Mapear campos customizados para expressões JSONB.
6. Utilizar queries parametrizadas.
7. Aplicar o tenant context.
8. Limitar quantidade de registros.
9. Impor timeout de consulta.
10. Retornar erros estruturados.

Exemplo:

```sql
SELECT
  id,
  custom_data->>'equipment_type' AS equipment_type,
  (custom_data->>'estimated_hours')::numeric AS estimated_hours
FROM business_records
WHERE tenant_id = $1
  AND entity_type = $2
  AND custom_data->>'equipment_type' = $3
LIMIT $4;
```

A camada de consulta não deverá permitir que o agente forneça SQL arbitrário.

---

## 8. Tools específicas de negócio

As tools de negócio existentes deverão continuar sendo a interface principal para as perguntas mais comuns.

Exemplos:

* `get_sales`
* `get_customers`
* `get_products`
* `get_service_orders`
* `get_revenue_summary`
* `get_campaign_performance`
* `get_integration_data`

Cada tool deverá:

1. Ter schema de entrada definido.
2. Validar argumentos.
3. Utilizar o contexto do tenant.
4. Consultar dados canônicos e customizados quando necessário.
5. Retornar dados estruturados.
6. Não retornar informações de outros tenants.
7. Evitar enviar campos irrelevantes ao agente.

### 8.1 Exemplo: `get_service_orders`

Entrada:

```json
{
  "period": {
    "start": "2026-01-01",
    "end": "2026-03-31"
  },
  "equipment_type": "Compressor",
  "limit": 100
}
```

Saída:

```json
{
  "entity_type": "service_order",
  "rows": [
    {
      "id": "os-123",
      "customer_id": "customer-001",
      "status": "completed",
      "equipment": {
        "type": "Compressor",
        "serial_number": "CP-2026-001"
      },
      "estimated_hours": 4,
      "created_at": "2026-02-10"
    }
  ],
  "meta": {
    "count": 1,
    "has_more": false
  }
}
```

Os campos customizados deverão ser normalizados para uma estrutura semântica quando a tool possuir conhecimento do domínio.

---

## 9. Tools analíticas e correlações

O agente não deverá receber milhares de registros para realizar contagens, somas ou correlações simples.

Criar ferramentas analíticas que realizem agregações no PostgreSQL.

### 9.1 Tool: `get_equipment_performance`

**Objetivo:** Comparar equipamentos por volume de chamados e horas técnicas.

Entrada:

```json
{
  "period": {
    "start": "2026-01-01",
    "end": "2026-03-31"
  },
  "group_by": "equipment_type"
}
```

Saída:

```json
{
  "metrics": [
    {
      "equipment_type": "Compressor",
      "service_order_count": 18,
      "total_hours": 72
    },
    {
      "equipment_type": "Gerador",
      "service_order_count": 6,
      "total_hours": 30
    }
  ]
}
```

### 9.2 Regras analíticas

* Agregações deverão ser realizadas no banco.
* Campos numéricos customizados deverão ser convertidos e validados.
* O resultado deverá informar unidade de medida quando aplicável.
* A tool deverá retornar o período analisado.
* Consultas sem dados deverão retornar resultado vazio com metadados.
* A tool não deverá inventar métricas que não existam no banco.

### 9.3 Correlações entre entidades

Quando uma análise exigir dados de entidades diferentes, a implementação deverá utilizar:

* Joins SQL quando houver relacionamentos canônicos.
* Agregações SQL quando houver métricas.
* Tools especializadas quando a lógica for complexa.
* Dados customizados como atributos de agrupamento ou filtro quando apropriado.

O agente poderá combinar os resultados de várias tools para produzir uma explicação, mas cálculos críticos deverão ser executados por código determinístico.

---

## 10. Contrato de dados para o agente

Os resultados enviados ao modelo deverão ser estruturados, com nomes de campos semânticos e metadados suficientes para interpretação.

### 10.1 Envelope padrão

```typescript
interface AgentToolResult<T> {
  data: T;
  meta: {
    tenantId?: string;
    entityType?: string;
    fields?: string[];
    period?: {
      start: string;
      end: string;
    };
    count?: number;
    hasMore?: boolean;
    source?: string;
  };
  errors?: Array<{
    code: string;
    message: string;
  }>;
}
```

O `tenantId` deverá ser utilizado internamente e não deverá ser exposto desnecessariamente no contexto do modelo.

### 10.2 Exemplo de contexto

```json
{
  "tool": "get_equipment_performance",
  "result": {
    "metrics": [
      {
        "equipment_type": "Compressor",
        "service_order_count": 18,
        "total_hours": 72
      }
    ],
    "meta": {
      "period": {
        "start": "2026-01-01",
        "end": "2026-03-31"
      }
    }
  }
}
```

### 10.3 Contexto de negócio

O agente deverá receber instruções sobre:

* Nome da empresa.
* Segmento.
* Entidades disponíveis.
* Significado dos campos customizados.
* Unidades de medida.
* Regras específicas do negócio.
* Limitações de acesso.
* Ferramentas disponíveis.

O catálogo deverá ser fornecido sob demanda ou como contexto resumido, para evitar excesso de tokens.

---

## 11. Integrações e dados de origem

As integrações deverão preservar os payloads originais quando necessário.

Criar ou adaptar uma tabela para dados brutos de integração, caso ainda não exista:

```sql
CREATE TABLE integration_raw_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  integration_id UUID NOT NULL,
  entity_type TEXT NOT NULL,
  external_id TEXT,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Requisitos:

* Armazenar payload original.
* Manter identificação da origem.
* Permitir reprocessamento.
* Não expor dados brutos diretamente ao agente sem normalização.
* Aplicar tenancy.
* Registrar falhas de ingestão.

O modelo canônico deverá ser responsável por fornecer dados consistentes para as tools.

---

## 12. Performance e indexação

A implementação deverá medir o comportamento das consultas antes de adicionar índices indiscriminadamente.

Índices recomendados inicialmente:

```sql
CREATE INDEX idx_business_records_tenant_entity
ON business_records (tenant_id, entity_type);
```

Para campos JSONB consultados frequentemente:

```sql
CREATE INDEX idx_business_records_custom_data
ON business_records
USING GIN (custom_data);
```

Índices específicos deverão ser adicionados conforme os padrões de consulta:

```sql
CREATE INDEX idx_service_order_equipment_type
ON business_records (
  tenant_id,
  (custom_data->>'equipment_type')
)
WHERE entity_type = 'service_order';
```

Regras:

* Não indexar todos os campos customizados por padrão.
* Analisar queries com `EXPLAIN`.
* Considerar índices parciais.
* Monitorar tamanho dos índices.
* Aplicar limites e timeouts nas tools.

---

## 13. API e serviços

Criar serviços de domínio para evitar que cada tool implemente sua própria lógica de JSONB.

### Serviços

* `CustomFieldDefinitionService`
* `CustomDataValidationService`
* `DataCatalogService`
* `StructuredQueryService`
* `AgentContextService`
* `BusinessAnalyticsService`

### Responsabilidades

**CustomFieldDefinitionService**

CRUD de definições de campos, validação de chaves e configuração.

**CustomDataValidationService**

Validação de valores, tipos e campos obrigatórios.

**DataCatalogService**

Catálogo de entidades e campos disponíveis para o tenant.

**StructuredQueryService**

Tradução de filtros estruturados em SQL parametrizado.

**AgentContextService**

Normalização de resultados, metadados e montagem de contexto para o agente.

**BusinessAnalyticsService**

Agregações, métricas e correlações determinísticas.

---

## 14. Plano de implementação

### Fase 1 — Banco e tenancy

* [ ] Mapear entidades existentes.
* [ ] Identificar tabelas que receberão `custom_data`.
* [ ] Criar migrations.
* [ ] Criar tabela de definições.
* [ ] Validar RLS.
* [ ] Criar índices iniciais.
* [ ] Criar testes de isolamento.

### Fase 2 — Catálogo e validação

* [ ] Implementar `CustomFieldDefinitionService`.
* [ ] Implementar validação de `custom_data`.
* [ ] Implementar `DataCatalogService`.
* [ ] Criar endpoints internos para catálogo.
* [ ] Testar campos de diferentes tipos.
* [ ] Implementar cache e invalidação, se necessário.

### Fase 3 — Consulta estruturada

* [ ] Implementar `StructuredQueryService`.
* [ ] Implementar `query_business_data`.
* [ ] Implementar validação de entidades e campos.
* [ ] Implementar filtros.
* [ ] Implementar paginação.
* [ ] Implementar limites e timeouts.
* [ ] Testar campos canônicos e JSONB.

### Fase 4 — Ajuste das tools

* [ ] Mapear todas as tools atuais.
* [ ] Adaptar tools de leitura para incluir campos customizados.
* [ ] Criar schemas de entrada e saída.
* [ ] Criar ferramentas analíticas prioritárias.
* [ ] Criar normalização de resultados.
* [ ] Garantir tenancy em todas as tools.

### Fase 5 — Contexto do agente

* [ ] Implementar `AgentContextService`.
* [ ] Integrar catálogo com o agente.
* [ ] Definir formato de resultados.
* [ ] Atualizar system prompt e tool descriptions.
* [ ] Testar descoberta de campos.
* [ ] Testar correlações entre entidades.
* [ ] Validar limites de contexto e tokens.

### Fase 6 — Integrações e observabilidade

* [ ] Adaptar ingestão de dados.
* [ ] Preservar payloads de origem.
* [ ] Criar métricas de consulta.
* [ ] Criar logs de tools.
* [ ] Monitorar erros de validação.
* [ ] Monitorar performance.
* [ ] Testar reprocessamento.

---

## 15. Critérios de aceitação

### Banco

* [ ] É possível salvar dados customizados sem alterar schema.
* [ ] Campos canônicos continuam funcionando.
* [ ] JSONB aceita objetos aninhados.
* [ ] Dados inválidos são rejeitados.
* [ ] RLS impede acesso cruzado entre tenants.

### Tools

* [ ] `get_data_catalog` retorna os campos disponíveis.
* [ ] `query_business_data` consulta campos customizados.
* [ ] Tools específicas retornam dados estruturados.
* [ ] Tools analíticas calculam métricas no banco.
* [ ] Não existe execução de SQL arbitrário pelo agente.
* [ ] Resultados respeitam o tenant atual.

### Agente

* [ ] O agente consegue descobrir campos customizados.
* [ ] O agente consegue consultar esses campos.
* [ ] O agente consegue combinar resultados de múltiplas tools.
* [ ] O agente não precisa conhecer tabelas ou colunas físicas.
* [ ] O agente consegue explicar quando um campo não existe.
* [ ] O agente não inventa dados ausentes.

### Operação

* [ ] Migrations executam corretamente.
* [ ] Testes de integração passam.
* [ ] Testes de tenancy passam.
* [ ] Consultas possuem limites.
* [ ] Erros são observáveis.
* [ ] Dados brutos de integração podem ser reprocessados.

---

## 16. Riscos e decisões futuras

### Campos altamente estruturados

Se um domínio começar a exigir muitos relacionamentos, cálculos ou regras específicas, deverá ser promovido para tabelas dedicadas.

### Dados de origem

Dados brutos de integrações não devem ser tratados como dados canônicos sem normalização.

### Consultas complexas

Consultas analíticas complexas deverão ser implementadas como tools especializadas, não como consultas genéricas irrestritas.

### Evolução do catálogo

O catálogo deverá ser expandido conforme a Tactia atender novos segmentos e identificar campos comuns entre os clientes.

### Migração para outro banco

A migração para MongoDB só deverá ser considerada se houver uma necessidade comprovada de armazenamento ou consulta que não seja atendida adequadamente pelo PostgreSQL.

---

## 17. Resultado esperado

A Tactia deverá possuir um modelo de dados flexível, multi-tenant e orientado a negócio, capaz de suportar diferentes nichos sem alterações frequentes no schema principal.

Os agentes de IA deverão consultar dados por meio de ferramentas estruturadas, com contexto suficiente para interpretar os campos customizados e executar correlações confiáveis entre diferentes entidades.

O PostgreSQL permanecerá como fonte de verdade, enquanto JSONB, catálogo e tools especializadas fornecerão a flexibilidade necessária para a evolução do produto.
