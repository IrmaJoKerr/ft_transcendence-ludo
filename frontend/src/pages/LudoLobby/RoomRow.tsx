import { useTranslation } from 'react-i18next';
import { UserAvatar } from '../../components/UserAvatar';
import { RETRO_BTN } from '../../styles/tw';
import { badgeStyle, ROOM_GRID_COLUMNS, type Room } from './ludoLobbyTypes';
import { RoomModes } from './RoomModes';

export function RoomRow({
  room,
  isMySeat,
  full,
  hue,
  joining,
  lockedByActiveGame,
  onRejoin,
  onJoin,
}: {
  room: Room;
  isMySeat: boolean;
  full: boolean;
  hue: string;
  joining: boolean;
  lockedByActiveGame: boolean;
  onRejoin: () => void;
  onJoin: () => void;
}) {
  const { t } = useTranslation();
  return (
                              <div
                                key={room.id}
                                style={{
                                  display: 'grid',
                                  gridTemplateColumns: ROOM_GRID_COLUMNS,
                                  gap: 8,
                                  padding: '12px 14px',
                                  borderBottom: '1px solid rgb(var(--ink-rgb) / 0.07)',
                                  alignItems: 'center',
                                  textAlign: 'left',
                                  background: isMySeat ? 'rgb(var(--accent-pink-rgb) / 0.12)' : 'transparent',
                                }}
                              >
                                <div
                                  style={{
                                    fontWeight: 'bold',
                                    fontSize: '0.82rem',
                                    color: 'var(--accent-yellow)',
                                    fontFamily: 'var(--font-mono)',
                                    letterSpacing: '0.5px',
                                  }}
                                >
                                  {room.roomCode}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                  <UserAvatar
                                    username={room.hostUsername ?? room.host}
                                    userId={room.hostId}
                                    hasAvatarPhoto={room.hasAvatarPhoto}
                                    size={28}
                                    fallbackStyle={{
                                      width: 28,
                                      height: 28,
                                      flex: 'none',
                                      borderRadius: 4,
                                      display: 'grid',
                                      placeItems: 'center',
                                      fontWeight: 'bold',
                                      fontSize: '0.7rem',
                                      color: 'rgb(var(--bg-primary-rgb))',
                                      background: hue,
                                    }}
                                    style={{ borderRadius: 4, border: `1px solid ${hue}` }}
                                  />
                                  <div style={{ minWidth: 0 }}>
                                    <div
                                      style={{
                                        fontWeight: 'bold',
                                        fontSize: '0.82rem',
                                        color: 'var(--text-main)',
                                        fontFamily: 'var(--font-mono)',
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                      }}
                                    >
                                      {room.host}
                                    </div>
                                    <div style={{ color: 'var(--text-soft)', fontSize: '0.65rem' }}>
                                      {room.maxSeats}P • {room.mode}
                                    </div>
                                  </div>
                                </div>
                                <div
                                  style={{
                                    fontWeight: 'bold',
                                    fontSize: '0.82rem',
                                    color: full ? 'var(--state-off)' : 'var(--state-on)',
                                    fontFamily: 'var(--font-mono)',
                                  }}
                                >
                                  {room.seats}/{room.maxSeats}
                                </div>
                                <div>
                                  <span style={badgeStyle('ranked')}>
                                    {t('lobbyBrowser.ranked')}
                                  </span>
                                </div>
                                <div style={{ minWidth: 0 }}>
                                  <RoomModes room={room} />
                                </div>
                                <div>
                                  <button
                                    className={RETRO_BTN}
                                    onClick={() => {
                                      if (isMySeat) onRejoin();
                                      else onJoin();
                                    }}
                                    disabled={
                                      (!isMySeat && (full || lockedByActiveGame)) ||
                                      joining
                                    }
                                    title={
                                      !isMySeat && lockedByActiveGame
                                        ? t('lobbyBrowser.activeGameLockTooltip')
                                        : undefined
                                    }
                                    style={{
                                      padding: '5px 12px',
                                      fontSize: '0.7rem',
                                      background: isMySeat ? 'var(--accent-pink)' : undefined,
                                      opacity:
                                        (!isMySeat && (full || lockedByActiveGame)) ||
                                        joining
                                          ? 0.4
                                          : 1,
                                      cursor:
                                        !isMySeat && (full || lockedByActiveGame)
                                          ? 'not-allowed'
                                          : 'pointer',
                                    }}
                                  >
                                    {isMySeat
                                      ? joining
                                        ? '...'
                                        : t('lobbyBrowser.rejoinBtn')
                                      : full
                                        ? t('lobbyBrowser.fullBtn')
                                        : joining
                                          ? '...'
                                          : t('lobbyBrowser.joinBtn')}
                                  </button>
                                </div>
                              </div>
  );
}
