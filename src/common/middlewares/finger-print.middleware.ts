import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { DeviceFingerprintService } from '../finger-print.service';

@Injectable()
export class DeviceFingerprintMiddleware implements NestMiddleware {
  constructor(private deviceFpService: DeviceFingerprintService) {}

  use(req: Request, res: Response, next: NextFunction) {
    // Lấy hoặc tạo deviceId (cookie httpOnly)
    const deviceId = this.deviceFpService.getOrSetDeviceId(req, res);

    // Tính chữ ký fingerprint (HMAC từ các trường ổn định)
    const deviceFp = this.deviceFpService.calcSignature(req);

    // Đưa vào context cho downstream (AuthService, v.v.)
    req.ctx = {
      ...req.ctx,
      deviceId,
      deviceFp,
      ua: req.headers['user-agent'],
      ip:
        (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
        (req.socket?.remoteAddress ?? req.ip),
    };

    // Không set header, không log fingerprint để tránh lộ
    next();
  }
}
