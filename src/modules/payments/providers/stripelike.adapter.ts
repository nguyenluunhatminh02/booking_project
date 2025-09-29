import { Injectable } from '@nestjs/common';
import { PaymentProviderAdapter, NormalizedWebhook } from './provider.adapter';
import { createHmac } from 'crypto';

function headerVal(h: Record<string, any>, k: string) {
  return h[k] ?? h[k.toLowerCase()] ?? h[k.toUpperCase()];
}

@Injectable()
export class StripeLikeHmacAdapter implements PaymentProviderAdapter {
  name() {
    return 'STRIPE' as const;
  }

  async createIntent(_p: {
    amount: number;
    currency: string;
    returnUrl?: string | null;
    metadata?: Record<string, any>;
  }) {
    const id = `pi_${Math.random().toString(36).slice(2)}`;
    return { intentId: id, clientSecret: `cs_${id}` };
  }

  async createRefund(_p: { chargeId: string; amount: number }) {
    const id = `re_${Math.random().toString(36).slice(2)}`;
    return { refundId: id };
  }

  async verifyAndNormalizeWebhook(
    headers: Record<string, any>,
    rawBody: string,
  ): Promise<NormalizedWebhook> {
    const secret = process.env.STRIPE_WEBHOOK_SECRET || '';
    if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET not set');

    const sig = headerVal(headers, 'stripe-signature');
    if (!sig) throw new Error('Missing Stripe-Signature');

    const parts = Object.fromEntries(
      String(sig)
        .split(',')
        .map((s) => s.split('=').map((x) => x.trim()) as [string, string]),
    );
    const t = parts['t'];
    const v1 = parts['v1'];
    if (!t || !v1) throw new Error('Invalid Stripe-Signature format');

    const payload = `${t}.${rawBody}`;
    const calc = createHmac('sha256', secret).update(payload).digest('hex');
    if (calc !== v1) throw new Error('Invalid signature');

    const evt = JSON.parse(rawBody || '{}');

    let type: NormalizedWebhook['type'] = 'payment_failed';
    let intentId: string | null = null;
    let chargeId: string | null = null;
    let amount: number | null = null;
    let currency: string | null = null;

    switch (evt.type) {
      case 'payment_intent.succeeded':
        type = 'payment_succeeded';
        intentId = evt.data?.object?.id ?? null;
        chargeId = evt.data?.object?.latest_charge ?? null;
        amount = evt.data?.object?.amount_received ?? null;
        currency = evt.data?.object?.currency?.toUpperCase?.() ?? null;
        break;
      case 'charge.succeeded':
        type = 'payment_succeeded';
        chargeId = evt.data?.object?.id ?? null;
        intentId = evt.data?.object?.payment_intent ?? null;
        amount = evt.data?.object?.amount ?? null;
        currency = evt.data?.object?.currency?.toUpperCase?.() ?? null;
        break;
      case 'payment_intent.payment_failed':
      case 'charge.failed':
        type = 'payment_failed';
        intentId =
          evt.data?.object?.id ?? evt.data?.object?.payment_intent ?? null;
        chargeId = evt.data?.object?.id ?? null;
        break;
      case 'charge.refunded':
        type = 'refund_succeeded';
        chargeId = evt.data?.object?.id ?? null;
        amount = evt.data?.object?.amount_refunded ?? null;
        currency = evt.data?.object?.currency?.toUpperCase?.() ?? null;
        break;
    }

    return {
      eventId: String(evt.id || `${evt.type}:${evt.created}`),
      type,
      provider: 'STRIPE',
      intentId,
      chargeId,
      amount,
      currency,
      raw: evt,
      paymentIdHint: null,
    };
  }
}
