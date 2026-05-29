# CaseCellShop Backend Challenge

API backend em Node.js para catálogo de produtos, checkout assíncrono e consulta de status de pedidos.

O objetivo desta entrega é mostrar uma solução de backend simples, porém consistente, com:

- catálogo com cache;
- checkout com idempotência obrigatória;
- consistência de estoque sob concorrência;
- documentação OpenAPI;
- testes automatizados de integração.

## Visão Geral

Esta API foi projetada para simular um fluxo de e-commerce enxuto. O foco não é integrar pagamento real, antifraude, ERP ou fila distribuída, e sim demonstrar decisões de engenharia claras em torno de cache, concorrência, idempotência e observabilidade.

### Principais responsabilidades

- `GET /products` retorna o catálogo de produtos.
- `POST /checkout` cria um pedido de forma assíncrona.
- `GET /orders/{orderId}/status` consulta o status do pedido.
- `GET /metrics` expõe métricas simples de comportamento da API.
- `GET /openapi.json` fornece o contrato da API.
- `GET /docs` abre o Swagger UI.

## Stack e por que ela foi escolhida

### Node.js 23

Escolhi Node.js 23 porque o projeto usa APIs modernas da plataforma, incluindo `node:sqlite` e o modelo atual de módulos ESM.

Trade-off:

- Vantagem: elimina dependências externas para o banco local e reduz complexidade operacional.
- Desvantagem: exige uma versão recente do runtime, o que pode limitar ambientes legados.

### Express

Express foi mantido como camada HTTP por ser simples, estável e fácil de ler para esse tipo de aplicação.

Trade-off:

- Vantagem: curva de aprendizado baixa, ecossistema maduro e menor sobrecarga de abstração.
- Desvantagem: menos estrutura “pronta” do que frameworks mais opinativos como NestJS ou Fastify com plugins específicos.

### TypeScript

TypeScript é usado para dar tipagem explícita ao fluxo da API, aos contratos de domínio e aos adapters de infraestrutura.

Trade-off:

- Vantagem: reduz erros de integração entre camadas e melhora a manutenção.
- Desvantagem: adiciona etapa de compilação e necessidade de tipar algumas partes verbosas, especialmente testes e JSON dinâmico.

### SQLite nativo via `node:sqlite`

O banco local usa `node:sqlite` para manter o projeto autocontido.

Trade-off:

- Vantagem: sem servidor externo, instalação mais simples e transações locais confiáveis.
- Desvantagem: não é a melhor escolha para alta concorrência distribuída ou multi-instância.

### Redis via `ioredis` / `BullMQ`

Redis é usado em duas frentes:

- **Cache de produtos** — backend principal com fallback em memória quando a conexão não está disponível.
- **Fila de checkout assíncrono** — o `POST /checkout` enfileira o pedido no BullMQ, e um worker Redis processa a finalização do estoque em segundo plano. Sem Redis, o checkout cai para processamento síncrono inline.

Trade-off:

- Vantagem: cache distribuído, TTL centralizado, fila resiliente e possibilidade de compartilhar estado entre instâncias.
- Desvantagem: adiciona dependência de infraestrutura, latência de rede e necessidade de tratamento de indisponibilidade (a aplicação degrada graciosamente).

### `node:test`

A suíte usa o runner nativo do Node.js.

Trade-off:

- Vantagem: sem framework externo de teste, integração simples com o runtime.
- Desvantagem: menos recursos “ricos” do que ferramentas como Vitest ou Jest.

## Configuração

Crie um arquivo `.env` na raiz do projeto para ajustar o ambiente.

Exemplo:

```env
PORT=3000
LOG_LEVEL=info
CACHE_TTL_MS=5000
REDIS_URL=redis://localhost:6379
```

### Variáveis de ambiente

- `PORT`: porta da API.
- `LOG_LEVEL`: nível dos logs estruturados.
- `CACHE_TTL_MS`: TTL do cache de produtos.
- `REDIS_URL`: URL da instância Redis usada como backend principal do cache.

### Comportamento quando a configuração falha

