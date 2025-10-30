export type NormalizedWebhook = {
  eventId: string;
  type:
    | 'payment_succeeded'
    | 'payment_failed'
    | 'refund_succeeded'
    | 'refund_failed';
  provider: 'MOCK' | 'STRIPE' | 'VNPAY';
  intentId?: string | null;
  chargeId?: string | null;
  paymentIdHint?: string | null;
  amount?: number | null; // minor units
  currency?: string | null; // e.g. 'VND'
  raw: any;
};

export interface PaymentProviderAdapter {
  name(): 'MOCK' | 'STRIPE' | 'VNPAY';

  createIntent(payload: {
    amount: number; // minor units
    currency: string; // 'VND'
    returnUrl?: string | null;
    metadata?: Record<string, any>;
  }): Promise<{
    intentId: string;
    clientSecret?: string | null;
    redirectUrl?: string | null;
  }>;

  createRefund(payload: {
    chargeId: string;
    amount: number;
  }): Promise<{ refundId: string }>;

  verifyAndNormalizeWebhook(
    headers: Record<string, any>,
    rawBody: string,
  ): Promise<NormalizedWebhook>;

  // VNPay dùng IPN GET
  verifyAndNormalizeIpn?(
    params: Record<string, string | string[]>,
  ): Promise<NormalizedWebhook>;
}
