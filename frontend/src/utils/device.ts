/**
 * Device predicates shared by the game UI. Kept out of the components so a file
 * that exports a component only exports components (fast refresh).
 */

/**
 * The one predicate that decides the whole touch path. It selects the clash
 * input mechanism (circles instead of a keyboard) and arms the portrait gate.
 * The `MacIntel` clause is not optional: iPadOS 13+ reports a desktop macOS user
 * agent, so `/ipad/i` alone misses every modern iPad, which is the target device.
 *
 * Its limits are accepted, not load bearing: a Windows or Linux touchscreen
 * laptop is never classified as mobile and falls back to keys, and a spoofed
 * user agent can lie — server timing is identical for every client, so a
 * misclassified client still plays a fair QTE.
 */
export function isMobileOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent ?? '';
  if (/android|iphone|ipad/i.test(ua)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}
