import { NestFactory } from '@nestjs/core';
import { ValidationPipe, BadRequestException } from '@nestjs/common';
import type { HttpServer } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { PrismaService } from './prisma.service';
import { csrfProtection } from './common/csrf';

// Maps a failing validation (property + class-validator constraint) to a stable
// code the frontend localizes (errors.<CODE>). Constraints without an entry keep
// their English message, so nothing regresses.
const VALIDATION_CODES: Record<string, string> = {
  'username.matches': 'VALIDATION_USERNAME_FORMAT',
  'code.matches': 'VALIDATION_CODE_FORMAT',
  'displayName.isLength': 'VALIDATION_DISPLAY_NAME_LENGTH',
  'displayName.matches': 'VALIDATION_DISPLAY_NAME_CHARS',
  // `email` is the property name in both RegisterDto and UpdateProfileDto, so
  // this one line localizes @IsEmail() failures for signup and profile edits.
  'email.isEmail': 'VALIDATION_EMAIL_FORMAT',
  // Game invite (POST /api/game/:id/invite): InviteFriendDto.friendId must be a
  // real user id, and the client picks it from its own friend list.
  'friendId.isUuid': 'VALIDATION_FRIEND_ID_FORMAT',
};

// Which failing constraint to prefer when a field breaks more than one rule
// (e.g. an empty display name fails both length and character rules; length is
// the clearer message). Only affects fields that have a mapped code.
const CONSTRAINT_PRIORITY = ['isLength', 'minLength', 'maxLength', 'matches', 'isEmail', 'isUuid'];

// Turns class-validator failures into { code?, message } so DTO validation errors
// are localized like the rest. Unmapped constraints keep Nest's default shape.
function validationExceptionFactory(errors: ValidationError[]): BadRequestException {
  const messages = errors.flatMap((e) => (e.constraints ? Object.values(e.constraints) : []));
  const message = messages.length > 0 ? messages : ['Invalid request payload'];

  // Pick the first failing field that has a mapped code, independent of the
  // order class-validator reports the errors in.
  let code: string | undefined;
  for (const e of errors) {
    if (!e.constraints) continue;
    const keys = Object.keys(e.constraints);
    const constraint =
      CONSTRAINT_PRIORITY.find((k) => keys.includes(k) && VALIDATION_CODES[`${e.property}.${k}`]) ??
      keys[0];
    const candidate = VALIDATION_CODES[`${e.property}.${constraint}`];
    if (candidate) {
      code = candidate;
      break;
    }
  }

  if (code) return new BadRequestException({ code, message });
  return new BadRequestException({ statusCode: 400, message, error: 'Bad Request' });
}

// App entry point: builds the NestJS app, sets up trust-proxy, cookies and validation,
// exposes a /health DB check, and starts listening on port 3000.
// Called once at startup from the line below.
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Trust internal hops (localhost/LAN/tunnel) by address, so req.ip is the
  // real client IP for rate limiting and can't be spoofed via X-Forwarded-For.
  app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);

  // JwtStrategy reads the token from req.cookies; without this it's undefined.
  app.use(cookieParser());

  // CSRF: same-host Origin allow-list plus a signed double-submit token echoed
  // in X-CSRF-Token on every mutating /api route (see common/csrf.ts). Mounted
  // after cookieParser so the token cookie is readable, and before the routes so
  // nothing reaches a controller without both checks.
  app.use(csrfProtection);

  // Enforce the class-validator decorators on register/login DTOs, localizing
  // the mapped validation failures (see validationExceptionFactory).
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );

  // Health endpoint. Typed via the generic HttpServer interface because the
  // concrete ExpressAdapter's RequestHandler type is too narrow for a custom
  // handler; same runtime object as app.getHttpAdapter().
  const prisma = app.get(PrismaService);
  const httpServer: HttpServer = app.getHttpAdapter();
  httpServer.get(
    '/health',
    async (
      _req: unknown,
      res: { status: (code: number) => { json: (body: unknown) => unknown } },
    ) => {
      try {
        await prisma.db.$queryRaw`SELECT 1`;
        res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
      } catch {
        res.status(500).json({ status: 'error', timestamp: new Date().toISOString() });
      }
    },
  );

  await app.listen(3000);
}
bootstrap().catch((err) => {
  console.error('Failed to start the backend:', err);
  process.exit(1);
});
