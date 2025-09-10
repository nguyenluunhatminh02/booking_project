// src/common/middlewares/finger-print.middleware.ts

import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { DeviceFingerprintService } from '../finger-print.service';

@Injectable()
export class DeviceFingerprintMiddleware implements NestMiddleware {
  constructor(private deviceFpService: DeviceFingerprintService) {}

  use(req: Request, res: Response, next: NextFunction) {
    // Generate new fingerprint
    const fingerprint = this.deviceFpService.generateFingerprint(req);

    // Attach to request context
    req.ctx = {
      ...req.ctx,
      deviceFp: fingerprint,
    };

    // Set as response header
    res.setHeader('x-device-fp', fingerprint);

    next();
  }
}
