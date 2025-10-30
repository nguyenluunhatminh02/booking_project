// test/invoice.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';

import { InvoiceController } from '../src/modules/invoice/invoice.controller';
import { InvoiceService } from '../src/modules/invoice/invoice.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { MailerService } from '../src/modules/mailer/mailer.service';

// Keep the same mocks as unit to avoid font/files dependency
jest.mock('../src/utils/asset-path', () => ({
  ensureFontPaths: jest.fn(),
}));

const createPdfStream = () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PassThrough } = require('stream');
  const out = new PassThrough();
  setImmediate(() => {
    out.write(Buffer.from('%PDF-1.4\n%dummy\n'));
    out.end();
  });
  return out;
};
jest.mock('pdfmake', () => {
  return jest.fn().mockImplementation(() => {
    return {
      createPdfKitDocument: jest.fn(() => createPdfStream()),
    };
  });
});

describe('InvoiceController (e2e)', () => {
  let app: INestApplication;
  let prisma: any;
  let mailer: any;

  beforeAll(async () => {
    const bookingOk = {
      id: 'bk_demo_123',
      checkIn: new Date('2025-12-01T00:00:00Z'),
      checkOut: new Date('2025-12-04T00:00:00Z'),
      totalPrice: 9000000,
      property: { title: 'Sea View Apt' },
      customer: { email: 'alice@example.com', fullName: 'Alice' },
      payment: { status: 'SUCCEEDED' },
    };

    prisma = {
      booking: {
        findUnique: jest.fn(({ where: { id } }) =>
          id === 'bk_demo_123' ? bookingOk : null,
        ),
      },
    };

    mailer = {
      send: jest.fn().mockResolvedValue({ queued: true }),
    };

    const modRef = await Test.createTestingModule({
      controllers: [InvoiceController],
      providers: [
        InvoiceService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailerService, useValue: mailer },
      ],
    }).compile();

    app = modRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /v1/invoices/:id.pdf → 200 PDF', async () => {
    const r = await request(app.getHttpServer())
      .get('/v1/invoices/bk_demo_123.pdf')
      .expect(200);

    expect(r.headers['content-type']).toMatch(/application\/pdf/);
    expect(r.body instanceof Buffer || Buffer.isBuffer(r.body)).toBe(true);
    // quick magic check
    expect(Buffer.from(r.body).slice(0, 5).toString('utf8')).toBe('%PDF-');
  });

  it('GET /v1/invoices/:id.pdf?download=1 → attachment', async () => {
    const r = await request(app.getHttpServer())
      .get('/v1/invoices/bk_demo_123.pdf?download=1')
      .expect(200);

    expect(r.headers['content-disposition']).toMatch(/attachment/);
  });

  it('POST /v1/invoices/:id/email → 200 + MailerService called', async () => {
    await request(app.getHttpServer())
      .post('/v1/invoices/bk_demo_123/email')
      .expect(200);

    expect(mailer.send).toHaveBeenCalledTimes(1);
    const msg = mailer.send.mock.calls[0][0];
    expect(msg.to).toBe('alice@example.com');
    expect(msg.attachments?.[0]?.filename).toBe('invoice-bk_demo_123.pdf');
  });

  it('404 when booking missing', async () => {
    await request(app.getHttpServer())
      .get('/v1/invoices/not_found.pdf')
      .expect(404);

    await request(app.getHttpServer())
      .post('/v1/invoices/not_found/email')
      .expect(404);
  });
});
