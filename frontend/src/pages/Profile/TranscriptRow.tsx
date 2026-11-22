import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { systemLineText } from '../../components/chatCardTypes';
import { retroAudio } from '../../utils/audio';
import { RETRO_BTN } from '../../styles/tw';
import type { TranscriptLine } from './profileTypes';

export function TranscriptRow({
  chat,
  chatTruncated,
  gameType,
  ownerId,
}: {
  chat?: TranscriptLine[] | null;
  chatTruncated: boolean;
  gameType: 'PVP' | 'PVE';
    // The row's own account: its lines are the ones painted in the channel's colour.
  ownerId: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const lines = Array.isArray(chat) ? chat : [];
  const hasTranscript = gameType === 'PVP' && lines.length > 0;

  return (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {hasTranscript ? (
          <button
            type="button"
            className={RETRO_BTN}
            aria-expanded={open}
            onClick={() => {
              retroAudio.playUiBeep(open ? 520 : 700, 0.05);
              setOpen((previous) => !previous);
            }}
            style={{ fontSize: '0.66rem', padding: '3px 10px' }}
          >
            {open
              ? t('profile.transcriptHide')
              : t('profile.transcriptShow', { count: lines.length })}
          </button>
        ) : (
          <span
            style={{
              fontSize: '0.66rem',
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.04em',
              color: 'var(--text-muted)',
            }}
          >
            {t('profile.transcriptLabel')} {t('profile.transcriptNa')}
          </span>
        )}
        {chatTruncated && (
          <span
            style={{
              fontSize: '0.62rem',
              fontFamily: 'var(--font-mono)',
              color: 'var(--accent-yellow)',
            }}
          >
            {t('profile.transcriptTruncated')}
          </span>
        )}
      </div>
      {open && hasTranscript && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            padding: 10,
            maxHeight: 220,
            overflowY: 'auto',
            borderRadius: 6,
            background: 'rgb(var(--shade-rgb) / 0.45)',
            border: '1px solid rgb(var(--accent-cyan-rgb) / 0.16)',
          }}
        >
          {lines.map((line) => (
            <span
              key={line.id}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.66rem',
                lineHeight: 1.45,
                color:
                  line.kind === 'system'
                    ? 'var(--text-muted)'
                    : line.senderId === ownerId
                      ? 'var(--accent-cyan)'
                      : 'var(--text-main)',
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                textAlign: line.kind === 'system' ? 'center' : 'left',
              }}
            >
              {line.kind === 'system'
                ? systemLineText(t, line)
                : `${line.senderName} > ${line.text}`}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
