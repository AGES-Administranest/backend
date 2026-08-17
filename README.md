# Administranest — Backend

API REST do **Administranest**, um ERP mobile para médicos veterinários anestesistas autônomos. Projeto da AGES 2026/2, turma 2JK4JK.

A cliente é uma anestesista itinerante: atende em várias clínicas, muitas vezes sem sinal, e hoje controla tudo em planilha. O sistema cobre agenda, estoque, notas fiscais, custos e relatórios de rentabilidade — com foco em ser rápido de alimentar pelo celular.

Este repositório é **só o backend**. O app está em [client-mobile](https://github.com/AGES-Administranest/client-mobile).

| Camada              | Tecnologia                  |
| ------------------- | --------------------------- |
| Runtime             | Node 22                     |
| Framework           | NestJS 11 · TypeScript      |
| ORM / migrations    | Prisma 7                    |
| Banco               | PostgreSQL 16               |
| Documentação da API | Swagger (`@nestjs/swagger`) |

## Índice

- [Estado atual](#estado-atual)
- [Pré-requisitos](#pré-requisitos)
- [Instalação](#instalação)
- [Scripts](#scripts)
- [Banco de dados](#banco-de-dados)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Convenções de código](#convenções-de-código)
- [Documentação da API](#documentação-da-api)
- [Pasta `docs/`](#pasta-docs)
- [Git, CI e PRs](#git-ci-e-prs)

## Estado atual

O projeto está no esboço inicial

**Já existe**

- `ConfigModule` global e `PrismaModule` (`src/infra/prisma/`)
- Módulo `users` — CRUD completo, usado como **molde** para os demais módulos
- `ValidationPipe` global (`whitelist`, `forbidNonWhitelisted`, `transform`)
- Swagger gerado a partir dos DTOs e entities
- Migration inicial (`prisma/migrations/20260813020259_init/`) — o schema tem apenas o model `User`

**Ainda não existe** (está desenhado nos documentos, não no código)

Autenticação com Cognito, upload para S3, jobs de extração de NFS-e, endpoints de sincronização offline, geração de relatórios em PDF e a rota `/health`. Veja [`docs/ADRs/`](docs/ADRs/) antes de implementar qualquer um desses.

Hoje as únicas rotas expostas são `GET /` e `/users`.

## Pré-requisitos

| Ferramenta              | Versão         | Para quê                 |
| ----------------------- | -------------- | ------------------------ |
| Node.js                 | 22 LTS         | Tudo                     |
| npm                     | vem com o Node | Instalar dependências    |
| Docker + Docker Compose | recente        | Subir o PostgreSQL local para ambiente dev |

### Node — use o nvm

A versão do Node está fixada no [`.nvmrc`](./.nvmrc). Não instale o Node 22 na mão — use o [nvm](https://github.com/nvm-sh/nvm), assim sua versão bate com a do repositório (e com a de todo mundo) automaticamente:

```sh
# instalar o nvm, se ainda não tiver
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash

# de dentro do repositório — instala e ativa a versão do .nvmrc
nvm install
nvm use
```

`nvm use` sem argumento lê o `.nvmrc` sozinho sempre que você estiver nesta pasta.

## Instalação

```sh
git clone git@github.com:AGES-Administranest/backend.git
cd backend

nvm use                 # Node 22
npm install
cp .env.example .env    # DATABASE_URL e PORT

docker compose up -d    # sobe o PostgreSQL na porta 5432
npx prisma migrate dev  # aplica as migrations e gera o Prisma Client

npm run start:dev       # API em modo watch
```

Pronto: a API sobe em `http://localhost:3000` e o Swagger fica em **http://localhost:3000/docs**.

Alguns detalhes que economizam tempo:

**O `.env` precisa existir antes de qualquer comando `prisma`.** O [`prisma.config.ts`](./prisma.config.ts) carrega o `.env` via `dotenv/config` e lê `DATABASE_URL` dali. Sem o arquivo, até o `prisma generate` — que nem chega a conectar no banco — falha. É por isso que o job de build do CI define um `DATABASE_URL` de mentira.

**O `.env` é gitignored.** Ele nunca vai para o repositório; o que se versiona é o `.env.example`. Variáveis novas entram nos dois lugares.

**O Compose sobe só o banco.** O [`docker-compose.yml`](./docker-compose.yml) tem um único serviço, `postgres:16-alpine` (banco `backend`, usuário e senha `postgres`, volume nomeado para os dados persistirem). A API roda direto na sua máquina, não em container — é o que permite o watch mode e o debugger funcionarem sem configuração extra.

**Swagger não sobe em produção.** As rotas `/docs` e `/docs-json` só são registradas quando `NODE_ENV !== 'production'` (ver [`src/main.ts`](./src/main.ts)).

## Scripts

**Rodar**

| Script                | O que faz                                  |
| --------------------- | ------------------------------------------ |
| `npm run start:dev`   | Modo watch — o que você usa no dia a dia   |

**Qualidade**

| Script                 | O que faz                                            |
| ---------------------- | ---------------------------------------------------- |
| `npm run lint`         | ESLint (inclui as regras de fronteira entre módulos) |
| `npm run lint:fix`     | ESLint corrigindo o que dá para corrigir             |
| `npm run format`       | Prettier escrevendo os arquivos                      |
| `npm run format:check` | Prettier em modo verificação — é o que o CI roda     |
| `npm run typecheck`    | `tsc --noEmit`                                       |

**Testes**

| Script               | O que faz                                |
| -------------------- | ---------------------------------------- |
| `npm test`           | Testes unitários (`*.spec.ts` em `src/`) |
| `npm run test:watch` | Idem, em watch                           |
| `npm run test:cov`   | Com relatório de cobertura               |
| `npm run test:e2e`   | Testes end-to-end (`test/*.e2e-spec.ts`) |

## Banco de dados

O acesso é via Prisma 7 com o adapter `@prisma/adapter-pg`, encapsulado no [`PrismaService`](./src/infra/prisma/prisma.service.ts). Nenhum módulo instancia `PrismaClient` por conta própria — todos injetam esse service.

| Comando                                | Quando usar                                                |
| -------------------------------------- | ---------------------------------------------------------- |
| `npx prisma migrate dev --name <nome>` | Mudou o `schema.prisma` e quer gerar a migration           |
| `npx prisma migrate deploy`            | Aplicar migrations existentes sem criar nada (produção/CI) |
| `npx prisma generate`                  | Regerar o Prisma Client (o `migrate dev` já faz isso)      |
| `npx prisma studio`                    | Abrir a UI para inspecionar os dados                       |

**Migrations são versionadas e ninguém altera o schema na mão.** Mudança de banco entra como arquivo em `prisma/migrations/`, revisada no PR como qualquer outro código.

## Estrutura do projeto

```
src/
  main.ts                    # bootstrap: ValidationPipe global, Swagger, shutdown hooks
  app.module.ts              # módulo raiz — registre módulos novos aqui
  infra/
    prisma/                  # PrismaService e PrismaModule (camada de baixo)
  modules/
    <recurso>/
      <recurso>.controller.ts  # rotas + decorators do Swagger
      <recurso>.service.ts     # regra de negócio
      <recurso>.module.ts
      dto/                     # entrada, com class-validator
      entities/                # saída, o que o Swagger documenta
      index.ts                 # API pública — a ÚNICA porta de entrada do módulo
test/                        # testes e2e
prisma/                      # schema.prisma e migrations
docs/                        # ADRs, diagramas C4 e guia de Swagger
```

### Regras de fronteira

Estas duas regras são **enforçadas pelo ESLint** ([`eslint.config.mjs`](./eslint.config.mjs)), não só documentadas — `npm run lint` falha na violação, e o CI junto.

1. **Um módulo importa outro pela API pública**, nunca por dentro. `import { UsersService } from '../users'` está certo; `from '../users/users.service'` está errado. Isso deixa a reorganização interna de um módulo livre, sem quebrar quem depende dele. O [`src/modules/users/index.ts`](./src/modules/users/index.ts) mostra o padrão.

2. **`infra/` não importa de `modules/`.** Infra (Prisma, config) é a camada de baixo: ela existe _para_ os módulos de negócio, e a dependência só aponta numa direção.

### Módulo de referência

O [`src/modules/users/`](./src/modules/users/) é hoje o único módulo completo do repositório — um CRUD simples de propósito. Ao criar um módulo novo, copie a estrutura dele: controller documentado, DTOs com validação, entity para a resposta, `index.ts` exportando o que é público.

## Convenções de código

**Formatação é do Prettier, não do code review.** A configuração está no [`.prettierrc`](./.prettierrc) (aspas simples, `trailingComma: all`, `arrowParens: avoid`). Rode `npm run format` e siga a vida.

**O ESLint cuida do resto:**

- `import/order` — imports agrupados (externos → internos → relativos), ordem alfabética, linha em branco entre grupos.
- `@typescript-eslint/naming-convention` — `camelCase` para variáveis e funções, `PascalCase` para tipos e classes.
- `@typescript-eslint/no-floating-promises` — promise sem `await` é erro. Em código assíncrono, é a origem silenciosa da maior parte dos bugs de ordem de execução.
- As regras de fronteira descritas acima.

**Validação de entrada é declarativa.** O `ValidationPipe` global roda com `whitelist` e `forbidNonWhitelisted`: campo que não está no DTO não é ignorado, ele derruba o request com 400. Se um campo precisa ser aceito, ele precisa estar no DTO com o decorator do `class-validator` correspondente.

Antes de abrir o PR:

```sh
npm run lint && npm run format:check && npm run typecheck && npm test
```

## Documentação da API

- UI: `http://localhost:3000/docs`
- JSON (OpenAPI): `http://localhost:3000/docs-json`

A documentação sai do próprio código. O plugin do `@nestjs/swagger` está ligado no [`nest-cli.json`](./nest-cli.json) e monta o schema na compilação, lendo os arquivos `*.dto.ts` e `*.entity.ts` — por isso quase nunca é preciso escrever `@ApiProperty` na mão. Se um endpoint não aparece no `/docs`, ou aparece errado, é decorator faltando no controller.

Pontos de atenção:

- Mudou um DTO e o `/docs` continuou igual? **Reinicie o servidor** — a geração acontece na compilação.
- Criou um módulo novo? Acrescente o `addTag` correspondente no [`src/main.ts`](./src/main.ts), senão o grupo aparece sem descrição na UI.

O guia completo, com o checklist de PR, está em **[`docs/swagger.md`](docs/swagger.md)**.

## Pasta `docs/`

| Onde                                         | O quê                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`docs/swagger.md`](docs/swagger.md)         | Como documentar um endpoint novo, o que o plugin faz sozinho, erros comuns e checklist de PR                                                                                                                                                                                                                        |
| [`docs/Diagramas C4/`](docs/Diagramas%20C4/) | Diagramas C4 em Mermaid — contexto (nível 1), containers (nível 2) e componentes do módulo `users` (nível 3). Renderizam direto no GitHub e no VS Code                                                                                                                                                              |
| [`docs/ADRs/`](docs/ADRs/)                   | 11 registros de decisão arquitetural: camada repository, espelho de usuário do Cognito, upload por presigned URL, geração de PDFs, extração assíncrona, contratos da API, tratamento de erros, sincronização offline, identificadores gerados no cliente, estoque como livro de movimentos e isolamento por usuário |

## Git, CI e PRs

Branches principais: **`dev`** (padrão) e **`production`**.

O CI roda em todo PR e push para essas duas branches:

| Workflow                                           | O que verifica                                                               |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| [`ci.yml`](.github/workflows/ci.yml) — job _Lint_  | `npm run lint` e `npm run format:check`                                      |
| [`ci.yml`](.github/workflows/ci.yml) — job _Build_ | `prisma generate` → `typecheck` → `build` → testes unitários                 |
| [`pr-lint.yml`](.github/workflows/pr-lint.yml)     | Título do PR em [Conventional Commits](https://www.conventionalcommits.org/) |

**O título do PR vira a mensagem do squash merge**, por isso ele é validado: precisa começar com `feat`, `fix`, `chore`, `refactor`, `docs`, `style`, `test`, `perf`, `build`, `ci` ou `revert`.

O [`CODEOWNERS`](.github/CODEOWNERS) exige review de `@AGES-Administranest/code-reviewers` em todo PR.
