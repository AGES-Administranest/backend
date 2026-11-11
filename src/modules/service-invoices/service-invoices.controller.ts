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
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { ConfirmServiceInvoiceDto } from './dto/confirm-service-invoice.dto';
import { ServiceInvoiceConfirmationDto } from './dto/confirmation-response.dto';
import { CreateServiceInvoiceUploadUrlDto } from './dto/create-upload-url.dto';
import {
  ServiceInvoiceDownloadDto,
  ServiceInvoiceDownloadUrlDto,
} from './dto/download-url-response.dto';
import { QueryServiceInvoiceReportDto } from './dto/query-service-invoice-report.dto';
import { QueryServiceInvoiceDto } from './dto/query-service-invoice.dto';
import { ServiceInvoiceDetailDto } from './dto/service-invoice-detail.dto';
import { ServiceInvoiceReportItemDto } from './dto/service-invoice-report-item.dto';
import { ServiceInvoicePageDto } from './dto/service-invoice-summary.dto';
import { UpdateServiceInvoiceDto } from './dto/update-service-invoice.dto';
import { ServiceInvoiceUploadConfirmationDto } from './dto/upload-confirmation-response.dto';
import { ServiceInvoiceUploadUrlResponseDto } from './dto/upload-url-response.dto';
import { ServiceInvoiceConfirmationService } from './service-invoice-confirmation.service';
import { ServiceInvoiceDraftService } from './service-invoice-draft.service';
import { ServiceInvoiceUploadService } from './service-invoice-upload.service';
import { CurrentUser } from '../../shared/auth';
// `import type` is required by `emitDecoratorMetadata` on a decorated signature.
import type { AuthenticatedUser } from '../../shared/auth';

