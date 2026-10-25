import { Injectable } from '@nestjs/common';

import { categoryNameKey } from './domain/category-name';
import { CreateFinancialCategoryDto } from './dto/create-financial-category.dto';
import { QueryFinancialCategoryDto } from './dto/query-financial-category.dto';
import { FinancialCategoryResponse } from './entities/financial-category.entity';
import { FinancialCategoryRepository } from './financial-category.repository';
import { UniqueConstraintError } from '../../infra/prisma/prisma-errors';
import { DomainError } from '../../shared/errors/domain-error';

function samePayload(
  existing: FinancialCategoryResponse,
  dto: CreateFinancialCategoryDto,
): boolean {
  return (
    existing.name === dto.name &&
    existing.nature === dto.nature &&
    existing.defaultScope === dto.defaultScope
  );
}

function idConflict(): DomainError {
  return new DomainError(
    'CONFLICT',
    'FINANCIAL_CATEGORY_ID_CONFLICT',
    'This id is already in use',
  );
}

function duplicated(existingId?: string): DomainError {
  return new DomainError(
    'CONFLICT',
    'FINANCIAL_CATEGORY_DUPLICATED',
    'A category with this name already exists',
    existingId ? { id: existingId } : undefined,
  );
}

@Injectable()
export class FinancialCategoryService {
  constructor(private readonly repository: FinancialCategoryRepository) {}

  findAll(
    userId: string,
    query: QueryFinancialCategoryDto,
  ): Promise<FinancialCategoryResponse[]> {
    return this.repository.findActive(userId, query.nature);
  }

  async create(
    userId: string,
    dto: CreateFinancialCategoryDto,
  ): Promise<FinancialCategoryResponse> {
    const retried = await this.alreadyCreated(userId, dto);
    if (retried) return retried;
    await this.refuseTakenName(userId, dto);

    try {
      return await this.repository.create({
        id: dto.id,
        userId,
        name: dto.name,
        nature: dto.nature,
        defaultScope: dto.defaultScope,
      });
    } catch (error) {
      if (!(error instanceof UniqueConstraintError)) throw error;
      return this.answerLostRace(userId, dto);
    }
  }

  /**
   * The category a previous send of this same request created (ADR-09), or
   * null when nobody uses the id. Any other use of the id is a conflict.
   */
  private async alreadyCreated(
    userId: string,
    dto: CreateFinancialCategoryDto,
  ): Promise<FinancialCategoryResponse | null> {
    const own = await this.repository.findOwned(userId, dto.id);
    if (own) {
      if (samePayload(own, dto)) return own;
      throw idConflict();
    }
    if (await this.repository.idIsTaken(dto.id)) throw idConflict();
    return null;
  }

  private async refuseTakenName(
    userId: string,
    dto: CreateFinancialCategoryDto,
  ): Promise<void> {
    const key = categoryNameKey(dto.name);
    const sameNature = await this.repository.findActive(userId, dto.nature);
    const sameName = sameNature.find(
      category => categoryNameKey(category.name) === key,
    );
    if (sameName) throw duplicated(sameName.id);
  }

  /**
   * Another request inserted between the checks and this insert. Reading again
   * tells which unique key it took: this id (the same request sent twice) or
   * this name.
   */
  private async answerLostRace(
    userId: string,
    dto: CreateFinancialCategoryDto,
  ): Promise<FinancialCategoryResponse> {
    const retried = await this.alreadyCreated(userId, dto);
    if (retried) return retried;
    await this.refuseTakenName(userId, dto);
    // Only an archived category of the user can still hold this exact name,
    // and the app cannot select it, so there is no id to send back.
    throw duplicated();
  }
}
