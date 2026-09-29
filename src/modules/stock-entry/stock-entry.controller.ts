import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CreateUploadUrlDto } from './dto/create-upload-url.dto';
import { DraftDetailDto } from './dto/draft-detail.dto';
import { DraftSummaryDto } from './dto/draft-summary.dto';
import { ReplaceDraftLinesDto } from './dto/replace-draft-lines.dto';
import { UpdateDraftHeaderDto } from './dto/update-draft-header.dto';
import { UploadConfirmationResponseDto } from './dto/upload-confirmation-response.dto';
import { UploadUrlResponseDto } from './dto/upload-url-response.dto';
import { StockEntryDraftService } from './stock-entry-draft.service';
import { StockEntryService } from './stock-entry.service';
import { CurrentUser } from '../../shared/auth';
// `import type` is required by `emitDecoratorMetadata` on a decorated signature.
import type { AuthenticatedUser } from '../../shared/auth';

@ApiTags('stock-entries')
@Controller('stock-entries')
export class StockEntryController {
  constructor(
    private readonly stockEntryService: StockEntryService,
    private readonly draftService: StockEntryDraftService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Lists the drafts, most recently changed first',
    description: 'What is still pending: read, failed or waiting for a file',
  })
  @ApiOkResponse({ type: [DraftSummaryDto] })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  listDrafts(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<DraftSummaryDto[]> {
    return this.draftService.listDrafts(user.id);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Reads a stock entry back for review',
    description:
      'The reading and the review as last saved, so the app can reopen it',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: DraftDetailDto })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  @ApiNotFoundResponse({ description: 'Missing, or another account (ADR-11)' })
  getDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DraftDetailDto> {
    return this.draftService.getDraft(user.id, id);
  }

  @Patch(':id')
  @HttpCode(204)
  @ApiOperation({ summary: "Saves the draft's header" })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Saved' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  @ApiNotFoundResponse({ description: 'Missing, or another account (ADR-11)' })
  @ApiConflictResponse({ description: 'The entry is no longer a draft' })
  updateHeader(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDraftHeaderDto,
  ): Promise<void> {
    return this.draftService.updateHeader(user.id, id, dto);
  }

  @Put(':id/items')
  @HttpCode(204)
  @ApiOperation({
    summary: "Saves the draft's lines",
    description: 'Replaces every line: what is not sent is removed',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Saved' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  @ApiNotFoundResponse({
    description: 'The entry or a linked item is missing or not yours (ADR-11)',
  })
  @ApiConflictResponse({ description: 'The entry is no longer a draft' })
  replaceLines(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplaceDraftLinesDto,
  ): Promise<void> {
    return this.draftService.replaceLines(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Discards a draft',
    description:
      'The entry stays on record as CANCELLED, with its document; the same ' +
      'file can start a new entry',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Discarded' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  @ApiNotFoundResponse({ description: 'Missing, or another account (ADR-11)' })
  @ApiConflictResponse({ description: 'The entry is no longer a draft' })
  discard(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.draftService.discard(user.id, id);
  }

  @Post(':id/upload-url')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Issues the presigned POST for the invoice document',
    description:
      'The S3 key is derived from the invoice id, so every issue writes to the ' +
      'same object. Covers an expired presigned POST, a failed upload or a ' +
      'replaced file.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: UploadUrlResponseDto })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  @ApiNotFoundResponse({
    description: 'The id belongs to another account (ADR-11)',
  })
  @ApiConflictResponse({
    description: 'Invoice is not a draft, or extraction already started',
  })
  createUploadUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateUploadUrlDto,
  ): Promise<UploadUrlResponseDto> {
    return this.stockEntryService.createUploadUrl(user.id, id, dto);
  }

  @Post(':id/uploaded')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Confirms the upload and reads the document',
    description:
      'The app calls this after S3 answers 204. The API verifies the object ' +
      'with HeadObject rather than trusting the client, then reads the PDF ' +
      'and matches its lines against the catalog before answering. A photo ' +
      'is not read: it is the receipt of a manual entry. Calling it again ' +
      'after a successful reading answers the same result without reading ' +
      'twice.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: UploadConfirmationResponseDto })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  @ApiConflictResponse({
    description:
      'Invoice is not a draft, no object at the key, or it diverges from ' +
      'what was declared',
  })
  confirmUpload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UploadConfirmationResponseDto> {
    return this.stockEntryService.confirmUpload(user.id, id);
  }
}
