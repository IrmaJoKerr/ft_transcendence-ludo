import { useTranslation } from 'react-i18next';
import { translateErrorCode } from '../../api';
import { CHAT_MAX_CHARS } from '../../__shared__/chat.constants';
import type { ChatCardStatus } from '../chatCardTypes';

// Every line the band can show, in one list, so its height is reserved for the longest of
// them in every language. The four friend refusals arrive as server codes rather than chat
// strings and are part of the same reservation.
const STATUS_KEYS = [
  'error.CHAT_EMPTY',
  'error.CHAT_TOO_LONG',
  'error.CHAT_COOLDOWN',
  'error.CHAT_UNAVAILABLE',
  'status.friendSent',
  'status.friendAdded',
  'status.challengeSent',
  'status.blocked',
] as const;

const FRIEND_ERROR_CODES = [
  'FRIEND_REQUEST_PENDING',
  'FRIEND_REQUEST_COOLDOWN',
  'FRIEND_ALREADY',
  'RATE_LIMITED',
] as const;

const NAME_SAMPLE = 'W'.repeat(24);

// The reserved line under the composer: one cell, as tall as the longest string it can show.
export function ChatStatusBand({ status }: { status: ChatCardStatus | null }) {
  const { t } = useTranslation();

  // The sizing rows. The chat strings are keyed; a friend refusal is a localized
  // error code, so those four are resolved through the same helper the API uses.
  const sized = [
    ...STATUS_KEYS.map((key) => ({
      key,
      text: t(`chat.${key}`, { max: CHAT_MAX_CHARS, name: NAME_SAMPLE }),
    })),
    ...FRIEND_ERROR_CODES.map((code) => ({
      key: code,
      text: translateErrorCode(code) ?? t('chat.error.CHAT_UNAVAILABLE', { max: CHAT_MAX_CHARS }),
    })),
  ];

  return (
    <div
      style={{
        display: 'grid',
        alignItems: 'center',
        gap: 6,
        flexShrink: 0,
        minHeight: 14,
        fontFamily: 'var(--font-mono)',
        fontSize: '0.6rem',
        letterSpacing: '0.5px',
        lineHeight: 1.35,
        color: status?.tone === 'error' ? 'var(--text-main)' : 'var(--accent-cyan)',
        textShadow:
          status?.tone === 'error'
            ? '0 0 8px rgba(255, 82, 120, 0.55)'
            : '0 0 8px rgb(var(--accent-cyan-rgb) / 0.45)',
      }}
    >
      <div role="status" style={{ display: 'grid', minWidth: 0 }}>
        {sized.map((row) => (
          <span key={row.key} aria-hidden style={{ gridArea: '1 / 1', visibility: 'hidden' }}>
            {row.text}
          </span>
        ))}
        {status && (
          <span key="live" title={status.text} style={{ gridArea: '1 / 1', overflow: 'hidden' }}>
            {status.text}
          </span>
        )}
      </div>
    </div>
  );
}
