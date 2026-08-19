/**
 * Catálogo de códigos de erro (ADR-07).
 *
 * O código é o contrato com o app: é por ele que o cliente decide o que fazer.
 * Por isso ele é estável — mensagem pode mudar, idioma pode mudar, código não.
 * Se o significado mudar, adicione um código novo em vez de reescrever o antigo.
 *
 * Convenção: `ENTIDADE_O_QUE_ACONTECEU`, em maiúsculas, sem acento.
 *
 * Para criar um erro novo: acrescente a linha aqui, no bloco do seu módulo.
 * Sem isso o `DomainError` não compila — é de propósito.
 */
export const ERROR_CODES = [
  // Transversais: nascem no filtro global, valem para qualquer rota.
  'VALIDACAO_INVALIDA',
  'REQUISICAO_INVALIDA',
  'NAO_AUTENTICADO',
  'SEM_PERMISSAO',
  'ROTA_NAO_ENCONTRADA',
  'ERRO_HTTP',
  'ERRO_INTERNO',

  // users
  'USUARIO_NAO_ENCONTRADO',
  'USUARIO_EMAIL_JA_CADASTRADO',

  // seu módulo entra aqui
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
