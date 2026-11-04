import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { CyberModal } from './CyberModal';

// One confirm for every destructive press in the app, so a gate is never wired
// twice: the lobby's name card, the friends page's BLOCK and its REMOVE all render
// this. It is portaled to `document.body` on its own layer because the surfaces it
// is opened from stack: the name card sits at z-10005 and the transcript card at
// 10004, while `CyberModal`'s overlay is z-10002. Lifting the wrapper lifts the
// whole overlay; the wrapper is `pointer-events-none` because only the overlay
// takes presses, and it takes them itself once open.
const CONFIRM_LAYER_Z = 10006;

export function ConfirmActionModal({
  isOpen,
  title,
  message,
  subMessage,
  proceedLabel,
  cancelLabel,
  isDanger = true,
  onProceed,
  onCancel,
}: {
  isOpen: boolean;
  /** The question, in the panel's own header voice ("SEVER LINK?"). */
  title: string;
  /** What is about to happen, naming the other side. */
  message: ReactNode;
  /** The consequence, in a sentence: what cannot be undone and where it lives. */
  subMessage?: string;
  proceedLabel: string;
  cancelLabel: string;
  /** Pink/danger affordance by default: every caller so far is irreversible. */
  isDanger?: boolean;
  onProceed: () => void;
  onCancel: () => void;
}) {
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: CONFIRM_LAYER_Z, pointerEvents: 'none' }}>
      <CyberModal
        isOpen={isOpen}
        title={title}
        message={message}
        subMessage={subMessage}
        cancelLabel={cancelLabel}
        proceedLabel={proceedLabel}
        cancelShortcut="ESC"
        proceedShortcut="↵"
        isDanger={isDanger}
        onCancel={onCancel}
        onProceed={onProceed}
      />
    </div>,
    document.body,
  );
}
