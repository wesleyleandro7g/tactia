# Prompts para Geração de Dados Fictícios (Demo Tactia)

Este documento contém uma série de prompts (instruções) otimizados para serem enviados a uma IA com o objetivo de gerar dados fictícios estruturados (JSON). 

Nesta versão, focaremos **apenas nos dados de negócio (clientes, produtos, vendas e CRM)**. Dados internos do sistema, como usuários, insights e recomendações, não serão gerados por aqui.

Copie e cole cada bloco em sequência na mesma conversa com a IA para que ela mantenha o contexto dos UUIDs (IDs) gerados.

---

## 1. Contexto Base (Enviar primeiro)

```text
Você é um engenheiro de dados gerando uma massa de dados fictícios em JSON para popular o banco de dados de um sistema. 

O cenário é de uma **Empresa de E-commerce B2B de Suprimentos de Escritório e TI** chamada "TechOffice Supplies".

Regras Gerais:
1. O output de cada resposta deve ser **exclusivamente** um array JSON, sem texto adicional.
2. Utilize UUIDs (v4) reais e únicos para os IDs.
3. Mantenha as relações íntegras (se você criar um Customer com ID "X", lembre-se de usar "X" nas Vendas).
4. Considere que o ID da nossa empresa (tenantId) é sempre "00000000-0000-0000-0000-000000000001". Use este UUID em todos os campos `tenantId`.
5. Dados devem ser no contexto brasileiro: nomes em PT-BR, CNPJs/CPFs formatados ou apenas números, valores em BRL.
6. As datas devem englobar os últimos 6 meses.

Confirme que entendeu o cenário e as regras. Não gere nenhum dado ainda.
```

---

## 2. Prompt: Produtos

```text
Gere um array JSON para o modelo `Product` com 10 produtos típicos do nosso e-commerce B2B (ex: Notebooks, Monitores, Papel A4, Cadeiras Ergonômicas).

Campos necessários para cada objeto JSON:
- `id`: UUID único do produto.
- `tenantId`: "00000000-0000-0000-0000-000000000001"
- `name`: Nome do produto.
- `sku`: Código SKU realista.
- `category`: Categoria do produto.
- `cost`: Custo de aquisição (número decimal).
- `price`: Preço de venda (número decimal).
- `status`: "active" ou "inactive".
- `createdAt`: Data de criação no formato ISO 8601 (dos últimos 6 meses).
```

---

## 3. Prompt: Clientes

```text
Gere um array JSON para o modelo `Customer` com 15 clientes B2B (empresas reais fictícias do Brasil).

Campos necessários para cada objeto JSON:
- `id`: UUID único do cliente. Guardo esses IDs para usar depois.
- `tenantId`: "00000000-0000-0000-0000-000000000001"
- `name`: Razão Social ou Nome Fantasia.
- `email`: E-mail corporativo de contato.
- `phone`: Telefone comercial.
- `document`: CNPJ válido ou gerado realisticamente.
- `status`: "active" ou "inactive".
- `createdAt`: Data de criação no formato ISO 8601 (dos últimos 6 meses).
```

---

## 4. Prompt: Vendas

```text
Utilizando os IDs dos clientes (`customerId`) que você gerou no passo anterior, gere um array JSON para o modelo `Sale` representando 25 vendas distribuídas ao longo dos últimos 6 meses.

Campos necessários para cada objeto JSON:
- `id`: UUID único da venda. Guarde esses IDs para usar nos itens.
- `tenantId`: "00000000-0000-0000-0000-000000000001"
- `customerId`: UUID de um cliente gerado no passo anterior.
- `totalAmount`: Valor total da venda (número decimal).
- `discountAmount`: Valor de desconto (número decimal, pode ser 0).
- `currency`: "BRL"
- `status`: "pending", "confirmed", "cancelled" ou "refunded".
- `soldAt`: Data da venda no formato ISO 8601.
```

---

## 5. Prompt: Itens de Venda

```text
Para cada uma das vendas geradas no passo anterior (`saleId`), crie de 1 a 3 itens de venda associando aos produtos (`productId`) gerados lá no início. Gere o array JSON para o modelo `SaleItem`.

Certifique-se de que a lógica matemática faz sentido (quantity * unitPrice - discountAmount = totalAmount).

Campos necessários para cada objeto JSON:
- `id`: UUID único do item.
- `tenantId`: "00000000-0000-0000-0000-000000000001"
- `saleId`: UUID da venda correspondente.
- `productId`: UUID do produto correspondente.
- `quantity`: Quantidade comprada (número decimal, ex: 1.0, 5.0).
- `unitPrice`: Preço unitário no momento da venda (número decimal).
- `discountAmount`: Valor do desconto no item (número decimal, pode ser 0).
- `totalAmount`: Valor total deste item (número decimal).
```

---

## 6. Prompt: Leads

```text
Gere um array JSON para o modelo `Lead` com 8 potenciais clientes B2B que ainda não efetuaram compras.

Campos necessários para cada objeto JSON:
- `id`: UUID único do lead. Guarde esses IDs.
- `tenantId`: "00000000-0000-0000-0000-000000000001"
- `name`: Nome da empresa lead.
- `email`: E-mail de contato.
- `phone`: Telefone.
- `source`: Origem (ex: "Google Ads", "LinkedIn", "Indicação").
- `status`: "new", "contacted", "qualified", "proposal", "won" ou "lost".
- `score`: Pontuação do lead de 0 a 100 (inteiro).
- `createdAt`: Data no formato ISO 8601.
```

---

## 7. Prompt: Interações (Omnichannel)

```text
Gere um array JSON para o modelo `Interaction` contendo 15 interações de suporte/vendas. Use aleatoriamente os IDs de `Customer` (gerados no passo 3) ou deixe o `customerId` como nulo (representando um contato anônimo ou de lead não pareado).

Campos necessários para cada objeto JSON:
- `id`: UUID único da interação.
- `tenantId`: "00000000-0000-0000-0000-000000000001"
- `customerId`: UUID de um cliente existente ou null.
- `channel`: "whatsapp", "email", "note" ou "other".
- `direction`: "inbound" (recebida), "outbound" (enviada) ou "internal".
- `subject`: Assunto da mensagem (se for e-mail, ex: "Atraso na entrega do pedido").
- `body`: Conteúdo real da mensagem em português (simule o corpo do e-mail ou a mensagem do cliente no WhatsApp).
- `occurredAt`: Data da interação no formato ISO 8601.
- `intent`: "complaint" (reclamação), "praise" (elogio), "question" (dúvida) ou "other".
```

---

## 8. Prompt: Atividades (CRM Interno)

```text
Por fim, gere um array JSON para o modelo `Activity` contendo 15 registros de ações feitas por vendedores/operadores com os Clientes (`customerId`) ou Leads (`leadId`).

Campos necessários para cada objeto JSON:
- `id`: UUID único da atividade.
- `tenantId`: "00000000-0000-0000-0000-000000000001"
- `type`: "call", "email", "meeting", "message", "note", "task", "proposal" ou "status_change".
- `customerId`: UUID de um cliente existente (pode ser null se for de lead).
- `leadId`: UUID de um lead existente (pode ser null se for de cliente).
- `occurredAt`: Data de ocorrência no formato ISO 8601.
- `createdAt`: Data de criação no formato ISO 8601.
```
