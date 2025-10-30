import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { PromotionType } from '@prisma/client';
import { PromotionService } from './promotion.service';

// ====== DTOs ======
class CreatePromotionDto {
  @IsString() @IsNotEmpty() code!: string;
  @IsEnum(PromotionType) type!: PromotionType;
  @IsInt() value!: number;
  @IsOptional() @IsString() validFrom?: string | null;
  @IsOptional() @IsString() validTo?: string | null;
  @IsOptional() @IsInt() minNights?: number | null;
  @IsOptional() @IsInt() minTotal?: number | null;
  @IsOptional() @IsInt() usageLimit?: number | null;
  @IsOptional() isActive?: boolean | null;
}

class UpdatePromotionDto {
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsEnum(PromotionType) type?: PromotionType;
  @IsOptional() @IsInt() @Min(1) @Max(100) value?: number;
  @IsOptional() @IsString() validFrom?: string | null;
  @IsOptional() @IsString() validTo?: string | null;
  @IsOptional() @IsInt() minNights?: number | null;
  @IsOptional() @IsInt() minTotal?: number | null;
  @IsOptional() @IsInt() usageLimit?: number | null;
  @IsOptional() isActive?: boolean | null;
}

class ApplyOnHoldDto {
  @IsString() @IsNotEmpty() bookingId!: string;
  @IsString() @IsNotEmpty() code!: string;
  // Prod: lấy từ auth. Ở demo/.http cho phép truyền trực tiếp
  @IsString() @IsNotEmpty() userId!: string;
}

class ConfirmOnPaidDto {
  @IsString() @IsNotEmpty() bookingId!: string;
}

class ReleaseDto {
  @IsString() @IsNotEmpty() bookingId!: string;
  @IsOptional() @IsBoolean() decreaseUsage?: boolean = false;
  @IsOptional()
  @IsIn(['CANCELLED', 'EXPIRED', 'REFUNDED'])
  cause?: 'CANCELLED' | 'EXPIRED' | 'REFUNDED';
}

@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
@Controller('promotions')
export class PromotionController {
  constructor(private readonly svc: PromotionService) {}

  // ---- Admin CRUD ----
  @Post()
  create(@Body() dto: CreatePromotionDto) {
    return this.svc.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePromotionDto) {
    return this.svc.update(id, dto);
  }

  @Get()
  findAll() {
    return this.svc.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }

  @Get('by-code/:code')
  byCode(@Param('code') code: string) {
    return this.svc.byCode(code);
  }

  // ---- Preview (no side effects) ----
  @Get('preview')
  preview(@Query('bookingId') bookingId: string, @Query('code') code: string) {
    return this.svc.preview({ bookingId, code });
  }

  // ---- Apply / Confirm / Release ----
  @Post('apply-on-hold')
  applyOnHold(@Body() dto: ApplyOnHoldDto) {
    return this.svc.applyOnHold(dto);
  }

  @Post('confirm-on-paid')
  confirmOnPaid(@Body() dto: ConfirmOnPaidDto) {
    return this.svc.confirmOnPaid(dto.bookingId);
  }

  @Post('release')
  release(@Body() dto: ReleaseDto) {
    return this.svc.releaseOnCancelOrExpire(
      dto.bookingId,
      !!dto.decreaseUsage,
      dto.cause,
    );
  }
}
