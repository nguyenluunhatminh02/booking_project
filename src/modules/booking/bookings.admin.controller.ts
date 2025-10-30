import { Controller, Post } from '@nestjs/common';
import { BookingsService } from './bookings.service';
// import { AdminGuard } from '../auth/guards/admin.guard';

@Controller('admin/bookings')
// @UseGuards(AdminGuard)
export class BookingsAdminController {
  constructor(private readonly svc: BookingsService) {}

  @Post('expire')
  async expire() {
    return await this.svc.expireHolds(new Date());
  }
}
