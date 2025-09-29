import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { PaymentService } from './payment.service';
import { Request } from 'express';

@Controller('payments')
export class PaymentWebhookController {
  constructor(private readonly service: PaymentService) {}

  // Stripe/MOCK: body-signed webhooks
  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Headers() headers: Record<string, any>,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const raw = (req as any).rawBody
      ? (req as any).rawBody.toString('utf8')
      : JSON.stringify((req as any).body || {});
    return await this.service.handleWebhook(headers, raw);
  }

  // VNPay: IPN (GET query) — phải trả text
  @Get('vnpay/ipn')
  @HttpCode(200)
  async vnpayIpn(@Query() q: Record<string, any>) {
    try {
      await this.service.handleVnpayIpn(q);
      return 'RspCode=00&Message=Confirm Success';
    } catch (e: any) {
      const msg = e?.message || '';
      if (/signature|Invalid/i.test(msg))
        return 'RspCode=97&Message=Invalid Signature';
      return 'RspCode=99&Message=Unknown Error';
    }
  }
}
