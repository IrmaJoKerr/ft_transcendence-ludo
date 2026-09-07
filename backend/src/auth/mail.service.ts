import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { secret } from '../secrets';

// Sends transactional email (verification links, 2FA codes) via SMTP from
// SMTP_CREDENTIALS. Without credentials, mail is logged to the console so
// every flow stays testable in dev.
@Injectable()
export class MailService {
  // Nest logger for connection warnings and dev-mode mail output.
  private readonly logger = new Logger(MailService.name);
  // SMTP transport from SMTP_CREDENTIALS; null in dev → mail is only logged.
  private transporter: nodemailer.Transporter | null = null;
  // "From" address, taken from the SMTP credentials.
  private from = '';

  constructor() {
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
      });
    } else {
      this.logger.warn(
        'SMTP credentials missing or placeholder : emails will be LOGGED to this console instead of sent.',
      );
    }
  }

  private async send(to: string, subject: string, text: string): Promise<void> {
    if (!this.transporter) {
      this.logger.log(`📧 [DEV MAIL] to=${to} subject="${subject}"\n${text}`);
      return;
    }
    try {
      await this.transporter.sendMail({ from: this.from, to, subject, text });
    } catch (err) {
      this.logger.error(`sendMail to ${to} failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException('Could not send email : try again later');
    }
  }

  sendVerification(to: string, link: string): Promise<void> {
    return this.send(
      to,
      'Verify your Retro Ludo account',
      `Welcome to Retro Ludo!\n\nConfirm this email address by opening:\n\n${link}\n\nThe link expires in 24 hours. If you did not sign up, ignore this mail.`,
    );
  }

  sendPasswordReset(to: string, link: string): Promise<void> {
    return this.send(
      to,
      'Reset your Retro Ludo password',
      `We received a request to reset your password.\n\nChoose a new one here:\n\n${link}\n\nThe link expires in 1 hour and can be used once. If you did not request this, ignore this mail : your password stays unchanged.`,
    );
  }

  send2faCode(to: string, code: string): Promise<void> {
    return this.send(
      to,
      `${code} is your Retro Ludo login code`,
      `Your login code is: ${code}\n\nIt expires in 5 minutes. If you did not try to log in, someone knows your password : change it.`,
    );
  }
}
