// src/common/mailer/mailer.service.ts
import { Injectable, Logger } from '@nestjs/common';
import * as sgMail from '@sendgrid/mail';
import { Readable } from 'stream';

const FROM = process.env.SENDGRID_FROM || 'no-reply@example.com';
const SANDBOX = process.env.SENDGRID_SANDBOX === '1';

type AttachmentInput = {
  filename: string;
  content: Buffer | Readable | string; // Buffer | Readable | base64 string
  contentType?: string;
  contentDisposition?: 'attachment' | 'inline';
  contentId?: string; // dùng cho inline images (cid)
};

type SendOpts = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;

  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;

  /** 1 category hoặc nhiều (SendGrid sẽ lấy tối đa 10) */
  category?: string;
  categories?: string[];

  customArgs?: Record<string, string>;
  headers?: Record<string, string>;
  attachments?: AttachmentInput[];
};

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

  private async toBase64(input: Buffer | Readable | string): Promise<string> {
    if (typeof input === 'string') {
      // nếu người gọi đã truyền sẵn base64 string thì dùng luôn
      // (không thể phân biệt 100%, nhưng đa số bạn sẽ truyền Buffer/Readable)
      try {
        // thử decode để xác định có phải base64 hợp lệ không
        const maybe = Buffer.from(input, 'base64');
        if (maybe.toString('base64') === input.replace(/\r?\n/g, '')) {
          return input;
        }
      } catch {
        /* ignore */
      }
      return Buffer.from(input, 'utf8').toString('base64');
    }
    if (Buffer.isBuffer(input)) return input.toString('base64');

    // Readable
    const chunks: Buffer[] = [];
    for await (const ch of input as any) {
      chunks.push(Buffer.isBuffer(ch) ? ch : Buffer.from(ch));
    }
    return Buffer.concat(chunks).toString('base64');
  }

  async send(opts: SendOpts) {
    if (!this.enabled) return { queued: false, reason: 'disabled' as const };

    const categories = [
      ...(opts.categories ?? []),
      ...(opts.category ? [opts.category] : []),
    ];
    const headers = opts.headers ?? undefined;

    let attachments;
    if (opts.attachments?.length) {
      attachments = await Promise.all(
        opts.attachments.map(async (a) => ({
          filename: a.filename,
          type: a.contentType,
          disposition: a.contentDisposition,
          contentId: a.contentId,
          content: await this.toBase64(a.content),
        })),
      );
    }

    const msg: sgMail.MailDataRequired = {
      to: opts.to,
      from: FROM,
      subject: opts.subject,
      html: opts.html,
      text:
        opts.text ??
        opts.html
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]*>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim(),
      cc: opts.cc,
      bcc: opts.bcc,
      replyTo: opts.replyTo,
      trackingSettings: {
        clickTracking: { enable: false, enableText: false },
        openTracking: { enable: false },
        subscriptionTracking: { enable: false },
      },
      mailSettings: { sandboxMode: { enable: SANDBOX } },
      categories: categories.length ? categories.slice(0, 10) : undefined,
      customArgs: opts.customArgs,
      headers,
      attachments,
    };

    try {
      const [resp] = await sgMail.send(msg);
      this.logger.log(
        `SendGrid ok to=${
          Array.isArray(opts.to) ? opts.to.join(',') : opts.to
        } status=${resp.statusCode}`,
      );
      return { queued: true as const };
    } catch (e: any) {
      const code = e?.code || e?.response?.statusCode;
      const details = e?.response?.body?.errors;
      this.logger.error(
        `SendGrid FAIL code=${code} to=${
          Array.isArray(opts.to) ? opts.to.join(',') : opts.to
        } details=${JSON.stringify(details) || e?.message}`,
      );
      throw e;
    }
  }
}
