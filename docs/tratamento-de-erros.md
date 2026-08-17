# Tratamento de erros

Como uma falha vira resposta da API, e o que você precisa escrever quando um
endpoint novo precisa recusar alguma coisa.

Decisões por trás disso: [ADR-01](ADRs/ADR-01-camada-repository.md) e
[ADR-07](ADRs/ADR-07-tratamento-de-erros.md).

## A ideia em uma frase

Você lança o erro, o filtro global monta a resposta. Ninguém escreve
`response.status(404)` no meio de um controller.

## O try/catch que você não vê

Quando você escreve um endpoint assim:

```ts
@Get(':id')
findOne(@Param('id', ParseUUIDPipe) id: string) {
  return this.usersService.findOne(id);
}
```

o NestJS não chama seu método direto. Ele o executa dentro de algo parecido com
isto:

```ts
try {
  const resultado = await seuMetodo();
  response.json(resultado);
} catch (erro) {
  allExceptionsFilter.catch(erro); // ← toda falha do sistema passa por aqui
}
```

Por isso um `throw` lá no fundo do Service chega na resposta certa sem você
fazer nada. E por isso **não existe `try/catch` em controller** neste projeto:
já tem um, e ele é do framework.

## O erro troca de nome três vezes

Um e-mail duplicado percorre este caminho:

| Onde              | O que o erro é                                         | Quem traduz                                      |
| ----------------- | ------------------------------------------------------ | ------------------------------------------------ |
| PostgreSQL        | `23505`                                                | —                                                |
| Prisma            | `P2002`                                                | Prisma                                           |
| `UsersRepository` | `UniqueConstraintError`                                | `runQuery()`, em `infra/prisma/prisma-errors.ts` |
| `UsersService`    | `DomainError` com código `USUARIO_EMAIL_JA_CADASTRADO` | você                                             |
| Resposta          | `409` + JSON                                           | `AllExceptionsFilter`                            |

Cada camada só entende a linguagem da camada de baixo. O Service nunca vê
`P2002`; o filtro nunca vê Prisma.

## Escrevendo um erro novo

Primeiro declare o código em
[`src/shared/errors/error-codes.ts`](../src/shared/errors/error-codes.ts), no
bloco do seu módulo:

```ts
export const ERROR_CODES = [
  // ...
  // estoque
  'ESTOQUE_ITEM_NAO_ENCONTRADO',
] as const;
```

Depois, no Service, lance um `DomainError` com quatro informações:

```ts
throw new DomainError(
  'NOT_FOUND', // 1. natureza → vira o status HTTP
  'ESTOQUE_ITEM_NAO_ENCONTRADO', // 2. código → é o que o app lê
  `Item ${id} não encontrado`, // 3. mensagem → para humanos
  { id }, // 4. detalhes (opcional)
);
```

**1. A natureza** é uma lista fechada, e é ela que decide o status:

| Natureza            | Status | Quando                                 |
| ------------------- | ------ | -------------------------------------- |
| `NOT_FOUND`         | 404    | o recurso não existe                   |
| `CONFLICT`          | 409    | já existe / o estado atual não permite |
| `INVALID_INPUT`     | 400    | o dado enviado não serve               |
| `INVALID_REFERENCE` | 422    | aponta para algo que não existe        |
| `UNAUTHORIZED`      | 401    | não sabemos quem é                     |
| `FORBIDDEN`         | 403    | sabemos quem é, e não pode             |

**2. O código** só pode ser um dos que estão no catálogo — código não
declarado não compila:

```
Argument of type '"USUARIO_NAO_ENCOTRADO"' is not assignable to parameter of
type '"VALIDACAO_INVALIDA" | "USUARIO_NAO_ENCONTRADO" | ...'
```

É a única parte que o app usa para tomar decisão, então ele é permanente: se o
significado mudar, acrescente um código novo em vez de alterar o antigo. Quem
está do outro lado já escreveu `if (code === 'USUARIO_NAO_ENCONTRADO')`.

