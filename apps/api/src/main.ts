import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { rateLimit } from './common/rate-limit';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // query string แบบแบน: ทุกค่าเป็น string ชื่อซ้ำใช้ค่าแรก (ทุก endpoint รับ query เป็นข้อความเท่านั้น)
  app.set('query parser', (str: string) => {
    const out: Record<string, string> = {};
    for (const [k, v] of new URLSearchParams(str)) if (!(k in out)) out[k] = v;
    return out;
  });
  app.setGlobalPrefix('api');
  // จำกัดคำขอต่อ IP ก่อนถึงทุก route (common/rate-limit.ts)
  app.use(rateLimit);
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`WMS API: http://localhost:${port}/api`);
}

void bootstrap();
