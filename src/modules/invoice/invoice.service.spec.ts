// src/modules/invoice/invoice.service.spec.ts
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { InvoiceService } from './invoice.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MailerService } from '../mailer/mailer.service';
import { OutboxProducer } from '../outbox/outbox.producer';

describe('InvoiceService (unit)', () => {
  let svc: InvoiceService;
  let prisma: {
    booking: { findUnique: jest.Mock };
  };
  let mailer: { send: jest.Mock };
  let outbox: { emit: jest.Mock };

  const bookingOk = {
    id: 'bk_123',
    checkIn: new Date('2025-12-01T00:00:00Z'),
    checkOut: new Date('2025-12-04T00:00:00Z'),
    totalPrice: 9_000_000,
    property: { title: 'Sea View Apt' },
    customer: { email: 'alice@example.com', fullName: 'Alice' },
    payment: { status: 'SUCCEEDED' },
  };

  beforeEach(async () => {
    prisma = {
      booking: {
        findUnique: jest.fn().mockResolvedValue(bookingOk),
      },
    } as any;

    mailer = {
      send: jest.fn().mockResolvedValue({ queued: true }),
    };
    outbox = {
      emit: jest.fn().mockResolvedValue(undefined),
    };

    const modRef = await Test.createTestingModule({
      providers: [
        InvoiceService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailerService, useValue: mailer },
        { provide: OutboxProducer, useValue: outbox },
      ],
    }).compile();

    svc = modRef.get(InvoiceService);
  });

  it('generatePdfBuffer: returns a PDF buffer', async () => {
    const buf = await svc.generatePdfBuffer('bk_123');
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.slice(0, 5).toString('utf8')).toBe('%PDF-');
    expect(prisma.booking.findUnique).toHaveBeenCalledWith({
      where: { id: 'bk_123' },
      include: { property: true, customer: true, payment: true },
    });
  });

  it('generatePdfStream: returns stream + filename', async () => {
    const { stream, filename } = await svc.generatePdfStream('bk_123');
    expect(filename).toBe('invoice-bk_123.pdf');

    const chunks: Buffer[] = [];
    const data = await new Promise<Buffer>((resolve, reject) => {
      stream
        .on('data', (c) => chunks.push(Buffer.from(c)))
        .on('end', () => resolve(Buffer.concat(chunks)))
        .on('error', reject);
    });
    expect(data.slice(0, 5).toString('utf8')).toBe('%PDF-');
  });

  it('emailInvoice: sends MailerService with PDF attachment', async () => {
    await svc.emailInvoice('bk_123');
    expect(mailer.send).toHaveBeenCalledTimes(1);

    const call = mailer.send.mock.calls[0][0];
    expect(call.to).toBe('alice@example.com');
    expect(call.subject).toMatch(/Invoice/);
    const att = call.attachments?.[0];
    expect(att?.filename).toBe('invoice-bk_123.pdf');
    // content là Readable stream
    expect(typeof att?.content?.on).toBe('function');
    expect(att?.contentType).toBe('application/pdf');
    expect(outbox.emit).toHaveBeenCalledWith(
      'invoice.emailed',
      {
        bookingId: 'bk_123',
        to: 'alice@example.com',
        filename: 'invoice-bk_123.pdf',
      },
      'invoice.emailed:bk_123',
    );
  });

  it('throws NotFound when booking missing', async () => {
    prisma.booking.findUnique.mockResolvedValueOnce(null);
    await expect(svc.generatePdfBuffer('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    prisma.booking.findUnique.mockResolvedValueOnce(null);
    await expect(svc.emailInvoice('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
