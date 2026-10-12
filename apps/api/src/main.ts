import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { rateLimit } from './common/rate-limit';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  // จำกัดคำขอต่อ IP ก่อนถึงทุก route (common/rate-limit.ts)
  app.use(rateLimit);
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`WMS API: http://localhost:${port}/api`);
}

void bootstrap();
