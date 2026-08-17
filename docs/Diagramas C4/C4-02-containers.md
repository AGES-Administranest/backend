## 2. C4 Nível 2 — Containers

Abrimos a caixa azul do nível 1. "Container" aqui **não é Docker** — no C4
significa "uma coisa que roda separada e precisa estar no ar": um app, um
processo de servidor, um banco.

```mermaid
flowchart TB
    anestesista["Anestesista veterinário<br/>(Pessoa)"]

    subgraph admin["Administranest"]
        direction TB
        app["App Mobile<br/>(React Native · TypeScript · iOS e Android)<br/>Única interface do usuário; funciona sem rede,<br/>guarda tudo localmente e sincroniza depois."]
        api["API Administranest<br/>(NestJS 11 · Node.js 22 · REST)<br/>Aplica as regras de negócio, garante que cada<br/>usuário só veja o próprio dado e gera os PDFs."]
        banco[("Banco de dados<br/>(PostgreSQL)<br/>Guarda todos os dados do sistema.<br/>A modelagem é do time de banco.")]
    end

    cognito["AWS Cognito<br/>(Container externo · SaaS AWS)<br/>Fonte da verdade das credenciais.<br/>Emite os tokens."]
    s3["Bucket S3 privado<br/>(Container externo · AWS S3)<br/>Guarda os arquivos. Nunca fica público."]

    anestesista -->|"Usa<br/>(toque na tela)"| app

    app -->|"Lê e grava dados; envia o lote de sincronização<br/>(HTTPS · REST + JSON · Bearer JWT)"| api
    app -->|"Login, cadastro e renovação do token<br/>(HTTPS · OIDC / OAuth2 · SDK do Cognito)"| cognito
    app -->|"Envia e baixa arquivos direto, sem passar pela API<br/>(HTTPS · PUT/GET em URL pré-assinada)"| s3

    api -->|"Consulta e grava<br/>(TCP/SQL, gerado pelo Prisma Client)"| banco
    api -->|"Confere a assinatura do token recebido<br/>(HTTPS · chaves públicas JWKS)"| cognito
    api -->|"Gera a URL pré-assinada e lê o arquivo para extrair dados<br/>(HTTPS · AWS SDK v3)"| s3

    classDef pessoa fill:#08427b,stroke:#052e56,color:#ffffff
    classDef container fill:#1168bd,stroke:#0b4884,color:#ffffff
    classDef externo fill:#8b8b8b,stroke:#5f5f5f,color:#ffffff

    class anestesista pessoa
    class app,api,banco container
    class cognito,s3 externo
```

**Como ler este diagrama.** Cada caixa azul é uma peça que roda em algum lugar e pode cair sozinha. A tecnologia vem entre parênteses. **A parte importante são as setas**, não as caixas: elas dizem quem inicia a conversa e por qual protocolo.

Três coisas que costumam surpreender quem está lendo pela primeira vez:

- **O app fala com o S3 direto** (ADR-03). A API só entrega uma URL temporária e assinada; os bytes do arquivo nunca passam pelo servidor. É por isso que existem duas setas do app para fora, e não uma.
- **O app fala com o Cognito direto** para fazer login. A API nunca vê a senha — ela só recebe o token pronto e confere a assinatura contra as chaves públicas da AWS.
- **Só a API fala com o banco.** O app não tem, e nunca terá, credencial de PostgreSQL. Quando o app está offline ele lê do banco **local dele**, que é outra coisa (e ainda não foi escolhido — não há biblioteca de banco local no `client-mobile` hoje).

Cabe aqui, e não no diagrama, dizer que a API expõe o endpoint `/sync`
(ADR-08) — é um detalhe interno da API, então não é container.
