import { Body, Controller, Headers, Param, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { BookingsService } from './bookings.service';
import { HoldBookingDto } from './dto/hold-booking.dto';
// import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'; // nếu có guard

type AuthedRequest = Request & { user?: { sub: string } };

@Controller('bookings')
// @UseGuards(JwtAuthGuard)
export class BookingsController {
  constructor(private readonly svc: BookingsService) {}

  @Post('hold')
  async hold(
    @Req() req: AuthedRequest,
    @Headers('Idempotency-Key') idemKey: string | undefined,
    @Body() body: HoldBookingDto,
  ) {
    const userId = req.user?.sub ?? 'user_customer_demo'; // demo fallback
    return await this.svc.hold(
      userId,
      body.propertyId,
      body.checkIn,
      body.checkOut,
      idemKey,
    );
  }

  @Post(':id/cancel')
  async cancelHold(@Req() req: AuthedRequest, @Param('id') bookingId: string) {
    const userId = req.user?.sub ?? 'user_customer_demo';
    return await this.svc.cancelHold(userId, bookingId);
  }
}
