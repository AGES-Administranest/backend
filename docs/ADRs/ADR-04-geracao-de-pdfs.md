# ADR-04 — Onde os PDFs são gerados

**Status:**

- [ ] Aceito
- [ ] Recusado

**Contexto:** Exportação em PDF de demais áreas do sistema. O app é React Native e offline-first.

**Opções:** (a) backend gera e devolve o arquivo; (b) app gera localmente; (c) backend gera e guarda no S3.

**Decisão:** (a) backend gera sob demanda, sem persistir. O relatório sai de dados que só o servidor tem completos (a apuração do mês depende de tudo já sincronizado), e gerar no app significaria reimplementar as regras de cálculo em dois lugares. (c) só faria sentido se a geração fosse cara, o que não é o caso.

**Consequências:** (+) uma implementação só das regras; (+) o layout do relatório fica sob controle de quem entende as regras. (−) relatório não funciona offline — precisa estar explícito para a cliente; (−) geração de PDF em Node consome memória e é a operação mais pesada do sistema em uma máquina pequena. (−) escolher biblioteca de PDF é uma decisão em aberto: as que renderizam HTML dão layout melhor mas costumam embutir um navegador, o que pode não caber na máquina. **AINDA A DEFINIR**
