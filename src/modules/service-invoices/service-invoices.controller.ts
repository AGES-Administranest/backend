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
import { ServiceInvoiceDownloadUrlDto } from './dto/download-url-response.dto';
import { QueryServiceInvoiceDto } from './dto/query-service-invoice.dto';
import { ServiceInvoiceDetailDto } from './dto/service-invoice-detail.dto';
import { ServiceInvoiceSummaryDto } from './dto/service-invoice-summary.dto';
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
    summary: 'Lists the NFSe, most recently created first',
    description: 'Discarded drafts only come back when asked for by status',
  })
  @ApiOkResponse({ type: [ServiceInvoiceSummaryDto] })
  @ApiBadRequestResponse({ description: 'Invalid filter' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid token' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryServiceInvoiceDto,
  ): Promise<ServiceInvoiceSummaryDto[]> {
    return this.draftService.list(user.id, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Reads an NFSe back for review',
    description: 'The reading and the review as last saved',
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
  @HttpCode(204)
  @ApiOperation({
    summary: 'Saves the review of a draft, or edits a confirmed note',
    description:
      'An absent field is left as it is; null clears it. On a confirmed note ' +
      'the income entry follows the amount, the issue date and the due date, ' +
      'and the issue date, the amount and the client cannot be cleared.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Saved' })
  @ApiBadRequestResponse({
    description:
      'Invalid payload, or a required field cleared on a confirmed note (SERVICE_INVOICE_NOT_READY)',
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
  ): Promise<void> {
    return this.draftService.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Discards a draft, or deletes a confirmed note',
    description:
      'A draft stays on record as CANCELLED, with its document. A confirmed ' +
      'note is deleted with its income entry. Either way the same file can ' +
      'start a new note.',
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
