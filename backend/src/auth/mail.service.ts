import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import Redis from 'ioredis';
import { secret } from '../secrets';
import { PrismaService } from '../prisma.service';
import { emailStrings, fill } from '../i18n/email-messages';

// Reverse pointer to a staged email change; the key carries the user id, so the
// expiry event alone identifies the address to notify.
const USER_KEY_PREFIX = 'emailchange:user:';
// Redis instance 0 is the only database in use, so the channel name is fixed.
const EXPIRED_CHANNEL = '__keyevent@0__:expired';

// Sends transactional email (verification, 2FA, password reset, email change)
// over SMTP, or logs it when SMTP_CREDENTIALS is unset. Also emails the lapsed
// email-change notice; see docs/backend/backend-auth-module.md ("Email delivery").
@Injectable()
export class MailService implements OnModuleInit, OnModuleDestroy {
  // Logger for SMTP and subscription warnings, and for the dev-mode mail lines.
  private readonly logger = new Logger(MailService.name);
  // Built from SMTP_CREDENTIALS; null when unset, so mail is only logged.
  private transporter: nodemailer.Transporter | null = null;
  // "From" address, taken from the SMTP credentials.
  private from = '';
  // Subscriber-mode connection for expiry events. A subscribed client cannot run
  // ordinary commands, so this connection is not used for anything else.
  private readonly redis: Redis;

  constructor(private readonly prisma: PrismaService) {
    const raw = secret('SMTP_CREDENTIALS');
    const parsed = raw?.match(/^\[([^\]]+)\]:(\d+)\s+([^:<\s]+@[^:\s]+):(.+)$/);
    if (parsed) {
      const [, host, port, user, pass] = parsed;
      this.from = user;
      this.transporter = nodemailer.createTransport({
        host,
        port: Number(port),
        secure: false, // 587 = STARTTLS
        auth: { user, pass },
        // Reuse one authenticated socket instead of repeating the TCP, STARTTLS
        // and AUTH handshake for every email (see docs/backend/backend-auth-module.md).
        pool: true,
        maxConnections: 1,
        maxMessages: 100,
        // Fail a slow connect or greeting instead of hanging the send.
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
      });
    } else {
      this.logger.warn(
        'SMTP credentials missing or placeholder : emails will be LOGGED to this console instead of sent.',
      );
    }

    // Host and port are topology, not secrets, so they stay plain env vars.
    const host = process.env.REDIS_HOST ?? 'redis';
    const port = parseInt(process.env.REDIS_PORT ?? '6479', 10);
    const password = secret('REDIS_PASSWORD');
    this.redis = new Redis({ host, port, password, retryStrategy: (t) => Math.min(t * 50, 2000) });
    this.redis.on('error', (error) => {
      console.error('Redis error:', error.message);
    });
    // A lapsed reverse pointer means the staged change was never confirmed.
    this.redis.on('message', (channel, key) => {
      if (channel === EXPIRED_CHANNEL) void this.onExpired(key);
    });
  }

  // Logs in dev, sends via SMTP otherwise. The dev log omits the body, so a
  // verification or reset token never reaches the console.
  private async send(to: string, subject: string, text: string, username?: string): Promise<void> {
    if (!this.transporter) {
      this.logger.log(`📧 [DEV MAIL] user=${username ?? '-'} to=${to} subject="${subject}"`);
      return;
    }
    try {
      await this.transporter.sendMail({ from: this.from, to, subject, text });
    } catch (err) {
      this.logger.error(`sendMail to ${to} failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException({
        code: 'AUTH_EMAIL_SEND_FAILED',
        message: 'Could not send email : try again later',
      });
    }
  }

  sendVerification(to: string, link: string, lang = 'en', username?: string): Promise<void> {
    const s = emailStrings(lang).verification;
    return this.send(to, s.subject, fill(s.text, { link }), username);
  }

  sendPasswordReset(to: string, link: string, lang = 'en', username?: string): Promise<void> {
    const s = emailStrings(lang).passwordReset;
    return this.send(to, s.subject, fill(s.text, { link }), username);
  }

  send2faCode(to: string, code: string, lang = 'en', username?: string): Promise<void> {
    const s = emailStrings(lang).twoFactor;
    return this.send(to, fill(s.subject, { code }), fill(s.text, { code }), username);
  }

  // Verify-then-commit email change: sent to the NEW address; applied only when
  // this link is opened (15 min).
  sendEmailChange(to: string, link: string, lang = 'en', username?: string): Promise<void> {
    const s = emailStrings(lang).emailChange;
    return this.send(to, s.subject, fill(s.text, { link }), username);
  }

  // Heads-up to the CURRENT address that a change was requested.
  sendEmailChangeNotice(
    oldTo: string,
    newEmail: string,
    lang = 'en',
    username?: string,
  ): Promise<void> {
    const s = emailStrings(lang).emailChangeNotice;
    return this.send(oldTo, s.subject, fill(s.text, { newEmail }), username);
  }

  // Sent to the CURRENT address when a pending change expires unconfirmed.
  sendEmailChangeExpired(oldTo: string, lang = 'en', username?: string): Promise<void> {
    const s = emailStrings(lang).emailChangeExpired;
    return this.send(oldTo, s.subject, s.text, username);
  }

  // Best-effort: a mail failure must not crash the process or the listener loop.
  private async onExpired(key: string): Promise<void> {
    if (!key.startsWith(USER_KEY_PREFIX)) return; // only the reverse pointer is handled
    const userId = key.slice(USER_KEY_PREFIX.length);
    try {
      const user = await this.prisma.db.user.findUnique({ where: { id: userId } });
      if (!user) return;
      await this.sendEmailChangeExpired(user.email ?? '', user.language, user.username);
    } catch (error) {
      this.logger.error(`Email-change expiry notice failed: ${(error as Error).message}`);
    }
  }

  async onModuleInit(): Promise<void> {
    try {
      // Warn (never throw) when expiry events are off: the notice depends on them.
      const reply = await this.redis.config('GET', 'notify-keyspace-events');
      const flags = Array.isArray(reply) ? String(reply[1] ?? '') : '';
      if (!flags.includes('x')) {
        this.logger.warn(
          `Redis notify-keyspace-events is "${flags}" (missing "x"): expired email-change notices will NOT be sent. Expected at least "Ex".`,
        );
      }
      await this.redis.subscribe(EXPIRED_CHANNEL);
    } catch (error) {
      this.logger.warn(`Could not subscribe to Redis expiry events: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.unsubscribe(EXPIRED_CHANNEL).catch(() => {});
    await this.redis.quit();
    // Pooled SMTP sockets outlive a send, so close the pool with the module.
    this.transporter?.close();
  }
}
