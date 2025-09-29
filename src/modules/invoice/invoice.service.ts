// src/modules/invoice/invoice.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import * as path from 'path';
import type {
  TDocumentDefinitions,
  TFontDictionary,
  Content,
  TableCell,
} from 'pdfmake/interfaces';
import { PrismaService } from '../../prisma/prisma.service';
import { Readable } from 'stream';
import { formatInTimeZone } from 'date-fns-tz';
import { differenceInCalendarDays } from 'date-fns';
import { ensureFontPaths } from '../../utils/asset-path';
import { buildSignedQrUrl } from '../../utils/qr.util';
import { OutboxProducer } from '../outbox/outbox.producer';

// eslint-disable-next-line @typescript-eslint/no-require-imports
import PdfPrinter = require('pdfmake');
import { MailerService } from '../mailer/mailer.service';

const TZ = process.env.INVOICE_TZ || 'Asia/Ho_Chi_Minh';
const resolveAsset = (...p: string[]) =>
  path.resolve(process.cwd(), 'assets', ...p);

@Injectable()
export class InvoiceService {
  private fonts: TFontDictionary = {
    Roboto: {
      normal: resolveAsset('fonts/Roboto-Regular.ttf'),
      bold: resolveAsset('fonts/Roboto-Bold.ttf'),
      italics: resolveAsset('fonts/Roboto-Italic.ttf'),
      bolditalics: resolveAsset('fonts/Roboto-BoldItalic.ttf'),
    },
  };

  private printer: PdfPrinter;

  constructor(
    private prisma: PrismaService,
    private mailer: MailerService,
    private outbox: OutboxProducer,
  ) {
    ensureFontPaths({
      Roboto: [
        this.fonts.Roboto.normal as string,
        this.fonts.Roboto.bold as string,
        this.fonts.Roboto.italics as string,
        this.fonts.Roboto.bolditalics as string,
      ],
    });
    this.printer = new PdfPrinter(this.fonts);
  }

  private formatVnd(input: unknown): string {
    const n =
      typeof input === 'object' &&
      input !== null &&
      'toNumber' in (input as any)
        ? (input as any).toNumber()
        : Number(input);
    return new Intl.NumberFormat('vi-VN', {
      style: 'currency',
      currency: 'VND',
      maximumFractionDigits: 0,
    }).format(n);
  }

  private fmtDate(d: Date): string {
    return formatInTimeZone(d, TZ, 'yyyy-MM-dd HH:mm');
  }

  private fmtYmd(d: Date): string {
    return formatInTimeZone(d, TZ, 'yyyy-MM-dd');
  }

