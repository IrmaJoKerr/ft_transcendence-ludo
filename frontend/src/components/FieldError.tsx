import type { CSSProperties } from 'react';

// Two lines at this size is the longest the localized password message needs
// in the edit-profile panel; the slot keeps that space whether or not an error
// is showing, so appearing/clearing never shifts the form.
const SLOT: CSSProperties = {
  minHeight: 'calc(2 * 1.45em + 4px)',
  // Breathing room above and below the sentence: it sits between inputs, and
  // without it the text looks wedged against them.
  padding: '2px 0',
  margin: '0 0 8px',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.68rem',
  lineHeight: 1.45,
  color: '#ff4081',
  overflowWrap: 'anywhere',
};

/**
 * Reserved error slot directly under a field. Renders empty when the field is
 * valid; `role="alert"` announces the message when a submit fills it.
 */
export function FieldError({ message }: { message: string | null }) {
  return (
    <div role="alert" style={SLOT}>
      {message}
    </div>
  );
}
