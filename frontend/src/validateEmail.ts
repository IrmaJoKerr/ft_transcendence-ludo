// Client-side mirror of the backend's `@IsEmail()` gate. Deliberately loose: it
// rejects only obviously malformed values (no `@`, embedded spaces), so it never
// blocks an address the server accepts. The backend stays authoritative.
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}
