import { Injectable } from '@nestjs/common';
import { PaymentProviderAdapter, NormalizedWebhook } from './provider.adapter';
import { randomUUID, createHmac } from 'crypto';

@Injectable()
export class MockProviderAdapter implements PaymentProviderAdapter {
  name() {
    return 'MOCK' as const;
  }

  createIntent(_p: {
    amount: number;
    currency: string;
    returnUrl?: string | null;
    metadata?: Record<string, any>;
  }) {
    return Promise.resolve({
      intentId: `mock_${randomUUID()}`,
      clientSecret: `sec_${randomUUID()}`,
    });
  }

  createRefund(_p: { chargeId: string; amount: number }) {
    return Promise.resolve({ refundId: `r_${randomUUID()}` });
  }

  verifyAndNormalizeWebhook(
    headers: Record<string, any>,
    rawBody: string,
  ): Promise<NormalizedWebhook> {
    const secret = process.env.MOCK_WEBHOOK_SECRET || 'dev_mock_secret';
    const sig = headers['x-mock-signature'] || headers['X-Mock-Signature'];
    const calc = createHmac('sha256', secret).update(rawBody).digest('hex');
    if (!sig || String(sig) !== calc) {
      return Promise.reject(new Error('Invalid mock signature'));
    }

    const evt = JSON.parse(rawBody || '{}');
    const typeMap: Record<string, NormalizedWebhook['type']> = {
      'mock.payment.succeeded': 'payment_succeeded',
      'mock.payment.failed': 'payment_failed',
      'mock.refund.succeeded': 'refund_succeeded',
      'mock.refund.failed': 'refund_failed',
    };

    const result: NormalizedWebhook = {
      eventId: String(evt.id || evt.eventId || `mock:${Date.now()}`),
      type: typeMap[evt.type] || 'payment_failed',
      provider: 'MOCK',
      intentId: evt.data?.intentId ?? null,
      chargeId: evt.data?.chargeId ?? null,
      paymentIdHint: evt.data?.paymentId ?? null,
      amount: evt.data?.amount ?? null,
      currency: evt.data?.currency ?? null,
      raw: evt,
    };

    return Promise.resolve(result);
  }
}
