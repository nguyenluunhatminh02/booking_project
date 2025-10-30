import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PaymentService } from './payment.service';
import { CreateIntentDto } from './dto/create-intent.dto';
import { RefundDto } from './dto/refund.dto';
// import { JwtAuthGuard } from '../auth/guards/jwt.guard';

@UseGuards(/* JwtAuthGuard */)
@Controller('payments')
export class PaymentController {
  constructor(private readonly service: PaymentService) {}

  @Post(':bookingId/intent')
  async createIntent(
    @Req() req: any,
    @Param('bookingId') bookingId: string,
    @Body() dto: CreateIntentDto,
  ) {
    const userId = (req.user?.id as string) || 'u1';
    const idem = (req.headers['idempotency-key'] as string) || undefined;
    return this.service.createIntent(userId, bookingId, dto, idem);
  }

  @Post(':id/refund')
  async refund(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: RefundDto,
  ) {
    const userId = (req.user?.id as string) || 'u1';
    const idem = (req.headers['idempotency-key'] as string) || undefined;
    return this.service.refund(userId, id, dto, idem);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.service.getPayment(id);
  }

  @Get()
  async listByBooking(@Query('bookingId') bookingId: string) {
    return this.service.listByBooking(bookingId);
  }
}
