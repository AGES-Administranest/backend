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

  // client
  'CLIENT_NOT_FOUND',
  'DUPLICATED_CLIENT_NAME',
  'DUPLICATED_CLIENT_TAX_ID',

  // stock-movements
  'STOCK_QUANTITY_INVALID',
  'STOCK_REASON_ADJUSTMENT_INVALID',
  // The outbound does not fit in the balance. `details.available` carries the
  // balance the caller can still take out, because the app interpolates that
  // number into the message it shows.
  'INSUFFICIENT_STOCK',
  'STOCK_MOVEMENT_DATE_IN_FUTURE',
  'STOCK_MOVEMENT_BATCH_EMPTY',
  // A device sent a movement whose UUID already belongs to another account
  // (ADR-09). Never silently skipped: that would drop a real consumption.
  'STOCK_MOVEMENT_ID_CONFLICT',
  // An origin that cannot exist offline arrived through the sync door.
  'STOCK_SYNC_SOURCE_NOT_ALLOWED',
  'SUPPLIER_NOT_FOUND',
  'PURCHASE_ORDER_NOT_FOUND',
  'ITEM_LOT_NOT_FOUND',
  'STOCK_APPOINTMENT_ID_REQUIRED',
  'STOCK_PURCHASE_ORDER_ID_REQUIRED',
  // The clientGeneratedId was already used for a different movement (another
  // appointment, item or quantity): a retry must resend the same line.
  'STOCK_MOVEMENT_CLIENT_ID_CONFLICT',
  // Not a supply of this appointment: missing, another account's, another
  // appointment's, or not an APPOINTMENT consumption (e.g. a reversal).
  'STOCK_MOVEMENT_NOT_FOUND',
  // The supply was already corrected (edited or removed): the app must work
  // on the movement that replaced it.
  'STOCK_MOVEMENT_ALREADY_REVERSED',

  // appointments
  'APPOINTMENT_NOT_FOUND',
  'APPOINTMENT_INVALID_INTERVAL',
  'APPOINTMENT_TIME_CONFLICT',
  // The transition needs a SCHEDULED appointment: it was already completed or
  // canceled. Shared with the /cancel endpoint (US08 subtask 2).
  'APPOINTMENT_NOT_SCHEDULED',
  // Supplies cannot be registered on a canceled appointment: the procedure did
  // not happen, so nothing was consumed (US06).
  'APPOINTMENT_CANCELED',

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
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
