import { useTranslation } from 'react-i18next';
import { RoomRuleToggle } from '../../components/RoomRuleToggle';
import { retroAudio } from '../../utils/audio';
import { INLINE_CHIP } from '../../styles/tw';

export function RoomRulesPanel({
  clashEnabled,
  onClash,
  clashShiftCount,
  onClashShiftCount,
  clashKeyShift,
  onClashKeyShift,
  freeExit,
  onFreeExit,
  noSafeZones,
  onNoSafeZones,
  captureFx,
  onCaptureFx,
}: {
  clashEnabled: boolean;
  onClash: (value: boolean) => void;
  clashShiftCount: 1 | 2;
  onClashShiftCount: (value: 1 | 2) => void;
  clashKeyShift: 0 | 1 | 2;
  onClashKeyShift: (value: 0 | 1 | 2) => void;
  freeExit: boolean;
  onFreeExit: (value: boolean) => void;
  noSafeZones: boolean;
  onNoSafeZones: (value: boolean) => void;
  captureFx: boolean;
  onCaptureFx: (value: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        borderTop: '1px solid rgb(var(--accent-cyan-rgb) / 0.25)',
        paddingTop: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <span
        style={{
          fontSize: '0.72rem',
          color: 'var(--accent-cyan)',
          fontFamily: 'var(--font-mono)',
        }}
      >
        {t('game.rulesControl')}
      </span>
      <RoomRuleToggle
        icon="⚔️"
        label={t('game.clashMode')}
        desc={t('game.clashModeDesc')}
        checked={clashEnabled}
        accent="var(--accent-pink)"
        onToggle={onClash}
      />
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          fontSize: '0.78rem',
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-main)',
          cursor: clashEnabled ? 'pointer' : 'not-allowed',
          opacity: clashEnabled ? 1 : 0.55,
          border: '1px solid var(--border-color)',
          borderRadius: 4,
          padding: '7px 10px',
          background: 'rgb(var(--shade-rgb) / 0.4)',
        }}
      >
        <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
          <span>🔀 {t('game.clashKeyShift')}</span>
          <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>
            {t('game.clashKeyShiftDesc')}
          </span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <select
            aria-label={t('game.clashKeyShiftCount')}
            value={clashShiftCount}
            disabled={!clashEnabled}
            onChange={(e) => {
              const next = e.target.value === '2' ? 2 : 1;
              onClashShiftCount(next);
              retroAudio.playUiBeep(520, 0.05);
              if (clashKeyShift > 0) onClashKeyShift(next);
            }}
            className={INLINE_CHIP}
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
          </select>
          <input
            type="checkbox"
            checked={clashEnabled && clashKeyShift > 0}
            disabled={!clashEnabled}
            onChange={(e) => {
              retroAudio.playUiBeep(e.target.checked ? 520 : 320, 0.05);
              onClashKeyShift(e.target.checked ? clashShiftCount : 0);
            }}
            style={{
              accentColor: 'var(--accent-pink)',
              width: 15,
              height: 15,
              cursor: clashEnabled ? 'pointer' : 'not-allowed',
            }}
          />
        </span>
      </label>
      <RoomRuleToggle
        icon="🚪"
        label={t('game.freeExit')}
        desc={t('game.freeExitDesc')}
        checked={freeExit}
        accent="var(--accent-yellow)"
        onToggle={onFreeExit}
      />
      <RoomRuleToggle
        icon="💀"
        label={t('game.noSafeZones')}
        desc={t('game.noSafeZonesDesc')}
        checked={noSafeZones}
        accent="var(--accent-cyan)"
        onToggle={onNoSafeZones}
      />
      <RoomRuleToggle
        icon="💥"
        label={t('game.captureFx')}
        desc={t('game.captureFxDesc')}
        checked={captureFx}
        accent="var(--state-on)"
        onToggle={onCaptureFx}
      />
    </div>
  );
}
