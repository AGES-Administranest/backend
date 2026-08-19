# ADR-01 — Camada Repository dedicada vs. PrismaService direto no Service

**Status:**

- [ ] Aceito
- [ ] Recusado

**Contexto:** O Prisma já é uma abstração de acesso a dados. Injetar PrismaService direto no Service elimina uma camada. Porém, o Prisma Client expõe todas as tabelas do sistema a partir de qualquer ponto onde for injetado — inclusive as de outros módulos.

**Opções:** (a) Prisma direto no Service; (b) Repository dedicado por módulo; (c) Repository só onde a consulta for complexa.

**Decisão:** (b) Repository dedicado é o que torna a regra "não escreva na tabela do outro" verificável em code review — basta olhar o que o módulo injeta. Com Prisma direto, essa regra pode ser quebrada.
Bônus relevante aqui: o filtro obrigatório por usuário (ADR-11) tem um único lugar para morar.

**Consequências:** (+) fronteira de módulo auditável; (+) isolamento do usuário centralizado; (+) possibilidade de trocar de ORM caso stakeholder queira seguir com o projeto. (−) mais arquivos e boilerplate; (−) risco real de o Repository virar um repasse de 40 métodos.
Regra prática: o Repository só fala de dados; nenhuma regra de negócio dentro dele.
