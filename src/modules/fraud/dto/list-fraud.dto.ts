import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListFraudDto {
  @IsOptional()
  @IsEnum(['PENDING', 'APPROVED', 'REJECTED'] as const)
  decision?: 'PENDING' | 'APPROVED' | 'REJECTED';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number = 0;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  take?: number = 20;
}
