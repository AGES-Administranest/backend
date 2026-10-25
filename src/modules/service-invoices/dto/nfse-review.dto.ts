import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExtractionFailureReason, ExtractionStatus } from '@prisma/client';

import type { DuplicateReason } from '../domain/find-duplicates';

export class ExtractedTakerDto {
  @ApiPropertyOptional({ example: 'CLINICA VETERINARIA EXEMPLO LTDA' })
  name?: string;

  @ApiPropertyOptional({
    example: '12345678000195',
    description: 'CNPJ or CPF, unmasked, check digits verified',
  })
  taxId?: string;
}

export class NfsePartialReadingDto {
  @ApiProperty({ example: 50 })
  pagesRead!: number;

  @ApiProperty({ example: 62 })
  totalPages!: number;
}

export class ClientOptionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Clínica Veterinária Exemplo' })
  name!: string;

  @ApiPropertyOptional({ example: '12345678000195' })
  taxId?: string;
}

export class DuplicateServiceInvoiceDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiPropertyOptional({ example: '1287' })
  number?: string;

  @ApiPropertyOptional({ example: '2026-10-13', format: 'date' })
  issueDate?: string;

  @ApiPropertyOptional({ example: 1500 })
  amount?: number;

  @ApiPropertyOptional({ example: 'Clínica Veterinária Exemplo' })
  clientName?: string;

  @ApiProperty({ enum: ['SAME_AMOUNT_AND_DATE', 'SAME_NUMBER_AND_TAKER'] })
  reason!: DuplicateReason;
}

/** What the review screen starts from: the note as it stands, edits included. */
export class NfseReviewDto {
  @ApiProperty({ enum: ExtractionStatus })
  status!: ExtractionStatus;

  @ApiPropertyOptional({
    enum: ExtractionFailureReason,
    description:
      'NO_FIELDS_FOUND: the text was read but no field was found; the review is filled in by hand',
  })
  failureReason?: ExtractionFailureReason;

  @ApiPropertyOptional({ example: '2026-10-13', format: 'date' })
  issueDate?: string;

  @ApiPropertyOptional({
    example: 1500,
    description: 'Gross amount of the services, before deductions and taxes',
  })
  amount?: number;

  @ApiPropertyOptional({ example: '1287' })
  number?: string;

  @ApiPropertyOptional({
    type: ExtractedTakerDto,
    description: 'As read from the note, to find or register the client',
  })
  taker?: ExtractedTakerDto;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'The client the user picked as the taker',
  })
  clientId?: string;

  @ApiPropertyOptional({
    type: ClientOptionDto,
    description:
      "The user's client with the taker's tax id, to preselect. Only while no client was picked",
  })
  clientMatch?: ClientOptionDto;

  @ApiPropertyOptional({
    type: [ClientOptionDto],
    description:
      "Up to 3 clients whose name looks like the taker's, closest first, when no tax id matched. " +
      'With neither field, the app offers to register the taker',
  })
  clientSuggestions?: ClientOptionDto[];

  @ApiPropertyOptional({
    type: DuplicateServiceInvoiceDto,
    description:
      'A confirmed note with the same amount and issue date, or the same number and taker. A warning only: the note can still be confirmed',
  })
  duplicateOf?: DuplicateServiceInvoiceDto;

  @ApiPropertyOptional({
    type: NfsePartialReadingDto,
    description: 'Only when the document is past the page cap',
  })
  partial?: NfsePartialReadingDto;
}