- Se `CACHE_TTL_MS` for inválida, a aplicação usa o valor padrão.
- Se `REDIS_URL` não existir ou a conexão falhar, a API continua operando com cache em memória.

## Como rodar

### Pré-requisitos

- Node.js 23+
- Docker (para Redis)

### Setup rápido

```bash
# 1. instalar dependências
npm install

# 2. subir Redis com Docker
npm run docker:up

# 3. iniciar a API
npm run dev
```

Por padrão a API sobe em `http://localhost:3000`.

> Sem Docker/Redis a aplicação ainda funciona — o cache cai para memória e o checkout processa de forma síncrona. Para desenvolvimento local com Redis, use Docker Compose.

### Outros comandos

```bash
npm run docker:up       # sobe Redis via Docker Compose
npm run docker:down     # derruba o container Redis
npm run check           # typecheck
npm test                # testes automatizados
npm run build           # compilação TypeScript
```

## Modelo de Arquitetura

A aplicação segue uma divisão simples de responsabilidades:

- `controllers` tratam HTTP, validação de entrada e resposta.
- `services` concentram regra de negócio.
- `repositories` encapsulam acesso ao banco.
- `infrastructure` abriga SQLite, Redis, worker, logger e métricas.
- `routes` conectam controllers aos endpoints.

### Por que esse desenho?

Esse formato foi escolhido para manter o projeto legível sem exagerar em abstrações.

Trade-off:

- Vantagem: facilita manutenção e testes sem virar uma arquitetura excessivamente complexa.
- Desvantagem: não tem a rigidez de uma arquitetura hexagonal completa com portas e adaptadores formais.

## Cache de Produtos

O endpoint `GET /products` usa cache para reduzir leituras repetidas do catálogo.

### Fluxo

1. A primeira chamada busca os produtos no SQLite.
2. O resultado é armazenado no cache.
3. Chamadas seguintes tentam ler do Redis.
4. Se Redis estiver indisponível, o sistema usa cache em memória.
5. Quando o checkout altera o estoque, o cache de produtos é invalidado.

### Por que Redis em vez de apenas memória?

Cache em memória é a forma mais simples, mas só vale dentro de um único processo. Como a API pode crescer para múltiplas instâncias, Redis vira uma opção mais realista.

Trade-off:

- Memória:
  - mais simples;
  - menor latência;
  - não compartilha estado entre processos.
- Redis:
  - compartilhado entre instâncias;
  - TTL centralizado;
  - depende de infraestrutura externa.

### Por que manter fallback em memória?

O fallback foi mantido para não quebrar o uso local e os testes quando Redis não está disponível.

Trade-off:

- Vantagem: resiliência em ambiente de desenvolvimento.
- Desvantagem: em fallback, cada instância tem sua própria visão temporária do cache.

## Checkout e Idempotência

O `POST /checkout` exige `idempotency-key` no header.

### Regras

- o header é obrigatório;
- requisições repetidas com a mesma chave e o mesmo payload retornam o mesmo pedido;
- se a mesma chave vier com payload diferente, a API responde conflito;
- o estoque é reservado dentro de transação SQLite;
- o processamento final é assíncrono via worker interno.

### Por que tornar a idempotência obrigatória?

Sem idempotency-key, o cliente pode enviar múltiplas tentativas e criar pedidos duplicados em cenários de retry, timeout ou duplo clique.

Trade-off:

- Vantagem: reduz duplicidade e deixa o contrato da API mais explícito.
- Desvantagem: o cliente precisa gerar e persistir uma chave por operação.

### Por que rejeitar payload diferente com a mesma chave?

Se a mesma chave for reutilizada com dados distintos, a API fica ambígua. Rejeitar esse caso evita que uma chamada acidental reescreva semanticamente uma operação anterior.

Trade-off:

- Vantagem: comportamento previsível e seguro.
- Desvantagem: o cliente precisa garantir que a chave realmente representa uma única operação.

### Por que usar transação SQLite?

A reserva de estoque acontece com transação para evitar oversell sob concorrência.

