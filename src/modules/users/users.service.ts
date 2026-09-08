import { Injectable } from '@nestjs/common';

import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersRepository } from './users.repository';
import {
  RecordNotFoundError,
  UniqueConstraintError,
} from '../../infra/prisma/prisma-errors';
import { DomainError } from '../../shared/errors/domain-error';

/**
 * The module's business rules. Knows nothing about Prisma or HTTP: it asks the
 * repository for data and says what each failure means. Turning the
 * `DomainError` into a response is the global filter's job (ADR-07).
 */
@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  findAll() {
    return this.usersRepository.findMany();
  }

  async findOne(id: string) {
    const user = await this.usersRepository.findById(id);
    if (!user) throw this.notFound(id);
    return user;
  }

  async create(dto: CreateUserDto) {
    try {
      return await this.usersRepository.create({
        ...dto,
        updatedAt: new Date(),
      });
    } catch (error) {
      if (error instanceof UniqueConstraintError) throw this.emailTaken();
      throw error;
    }
  }

  async update(id: string, dto: UpdateUserDto) {
    try {
      return await this.usersRepository.update(id, dto);
    } catch (error) {
      if (error instanceof RecordNotFoundError) throw this.notFound(id);
      if (error instanceof UniqueConstraintError) throw this.emailTaken();
      throw error;
    }
  }

  /**
   * Creates the local mirror from the token claims (ADR-02: the mirror is born
   * on the first valid login — not in a PostConfirmation trigger, which would
   * not even fire in the local environment).
   *
   * Idempotent on purpose: the app calls this on every login, and the second
   * call must not create a second user.
   *
   * The e-mail comes from Cognito and overwrites the local one on every call —
   * that is ADR-02 deciding who wins when the two diverge. The name is only
   * overwritten when the token carries the claim, so a stored name is never
   * wiped out.
   */
  async provisionFromCognito(claims: {
    cognitoSub: string;
    email: string;
    name?: string;
  }) {
    try {
      return await this.usersRepository.upsertByCognitoSub(
        claims.cognitoSub,
        {
          cognitoSub: claims.cognitoSub,
          email: claims.email,
          // An account without the `name` claim still needs a non-null name.
          // The e-mail is the only identifier we have, and the user can change
          // it later.
          name: claims.name ?? claims.email,
          updatedAt: new Date(),
        },
        {
          email: claims.email,
          ...(claims.name ? { name: claims.name } : {}),
        },
      );
    } catch (error) {
      // The e-mail already belongs to ANOTHER cognitoSub: either two Cognito
      // accounts share it, or it was changed there and the old mirror was left
      // behind. Both need a human, not a retry.
      if (error instanceof UniqueConstraintError) throw this.emailTaken();
      throw error;
    }
  }

  /**
   * Records consent: date and version, never a boolean — when the text changes
   * we need to know who accepted which one.
   *
   * The privacy policy is accepted in the same act, so it shares the terms
   * version for as long as the two texts are versioned together.
   */
  async acceptTerms(cognitoSub: string, termsVersion: string) {
    const user = await this.usersRepository.findByCognitoSub(cognitoSub);
    if (!user) throw this.notProvisioned();

    const acceptedAt = new Date();
    return this.usersRepository.update(user.id, {
      termsAcceptedAt: acceptedAt,
      privacyAcceptedAt: acceptedAt,
      termsVersion,
    });
  }

  async remove(id: string) {
    try {
      await this.usersRepository.delete(id);
    } catch (error) {
      if (error instanceof RecordNotFoundError) throw this.notFound(id);
      throw error;
    }
  }

  private notFound(id: string) {
    return new DomainError(
      'NOT_FOUND',
      'USUARIO_NAO_ENCONTRADO',
      `User ${id} not found`,
      { id },
    );
  }

  private notProvisioned() {
    return new DomainError(
      'NOT_FOUND',
      'USUARIO_NAO_PROVISIONADO',
      'The authenticated user has no local mirror yet. Call POST /auth/session first.',
    );
  }

  private emailTaken() {
    return new DomainError(
      'CONFLICT',
      'USUARIO_EMAIL_JA_CADASTRADO',
      'E-mail already registered',
    );
  }
}
