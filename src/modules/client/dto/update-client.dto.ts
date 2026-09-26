import { OmitType, PartialType } from '@nestjs/swagger';

import { CreateClientDto, TaxIdProperty } from './create-client.dto';

/**
 * `taxId` is declared again instead of inherited: PartialType marks every
 * field optional one by one, which skips a field's validation whenever that
 * field is missing — and the tax id pair check would then let
 * `{ taxIdType: 'CPF' }` or a lone `{ taxId: null }` through.
 */
export class UpdateClientDto extends PartialType(
  OmitType(CreateClientDto, ['taxId'] as const),
) {
  @TaxIdProperty()
  taxId?: string | null;
}
