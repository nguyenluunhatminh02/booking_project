import { Injectable } from '@nestjs/common';
import { Request, Response } from 'express';
import { createHmac } from 'crypto';
import { v4 as uuidv4 } from 'uuid';

const DEVICE_COOKIE = process.env.DEVICE_COOKIE_NAME || 'dvc';
const FP_SECRET = process.env.FP_SECRET || 'dev-fp-secret';

// Cookie options "an toàn" (điều chỉnh domain nếu cần)
const cookieOpts = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  maxAge: 365 * 24 * 60 * 60 * 1000, // 1 năm
  path: '/',
  // domain: '.your-domain.com', // nếu cần dùng subdomain
};

@Injectable()
export class DeviceFingerprintService {
  /** Lấy deviceId từ cookie; nếu chưa có thì sinh mới và set cookie. */
  getOrSetDeviceId(req: Request, res: Response): string {
    const fromCookie = req.cookies?.[DEVICE_COOKIE];
    if (
      fromCookie &&
      typeof fromCookie === 'string' &&
      fromCookie.length <= 64
    ) {
      return fromCookie;
    }
    const deviceId = uuidv4(); // opaque, không suy diễn được
    res.cookie(DEVICE_COOKIE, deviceId, cookieOpts);
    return deviceId;
  }

  /** Fingerprint: HMAC(secret, canonical UA/platform/lang/mobile/ip24) */
  calcSignature(req: Request): string {
    const c = this.canonicalClient(req);
    const base = `${c.uaFamily}|${c.uaMajor}|${c.platform}|${c.mobile}|${c.lang2}|${c.ip24}`;
    return createHmac('sha256', FP_SECRET).update(base).digest('base64url');
  }

  /** So khớp chữ ký với request hiện tại (nếu bạn lưu "baseline" ở DB). */
  verifySignature(expected: string, req: Request): boolean {
    const now = this.calcSignature(req);
    // so sánh constant-time (đơn giản hoá):
    return expected.length === now.length && expected === now;
  }

  /** Chuẩn hoá dữ liệu client để giảm false-negative. */
  private canonicalClient(req: Request) {
    const ua = (req.headers['user-agent'] as string) || '';
    const platform =
      (req.headers['sec-ch-ua-platform'] as string)?.replace(/"/g, '') ||
      this.guessPlatform(ua);

    const chMobile = (req.headers['sec-ch-ua-mobile'] as string)?.replace(
      /"?/g,
      '',
    );
    const mobile = chMobile === '?1' || chMobile === '1' ? '1' : '0';

    const lang = (req.headers['accept-language'] as string) || '';
    const lang2 = lang.split(',')[0]?.split('-')[0]?.toLowerCase() || 'xx';

    const { family, major } = this.parseUaMajor(ua);

    const ipRaw =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      (req.socket?.remoteAddress ?? req.ip) ||
      '';
    const ip24 = this.coarseIp(ipRaw);

    return {
      uaFamily: family, // Chrome/Firefox/Safari/Edge/Other
      uaMajor: major, // số major
      platform, // Windows/macOS/Android/iOS/Linux/Unknown
      mobile, // '1' hoặc '0'
      lang2, // 'vi','en',...
      ip24, // 1.2.3.0 hoặc rút gọn IPv6
    };
  }

  private parseUaMajor(ua: string): { family: string; major: string } {
    // Đơn giản hoá (đủ dùng cho khớp "tính tín hiệu"):
    const map: Array<[string, RegExp]> = [
      ['Chrome', /Chrome\/(\d+)/],
      ['Edge', /Edg\/(\d+)/],
      ['Firefox', /Firefox\/(\d+)/],
      ['Safari', /Version\/(\d+).+Safari/],
    ];
    for (const [family, re] of map) {
      const m = ua.match(re);
      if (m) return { family, major: m[1] };
    }
    const m2 = ua.match(/(\d+)[._]/);
    return { family: 'Other', major: m2?.[1] ?? '0' };
  }

  private guessPlatform(ua: string): string {
    if (/Windows NT/i.test(ua)) return 'Windows';
    if (/Macintosh|Mac OS X/i.test(ua)) return 'macOS';
    if (/Android/i.test(ua)) return 'Android';
    if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
    if (/Linux/i.test(ua)) return 'Linux';
    return 'Unknown';
  }

  private coarseIp(ip: string): string {
    // Rút gọn để giảm nhiễu (IP thay đổi nhỏ không làm lệch hoàn toàn)
    if (!ip) return '0';
    // IPv4
    const v4 = ip.match(/^(?:\d{1,3}\.){3}\d{1,3}$/);
    if (v4) {
      const parts = ip.split('.');
      parts[3] = '0';
      return parts.join('.');
    }
    // IPv6: lấy 4 hextet đầu
    const v6 = ip.includes(':') ? ip : '';
    if (v6) {
      const parts = v6.split(':');
      return parts.slice(0, 4).join(':');
    }
    return '0';
  }
}
