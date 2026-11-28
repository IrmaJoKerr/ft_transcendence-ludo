import { useTranslation } from 'react-i18next';
import {
  RETRO_WINDOW,
  WINDOW_HEADER,
  WINDOW_CONTROLS,
  WINDOW_BTN_MIN,
  WINDOW_BTN_MAX,
  WINDOW_BODY,
} from '../../styles/tw';
import type { Seat } from '../../store';
import { SeatCard } from './SeatCard';

export function SeatRoster({
  visible,
  playerCount,
  emptyCount,
  editingSeat,
  editName,
  guest,
  botRoom,
  hostSeated,
  onRemoveSeat,
  onRenameSeat,
  onEditingSeat,
  onEditName,
  onPickColor,
}: {
  visible: Seat[];
  playerCount: number;
  emptyCount: number;
  editingSeat: number | null;
  editName: string;
  guest: boolean;
  botRoom: boolean;
  hostSeated: boolean;
  onRemoveSeat: (index: number) => void;
  onRenameSeat: (index: number, name: string) => void;
  onEditingSeat: (index: number | null) => void;
  onEditName: (name: string) => void;
  onPickColor: (index: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className={RETRO_WINDOW} style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div className={WINDOW_HEADER} style={{ fontSize: '0.84rem' }}>
        <span>
          {t('lobby.seatRosterTitle', {
            assigned: playerCount - emptyCount,
            total: playerCount,
          })}
        </span>
        <div className={WINDOW_CONTROLS}>
          <span className={WINDOW_BTN_MIN} />
          <span className={WINDOW_BTN_MAX} />
        </div>
      </div>

      <div
        className={WINDOW_BODY}
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          padding: 14,
          flex: 1,
        }}
      >
        {visible.map((seat, i) => (
          <SeatCard
            key={i}
            seat={seat}
            index={i}
            editing={editingSeat === i}
            editName={editName}
            guest={guest}
            botRoom={botRoom}
            hostSeated={hostSeated}
            onRemove={() => onRemoveSeat(i)}
            onRename={(name) => onRenameSeat(i, name)}
            onEditingSeat={onEditingSeat}
            onEditName={onEditName}
            onPickColor={() => onPickColor(i)}
          />
        ))}
      </div>
    </section>
  );
}
