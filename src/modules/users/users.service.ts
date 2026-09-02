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
 * Regras de negócio do módulo. Não conhece Prisma nem HTTP: pede os dados ao
 * repository e diz o que cada falha significa. Quem transforma o `DomainError`
 * em resposta é o filtro global (ADR-07).
 */
@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  findAll() {
    return this.usersRepository.findMany();
  }

  async findOne(id: string) {
    const user = await this.usersRepository.findById(id);
    if (!user) throw this.naoEncontrado(id);
    return user;
  }

  async create(dto: CreateUserDto) {
    try {
      return await this.usersRepository.create({
        ...dto,
        updatedAt: new Date(),
      });
    } catch (error) {
      if (error instanceof UniqueConstraintError)
        throw this.emailJaCadastrado();
      throw error;
    }
  }

  async update(id: string, dto: UpdateUserDto) {
    try {
      return await this.usersRepository.update(id, dto);
    } catch (error) {
      if (error instanceof RecordNotFoundError) throw this.naoEncontrado(id);
      if (error instanceof UniqueConstraintError)
        throw this.emailJaCadastrado();
      throw error;
    }
  }

  async remove(id: string) {
    try {
      await this.usersRepository.delete(id);
    } catch (error) {
      if (error instanceof RecordNotFoundError) throw this.naoEncontrado(id);
      throw error;
    }
  }

  private naoEncontrado(id: string) {
    return new DomainError(
      'NOT_FOUND',
      'USUARIO_NAO_ENCONTRADO',
      `Usuário ${id} não encontrado`,
      { id },
    );
  }

  private emailJaCadastrado() {
    return new DomainError(
      'CONFLICT',
      'USUARIO_EMAIL_JA_CADASTRADO',
      'E-mail já cadastrado',
    );
  }
}