@ApiTags('service-invoices')
@Controller('service-invoices')
export class ServiceInvoicesController {
  constructor(
    private readonly uploadService: ServiceInvoiceUploadService,
    private readonly draftService: ServiceInvoiceDraftService,
    private readonly confirmationService: ServiceInvoiceConfirmationService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Lists the confirmed NFSe, newest issue date first',
    description:
      'Drafts never come back. The search matches the taker name, the number ' +
      'or the issue date (DD/MM/YYYY, in part), without accents or case.',
  })
  @ApiOkResponse({ type: ServiceInvoicePageDto })
  @ApiBadRequestResponse({ description: 'Invalid or missing filter' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryServiceInvoiceDto,
  ): Promise<ServiceInvoicePageDto> {
    return this.draftService.list(user.id, query);
  }

  // Declared before `:id`, or "reports" would be read as a note id.
  @Get('reports')
  @ApiOperation({
    summary: 'Lists the confirmed NFSe for the Reports tab (US02)',
    description:
      'Latest issue date first. Feeds the few cards (limit) and the "see ' +
      'all" list. Drafts and discarded notes are left out. search, ' +
      'startDate and endDate combine; either date can be sent alone for an ' +
      'open period, and both ends are included.',
  })
  @ApiOkResponse({ type: [ServiceInvoiceReportItemDto] })
  @ApiBadRequestResponse({
    description:
      'A date that is not YYYY-MM-DD or does not exist, a search over the ' +
      'limit or a page out of range (VALIDATION_ERROR), or startDate after ' +
      'endDate (INVALID_REQUEST)',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  listForReports(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryServiceInvoiceReportDto,
  ): Promise<ServiceInvoiceReportItemDto[]> {
    return this.draftService.listForReports(user.id, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Reads an NFSe back for review',
    description:
      'The reading and the review as last saved. A confirmed note also ' +
      'carries `invoice`, with its values as they stand',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ServiceInvoiceDetailDto })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  @ApiNotFoundResponse({
    description: 'Missing, or another account (SERVICE_INVOICE_NOT_FOUND)',
  })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ServiceInvoiceDetailDto> {
    return this.draftService.get(user.id, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Saves the review of a draft, or edits a confirmed note',
    description:
      'On a draft an absent field is left as it is and null clears it. A ' +
      'confirmed note needs the issue date, the amount and the client every ' +
      'time (the number is ignored); its income entry follows them in the ' +
      'same transaction, and the due date follows the client.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({
    type: ServiceInvoiceDetailDto,
    description: 'The note as saved, in the shape of the read',
  })
  @ApiBadRequestResponse({
    description:
      'Invalid payload, or a field a confirmed note needs is missing (SERVICE_INVOICE_NOT_READY)',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  @ApiNotFoundResponse({
    description:
      'The note or the client is missing or not yours (SERVICE_INVOICE_NOT_FOUND, CLIENT_NOT_FOUND)',
  })
  @ApiConflictResponse({
    description: 'The note was discarded (SERVICE_INVOICE_NOT_EDITABLE)',
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceInvoiceDto,
  ): Promise<ServiceInvoiceDetailDto> {
    return this.draftService.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Discards a draft, or deletes a confirmed note',
    description:
      'A draft stays on record as CANCELLED, with its document. A confirmed ' +
      'note is deleted with its income entry and its PDF. Either way the same ' +
      'file can start a new note. Deleting again answers 404.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Discarded or deleted' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  @ApiNotFoundResponse({
    description: 'Missing, or another account (SERVICE_INVOICE_NOT_FOUND)',
  })
  @ApiConflictResponse({
    description:
      'The note was already discarded (SERVICE_INVOICE_NOT_EDITABLE)',
  })
  discard(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.draftService.discard(user.id, id);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Confirms the note and records its income entry (US03)',
    description:
      'Needs an issue date, an amount and a client. The entry is a ' +
      'PROFESSIONAL income under "Professional fees", accrued on the issue ' +
      "date and due after the client's payment terms. It is recorded even " +
      'when an appointment already earned the same revenue: the user is ' +
      'expected to upload only notes of appointments not registered in the app.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ServiceInvoiceConfirmationDto })
  @ApiBadRequestResponse({
    description:
      'Invalid payload, or a field is missing, listed in the details (SERVICE_INVOICE_NOT_READY)',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  @ApiNotFoundResponse({
    description:
      'The note or its client is missing or not yours (SERVICE_INVOICE_NOT_FOUND, CLIENT_NOT_FOUND)',
  })
  @ApiConflictResponse({
    description:
      'A confirmed note looks like this one, sent in details.duplicateOf; ' +
      'resend with allowDuplicate (SERVICE_INVOICE_POSSIBLE_DUPLICATE). Or ' +
      'the note is not a draft (SERVICE_INVOICE_NOT_EDITABLE)',
  })
  confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmServiceInvoiceDto,
  ): Promise<ServiceInvoiceConfirmationDto> {
    return this.confirmationService.confirm(user.id, id, dto);
  }

  @Get(':id/download-url')
  @ApiOperation({
    summary: 'Issues a short-lived URL to download the PDF of a confirmed note',
    description:
      'The URL answers as an attachment named `filename`, as application/pdf.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ServiceInvoiceDownloadDto })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  @ApiNotFoundResponse({
    description:
      'Missing, another account, or without a file (SERVICE_INVOICE_FILE_NOT_FOUND)',
  })
  @ApiConflictResponse({
    description: 'Still a draft (SERVICE_INVOICE_NOT_CONFIRMED)',
  })
  downloadFile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ServiceInvoiceDownloadDto> {
    return this.draftService.downloadFile(user.id, id);
  }

  @Get(':id/file')
  @ApiOperation({
    summary: 'Issues a download URL for the original PDF (US02)',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ServiceInvoiceDownloadUrlDto })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  @ApiNotFoundResponse({
    description: 'Missing, or another account (SERVICE_INVOICE_NOT_FOUND)',
  })
  @ApiConflictResponse({
    description:
      'The upload was never confirmed (SERVICE_INVOICE_UPLOAD_NOT_FINISHED)',
  })
  downloadUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ServiceInvoiceDownloadUrlDto> {
    return this.draftService.downloadUrl(user.id, id);
  }

  @Post(':id/upload-url')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Issues the presigned POST for the NFSe PDF',
    description:
      'The first issue creates the draft with the id the app picked. The S3 ' +
      'key is derived from that id, so every issue writes to the same object: ' +
      'an expired presigned POST, a failed upload or a replaced file.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ServiceInvoiceUploadUrlResponseDto })
  @ApiBadRequestResponse({ description: 'Invalid payload, or not a PDF' })
  @ApiPayloadTooLargeResponse({
    description: 'The file is over 15 MB (SERVICE_INVOICE_FILE_TOO_LARGE)',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  @ApiNotFoundResponse({
    description:
      'The id belongs to another account (SERVICE_INVOICE_NOT_FOUND)',
  })
  @ApiConflictResponse({
    description:
      'The same file is already in another note, which the details name ' +
      '(SERVICE_INVOICE_FILE_DUPLICATED); or the note is not a draft or was ' +
      'already read (SERVICE_INVOICE_NOT_EDITABLE)',
  })
  createUploadUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateServiceInvoiceUploadUrlDto,
  ): Promise<ServiceInvoiceUploadUrlResponseDto> {
    return this.uploadService.createUploadUrl(user.id, id, dto);
  }

  @Post(':id/uploaded')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Confirms the upload and reads the NFSe',
    description:
      'The app calls this after S3 answers 204. The API verifies the object ' +
      'with HeadObject rather than trusting the client, then reads the PDF ' +
      'before answering. Calling it again after a successful reading answers ' +
      'the same result without reading twice.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ServiceInvoiceUploadConfirmationDto })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  @ApiNotFoundResponse({
    description: 'Missing, or another account (SERVICE_INVOICE_NOT_FOUND)',
  })
  @ApiConflictResponse({
    description:
      'Not a draft (SERVICE_INVOICE_NOT_EDITABLE), no object at the key ' +
      '(SERVICE_INVOICE_UPLOAD_NOT_FINISHED), or it diverges from what was ' +
      'declared (SERVICE_INVOICE_UPLOAD_MISMATCH)',
  })
  confirmUpload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ServiceInvoiceUploadConfirmationDto> {
    return this.uploadService.confirmUpload(user.id, id);
  }
}
