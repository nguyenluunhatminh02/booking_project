import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  Min,
} from 'class-validator';

class UpsertCalendarItemDto {
  @IsDateString()
  date!: string; // YYYY-MM-DD hoặc ISO

  @IsOptional()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  remaining?: number;

  @IsOptional()
  @IsBoolean()
  isBlocked?: boolean;
}

export class UpsertCalendarDto {
  @IsArray()
  @ArrayMaxSize(366)
  items!: UpsertCalendarItemDto[];
}
