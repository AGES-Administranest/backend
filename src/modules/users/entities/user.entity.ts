import { TaxIdType, User } from '@prisma/client';

export class UserEntity implements User {
  /** Identificador único do usuário */
  id!: string;

  /** Identificador do usuário no Cognito (`sub` do token) */
  cognitoSub!: string;

  /** Nome completo do usuário */
  name!: string;

  /** E-mail do usuário (único) */
  email!: string;

  /** Registro no conselho (CRMV) */
  crmv!: string | null;

  /** CPF ou CNPJ do usuário */
  taxId!: string | null;

  /** Tipo do documento em `taxId` */
  taxIdType!: TaxIdType | null;

  /** Data de nascimento */
  birthDate!: Date | null;

  /** URL da foto de perfil */
  photoUrl!: string | null;

  /** Data de criação do registro */
  createdAt!: Date;

  /** Data da última atualização do registro */
  updatedAt!: Date;

  /** Data de exclusão lógica (soft delete) */
  deletedAt!: Date | null;
}
