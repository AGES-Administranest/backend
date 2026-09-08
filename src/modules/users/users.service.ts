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
   * Creates the local mirror on first valid login (ADR-02), idempotently: the
   * app calls this on every login. Cognito wins on e-mail; the name is only
   * overwritten when the token carries the claim.
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
          name: claims.name ?? claims.email,
          updatedAt: new Date(),
        },
        {
          email: claims.email,
          ...(claims.name ? { name: claims.name } : {}),
        },
      );
    } catch (error) {
      // `user` is unique on `cognito_sub` too, and losing the upsert race fails
      // on that one — a retryable path that must not be reported as a conflict
      // needing a human.
      if (
        error instanceof UniqueConstraintError &&
        error.fields.some(field => field.includes('email'))
      ) {
        throw this.emailTaken();
      }
      throw error;
    }
  }

  /** Date and version, never a boolean: the text changes and we need to know which. */
  async acceptTerms(cognitoSub: string, termsVersion: string) {
    const acceptedAt = new Date();

    try {
      return await this.usersRepository.updateByCognitoSub(cognitoSub, {
        termsAcceptedAt: acceptedAt,
        privacyAcceptedAt: acceptedAt,
        termsVersion,
      });
    } catch (error) {
      if (error instanceof RecordNotFoundError) throw this.notProvisioned();
      throw error;
    }
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
