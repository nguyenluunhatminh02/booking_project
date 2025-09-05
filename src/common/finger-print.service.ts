import { Injectable } from '@nestjs/common';
import { Request } from 'express';
import { createHash } from 'crypto';

@Injectable()
export class DeviceFingerprintService {
  generateFingerprint(req: Request): string {
    const components = [
      req.headers['user-agent'],
      req.headers['accept-language'],
      req.headers['sec-ch-ua'],
      req.headers['sec-ch-ua-platform'],
      req.ip || req.socket.remoteAddress,
      // Optional: Include more stable identifiers
      req.headers['x-device-id'],
      req.headers['x-client-id'],
    ];

    // Create hash from components
    const fingerprint = createHash('sha256')
      .update(components.filter(Boolean).join('|'))
      .digest('hex');

    return fingerprint;
  }

  verify(fingerprint: string, req: Request): boolean {
    const calculatedFp = this.generateFingerprint(req);
    return fingerprint === calculatedFp;
  }
}
