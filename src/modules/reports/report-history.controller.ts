import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { QueryReportHistoryDto } from './dto/query-report-history.dto';
import { ReportDownloadUrlEntity } from './entities/report-download-url.entity';
import { ReportHistoryItemEntity } from './entities/report-history-item.entity';
import { ReportHistoryService } from './report-history.service';
import { CurrentUser } from '../../shared/auth';
// `import type` is required by `emitDecoratorMetadata` on a decorated signature.
import type { AuthenticatedUser } from '../../shared/auth';

const UNAUTHORIZED =
  'Missing or invalid token (UNAUTHENTICATED, TOKEN_EXPIRED, TOKEN_INVALID)';
const NOT_FOUND =
  'Missing, another account, not stored yet, failed or deleted (REPORT_NOT_FOUND)';

/**
 * The history of generated reports (US32). Its own controller under the same
 * path, so the routes that generate reports stay in `ReportsController`.
 */
@ApiTags('reports')
@Controller('reports')
export class ReportHistoryController {
  constructor(private readonly history: ReportHistoryService) {}

  @Get()
  @ApiOperation({
    summary: 'Lists the generated reports and packages, newest first (US32)',
    description:
      'Only reports whose file is stored and that were not deleted. Newest ' +
      'generation first; reports generated in the same instant come in a ' +
      'fixed order, so paging never repeats or skips one. A page shorter ' +
      'than limit is the last one: there is no total count.',
  })
  @ApiOkResponse({ type: ReportHistoryItemEntity, isArray: true })
  @ApiBadRequestResponse({
    description:
      'kind is not GENERAL_REPORT or TAX_PACKAGE, page is out of 1–10000, ' +
      'limit is out of 1–100, or an unknown field such as userId was sent ' +
      '(VALIDATION_ERROR)',
  })
  @ApiUnauthorizedResponse({ description: UNAUTHORIZED })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryReportHistoryDto,
  ): Promise<ReportHistoryItemEntity[]> {
    return this.history.list(user.id, query);
  }

  @Get(':id/file')
  @ApiOperation({
    summary: 'Issues a download URL for a generated report (US32)',
    description:
      'The same file that was generated, not a new one. The URL expires in ' +
      'five minutes: ask for another one to download again. It saves the ' +
      'file under fileName.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ReportDownloadUrlEntity })
  @ApiBadRequestResponse({ description: 'The id is not a UUID' })
  @ApiUnauthorizedResponse({ description: UNAUTHORIZED })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  downloadUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ReportDownloadUrlEntity> {
    return this.history.downloadUrl(user.id, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Deletes a generated report from the history (US32)',
    description:
      'The app asks the user to confirm first. The report leaves the list ' +
      'and its file is deleted from storage, so a URL issued before stops ' +
      'working. Deleting it again answers 404.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiBadRequestResponse({ description: 'The id is not a UUID' })
  @ApiUnauthorizedResponse({ description: UNAUTHORIZED })
  @ApiNotFoundResponse({ description: NOT_FOUND })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.history.remove(user.id, id);
  }
}
