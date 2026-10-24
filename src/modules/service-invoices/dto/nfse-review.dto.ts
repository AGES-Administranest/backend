import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExtractionFailureReason, ExtractionStatus } from '@prisma/client';

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
    type: NfsePartialReadingDto,
    description: 'Only when the document is past the page cap',
  })
  partial?: NfsePartialReadingDto;
}
