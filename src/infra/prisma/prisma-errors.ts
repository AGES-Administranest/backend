import { Prisma } from '@prisma/client';

/**
 * Erros de banco em linguagem de aplicação.
 *
 * O Prisma sinaliza falha com códigos (`P2002`, `P2025`…) que só fazem sentido
 * com a documentação dele aberta do lado. Estas classes existem para que o
 * resto do sistema nunca precise conhecer esses códigos: quem chama o banco
 * recebe um erro com nome, não um número.
 *
 * Mora em `infra/` porque traduzir Prisma é assunto de infraestrutura. Se um
 * dia o ORM mudar, este arquivo muda — e mais nenhum.
 */

/** Violação de restrição UNIQUE (ex.: e-mail já cadastrado). */
export class UniqueConstraintError extends Error {
  constructor(readonly fields: string[]) {
    super(`Violação de unicidade: ${fields.join(', ')}`);
    this.name = 'UniqueConstraintError';
  }
}

/** A operação exigia um registro que não existe (update/delete de id inválido). */
export class RecordNotFoundError extends Error {
  constructor() {
    super('Registro não encontrado');
    this.name = 'RecordNotFoundError';
  }
}

/** Violação de chave estrangeira: aponta para um registro que não existe. */
export class InvalidReferenceError extends Error {
  constructor(readonly field?: string) {
    super(field ? `Referência inválida: ${field}` : 'Referência inválida');
    this.name = 'InvalidReferenceError';
  }
}

/**
 * Executa uma consulta do Prisma traduzindo os erros conhecidos.
 *
 * Todo método de repository passa por aqui. É o que evita repetir
 * `instanceof PrismaClientKnownRequestError && error.code === '...'` em cada
 * método de cada módulo. Código não mapeado sobe intacto: erro desconhecido
 * não pode virar um erro genérico que esconde o problema real.
 */
export async function runQuery<T>(query: () => Promise<T>): Promise<T> {
  try {
    return await query();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      throw translate(error);
    }
    throw error;
  }
}

function translate(error: Prisma.PrismaClientKnownRequestError): Error {
  switch (error.code) {
    case 'P2002':
      return new UniqueConstraintError(metaFields(error));
    case 'P2025':
      return new RecordNotFoundError();
    case 'P2003':
      return new InvalidReferenceError(metaFields(error)[0]);
    default:
      return error;
  }
}

/** `meta.target` vem como string, array ou undefined, dependendo do banco. */
function metaFields(error: Prisma.PrismaClientKnownRequestError): string[] {
  const target: unknown = error.meta?.target;
  if (Array.isArray(target))
    return target.map((field: unknown) => String(field));
  if (typeof target === 'string') return [target];
  return [];
}

/**
 * O erro veio do Prisma sem passar por nenhuma tradução?
 *
 * Usado pelo filtro global como rede de segurança: se isso for verdade lá em
 * cima, alguém chamou o Prisma fora de um repository (ADR-01) ou o código do
 * erro não está mapeado aqui. Nos dois casos é bug nosso, e vira 500 + log.
 */
export function isPrismaKnownError(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError;
}
