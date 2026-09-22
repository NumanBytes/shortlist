import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

describe('API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health'] });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health reports ok', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('POST /api/v1/skills accepts a valid skill', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/skills')
      .send({ name: 'TypeScript', category: 'LANGUAGE' })
      .expect(201);
    expect(res.body.received.name).toBe('TypeScript');
  });

  it('POST /api/v1/skills returns 400 with field-level errors', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/skills')
      .send({ name: '', category: 'nope' })
      .expect(400);
    expect(res.body.errors.map((e: { path: string }) => e.path)).toEqual(['name', 'category']);
  });
});
