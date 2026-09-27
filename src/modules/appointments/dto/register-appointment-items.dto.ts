import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsPositive,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class AppointmentItemUsageDto {
  @ApiProperty({ example: '3f7b1c4a-8e2d-4f1a-9c3b-2d4e5f6a7b8c' })
  @IsUUID()
  itemId!: string;

  @ApiProperty({ example: 2, description: 'Quantity used, in the item unit' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity!: number;
}

// No `userId`: the owner comes from the token, never from the request (ADR-11).
export class RegisterAppointmentItemsDto {
  @ApiProperty({ type: [AppointmentItemUsageDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => AppointmentItemUsageDto)
  items!: AppointmentItemUsageDto[];
}
