import { IsNotEmpty, IsString } from 'class-validator';

export class HoldBookingDto {
  @IsString()
  @IsNotEmpty()
  propertyId!: string;

  // nhận 'YYYY-MM-DD' (theo TZ) hoặc ISO datetime
  @IsString()
  @IsNotEmpty()
  checkIn!: string;

  @IsString()
  @IsNotEmpty()
  checkOut!: string;
}
