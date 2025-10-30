import { PassThrough } from 'stream';

class MockPdfPrinter {
  constructor(_fonts: Record<string, unknown>) {}
  createPdfKitDocument(_def: unknown) {
    const s = new PassThrough();
    const origEnd = s.end.bind(s) as PassThrough['end'];
    s.end = ((...args: Parameters<PassThrough['end']>) => {
      try {
        s.write(Buffer.from('%PDF-1.4\n%mock\n'));
      } catch {
        /* empty */
      }
      return origEnd(...args);
    }) as PassThrough['end'];
    return s;
  }
}

// CJS export để `require('pdfmake')` trả về constructor
export = MockPdfPrinter;
