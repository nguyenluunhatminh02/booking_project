import { IsOptional, IsString, IsUrl } from 'class-validator';

export class CreateIntentDto {
  @IsOptional()
  @IsString()
  provider?: 'MOCK' | 'STRIPE' | 'VNPAY';

  @IsOptional()
  @IsUrl()
  returnUrl?: string;

  // VNPay thêm context
  @IsOptional()
  @IsString()
  clientIp?: string;

  @IsOptional()
  @IsString()
  orderInfo?: string;
}
