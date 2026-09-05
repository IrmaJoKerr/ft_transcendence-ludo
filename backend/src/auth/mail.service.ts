import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { secret } from '../secrets';

/**
 * Sends transactional email (verification links, 2FA codes) via the Mailgun
 * HTTP API (https://documentation.mailgun.com). Runs over HTTPS (443), so it
 * works on Render's free tier where outbound SMTP ports 25/465/587 are blocked.
 *
 * Configured via env vars:
 *   MAILGUN_API_KEY = <API key>
 *   MAILGUN_DOMAIN  = <domain>, e.g. sandbox6fee7b6d1b1a44128c95992ef6037595.mailgun.org
 *   MAILGUN_FROM    = <sender>, e.g. Mailgun Sandbox <postmaster@<domain>>
 *   MAILGUN_BASE_URL= (optional, default https://api.mailgun.net; EU = https://api.eu.mailgun.net)
 *
 * When Mailgun is not configured, the service degrades to logging the mail
 * body to the console - every flow stays testable in dev by reading
 * `docker compose logs backend`.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  // Mailgun HTTP API config (null = not configured).
  private mailgun: { baseUrl: string; domain: string; from: string; apiKey: string } | null = null;

  constructor() {
    const apiKey = secret('MAILGUN_API_KEY');
    const domain = secret('MAILGUN_DOMAIN');
    const from = secret('MAILGUN_FROM');
    if (apiKey && domain && from) {
      this.mailgun = {
        baseUrl: (secret('MAILGUN_BASE_URL') ?? 'https://api.mailgun.net').replace(/\/$/, ''),
        domain,
        from,
        apiKey,
      };
    } else {
      this.logger.warn(
        'Mailgun not configured (MAILGUN_API_KEY/DOMAIN/FROM) - emails will be LOGGED to this console instead of sent.',
      );
    }
  }

  private async send(to: string, subject: string, text: string): Promise<void> {
    if (!this.mailgun) {
      this.logger.log(`📧 [DEV MAIL] to=${to} subject="${subject}"\n${text}`);
      return;
    }
    const { baseUrl, domain, from, apiKey } = this.mailgun;
    const body = new URLSearchParams({ from, to, subject, text });
    try {
      const res = await fetch(`${baseUrl}/v3/${domain}/messages`, {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`api:${apiKey}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        this.logger.error(`Mailgun send to ${to} failed: HTTP ${res.status} ${detail}`);
        throw new ServiceUnavailableException('Could not send email - try again later');
      }
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      this.logger.error(`Mailgun send to ${to} failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException('Could not send email - try again later');
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
      `We received a request to reset your password.\n\nChoose a new one here:\n\n${link}\n\nThe link expires in 1 hour and can be used once. If you did not request this, ignore this mail - your password stays unchanged.`,
    );
  }

  send2faCode(to: string, code: string): Promise<void> {
    return this.send(
      to,
      `${code} is your Retro Ludo login code`,
      `Your login code is: ${code}\n\nIt expires in 5 minutes. If you did not try to log in, someone knows your password - change it.`,
    );
  }
}
