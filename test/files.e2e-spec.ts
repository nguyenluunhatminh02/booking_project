import {
  INestApplication,
  CanActivate,
  ExecutionContext,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { APP_GUARD } from '@nestjs/core';
import { FilesController } from '../src/modules/file/files.controller';
import { MinioService } from '../src/modules/file/minio.service';
import { PrismaService } from '../src/prisma/prisma.service';

// Fake auth guard để bỏ qua JWT
class FakeAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    ctx.switchToHttp().getRequest().user = { id: 'u1' };
    return true;
  }
}

// Mocks
const minioMock = {
  bucket: 'booking-uploads',
  ensureBucket: jest.fn().mockResolvedValue(undefined),
  presignedPutStrict: jest.fn().mockResolvedValue('http://minio/put?sig=a'),
  presignedGet: jest.fn().mockResolvedValue('http://minio/get?sig=b'),
  validateUploaded: jest
    .fn()
    .mockResolvedValue({ size: 1234, mime: 'image/jpeg' }),
};

const prismaMock = {
  photo: {
    create: jest
      .fn()
      .mockImplementation(({ data }) =>
        Promise.resolve({ id: 'ph_1', ...data, createdAt: new Date() }),
      ),
  },
};

describe('FilesController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [FilesController],
      providers: [
        { provide: MinioService, useValue: minioMock },
        { provide: PrismaService, useValue: prismaMock },
        { provide: APP_GUARD, useClass: FakeAuthGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('POST /v1/files/presign-upload → 201 + objectKey đúng prefix + requiredHeaders', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/files/presign-upload')
      .send({ propertyId: 'prop_123', contentType: 'image/jpeg' })
      .expect(201);

    expect(res.body.putUrl).toBeTruthy();
    expect(res.body.objectKey.startsWith('properties/prop_123/')).toBe(true);
    expect(res.body.requiredHeaders).toEqual({ 'Content-Type': 'image/jpeg' });
    expect(minioMock.ensureBucket).toHaveBeenCalled();
    expect(minioMock.presignedPutStrict).toHaveBeenCalled();
  });

  it('POST /v1/files/attach-photo (happy) → 201 + lưu DB + trả mime/size', async () => {
    const objectKey = 'properties/prop_123/abc.jpg';
    const res = await request(app.getHttpServer())
      .post('/v1/files/attach-photo')
      .send({ propertyId: 'prop_123', objectKey })
      .expect(201);

    expect(minioMock.validateUploaded).toHaveBeenCalledWith(objectKey);
    expect(prismaMock.photo.create).toHaveBeenCalledTimes(1);
    expect(res.body.mime).toBe('image/jpeg');
    expect(res.body.size).toBe(1234);
  });

  it('POST /v1/files/attach-photo (sai prefix) → 400', async () => {
    await request(app.getHttpServer())
      .post('/v1/files/attach-photo')
      .send({ propertyId: 'prop_123', objectKey: 'properties/other/abc.jpg' })
      .expect(400);
  });

  it('POST /v1/files/attach-photo (trùng) → 409', async () => {
    prismaMock.photo.create.mockRejectedValueOnce({ code: 'P2002' }); // unique violation
    await request(app.getHttpServer())
      .post('/v1/files/attach-photo')
      .send({
        propertyId: 'prop_123',
        objectKey: 'properties/prop_123/dup.jpg',
      })
      .expect(409);
  });

  it('POST /v1/files/presign-download → 201 + trả url GET', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/files/presign-download')
      .send({ objectKey: 'properties/prop_123/abc.jpg' })
      .expect(201); // default 201

    expect(res.body.url).toContain('http://minio/get?sig=b');
    expect(res.body.method).toBe('GET');
  });
});
