import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class SearchInboxDto {
  @IsString()
  @MaxLength(200)
  q!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number = 20;
}
