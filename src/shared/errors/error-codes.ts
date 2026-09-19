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
  // The two token failures the app has to tell apart: TOKEN_EXPIRED means the
  // refresh is worth trying, TOKEN_INVALID means send the user to the login
  // screen. Every other reason a token can be rejected (bad signature, wrong
  // issuer, wrong audience, unknown key) collapses into TOKEN_INVALID on
  // purpose: the app would do the same thing for all of them, and naming the
  // exact reason tells whoever is forging tokens which part to fix. The real
  // reason goes to the server log.
  'TOKEN_EXPIRED',
  'TOKEN_INVALID',
  'FORBIDDEN',
  'TOO_MANY_REQUESTS',
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
  'ITEM_LOT_UNIT_COST_REQUIRED',

  // supplier
  'DUPLICATED_SUPPLIER_NAME',

  // stock-movements
  'STOCK_QUANTITY_INVALID',
  'STOCK_REASON_ADJUSTMENT_INVALID',

  // stock-entry (purchase invoices)
  'INVOICE_NOT_FOUND',
  'INVOICE_NOT_EDITABLE',
  'INVOICE_FILE_DUPLICATED',
  'INVOICE_FILE_TOO_LARGE',
  // The app said the upload finished, but HeadObject found no object: it
  // reissues the presigned POST and resends, without losing the draft.
  'INVOICE_UPLOAD_NOT_FINISHED',
  // The object is there, but does not match what was declared and signed.
  'INVOICE_UPLOAD_MISMATCH',

  // appointment
  'APPOINTMENT_NOT_FOUND',
  'APPOINTMENT_NOT_SCHEDULED',

  // seu módulo entra aqui
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
