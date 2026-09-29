import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { CreateUploadUrlDto } from './dto/create-upload-url.dto';
import { UploadConfirmationResponseDto } from './dto/upload-confirmation-response.dto';
import { UploadUrlResponseDto } from './dto/upload-url-response.dto';
import { StockEntryService } from './stock-entry.service';
import { CurrentUser } from '../../shared/auth';
// `import type` is required by `emitDecoratorMetadata` on a decorated signature.
import type { AuthenticatedUser } from '../../shared/auth';

@ApiTags('stock-entries')
@Controller('stock-entries')
export class StockEntryController {
  constructor(private readonly stockEntryService: StockEntryService) {}

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
