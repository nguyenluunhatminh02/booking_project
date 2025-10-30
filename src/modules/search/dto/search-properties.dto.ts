import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

function toArray(v: any): string[] | undefined {
  if (v == null) return undefined;
  if (Array.isArray(v)) return v.map(String);
  const s = String(v).trim();
  if (!s) return [];
  return s
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

export class SearchPropertiesDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  lng?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(200)
  radiusKm?: number;

  @IsOptional()
  @IsString()
  startDate?: string; // ISO (yyyy-mm-dd)

  @IsOptional()
  @IsString()
  endDate?: string; // ISO

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPrice?: number;

  @IsOptional()
  @Transform(({ value }) => toArray(value))
  amenities?: string[];

  @IsOptional()
  @IsIn(['best', 'price', 'rating', 'distance'])
  sort?: 'best' | 'price' | 'rating' | 'distance';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  priceWithAllNights?: boolean = true; // hook để mở rộng sau
}
