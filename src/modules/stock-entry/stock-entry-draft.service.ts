import { Injectable } from '@nestjs/common';

import {
  linkedItemIds,
  toDraftDetail,
  toDraftSummary,
  toHeaderChanges,
  toLineRows,
} from './draft.mapper';
import { DraftDetailDto } from './dto/draft-detail.dto';
import { DraftSummaryDto } from './dto/draft-summary.dto';
import { ReplaceDraftLinesDto } from './dto/replace-draft-lines.dto';
import { UpdateDraftHeaderDto } from './dto/update-draft-header.dto';
import { ExtractionService } from './extraction.service';
import {
  invoiceNotEditable,
  invoiceNotFound,
  lineItemNotFound,
} from './stock-entry.errors';
import { StockEntryRepository } from './stock-entry.repository';
import { DomainError } from '../../shared/errors/domain-error';
import { ItemService } from '../item';

/** The review of a draft: reading it back, saving it and discarding it. */
@Injectable()
export class StockEntryDraftService {
  constructor(
    private readonly stockEntryRepository: StockEntryRepository,
    private readonly extractionService: ExtractionService,
    private readonly itemService: ItemService,
  ) {}

  async listDrafts(userId: string): Promise<DraftSummaryDto[]> {
    const drafts = await this.stockEntryRepository.findDrafts(userId);
    return drafts.map(toDraftSummary);
  }

  async getDraft(userId: string, id: string): Promise<DraftDetailDto> {
    const invoice = await this.stockEntryRepository.findWithLines(id, userId);
    if (!invoice) throw invoiceNotFound(id);
    return toDraftDetail(invoice, this.extractionService.view(invoice));
  }

  async updateHeader(
    userId: string,
    id: string,
    dto: UpdateDraftHeaderDto,
  ): Promise<void> {
    const saved = await this.stockEntryRepository.updateDraft(
      id,
      userId,
      toHeaderChanges(dto),
    );
    if (!saved) throw await this.refusal(userId, id);
  }

  async replaceLines(
    userId: string,
    id: string,
    dto: ReplaceDraftLinesDto,
  ): Promise<void> {
    await this.ensureItemsBelongTo(userId, linkedItemIds(dto.lines));
    const saved = await this.stockEntryRepository.replaceLines(
      id,
      userId,
      toLineRows(dto.lines),
    );
    if (!saved) throw await this.refusal(userId, id);
  }

  /**
   * A discarded entry stays on record as CANCELLED (Q12), with its document.
   * Its hash is released so the same file can start a new entry.
   */
  async discard(userId: string, id: string): Promise<void> {
    const discarded = await this.stockEntryRepository.updateDraft(id, userId, {
      status: 'CANCELLED',
      fileHash: null,
    });
    if (!discarded) throw await this.refusal(userId, id);
  }

  /**
   * The writes above carry their own condition — still this user's draft —
   * rather than checking first and writing after, a gap a discard or a
   * confirmation could slip into. When one matched nothing, this says why.
   */
  private async refusal(userId: string, id: string): Promise<DomainError> {
    const invoice = await this.stockEntryRepository.findByIdAndUser(id, userId);
    return invoice ? invoiceNotEditable(invoice) : invoiceNotFound(id);
  }

  private async ensureItemsBelongTo(
    userId: string,
    itemIds: string[],
  ): Promise<void> {
    if (itemIds.length === 0) return;
    const owned = new Set(
      await this.itemService.findActiveIds(userId, itemIds),
    );
    const missing = itemIds.find(itemId => !owned.has(itemId));
    if (missing) throw lineItemNotFound(missing);
  }
}
