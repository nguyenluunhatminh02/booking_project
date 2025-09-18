import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { FraudService } from './fraud.service';
import { ReviewFraudDto } from './dto/review-fraud.dto';
import { ListFraudDto } from './dto/list-fraud.dto';
// import { UseGuards } from '@nestjs/common';
// import { AdminGuard } from '../auth/guards/admin.guard';

type AuthedReq = Request & { user?: { sub: string } };

@Controller()
export class FraudController {
  constructor(private readonly svc: FraudService) {}

  // -------- Admin endpoints (bọc guard theo nhu cầu) --------

  /** Danh sách case cần review (mặc định PENDING) */
  @Get('admin/fraud/cases')
  // @UseGuards(AdminGuard)
  list(@Query() q: ListFraudDto) {
    return this.svc.listCases({
      decision: q.decision,
      skip: q.skip,
      take: q.take,
    });
  }

  /** Lấy 1 case theo bookingId */
  @Get('admin/fraud/cases/:bookingId')
  // @UseGuards(AdminGuard)
  getOne(@Param('bookingId') bookingId: string) {
    return this.svc.getCase(bookingId);
  }

  /** Ra quyết định cho case (APPROVED/REJECTED) */
  @Post('admin/fraud/cases/:bookingId/decision')
  // @UseGuards(AdminGuard)
  async decide(
    @Req() req: AuthedReq,
    @Param('bookingId') bookingId: string,
    @Body() dto: ReviewFraudDto,
  ) {
    const reviewerId = (req as any)?.user?.sub ?? 'user_admin_demo';
    return this.svc.decide(bookingId, reviewerId, dto.decision, dto.note);
  }

  // -------- Optional: debug assess nhanh (không ghi DB) --------

  /** Debug: chấm điểm tạm thời (không ghi DB) */
  @Get('admin/fraud/assess')
  // @UseGuards(AdminGuard)
  assessDebug(
    @Query('userId') userId: string,
    @Query('amount') amountStr: string,
  ) {
    const amount = Number(amountStr);
    if (!Number.isFinite(amount)) throw new Error('Invalid amount');
    return this.svc.assess(userId, amount);
  }
}