**3. A mensagem** pode mudar quando quiser — inclusive de idioma. Ela nunca
carrega detalhe interno: nada de nome de tabela, SQL ou stack trace.

**4. Os detalhes** são o que ajuda quem chamou a entender o problema (`{ id }`,
`{ campo: 'email' }`). Vale a mesma regra da mensagem.

## Erro que vem do banco

Se a falha nasce no banco, o repository já a converte antes de você:

```ts
try {
  return await this.usersRepository.create(dto);
} catch (error) {
  if (error instanceof UniqueConstraintError) {
    throw new DomainError(
      'CONFLICT',
      'USUARIO_EMAIL_JA_CADASTRADO',
      'E-mail já cadastrado',
    );
  }
  throw error; // não é seu caso: deixa subir
}
```

Os três erros que o `runQuery()` produz hoje:

| Classe                  | Vem de  | Significa                                |
| ----------------------- | ------- | ---------------------------------------- |
| `UniqueConstraintError` | `P2002` | valor repetido num campo único           |
| `RecordNotFoundError`   | `P2025` | update/delete de um id que não existe    |
| `InvalidReferenceError` | `P2003` | chave estrangeira apontando para o vazio |

O `throw error` no final importa: erro que você não reconhece precisa continuar
subindo. Ele vira 500 e aparece no log com a stack completa — que é exatamente o
que você quer quando é um bug de verdade.

## O que a API responde

Todo erro sai neste formato, sem exceção:

```jsonc
{
  "statusCode": 409,
  "code": "USUARIO_EMAIL_JA_CADASTRADO",
  "message": "E-mail já cadastrado",
  "details": { "campos": ["email"] }, // opcional
  "path": "/users",
  "timestamp": "2026-08-17T19:06:57.209Z",
}
```

Alguns casos reais:

```jsonc
// POST /users com body inválido — o ValidationPipe entra no mesmo formato
{
  "statusCode": 400,
  "code": "VALIDACAO_INVALIDA",
  "message": "Requisição inválida",
  "details": { "campos": ["email must be an email"] },
  "path": "/users"
}

// qualquer coisa que ninguém previu
{
  "statusCode": 500,
  "code": "ERRO_INTERNO",
  "message": "Erro interno do servidor",
  "path": "/users"
}
```

No 500 a resposta é sempre essa, seja qual for a causa. O que aconteceu de fato
fica no log do servidor. É proposital: mensagem de erro de banco entrega
estrutura interna para quem estiver olhando.

## As regras

1. **Código novo entra no catálogo.** É o contrato com o app; o compilador
   cobra.
2. **Controller não tem `try/catch`.** Nem `response.status()`.
3. **Service não lança `NotFoundException`** nem nenhuma exceção do NestJS.
   Lança `DomainError` — quem escolhe o status é o filtro.
4. **Só o repository fala com o Prisma.** Se um erro do Prisma chegar no filtro,
   ele loga avisando que alguém furou essa regra.
5. **Erro que você não reconhece, deixa subir.** Nunca `catch` vazio, nunca
   virar 200 com `null`.
6. **Nada de detalhe interno na resposta.** Stack, SQL e nome de coluna ficam no
   log.

## Testando

Um teste de erro verifica o código, não a mensagem — a mensagem muda:

```ts
await expect(service.create(dto)).rejects.toMatchObject({
  code: 'USUARIO_EMAIL_JA_CADASTRADO',
});
```

Para o filtro em si, o exemplo está em
[`src/shared/filters/all-exceptions.filter.spec.ts`](../src/shared/filters/all-exceptions.filter.spec.ts).

## Onde cada coisa mora

```
src/
  shared/
    errors/error-codes.ts              # o catálogo: todo código do sistema
    errors/domain-error.ts             # o erro que o Service lança
    filters/all-exceptions.filter.ts   # o único lugar que monta resposta de erro
  infra/
    prisma/prisma-errors.ts            # traduz código do Prisma em erro com nome
  modules/<recurso>/
    <recurso>.repository.ts            # único ponto que consulta o banco
    <recurso>.service.ts               # decide o que cada falha significa
```
