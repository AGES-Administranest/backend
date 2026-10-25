## C4 Level 3 — Components of the uploaded documents

We open the "API Administranest" box again, this time for the two flows that take a file from the app: the purchase order (`stock-entry`, US10) and the service invoice (`service-invoices`, US-01). The decisions behind this shape are in [ADR-14](../ADRs/ADR-14-document-modules.md).

> `service-invoices` is the target of US-01 and does not exist in the code yet.
> Everything else in the diagram does.

```mermaid
flowchart TB
    app["App Mobile<br/>(React Native)"]

    subgraph api["API Administranest (NestJS)"]
        direction TB

        subgraph flows["Document flows — the only modules with document routes · nothing imports them"]
            direction LR
            stock["stock-entry<br/>(Module · modules/stock-entry/)<br/>/stock-entries · purchase order upload policy<br/>PurchaseReadingService: claim, supplier and<br/>item matching, save"]
            nfse["service-invoices<br/>(Module · modules/service-invoices/ · US-01)<br/>/service-invoices · NFSe upload policy<br/>reading, taker matching, duplicate warnings"]
        end

        subgraph shared["Used by both flows — write to no table"]
            direction LR
            extraction["extraction<br/>(Module · modules/extraction/)<br/>ExtractionService picks the strategy by kind<br/>and applies its timeout · runClaimedReading"]
            storage["infra/storage<br/>(Global module · infra/storage/)<br/>DocumentUploads: sign, verify, download URL<br/>documentKey · UploadPolicy"]
        end

        subgraph domain["Domain services the flows call"]
            direction LR
            financial["financial<br/>(Module)<br/>records the expense or income entry<br/>of a confirmed document"]
            purchaseDeps["supplier · item · item-match<br/>(Modules)<br/>supplier by CNPJ, item catalog"]
            client["client<br/>(Module)<br/>taker by CNPJ/CPF and by name,<br/>accents ignored"]
        end
    end

    banco[("PostgreSQL")]
    s3[("Amazon S3<br/>(document bucket)")]

    app -->|"1 · asks for an upload URL, then confirms the upload<br/>(HTTPS + Bearer JWT)"| flows
    app -->|"2 · sends the file straight to the bucket<br/>(HTTPS · presigned POST, ADR-03)"| s3

    stock -->|"signs, verifies, reads the file"| storage
    nfse -->|"signs, verifies, reads the file, download URL"| storage
    stock -->|"extract('purchase-order')"| extraction
    nfse -->|"extract('nfse')"| extraction
    stock --> purchaseDeps
    stock --> financial
    nfse --> client
    nfse --> financial

    storage -->|"HeadObject · GetObject · presigned URLs<br/>(AWS SDK v3)"| s3
    flows -->|"purchase_invoice · service_invoice<br/>(each through its own repository)"| banco
    domain -->|"their own tables"| banco

    classDef externa fill:#1168bd,stroke:#0b4884,color:#ffffff
    classDef componente fill:#4a90d9,stroke:#2c6cb0,color:#ffffff
    classDef novo fill:#2e7d32,stroke:#1b5e20,color:#ffffff
    classDef dado fill:#8b8b8b,stroke:#5f5f5f,color:#ffffff

    class app externa
    class stock,extraction,storage,financial,purchaseDeps,client componente
    class nfse novo
    class banco,s3 dado
```

**How to read this diagram.** Arrows point from the module that imports to the module it calls. The green box is the module US-01 adds; the blue ones exist already. The three layers are the point: the flows on top hold the routes and the rows of their documents, the middle layer is shared and writes to no table, and the domain services at the bottom never learn which document called them.

**Why the file and the reading are split from the rows.** Each module writes only to its own tables (ADR-01). So `infra/storage` answers "is the file there and is it the one that was signed for?", `extraction` answers "what does this PDF say?", and the module that owns the row decides what that means: which error code, which status, which supplier or taker.

| Component | Answers | Practical rule |
| --- | --- | --- |
| `DocumentUploads` | "Was the right file uploaded? Where can it be downloaded?" | Returns `stored`, `missing` or `mismatch`; never a domain error |
| `ExtractionService` | "What does this document say?" | One strategy per kind; a bad document is a `failed` result, never a throw |
| `runClaimedReading` | "Who reads this row, and what if it breaks?" | Only the request that claims the row reads it; a failure puts it back to `PENDING` |
| `PurchaseReadingService` and its NFSe counterpart | "What does this reading mean for my row?" | Status, matching and save stay in the module that owns the table |
