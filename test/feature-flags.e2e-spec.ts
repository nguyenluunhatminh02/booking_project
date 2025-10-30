import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { DemoController } from '../src/modules/demo/demo.controller';
import { FeatureFlagsService } from '../src/modules/feature-flag/feature-flags.service';
import { FeatureFlagGuard } from '../src/modules/feature-flag/ff.guard';

// Fake middleware: gắn req.user cho test
function fakeAuth(userId?: string) {
  return (req, _res, next) => {
    req.user = userId ? { id: userId } : undefined;
    next();
  };
}

// Fake FF service: có thể set config tại runtime
class FakeFFService {
  enabled = true;
  payload: any = { rollout: 0, salt: 'fraud-v2' };
  async get(_key: string) {
    return await Promise.resolve({
      enabled: this.enabled,
      payload: this.payload,
    });
  }
  async isEnabled(_key: string) {
    return await Promise.resolve(this.enabled);
  }
}

describe('FeatureFlagGuard (e2e)', () => {
  let app: INestApplication;
  let ff: FakeFFService;

  beforeAll(async () => {
    ff = new FakeFFService();

    const moduleRef = await Test.createTestingModule({
      controllers: [DemoController],
      providers: [
        Reflector,
        { provide: FeatureFlagsService, useValue: ff },
        { provide: APP_GUARD, useClass: FeatureFlagGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // gắn user mặc định là 'bob'
    app.use(fakeAuth('bob'));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rollout=0% → 403', async () => {
    ff.enabled = true;
    ff.payload = { rollout: 0, salt: 'fraud-v2' };
    await request(app.getHttpServer()).get('/demo/fraud-score').expect(403);
  });

  it('kill-switch enabled=false → 403', async () => {
    ff.enabled = false;
    ff.payload = { rollout: 100 };
    await request(app.getHttpServer()).get('/demo/fraud-score').expect(403);
  });

  it('allowUsers cho phép vào dù rollout=0 → 200', async () => {
    ff.enabled = true;
    ff.payload = { rollout: 0, allowUsers: ['bob'] };
    await request(app.getHttpServer())
      .get('/demo/fraud-score')
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({ ok: true, user: 'bob' });
      });
  });

  it('denyUsers chặn dù rollout=100 → 403', async () => {
    ff.enabled = true;
    ff.payload = { rollout: 100, denyUsers: ['bob'] };
    await request(app.getHttpServer()).get('/demo/fraud-score').expect(403);
  });
});
