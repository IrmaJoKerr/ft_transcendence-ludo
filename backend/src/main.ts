import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { PrismaService } from './prisma.service';

// App entry point: builds the NestJS app, sets up cookies/validation/CORS,
// exposes a /health DB check, and starts listening on port 3000.
// Called once at startup from the line below.
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.set('trust proxy', 1);

  // JwtStrategy reads the token from req.cookies; without this it's undefined.
  app.use(cookieParser());


  // Enforce the class-validator decorators on register/login DTOs.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // CORS - only allow requests from nginx origin
  app.enableCors({
    origin: process.env.NODE_ENV === 'production'
      ? ['https://transcendence-ludo']
      : true, // Allow all origins in development
    credentials: true,
  });

  // Health endpoint
  const prisma = app.get(PrismaService);
  app.getHttpAdapter().get('/health', async (_req: any, res: any) => {
    try {
      await prisma.db.$queryRaw`SELECT 1`;
      res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
    } catch (e) {
      res.status(500).json({ status: 'error', timestamp: new Date().toISOString() });
    }
  });

  await app.listen(3000);
}
bootstrap();
