import { IsNotEmpty, IsOptional, IsString, IsNumber } from 'class-validator';

export class CreatePropertyDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  address!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @IsOptional()
  lat?: number;

  @IsNumber()
  @IsOptional()
  lng?: number;

  @IsOptional()
  amenities?: Record<string, any>;
}
