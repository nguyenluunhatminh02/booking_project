import { IsEnum, IsOptional, IsString } from 'class-validator';

export class ReviewFraudDto {
  @IsEnum(['APPROVED', 'REJECTED'] as const)
  decision!: 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  note?: string;
}
