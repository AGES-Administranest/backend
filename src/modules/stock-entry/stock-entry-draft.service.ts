import { Injectable } from '@nestjs/common';
import { PurchaseInvoice } from '@prisma/client';

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
    const draft = await this.findEditableDraft(userId, id);
    await this.stockEntryRepository.update(draft.id, toHeaderChanges(dto));
  }

  async replaceLines(
    userId: string,
    id: string,
    dto: ReplaceDraftLinesDto,
  ): Promise<void> {
    const draft = await this.findEditableDraft(userId, id);
    await this.ensureItemsBelongTo(userId, linkedItemIds(dto.lines));
    await this.stockEntryRepository.replaceLines(
      draft.id,
      toLineRows(dto.lines),
    );
  }

  /**
   * A discarded entry stays on record as CANCELLED (Q12), with its document.
   * Its hash is released so the same file can start a new entry.
   */
  async discard(userId: string, id: string): Promise<void> {
    const draft = await this.findEditableDraft(userId, id);
    await this.stockEntryRepository.update(draft.id, {
      status: 'CANCELLED',
      fileHash: null,
    });
  }

  private async findEditableDraft(
    userId: string,
    id: string,
  ): Promise<PurchaseInvoice> {
    const invoice = await this.stockEntryRepository.findByIdAndUser(id, userId);
    if (!invoice) throw invoiceNotFound(id);
    if (invoice.status !== 'DRAFT') throw invoiceNotEditable(invoice);
    return invoice;
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
