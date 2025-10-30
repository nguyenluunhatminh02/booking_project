import { Injectable } from '@nestjs/common';
import { PaymentProviderAdapter, NormalizedWebhook } from './provider.adapter';
import { createHmac } from 'crypto';

function toStringDict(
  q: Record<string, string | string[]>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(q)) {
    out[k] = Array.isArray(q[k]) ? q[k][0] : (q[k] ?? '');
  }
  return out;
}

function sortAndEncode(obj: Record<string, string>): string {
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const v = obj[k] ?? '';
    const ek = encodeURIComponent(k);
    const ev = encodeURIComponent(v).replace(/%20/g, '+');
    parts.push(`${ek}=${ev}`);
  }
  return parts.join('&');
}

function yyyymmddHHMMssLocal(d = new Date()) {
  const pad = (n: number) => `${n}`.padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

@Injectable()
export class VnpayAdapter implements PaymentProviderAdapter {
  name() {
    return 'VNPAY' as const;
  }

  private cfg() {
    const tmnCode = process.env.VNPAY_TMN_CODE || '';
    const hashSecret = process.env.VNPAY_HASH_SECRET || '';
    const payUrl =
      process.env.VNPAY_PAY_URL ||
      'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';
    const version = process.env.VNPAY_VERSION || '2.1.0';
    const currCode = process.env.VNPAY_CURRCODE || 'VND';
    const locale = process.env.VNPAY_LOCALE || 'vn';
    if (!tmnCode || !hashSecret)
      throw new Error('VNPAY_TMN_CODE / VNPAY_HASH_SECRET not set');
    return { tmnCode, hashSecret, payUrl, version, currCode, locale };
  }

  createIntent(p: {
    amount: number;
    currency: string;
    returnUrl?: string | null;
    metadata?: Record<string, any>;
  }) {
    const { tmnCode, hashSecret, payUrl, version, currCode, locale } =
      this.cfg();
    const amount100 = Math.round(p.amount) * 100;
    const ipAddr = String(p.metadata?.ipAddr || '127.0.0.1');
    const orderInfo = String(p.metadata?.orderInfo || 'Booking payment');
    const txnRef = `vnp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const params: Record<string, string> = {
      vnp_Version: version,
      vnp_Command: 'pay',
      vnp_TmnCode: tmnCode,
      vnp_Amount: String(amount100),
      vnp_CurrCode: currCode,
      vnp_TxnRef: txnRef,
      vnp_OrderInfo: orderInfo,
      vnp_OrderType: 'other',
      vnp_Locale: locale,
      vnp_IpAddr: ipAddr,
      vnp_CreateDate: yyyymmddHHMMssLocal(new Date()),
      vnp_ReturnUrl:
        p.returnUrl ||
        process.env.VNPAY_RETURN_URL ||
        'http://localhost:3000/payments/vnpay/return',
    };

    const signData = sortAndEncode(params);
    const vnp_SecureHash = createHmac('sha512', hashSecret)
      .update(signData)
      .digest('hex');
    const redirectUrl = `${payUrl}?${signData}&vnp_SecureHash=${vnp_SecureHash}`;

    return Promise.resolve({
      intentId: txnRef,
      clientSecret: null,
      redirectUrl,
    });
  }

  // Khớp interface, nhưng chưa hỗ trợ refund — ném lỗi
  createRefund(_p: {
    chargeId: string;
    amount: number;
  }): Promise<{ refundId: string }> {
    return Promise.reject(new Error('refund_not_supported_for_vnpay'));
  }

  verifyAndNormalizeWebhook(
    _headers: Record<string, any>,
    _rawBody: string,
  ): Promise<NormalizedWebhook> {
    return Promise.reject(new Error('unsupported_for_vnpay'));
  }

  verifyAndNormalizeIpn(
    paramsIn: Record<string, string | string[]>,
  ): Promise<NormalizedWebhook> {
    const { hashSecret, currCode } = this.cfg();
    const params = toStringDict(paramsIn);

    const secure = params['vnp_SecureHash'] || '';
    const filtered: Record<string, string> = {};
    for (const k of Object.keys(params)) {
      if (k === 'vnp_SecureHash' || k === 'vnp_SecureHashType') continue;
      filtered[k] = params[k];
    }
    const signData = sortAndEncode(filtered);
    const calc = createHmac('sha512', hashSecret)
      .update(signData)
      .digest('hex');
    if (calc.toLowerCase() !== secure.toLowerCase())
      throw new Error('Invalid VNPay signature');

    const responseCode = params['vnp_ResponseCode'];
    const txnStatus = params['vnp_TransactionStatus'];
    const ok = responseCode === '00' && txnStatus === '00';
    const amount = params['vnp_Amount']
      ? Number(params['vnp_Amount']) / 100
      : null;

    const eventId = `${params['vnp_TxnRef']}:${params['vnp_PayDate'] || Date.now()}`;

    return Promise.resolve({
      eventId,
      type: ok ? 'payment_succeeded' : 'payment_failed',
      provider: 'VNPAY',
      intentId: params['vnp_TxnRef'] || null,
      chargeId: params['vnp_TransactionNo'] || null,
      amount,
      currency: params['vnp_CurrCode'] || currCode,
      raw: params,
      paymentIdHint: null,
    });
  }
}
