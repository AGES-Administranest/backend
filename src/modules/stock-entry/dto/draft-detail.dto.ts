import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MeasurementUnit } from '@prisma/client';

import {
  ExtractionResponseDto,
  MatchCandidateDto,
} from './extraction-response.dto';

export class LinkedItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Propofol 1% amp 20ml' })
  name!: string;

  @ApiProperty({ enum: MeasurementUnit })
  unit!: MeasurementUnit;
}

export class DraftLineDto {
  @ApiPropertyOptional({
    example: 0,
    description:
      'The document line it came from; absent on a line added by hand',
  })
  sourceIndex?: number;

  @ApiProperty({ example: 'PROPOFOL 1% 20ML AMP' })
  description!: string;

  @ApiPropertyOptional({ type: LinkedItemDto })
  item?: LinkedItemDto;

  @ApiPropertyOptional({ example: 5 })
  quantity?: number;

  @ApiPropertyOptional({ example: 18.9 })
  unitCost?: number;

  @ApiPropertyOptional({
    example: 94.5,
    description: 'The printed total, while it disagrees with the line',
  })
  totalValue?: number;

  @ApiPropertyOptional({ example: 'PF8821' })
  lotNumber?: string;

  @ApiPropertyOptional({ example: '2027-05-31', format: 'date' })
  expirationDate?: string;

  @ApiProperty({
    type: [MatchCandidateDto],
    description: 'What the reading suggested for its document line',
  })
  candidates!: MatchCandidateDto[];
}

export class DraftDetailDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiPropertyOptional({ example: 'pedido-4521.pdf' })
  fileName?: string;

  @ApiPropertyOptional({ example: 'application/pdf' })
  fileMimeType?: string;

  @ApiProperty({
    type: ExtractionResponseDto,
    description: 'The reading, with the header as it stands now',
  })
  extraction!: ExtractionResponseDto;

  @ApiProperty({
    type: [DraftLineDto],
    description:
      'The review as saved; empty until it is first saved, when the app ' +
      'starts from `extraction.items`',
  })
  lines!: DraftLineDto[];
}
