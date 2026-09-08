# ADR-06 — Como o app conhece os contratos da API

**Status:**

- [ ] Aceito
- [ ] Recusado

**Contexto:** App em React Native (TypeScript), backend em NestJS, times separados trabalhando em paralelo por 4–5 meses, com pessoas entrando e saindo.

**Opções:** (a) nada formal, combinação por conversa; (b) Swagger/OpenAPI gerado a partir dos DTOs; (c) pacote de tipos compartilhado entre os dois projetos.

**Decisão:** (b) Swagger/OpenAPI, gerado pelo pacote oficial do NestJS a partir dos próprios DTOs.

**Consequências:** (+) o time de mobile tem uma página navegável e testável sem depender de ninguém; (+) documentação pronta para o RA e RF. (−) exige disciplina de anotar os DTOs;
