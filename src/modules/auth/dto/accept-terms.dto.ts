import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class AcceptTermsDto {
  /**
   * Version of the text the person read and accepted. The app decides it: the
   * app rendered the text, so the app is what knows which version it was.
   */
  @ApiProperty({ example: '2026-09-01' })
  @IsString()
  @IsNotEmpty()
  termsVersion!: string;
}
