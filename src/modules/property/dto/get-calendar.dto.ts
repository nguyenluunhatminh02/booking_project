import { IsDateString, IsOptional } from 'class-validator';

export class GetCalendarDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
