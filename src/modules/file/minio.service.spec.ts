// src/modules/file/minio.service.spec.ts

// 1) Mock 'file-type' như module ảo (không cần cài)
jest.mock(
  'file-type',
  () => ({
    fileTypeFromBuffer: jest.fn(async (_buf: Buffer) => ({
      mime: 'image/png',
      ext: 'png',
    })),
  }),
  { virtual: true }, // 👈 quan trọng
);

// 2) Sau khi mock xong mới require service
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { MinioService } = require('../../modules/file/minio.service');

describe('MinioService.validateUploaded', () => {
  const clientMock: any = {
    statObject: jest.fn(),
    getPartialObject: jest.fn(),
    removeObject: jest.fn(),
  };

  const svc = new MinioService();
  svc.client = clientMock;
  svc.bucket = 'booking-uploads';
  // mock sniffMime riêng để không phụ thuộc file-type
  svc.sniffMime = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('hợp lệ → trả size/mime, không xoá', async () => {
    clientMock.statObject.mockResolvedValue({ size: 1000 });
    svc.sniffMime.mockResolvedValue({ mime: 'image/png' });

    const out = await svc.validateUploaded('k.png');
    expect(out).toEqual({ size: 1000, mime: 'image/png' });
    expect(clientMock.removeObject).not.toHaveBeenCalled();
  });

  it('quá lớn → xoá + throw', async () => {
    clientMock.statObject.mockResolvedValue({ size: 5 * 1024 * 1024 + 1 });
    await expect(svc.validateUploaded('big.bin')).rejects.toThrow(
      /File too large/,
    );
    expect(clientMock.removeObject).toHaveBeenCalledWith(
      'booking-uploads',
      'big.bin',
    );
  });

  it('MIME lạ → xoá + throw', async () => {
    clientMock.statObject.mockResolvedValue({ size: 1000 });
    svc.sniffMime.mockResolvedValue({ mime: 'text/plain' });
    await expect(svc.validateUploaded('weird.txt')).rejects.toThrow(
      /Invalid file type/,
    );
    expect(clientMock.removeObject).toHaveBeenCalledWith(
      'booking-uploads',
      'weird.txt',
    );
  });
});
