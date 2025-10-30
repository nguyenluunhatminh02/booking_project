import { IsInt, IsOptional, Min } from 'class-validator';

export class RefundDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  amount?: number; // nếu không set: refund full
}
