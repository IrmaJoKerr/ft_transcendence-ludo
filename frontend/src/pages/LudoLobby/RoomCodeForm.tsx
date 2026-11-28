import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { RETRO_BTN } from '../../styles/tw';

export function RoomCodeForm({
  roomCodeInputRef,
  roomCodeInput,
  onCodeChange,
  roomCodeFontSize,
  joiningByCode,
  lockedByActiveGame,
  onSubmit,
}: {
  roomCodeInputRef: RefObject<HTMLInputElement | null>;
  roomCodeInput: string;
  onCodeChange: (value: string) => void;
  roomCodeFontSize: number;
  joiningByCode: boolean;
  lockedByActiveGame: boolean;
  onSubmit: (code: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
      <input
        ref={roomCodeInputRef}
        value={roomCodeInput}
        onChange={(e) => onCodeChange(e.target.value.toUpperCase())}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && roomCodeInput.trim().length > 0 && !joiningByCode) {
            void onSubmit(roomCodeInput);
          }
        }}
        placeholder={t('ludoLobbyPasses.enterCodePlaceholder')}
        maxLength={8}
        aria-label={t('ludoLobbyPasses.accessViaCode')}
        title={t('ludoLobbyPasses.accessViaCodeDesc')}
        style={{
          width: 132,
          height: 32,
          boxSizing: 'border-box',
          background: 'rgba(5, 2, 18, 0.92)',
          border: '1.5px solid var(--accent-cyan)',
          borderRadius: 6,
          color: 'var(--accent-yellow)',
          padding: '0 10px',
          fontSize: roomCodeFontSize,
          fontWeight: 'bold',
          fontFamily: 'var(--font-mono)',
          letterSpacing: '1.5px',
          textAlign: 'center',
          boxShadow: 'inset 0 0 10px rgb(var(--accent-cyan-rgb) / 0.25)',
        }}
      />
      <button
        type="button"
        className={RETRO_BTN}
        onClick={() => onSubmit(roomCodeInput)}
        disabled={!roomCodeInput.trim() || joiningByCode || lockedByActiveGame}
        title={lockedByActiveGame ? t('lobbyBrowser.activeGameLockTooltip') : undefined}
        style={{
          height: 32,
          padding: '0 14px',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.72rem',
          background: 'rgb(var(--accent-cyan-rgb) / 0.22)',
          borderColor: 'var(--accent-cyan)',
          color: 'var(--accent-cyan)',
          opacity: !roomCodeInput.trim() || joiningByCode || lockedByActiveGame ? 0.5 : 1,
          cursor:
            !roomCodeInput.trim() || joiningByCode || lockedByActiveGame
              ? 'not-allowed'
              : 'pointer',
          boxShadow: '0 0 16px rgb(var(--accent-cyan-rgb) / 0.4)',
          flexShrink: 0,
          whiteSpace: 'nowrap',
        }}
      >
        {joiningByCode
          ? `▶ ${t('ludoLobbyPasses.warping')}`
          : `▶ ${t('ludoLobbyPasses.accessRoom')}`}
      </button>
    </div>
  );
}
