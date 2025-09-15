// src/common/mailer/mailer.service.ts
import { Injectable, Logger } from '@nestjs/common';
import * as sgMail from '@sendgrid/mail';

const FROM = process.env.SENDGRID_FROM || 'no-reply@example.com';
const SANDBOX = process.env.SENDGRID_SANDBOX === '1';

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly enabled: boolean;

  constructor() {
    const key = process.env.SENDGRID_API_KEY;
    if (key) {
      sgMail.setApiKey(key);
      this.enabled = true;
      this.logger.log(`SendGrid enabled (sandbox=${SANDBOX ? 'ON' : 'OFF'})`);
    } else {
      this.enabled = false;
      this.logger.warn('SendGrid disabled (missing SENDGRID_API_KEY)');
    }
  }

  async send(opts: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    category?: string;
    customArgs?: Record<string, string>;
  }) {
    if (!this.enabled) return { queued: false, reason: 'disabled' };

    const msg: sgMail.MailDataRequired = {
      to: opts.to,
      from: FROM,
      subject: opts.subject,
      html: opts.html,
      text:
        opts.text ??
        opts.html
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim(),
      trackingSettings: {
        clickTracking: { enable: false, enableText: false },
        openTracking: { enable: false },
        subscriptionTracking: { enable: false },
      },
      mailSettings: { sandboxMode: { enable: SANDBOX } },
      categories: opts.category ? [opts.category] : undefined,
      customArgs: opts.customArgs,
    };

    try {
      const [resp] = await sgMail.send(msg);
      this.logger.log(`SendGrid ok to=${opts.to} status=${resp.statusCode}`);
      return { queued: true };
    } catch (e: any) {
      const code = e?.code || e?.response?.statusCode;
      const details = e?.response?.body?.errors;
      this.logger.error(
        `SendGrid FAIL code=${code} to=${opts.to} details=${JSON.stringify(details) || e?.message}`,
      );
      throw e; // ĐỪNG nuốt lỗi
    }
  }
}
