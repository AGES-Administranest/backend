# ADR-03 — Upload de arquivos: presigned URL vs. proxy pela API

**Status:**

- [ ] Aceito
- [ ] Recusado

**Contexto:** Entram no S3: arquivos de NFS-e, espelhos de pedidos de compra e foto de perfil. Volume baixíssimo.

**Opções:** (a) app envia para a API, a API repassa ao S3 (proxy); (b) API gera URL pré-assinada e o app envia direto ao S3; (c) misto.

**Decisão:** (b) presigned URL, tanto para upload quanto para download. Não aumenta carga no backend. Presigned tira o arquivo do caminho da API. Para download, presigned também evita tornar o bucket público. Possibilita extração de dados no backend de forma assíncrona sem sobrecarregar o servidor caso sejam enviados mts dados simultaneamente.

**Consequências:** (+) backend não manipula bytes; (+) bucket permanece privado. (−) fluxo em dois passos (pedir URL → enviar → confirmar); (−) existe janela de inconsistência: o app pode enviar ao S3 e falhar ao confirmar.
