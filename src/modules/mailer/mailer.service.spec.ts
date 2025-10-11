import { Readable } from 'stream';
import { MailerService } from './mailer.service';

// Mock @sendgrid/mail
jest.mock('@sendgrid/mail', () => {
  return {
    setApiKey: jest.fn(),
    send: jest.fn(),
  };
});

import * as sgMail from '@sendgrid/mail';

describe('MailerService', () => {
  const realEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...realEnv };
  });

  afterAll(() => {
    process.env = realEnv;
  });

  it('returns {queued:false} when disabled (no SENDGRID_API_KEY)', async () => {
    delete process.env.SENDGRID_API_KEY;
    const svc = new MailerService();
    const out = await svc.send({
      to: 'a@b.com',
      subject: 'Hi',
      html: '<b>Hello</b>',
    });
    expect(out).toEqual({ queued: false, reason: 'disabled' });
    expect((sgMail.setApiKey as any).mock.calls.length).toBe(0);
    expect((sgMail.send as any).mock.calls.length).toBe(0);
  });

  it('sends with Buffer attachment and categories/sandbox', async () => {
    process.env.SENDGRID_API_KEY = 'test-key';
    process.env.SENDGRID_SANDBOX = '1'; // ensure sandbox ON

    (sgMail.send as any).mockResolvedValue([{ statusCode: 202 }]);

    const svc = new MailerService();

    const pdf = Buffer.from('%PDF-1.4 dummy');
    const res = await svc.send({
      to: ['u1@example.com', 'u2@example.com'],
      cc: 'c@example.com',
      bcc: 'b@example.com',
      replyTo: 'reply@example.com',
      subject: 'Invoice',
      html: '<h1>Invoice</h1><p>Thanks!</p>',
      categories: ['invoice', 'billing'],
      headers: { 'X-Category': 'invoice' },
      attachments: [
        {
          filename: 'invoice.pdf',
          content: pdf, // Buffer
          contentType: 'application/pdf',
          contentDisposition: 'attachment',
        },
      ],
    });

    expect(res).toEqual({ queued: true });

    // Sent payload assertions
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(sgMail.setApiKey as any).toHaveBeenCalledWith('test-key');
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(sgMail.send as any).toHaveBeenCalledTimes(1);

    const msg = (sgMail.send as any).mock.calls[0][0];
    expect(msg.to).toEqual(['u1@example.com', 'u2@example.com']);
    expect(msg.cc).toBe('c@example.com');
    expect(msg.bcc).toBe('b@example.com');
    expect(msg.replyTo).toBe('reply@example.com');
    expect(msg.subject).toBe('Invoice');
    expect(msg.html).toContain('Invoice');
    // fallback text should exist if not provided
    expect(typeof msg.text).toBe('string');
    expect(msg.categories).toEqual(['invoice', 'billing']);

    // attachments are base64
    expect(msg.attachments?.[0].filename).toBe('invoice.pdf');
    expect(msg.attachments?.[0].type).toBe('application/pdf');
    expect(msg.attachments?.[0].disposition).toBe('attachment');
    expect(typeof msg.attachments?.[0].content).toBe('string');

    // quick base64 sanity
    const decoded = Buffer.from(msg.attachments[0].content, 'base64').toString(
      'utf8',
    );
    expect(decoded.startsWith('%PDF-1.4')).toBe(true);
  });

  it('sends with Readable attachment and header', async () => {
    process.env.SENDGRID_API_KEY = 'test-key';
    (sgMail.send as any).mockResolvedValue([{ statusCode: 202 }]);

    const svc = new MailerService();
    const stream = Readable.from(Buffer.from('STREAM_DATA'));

    await svc.send({
      to: 'kronnosss2002@gmail.com',
      subject: 'Hello',
      html: '<p>Hi</p>',
      headers: { 'X-Test': '1' },
      attachments: [
        {
          filename: 'note.txt',
          content: stream, // Readable
          contentType: 'text/plain',
          contentDisposition: 'attachment',
        },
      ],
    });

    const msg = (sgMail.send as any).mock.calls[0][0];
    const contentB64 = msg.attachments[0].content as string;
    expect(Buffer.from(contentB64, 'base64').toString('utf8')).toBe(
      'STREAM_DATA',
    );
    expect(msg.headers).toEqual({ 'X-Test': '1' });
  });

  it('rethrows sendgrid error with details', async () => {
    process.env.SENDGRID_API_KEY = 'test-key';

    (sgMail.send as any).mockRejectedValue({
      code: 400,
      response: {
        body: { errors: [{ message: 'Bad email' }] },
        statusCode: 400,
      },
    });

    const svc = new MailerService();

    await expect(
      svc.send({
        to: 'bad',
        subject: 'X',
        html: '<b>Y</b>',
      }),
    ).rejects.toBeTruthy(); // service rethrows
  });
});
