import { User } from '@prisma/client';

export class UserEntity implements User {
  /** Identificador único do usuário */
  id: string;

  /** Nome completo do usuário */
  name: string;

  /** E-mail do usuário (único) */
  email: string;

  /** Data de criação do registro */
  createdAt: Date;

  /** Data da última atualização do registro */
  updatedAt: Date;
}
