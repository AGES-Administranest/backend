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
  'VALIDATION_ERROR',
  'INVALID_REQUEST',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'ROUTE_NOT_FOUND',
  'HTTP_ERROR',
  'INTERNAL_SERVER_ERROR',

  // users
  'USER_NOT_FOUND',
  'USER_EMAIL_ALREADY_REGISTERED',
  'USER_NOT_PROVISIONED',

  // item
  'ITEM_NOT_FOUND',
  'DUPLICATED_ITEM_PRESENTATION',
  'INVALID_REFERENCE',

  // seu módulo entra aqui
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
