import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  Post,
  HttpCode,
  HttpStatus,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { InvoiceService } from './invoice.service';
// import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard'; // bật nếu cần bảo vệ

@Controller('v1/invoices')
// @UseGuards(JwtAuthGuard) // bật nếu chỉ cho user đã đăng nhập sử dụng
export class InvoiceController {
  constructor(private readonly invoice: InvoiceService) {}

  /**
   * Stream PDF invoice (inline). Thêm ?download=1 để tải về.
   * GET /v1/invoices/:bookingId.pdf
   */
  @Get(':bookingId.pdf')
  async streamPdf(
    @Param('bookingId') bookingId: string,
    @Query('download') download: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, filename } =
      await this.invoice.generatePdfStream(bookingId);

    // Headers
    res.setHeader('Content-Type', 'application/pdf');
    const isDownload = download === '1' || download === 'true';
    const disposition = isDownload ? 'attachment' : 'inline';
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${filename}"`,
    );

    return new StreamableFile(stream);
  }

  /**
   * Gửi invoice qua email cho khách của booking.
   * POST /v1/invoices/:bookingId/email
   */
  @Post(':bookingId/email')
  @HttpCode(HttpStatus.ACCEPTED)
  async emailInvoice(@Param('bookingId') bookingId: string) {
    await this.invoice.emailInvoice(bookingId);
    return { ok: true, bookingId };
  }
}
