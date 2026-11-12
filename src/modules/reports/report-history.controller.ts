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
  ApiNoContentResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { QueryReportHistoryDto } from './dto/query-report-history.dto';
import { ReportDownloadUrlEntity } from './entities/report-download-url.entity';
import { ReportHistoryItemEntity } from './entities/report-history-item.entity';
import { ReportHistoryService } from './report-history.service';
import { CurrentUser } from '../../shared/auth';
// `import type` is required by `emitDecoratorMetadata` on a decorated signature.
import type { AuthenticatedUser } from '../../shared/auth';

/**
 * The history of generated reports (US32). Its own controller under the same
 * path, so the routes that generate reports stay in `ReportsController`.
 */
@ApiTags('reports')
@Controller('reports')
export class ReportHistoryController {
  constructor(private readonly history: ReportHistoryService) {}

  @Get()
  @ApiOkResponse({ type: ReportHistoryItemEntity, isArray: true })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: QueryReportHistoryDto,
  ): Promise<ReportHistoryItemEntity[]> {
    return this.history.list(user.id, query);
  }

  @Get(':id/file')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ReportDownloadUrlEntity })
  downloadUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ReportDownloadUrlEntity> {
    return this.history.downloadUrl(user.id, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiNoContentResponse()
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.history.remove(user.id, id);
  }
}