  private buildDocDefinition(booking: any): TDocumentDefinitions {
    const nights = Math.max(
      1,
      differenceInCalendarDays(booking.checkOut, booking.checkIn),
    );
    const issuedAt = new Date();
    const companyName = process.env.INVOICE_COMPANY_NAME || 'Booking Co., Ltd.';
    const companyAddr =
      process.env.INVOICE_COMPANY_ADDR || '123 Sample Street, HCMC, Vietnam';
    const companyEmail =
      process.env.INVOICE_COMPANY_EMAIL || 'support@booking.local';
    const logoPath = process.env.INVOICE_LOGO_PATH
      ? resolveAsset(process.env.INVOICE_LOGO_PATH)
      : undefined;

    const qrUrl = buildSignedQrUrl(booking.id);

    const headerBlock: Content = {
      columns: [
        logoPath
          ? { image: logoPath, width: 80, margin: [0, 0, 10, 0] }
          : { text: companyName, style: 'brand' },
        [
          { text: 'INVOICE', style: 'header', alignment: 'right' },
          { text: `# ${booking.id}`, alignment: 'right', margin: [0, 2, 0, 0] },
          { text: this.fmtDate(issuedAt), alignment: 'right', style: 'meta' },
        ],
      ],
    };

    const customerBlock: Content = {
      columns: [
        {
          width: '50%',
          stack: [
            { text: 'Billed To', style: 'label' },
            {
              text:
                booking.customer?.fullName ||
                booking.customer?.email ||
                'Customer',
              margin: [0, 2, 0, 0],
            },
            ...(booking.customer?.email
              ? [{ text: booking.customer.email, style: 'light' }]
              : []),
          ],
        },
        {
          width: '50%',
          stack: [
            { text: 'From', style: 'label', alignment: 'right' },
            { text: companyName, alignment: 'right', margin: [0, 2, 0, 0] },
            { text: companyAddr, alignment: 'right', style: 'light' },
            { text: companyEmail, alignment: 'right', style: 'light' },
          ],
        },
      ],
      margin: [0, 20, 0, 10],
    };

    const summaryTable: TableCell[][] = [
      [
        { text: 'Property', style: 'th' },
        { text: 'Check-in', style: 'th' },
        { text: 'Check-out', style: 'th' },
        { text: 'Nights', style: 'th', alignment: 'right' },
      ],
      [
        { text: booking.property?.title || 'N/A' },
        { text: this.fmtYmd(booking.checkIn) },
        { text: this.fmtYmd(booking.checkOut) },
        { text: String(nights), alignment: 'right' },
      ],
    ];

    const totalRow: Content = {
      columns: [
        { text: 'Total', style: 'totalLabel', width: '*' },
        {
          text: this.formatVnd(booking.totalPrice),
          style: 'totalValue',
          alignment: 'right',
          width: 'auto',
        },
      ],
      margin: [0, 10, 0, 0],
    };

    const paymentBlock: Content = {
      columns: [
        {
          text: `Payment Status: ${booking.payment?.status || 'N/A'}`,
          style: 'meta',
        },
        { qr: qrUrl, fit: 80, alignment: 'right' },
      ],
      margin: [0, 10, 0, 0],
    };

    return {
      info: {
        title: `Invoice ${booking.id}`,
        author: companyName,
        subject: `Invoice for booking ${booking.id}`,
      },
      pageSize: 'A4',
      compress: true,
      content: [
        headerBlock,
        customerBlock,
        {
          table: { widths: ['*', 'auto', 'auto', 'auto'], body: summaryTable },
          layout: 'lightHorizontalLines',
        },
        totalRow,
        paymentBlock,
        {
          text: 'Tiếng Việt: Đặt chỗ/hoá đơn – Số tiền 1.234.567 ₫',
          margin: [0, 10, 0, 0],
          style: 'light',
        },
      ],
      footer: (currentPage, pageCount) => ({
        columns: [
          { text: `${companyName} — ${companyAddr}`, style: 'light' },
          {
            text: `Page ${currentPage} of ${pageCount}`,
            alignment: 'right',
            style: 'light',
          },
        ],
        margin: [40, 0, 40, 20],
      }),
      styles: {
        header: { fontSize: 20, bold: true },
        brand: { fontSize: 18, bold: true },
        label: { fontSize: 11, bold: true },
        meta: { fontSize: 10, color: '#555' },
        light: { fontSize: 9, color: '#777' },
        th: { bold: true, fillColor: '#f3f3f3', margin: [0, 3, 0, 3] },
        totalLabel: { bold: true, fontSize: 12 },
        totalValue: { bold: true, fontSize: 12 },
      },
      defaultStyle: {
        font: (process.env.INVOICE_FONT_FAMILY as any) || 'Roboto',
      },
      pageMargins: [40, 40, 40, 60],
    };
  }

  private async loadBooking(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { property: true, customer: true, payment: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  async generatePdfStream(
    bookingId: string,
  ): Promise<{ stream: Readable; filename: string }> {
    const booking = await this.loadBooking(bookingId);
    const docDefinition = this.buildDocDefinition(booking);
    const pdfDoc = this.printer.createPdfKitDocument(docDefinition);
    pdfDoc.end();
    return {
      stream: pdfDoc as unknown as Readable,
      filename: `invoice-${bookingId}.pdf`,
    };
  }

  async generatePdfBuffer(bookingId: string): Promise<Buffer> {
    const booking = await this.loadBooking(bookingId);
    const docDefinition = this.buildDocDefinition(booking);
    const pdfDoc = this.printer.createPdfKitDocument(docDefinition);

    const chunks: Buffer[] = [];
    return await new Promise<Buffer>((resolve, reject) => {
      pdfDoc.on('data', (d: Buffer) => chunks.push(d));
      pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
      pdfDoc.on('error', reject);
      pdfDoc.end();
    });
  }

  async emailInvoice(bookingId: string) {
    const booking = await this.loadBooking(bookingId);

    if (!booking.customer?.email) {
      throw new Error('Customer email is missing');
    }

    const { stream, filename } = await this.generatePdfStream(bookingId);

    const subject = `Invoice for booking ${bookingId}`;
    const html = `<p>Xin cảm ơn bạn đã đặt chỗ.</p>
<p>Hóa đơn của bạn được đính kèm.</p>`;
    const text = `Cam on ban da dat cho. Hoa don duoc dinh kem.`;

    await this.mailer.send({
      to: booking.customer.email,
      subject,
      html,
      text,
      categories: ['invoice'],
      headers: { 'X-Category': 'invoice' },
      attachments: [
        {
          filename,
          content: stream, // Readable
          contentType: 'application/pdf',
          contentDisposition: 'attachment',
        },
      ],
    });

    // Emit outbox sau khi gửi mail thành công
    await this.outbox.emit(
      'invoice.emailed',
      { bookingId, to: booking.customer.email, filename },
      `invoice.emailed:${bookingId}`, // namespaced event key
    );
  }
}
