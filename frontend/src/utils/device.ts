/** Device predicates shared by the game UI, kept out of the component files. */

// The one predicate that decides the touch path: circles instead of a keyboard plus
// the portrait gate. `MacIntel` is required because iPadOS 13+ reports a desktop
// agent; a misclassified client still plays a fair QTE.
export function isMobileOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/android|iphone|ipad/i.test(ua)) return true;
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}
