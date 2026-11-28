import { randomInt } from 'node:crypto';
import { requireSecret } from '../secrets';

// Values every auth service reads the same way. Kept here rather than in a service
// so a split (registration, session, profile, OAuth) never has to import one of the
// others just to normalize an address or format a timestamp.

export const SALT_ROUNDS = 10;

// Also where the SPA lives; /api on the same origin reaches the backend
// through whichever proxy (nginx or Vite) is serving it. Required by the
// make env preflight, so no hardcoded fallback here.
export const BASE_URL = requireSecret('FRONTEND_URL');

// store all email as lowercase since email is case-insensitive
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

// convert at read/display time
export const formatVerifiedAt = (date: Date) =>
  new Intl.DateTimeFormat('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);

// Random 4-digit suffix (1000–9999) appended to every new username.
export function randomSuffix(): string {
  return randomInt(1000, 10_000).toString();
}

// The canonical user object every auth response returns (login, 2FA verify,
// refresh, /me, PATCH profile). The SPA stores it wholesale, so a partial shape
// reads there as "missing"/"off": an absent email faked an email change.
export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  emailVerified: boolean;
  pendingEmail: string | null;
  hasPassword: boolean;
  twoFactorEnabled: boolean;
  avatarStyle: string;
  hasAvatarPhoto: boolean;
  providers: string[];
}

// The User columns publicUser() reads. Structural, so a full Prisma row from
// findUnique/update satisfies it without the generated model type.
export type UserRow = {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  emailVerified: Date | null;
  password_hash: string | null;
  twoFactorEnabled: boolean;
  avatarStyle: string;
  avatarPhotoContentType: string | null;
};
