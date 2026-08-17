## 3. C4 Nível 3 — Componentes do módulo `Users`

Abrimos a caixa "API Administranest". Este é o **molde**: todos os outros módulos (estoque, financeiro, notas-fiscais…) têm exatamente esta forma. `Users` é o exemplo mais simples possível — um CRUD de `id`, `email` e `nome`.

> Este diagrama mostra o **alvo** descrito nas ADRs, não o código que está no
> repositório hoje (ver a tabela da seção 0).

```mermaid
flowchart TB
    app["App Mobile<br/>(React Native)"]

    subgraph api["API Administranest (NestJS)"]
        direction TB

        subgraph shared["Camada transversal — pasta shared/ · atravessa TODOS os módulos"]
            direction TB
            guard["JwtAuthGuard<br/>(Guard do NestJS)<br/>Confere o token do Cognito e anexa o<br/>usuário à requisição. Sem token válido,<br/>a requisição morre aqui."]
            pipe["ValidationPipe + DTOs<br/>(class-validator)<br/>Confere o formato do corpo da requisição.<br/>Campo faltando, e-mail inválido: morre aqui."]
            filtro["AllExceptionsFilter<br/>(Filtro global de exceções)<br/>Transforma qualquer erro no formato único,<br/>com código textual estável."]
        end

        subgraph modulo["Módulo Users — pasta modules/users/"]
            direction TB
            controller["UsersController<br/>(Controller · @Controller)<br/>Só traduz HTTP. Recebe a requisição,<br/>chama o Service, devolve a resposta.<br/>Zero regra de negócio."]
            service["UsersService<br/>(Service · @Injectable)<br/>As regras de negócio. É a ÚNICA porta<br/>pela qual outro módulo pode entrar."]
            repo["UsersRepository<br/>(Repository · @Injectable)<br/>Único ponto que fala com o banco.<br/>Aplica o filtro por usuário em toda consulta.<br/>Privado do módulo."]
        end

        prisma["PrismaService<br/>(Prisma Client · pasta shared/)<br/>Traduz chamadas TypeScript em SQL<br/>e devolve objetos tipados."]
    end

    banco[("PostgreSQL")]

    app -->|"1 · GET /users/me<br/>(HTTPS + Bearer JWT)"| guard
    guard -->|"2 · requisição com o usuário já identificado"| pipe
    pipe -->|"3 · DTO validado"| controller
    controller -->|"4 · chama o método passando o usuário<br/>que veio do token, nunca do corpo"| service
    service -->|"5 · pede o dado"| repo
    repo -->|"6 · consulta já filtrada por usuário"| prisma
    prisma -->|"7 · SQL"| banco

    guard -.-> filtro
    pipe -.-> filtro
    service -.-> filtro
    repo -.-> filtro
    filtro -.->|"resposta de erro no formato único<br/>(ex.: USUARIO_NAO_ENCONTRADO)"| app

    classDef externa fill:#1168bd,stroke:#0b4884,color:#ffffff
    classDef componente fill:#4a90d9,stroke:#2c6cb0,color:#ffffff
    classDef transversal fill:#7d5ba6,stroke:#573f75,color:#ffffff
    classDef dado fill:#8b8b8b,stroke:#5f5f5f,color:#ffffff

    class app externa
    class controller,service,repo componente
    class guard,pipe,filtro,prisma transversal
    class banco dado
```

**Como ler este diagrama.** As caixas azul-claras são o **módulo**: o que um dev
escreve quando recebe a tarefa "fazer o módulo de estoque". As roxas são a
**camada transversal** — código que já existe na pasta `shared/`, escrito uma
vez, que passa por baixo de todos os módulos sem que ninguém precise chamá-lo. O
NestJS pluga essas peças automaticamente.

**A linha contínua numerada de 1 a 7 é o caminho feliz.** Leia de cima para
baixo: a requisição atravessa o guard, atravessa o pipe, e só então chega no
Controller. As linhas tracejadas são o caminho do erro: **qualquer** peça que
lance uma exceção cai no filtro global, e é o filtro — nunca o Controller — que
monta a resposta de erro.

**Por que existem quatro caixas onde poderia haver uma.** Cada uma responde a uma
pergunta diferente, e é isso que torna revisão de código possível:

| Componente | Responde a | Regra prática |
| --- | --- | --- |
| `UsersController` | "Que URL é essa e o que devolvo?" | Se tem `if` de regra de negócio aqui, está no lugar errado |
| `UsersService` | "O que significa essa operação?" | Único ponto que outro módulo pode chamar |
| `UsersRepository` | "Como isso vira uma consulta?" | Só fala de dados. Nenhuma regra aqui. Ninguém de fora o injeta |
| `PrismaService` | "Como falo com o PostgreSQL?" | Nunca injetado direto num Service (ADR-01) |

**O detalhe mais importante do diagrama inteiro** está no passo 4: o usuário
chega no Service **vindo do token**, nunca do corpo da requisição. Se o app
mandar `{"usuarioId": "..."}`, esse campo é ignorado. E no passo 6 o Repository
adiciona esse filtro sozinho, em toda consulta. É assim que ADR-11 (isolamento
por usuário) para de depender de alguém lembrar.
