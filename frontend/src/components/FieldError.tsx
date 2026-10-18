import type { CSSProperties } from 'react';

// The reserved height lives in `.field-error` (retrowave.css): two lines fit the
// longest localized message at desktop widths, and the rule grows the slot as the
// card narrows, so a submit never shifts the form.
const SLOT: CSSProperties = {
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

/** Reserved error slot under a field; empty when valid, announced on submit. */
export function FieldError({ id, message }: { id?: string; message: string | null }) {
  return (
    <div id={id} className="field-error" role="alert" style={SLOT}>
      {message}
    </div>
  );
}
