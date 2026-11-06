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
};

// Which failing constraint to prefer when a field breaks more than one rule
// (e.g. an empty display name fails both length and character rules; length is
// the clearer message). Only affects fields that have a mapped code.
const CONSTRAINT_PRIORITY = ['isLength', 'minLength', 'maxLength', 'matches', 'isEmail', 'isUuid'];

// Turns class-validator failures into { code?, message } so DTO validation errors
// are localized as the rest are. Unmapped constraints keep Nest's default shape.
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

// Engine-to-backend result posts carry the room's chat transcript (M3), and a long
// game's channel is a few hundred kilobytes: Express's 100 kB default would refuse the
// very report that writes the rows. Two json parsers split the URL space instead of one
// global cap, so the raised limit is the two engine routes' own and an ordinary request
// can never grow.
//
// What a `type` function answers is load-bearing, and it is not a media type: body-parser
// takes a function `type` as its own `shouldParse` test and reads the answer as a boolean,
// so a truthy return parses the body whatever Content-Type it carries. Answering with the
// string 'application/json' therefore parsed every bodied request, multipart included, in
// the 100 kB parser, which refused the avatar upload before multer ever saw the file. Both
// predicates are content-type tests instead: `false` skips a request without touching its
// stream, so the other parser still gets to read it.
const ENGINE_BODY_LIMIT = '2mb';
const DEFAULT_BODY_LIMIT = '100kb';

// What a `type` predicate is handed: the request as it arrives, before routing. `is` is
// Express's content-type test, always there at runtime but absent from Node's own
// IncomingMessage type, which is the shape the option is declared with.
type BodyParserRequest = {
  url?: string;
  is?: (contentType: string) => string | false | null;
};

// `is()` answers the matched media type ('application/json' for `application/json;
// charset=utf-8`), false for another one, and null when the request has no body at all.
const isJsonRequest = (req: BodyParserRequest) => !!req.is?.('application/json');

// The two routes the engine posts a result to. Matched on the URL alone, before
// routing, because a body parser never learns which handler will answer.
export function engineResultRoute(url: string | undefined): boolean {
  if (!url) return false;
  const path = url.split('?')[0];
  return path === '/api/game/end' || /^\/api\/game\/[^/]+\/abandon$/.test(path);
}

// App entry point: builds the NestJS app, sets up trust-proxy, cookies and validation,
// exposes a /health DB check, and starts listening on port 3000.
// Called once at startup from the line below.
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // The raised cap first, for the engine's two result routes only, then the default for
  // everything else. Each predicate names its own half of the URL space and takes JSON
  // only, so a multipart body reaches multer with its stream intact. The order is the rest
  // of the mechanism: a parser that refuses a request leaves the body unread for the next.
  app.useBodyParser('json', {
    limit: ENGINE_BODY_LIMIT,
    type: (req: BodyParserRequest) => engineResultRoute(req.url) && isJsonRequest(req),
  });
  app.useBodyParser('json', {
    limit: DEFAULT_BODY_LIMIT,
    type: (req: BodyParserRequest) => !engineResultRoute(req.url) && isJsonRequest(req),
  });

  // Trust internal hops (localhost/LAN/tunnel) by address, so req.ip is the
  // real client IP for rate limiting and can't be spoofed via X-Forwarded-For.
  app.set('trust proxy', ['loopback', 'linklocal', 'uniquelocal']);

  // JwtStrategy reads the token from req.cookies; without this it's undefined.
  app.use(cookieParser());

  // CSRF: same-host Origin allow-list plus a signed double-submit token in
  // X-CSRF-Token on every mutating /api route. Mounted after cookieParser and
  // before the routes; see common/csrf.ts.
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
