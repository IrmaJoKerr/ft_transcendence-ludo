// Client-side mirror of the backend password policy (backend
// dto/password.rules.ts). It only answers whether the policy is met: the
// message belongs to the caller, so every surface can show it localized.
const PASSWORD_MIN = 12;
const PASSWORD_MAX = 72;
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/;

export function passwordMeetsPolicy(pw: string): boolean {
  return pw.length >= PASSWORD_MIN && pw.length <= PASSWORD_MAX && PASSWORD_REGEX.test(pw);
}
