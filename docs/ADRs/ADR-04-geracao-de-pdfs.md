# ADR-04 — Onde os PDFs são gerados

**Status:**

- [x] Aceito
- [ ] Recusado

**Contexto:** Exportação em PDF de demais áreas do sistema. O app é React Native e offline-first.

**Opções:** (a) backend gera e devolve o arquivo; (b) app gera localmente; (c) backend gera e guarda no S3.

**Decisão (revista em 11/11/2026):** (c) o backend gera e guarda no S3. A decisão original era (a), gerar sob demanda sem persistir; ela mudou porque o histórico de relatórios (US32) precisa reabrir um arquivo já gerado sem gerá-lo de novo. O motivo de gerar no backend continua o mesmo: o relatório sai de dados que só o servidor tem completos, e gerar no app significaria reimplementar as regras de cálculo em dois lugares.

**Como funciona:** `POST /reports` monta os dados com o `GeneralReportService` (o mesmo do `GET /reports/general`), gera o PDF, grava em `users/<id>/reports/<id>/original`, registra em `report` e devolve um link temporário de download.

**Biblioteca: `pdfmake`.** JavaScript puro, sem navegador nem canvas. Já traz o que a US28 pede: cabeçalho de tabela repetido em cada página, linhas que não são cortadas na quebra, rodapé com "Página X de Y" e SVG para os gráficos. Medido em Node 22 com tabela de atendimentos e gráfico: 2.000 linhas geram 55 páginas em ~1,2 s com pico de ~154 MB; 5.000 linhas, 135 páginas em ~2 s com ~209 MB. A instância tem 1 GB.

Alternativas descartadas: `pdf-lib` (sem tabelas nem quebra de página; segue só nos testes, para abrir o PDF gerado); `expo-print` no app (no iPhone o WebKit não repete o cabeçalho das tabelas nem numera páginas, então o PDF sairia diferente por plataforma); Puppeteer (embute um navegador, não cabe na máquina).

**Consequências:** (+) uma implementação só das regras; (+) o layout do relatório fica sob controle de quem entende as regras; (+) o histórico reabre o mesmo arquivo. (−) relatório não é gerado offline — precisa estar explícito para a cliente; um PDF já baixado continua podendo ser compartilhado sem conexão; (−) geração de PDF em Node é a operação mais pesada do sistema em uma máquina pequena, e roda dentro da requisição; (−) os arquivos gerados ocupam o bucket até serem excluídos pelo histórico; (−) o pdfmake só pode ler os próprios arquivos de fonte: o `PdfRenderer` bloqueia qualquer outro arquivo local e qualquer URL.
