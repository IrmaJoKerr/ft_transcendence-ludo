import type { Notification, ToastDismissReason } from '../../hooks/useNotifications';
import { Toast } from './Toast';

// **Toast Container**

export function NotificationToasts({
  toasts,
  onDismiss,
}: {
  toasts: Notification[];
  onDismiss: (id: string, reason: ToastDismissReason) => void;
}) {
  // Show at most 3 toasts at once: oldest ones get pushed off.
  const visible = toasts.slice(0, 3);

  return (
    <>
      {visible.map((n, i) => (
        <Toast key={n.id} notification={n} onDismiss={onDismiss} index={i} />
      ))}
    </>
  );
}
