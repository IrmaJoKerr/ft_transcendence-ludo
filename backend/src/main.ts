import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { AppModule } from './app.module';
import { PrismaService } from './prisma.service';
import { secret } from './secrets';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.set('trust proxy', 1);

  // JwtStrategy reads the token from req.cookies; without this it's undefined.
  app.use(cookieParser());


  // Enforce the class-validator decorators on register/login DTOs.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // CORS — allow the SPA origin. Same-origin deployments (nginx, or the SPA
  // served by this backend) don't strictly need it, but CORS_ORIGIN keeps the
  // door open for split-origin setups (comma-separated list).
  app.enableCors({
    origin: (() => {
      const fromEnv = secret('CORS_ORIGIN');
      if (fromEnv) return fromEnv.split(',').map((s) => s.trim()).filter(Boolean);
      return process.env.NODE_ENV === 'production'
        ? ['https://transcendence-ludo']
        : true; // Allow all origins in development
    })(),
    credentials: true,
  });

  // Socket.IO reverse proxy — the browser talks to ONE origin (this backend)
  // for everything: the SPA, /api, AND /socket.io. In the deployed (no-nginx)
  // topology this forwards both the HTTP handshake and the WebSocket upgrade
  // to the engine. Locally/under nginx, nginx already owns /socket.io and
  // answers before this middleware, so it's inert but harmless.
  const engineTarget = secret('ENGINE_URL') ?? 'http://ludo-engine:3001';
  const socketProxy = createProxyMiddleware({
    target: engineTarget,
    changeOrigin: true,
    ws: true,
    pathFilter: '/socket.io',
  });
  app.use(socketProxy as never);
  const httpServer = app.getHttpServer();
  httpServer.on('upgrade', (socketProxy as unknown as { upgrade: (req: unknown, socket: unknown, head: unknown) => void }).upgrade);

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

  await app.listen(Number(process.env.PORT) || 3000);
}
bootstrap();
