import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExtractionFailureReason, ExtractionStatus } from '@prisma/client';

export class MatchCandidateDto {
  @ApiProperty({ format: 'uuid' })
  itemId!: string;

  @ApiProperty({ example: 'Propofol 10mg/mL - frasco ampola 20mL' })
  name!: string;

  @ApiProperty({ example: 0.912 })
  score!: number;
}

export class LineMatchDto {
  @ApiProperty({
    enum: ['linked', 'preselected', 'suggested', 'none'],
    description:
      '`linked` comes from a confirmed alias; a text match is at best ' +
      '`preselected`, for the user to confirm',
  })
  decision!: 'linked' | 'preselected' | 'suggested' | 'none';

  @ApiPropertyOptional({ format: 'uuid' })
  itemId?: string;

  @ApiPropertyOptional({ enum: ['ALIAS', 'FUZZY'] })
  reason?: 'ALIAS' | 'FUZZY';

  @ApiPropertyOptional({ example: 0.912 })
  confidence?: number;

  @ApiProperty({
    type: [MatchCandidateDto],
    description: 'Up to 3, best first',
  })
  candidates!: MatchCandidateDto[];
}

export class ExtractedLineDto {
  @ApiProperty({ example: 'PROPOFOL 1% 20ML AMP' })
  extractedDescription!: string;

  @ApiPropertyOptional({
    example: 5,
    description: 'Absent when the document does not print it',
  })
  quantity?: number;

  @ApiPropertyOptional({ example: 18.9 })
  unitValue?: number;

  @ApiPropertyOptional({ example: 94.5 })
  totalValue?: number;

  @ApiProperty({
    description: 'All three values present and quantity × unit ≈ total',
  })
  arithmeticCheck!: boolean;

  @ApiProperty({ type: LineMatchDto })
  match!: LineMatchDto;
}

export class ExtractedSupplierDto {
  @ApiPropertyOptional({ example: '11222333000181' })
  cnpj?: string;

  @ApiPropertyOptional({ example: 'Distribuidora Veterinária Exemplo Ltda' })
  name?: string;
}

export class PartialReadingDto {
  @ApiProperty({ example: 50 })
  pagesRead!: number;

  @ApiProperty({ example: 62 })
  totalPages!: number;
}

export class ExtractionResponseDto {
  @ApiProperty({ enum: ExtractionStatus })
  status!: ExtractionStatus;

  @ApiPropertyOptional({ enum: ExtractionFailureReason })
  failureReason?: ExtractionFailureReason;

  @ApiPropertyOptional({
    format: 'uuid',
    description: "The user's supplier with the CNPJ read from the document",
  })
  supplierId?: string;

  @ApiPropertyOptional({
    type: ExtractedSupplierDto,
    description: 'As read, to prefill a new supplier when none matched',
  })
  supplier?: ExtractedSupplierDto;

  @ApiPropertyOptional({ example: '4521' })
  invoiceNumber?: string;

  @ApiPropertyOptional({ example: '2026-08-12', format: 'date' })
  orderDate?: string;

  @ApiPropertyOptional({ example: 1870.7 })
  totalAmount?: number;

  @ApiProperty({ type: [ExtractedLineDto] })
  items!: ExtractedLineDto[];

  @ApiPropertyOptional({
    type: PartialReadingDto,
    description:
      'Only when the document is past the page cap: items and totals cover ' +
      'the pages read',
  })
  partial?: PartialReadingDto;
}
