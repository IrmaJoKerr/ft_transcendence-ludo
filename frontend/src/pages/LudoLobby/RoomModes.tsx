import { useTranslation } from 'react-i18next';
import type { Room } from './ludoLobbyTypes';
import { BASE_MODE_HUE, ROOM_MODES, modeChipStyle } from './ludoLobbyTypes';

export function RoomModes({ room }: { room: Room }) {
  const { t } = useTranslation();
  const active = ROOM_MODES.filter((mode) => room[mode.key]);
  const summary = active.length
    ? active.map((mode) => t(mode.label)).join(' · ')
    : t('ludoLobbyPasses.modeBase');

  // All four mutators would otherwise wrap 3 + 1 in the wide MODES column; a two-column grid
  // lays them out 2 + 2 instead, which reads more symmetric.
  const twoColumns = active.length === 4;

  return (
    <div
      title={summary}
      style={{
        display: twoColumns ? 'grid' : 'flex',
        gridTemplateColumns: twoColumns ? 'repeat(2, max-content)' : undefined,
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 4,
        minWidth: 0,
      }}
    >
      {active.length === 0 ? (
        <span style={modeChipStyle(BASE_MODE_HUE)}>{t('ludoLobbyPasses.modeBase')}</span>
      ) : (
        active.map((mode) => (
          <span key={mode.key} style={modeChipStyle(mode.hue)}>
            <span aria-hidden="true">{mode.icon}</span>
            {t(mode.label)}
          </span>
        ))
      )}
    </div>
  );
}
