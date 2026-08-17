## 1. C4 Nível 1 — Contexto

Quem usa o Administranest e com que mundo ele conversa.

```mermaid
flowchart TB
    anestesista["Anestesista veterinário<br/>(Pessoa)<br/>Autônomo e itinerante. Vê apenas<br/>os próprios dados — não há papéis<br/>nem permissões no sistema."]

    admin["Administranest<br/>(Sistema de software)<br/>Centraliza notas fiscais, financeiro,<br/>procedimentos, agendamentos, estoque,<br/>custos, honorários e relatórios em PDF."]

    cognito["AWS Cognito<br/>(Sistema externo · SaaS AWS)<br/>Cadastro, login, senha e confirmação<br/>de conta."]
    s3["AWS S3<br/>(Sistema externo · SaaS AWS)<br/>Guarda os arquivos: NFS-e, espelhos<br/>de pedido de compra e foto de perfil."]
    correio["Caixa de e-mail do profissional<br/>(Sistema externo)<br/>Recebe os códigos de confirmação<br/>e de recuperação de senha."]
    origem["Portal de NFS-e do município<br/>e fornecedores de insumos<br/>(Fora do sistema)<br/>Onde os arquivos nascem."]

    anestesista -->|"Registra procedimentos, agendamentos,<br/>compras e lançamentos; anexa arquivos;<br/>consulta saldos"| admin
    admin -->|"Alerta de estoque mínimo, resultado<br/>do mês e relatórios em PDF"| anestesista

    origem -.->|"Fornecem o XML ou o PDF. NÃO há integração<br/>automática: o profissional baixa à mão"| anestesista

    admin -->|"Autentica o usuário e valida o token<br/>(HTTPS · OIDC / JWT)"| cognito
    cognito -->|"Envia códigos<br/>(e-mail)"| correio
    admin -->|"Envia e lê arquivos<br/>(HTTPS · URL pré-assinada)"| s3

    classDef pessoa fill:#08427b,stroke:#052e56,color:#ffffff
    classDef sistema fill:#1168bd,stroke:#0b4884,color:#ffffff
    classDef externo fill:#8b8b8b,stroke:#5f5f5f,color:#ffffff

    class anestesista pessoa
    class admin sistema
    class cognito,s3,correio,origem externo
```

**Como ler este diagrama.** É o nível mais distante possível: o sistema inteiro vira **uma caixa só**. Sem tecnologias declaradas — a p11ergunta é "quem usa, e com quem conversa".

- A caixa azul no meio é o sistema a ser realizado
- As caixas cinzas são coisas que já existem e que não controlamos. 
- A seta tracejada é a única que **não é uma integração de software**: o profissional
baixa o arquivo da prefeitura ou do fornecedor no navegador e anexa no app. Sem integração automática.

**O que entra:** dados digitados pelo profissional, arquivos (NFS-e, espelho de compra, foto de perfil) e a identidade vinda do Cognito.
**O que sai:** relatórios em PDF, alertas de estoque mínimo, a apuração do mês e
os arquivos de volta para o app.