Trade-off:

- Vantagem: garante atomicidade local sem precisar de fila ou lock distribuído.
- Desvantagem: não escala tão bem quanto uma estratégia distribuída em alta concorrência multi-node.

## Endpoints

### `GET /products`

Retorna o catálogo de produtos.

Resposta:

```json
{
  "products": [
    {
      "id": "iphone-15-case",
      "name": "iPhone 15 Case",
      "description": "Premium slim case for iPhone 15",
      "priceCents": 12990,
      "stockAvailable": 12,
      "stockReserved": 0
    }
  ]
}
```

### `POST /checkout`

Inicia um checkout assíncrono.

Headers:

- `content-type: application/json`
- `idempotency-key: <chave-obrigatória>`

Body:

```json
{
  "items": [
    {
      "productId": "iphone-15-case",
      "quantity": 2
    }
  ]
}
```

Resposta `202`:

```json
{
  "orderId": "uuid",
  "status": "pending",
  "statusUrl": "/orders/uuid/status",
  "totalCents": 25980,
  "idempotencyKey": "demo-001"
}
```

Erros comuns:

- `400 MISSING_IDEMPOTENCY_KEY`
- `400 INVALID_REQUEST`
- `404 PRODUCT_NOT_FOUND`
- `409 OUT_OF_STOCK`
- `409 IDEMPOTENCY_KEY_CONFLICT`

### `GET /orders/{orderId}/status`

Consulta o estado atual do pedido.

Estados possíveis:

- `pending`
- `processing`
- `completed`
- `failed`

### `GET /metrics`

Snapshot simples de observabilidade.

Campos:

- `cacheHit`
- `cacheMiss`
- `checkoutAccepted`
- `checkoutEnqueued`
- `checkoutProcessing`
- `checkoutCompleted`
- `checkoutFailed`
- `queueDepth`

### `GET /health`

Retorna o status dos componentes internos.

```json
{
  "status": "ok",
  "uptime": 1234.56,
  "sqlite": { "connected": true },
  "redis": { "connected": true }
}
```

- `sqlite.connected` — `true` se o banco local respondeu `SELECT 1`.
- `redis.connected` — `true` se o Redis está conectado e respondendo.

### `GET /openapi.json`

Entrega o contrato OpenAPI da aplicação.

### `GET /docs`

Exibe Swagger UI com as rotas e schemas da API.

## Observabilidade

A aplicação usa logs estruturados e métricas simples para facilitar depuração.

### Logs

- `requestId`, `correlationId` e `traceId` são propagados no fluxo.
- eventos importantes do checkout e do worker são registrados.
- o sistema também registra quando o cache cai para memória.

### Métricas

- cache hit/miss;
- pedidos aceitos;
- pedidos enfileirados;
- pedidos processados;
- pedidos concluídos;
- pedidos com falha;
- profundidade da fila.

## Testes

A suíte de testes usa integração HTTP para validar comportamento real da API.

```bash
npm test
```

### O que é validado

- cache de `/products` com hit/miss;
- concorrência de checkout com estoque compartilhado;
- idempotência obrigatória;
- conflito de payload com a mesma chave;
- documentação OpenAPI;
- carregamento do contrato `/openapi.json`.

## Limitações assumidas

- Tudo roda em um único processo.
- A fila do worker é local (BullMQ em Redis local).
- Não há autenticação.
- Não há pagamento real.
- Não há integração com ERP.
- Redis é usado para cache de catálogo e fila de checkout; sem Redis o checkout degrada para síncrono.

## Estrutura principal

- `src/app.ts` - composição da aplicação.
- `src/server.ts` - bootstrap e shutdown.
- `src/services/` - regras de negócio.
- `src/infrastructure/` - SQLite, Redis, worker, logger e métricas.
- `tests/` - testes de integração.

## Conclusão

Essa base foi construída para ser simples de entender, porém honesta nos trade-offs. Onde a solução poderia ser mais sofisticada, preferi manter o projeto enxuto e explícito sobre o que ele faz e o que ele não tenta resolver.
