import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { navigate } from '../../router';
import { retroAudio } from '../../utils/audio';
import { RETRO_BTN, RETRO_WINDOW, WINDOW_HEADER, WINDOW_BODY } from '../../styles/tw';
import { HEADER_ACTION_STYLE, hueForHost, ROOM_GRID_COLUMNS, type Room } from './ludoLobbyTypes';
import { RoomCodeForm } from './RoomCodeForm';
import { RoomRow } from './RoomRow';

export function RoomsWindow({
  rooms,
  filteredRooms,
  error,
  roomCodeInputRef,
  roomCodeInput,
  onCodeChange,
  roomCodeFontSize,
  joiningByCode,
  lockedByActiveGame,
  joiningRoomId,
  username,
  onOpenJoinByCode,
  onRejoinRoom,
  onOpenJoinRoom,
  onOpenRules,
}: {
  rooms: Room[] | null;
  filteredRooms: Room[];
  error: string | null;
  roomCodeInputRef: RefObject<HTMLInputElement | null>;
  roomCodeInput: string;
  onCodeChange: (value: string) => void;
  roomCodeFontSize: number;
  joiningByCode: boolean;
  lockedByActiveGame: boolean;
  joiningRoomId: string | null;
  username?: string;
  onOpenJoinByCode: (code: string) => void;
  onRejoinRoom: (room: Room) => void;
  onOpenJoinRoom: (room: Room) => void;
  onOpenRules: () => void;
}) {
  const { t } = useTranslation();
  return (
              <section
                className={RETRO_WINDOW}
                id="roomsWindow"
                style={{ flex: '1 1 0', minHeight: 180 }}
              >
                {/* The header carries the counter on the left, the two reference
                    buttons in the middle and the room-code field on the right.

                    The middle used to be the page's error line: a zero-width span
                    with `flex: 1 1 0` that grew into the row's slack and was centred
                    in it. Two buttons cannot share a slot measured that way — a
                    definite zero width exists to keep text out of the line-breaking
                    maths, and a button is not text — so the message moved to a row
                    of its own directly under this one (34, item 2), and the two
                    buttons took the slack between the counter and the field. It is
                    a move, not a restyle: same type, same colours, and the three
                    locales' longest message now has the whole width instead of the
                    slack it had to ellipsise inside. `role="status"` stays on the
                    always-mounted row, so a failure is still announced as it
                    arrives. */}
                <div
                  className={WINDOW_HEADER}
                  style={{
                    background: '#190a38',
                    borderBottom: '1px solid rgb(var(--accent-cyan-rgb) / 0.3)',
                    padding: '12px 14px',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      minWidth: 0,
                      flex: '0 1 auto',
                    }}
                  >
                    <span
                      style={{
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        flexShrink: 0,
                      }}
                    >
                      {t('ludoLobbyPasses.openQuantumRooms')} ({filteredRooms.length})
                    </span>
                  </div>

                  {/* The arena's own two pages, one press each: the rules the game
                      already ships, and the squads the colours belong to. */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      flex: '1 1 auto',
                      minWidth: 0,
                      flexWrap: 'wrap',
                    }}
                  >
                    <button
                      type="button"
                      className={RETRO_BTN}
                      style={HEADER_ACTION_STYLE}
                      onClick={() => {
                        retroAudio.playUiBeep(600, 0.05);
                        onOpenRules();
                      }}
                    >
                      {t('ludoLobbyPasses.rulesBtn')}
                    </button>
                    <button
                      type="button"
                      className={RETRO_BTN}
                      style={HEADER_ACTION_STYLE}
                      onClick={() => {
                        retroAudio.playUiBeep(640, 0.05);
                        navigate('/squads');
                      }}
                    >
                      {t('ludoLobbyPasses.squadsBtn')}
                    </button>
                  </div>

                  {/* Warp by code: the header's right-hand control. */}
                <RoomCodeForm
                  roomCodeInputRef={roomCodeInputRef}
                  roomCodeInput={roomCodeInput}
                  onCodeChange={onCodeChange}
                  roomCodeFontSize={roomCodeFontSize}
                  joiningByCode={joiningByCode}
                  lockedByActiveGame={lockedByActiveGame}
                  onSubmit={onOpenJoinByCode}
                />
                </div>

                {/* The page's failure line, on its own row under the header: same
                    type and colours it had inside the header, wrapping now instead
                    of ellipsising because the row is the whole width (34, item 2).
                    The row is always mounted so the live region exists before a
                    message does; with nothing to say it collapses to nothing and
                    the header sits exactly where it did. */}
                <div
                  role="status"
                  style={{
                    padding: error ? '6px 14px' : 0,
                    background: error ? '#190a38' : undefined,
                    borderBottom: error ? '1px solid rgb(var(--accent-cyan-rgb) / 0.3)' : undefined,
                  }}
                >
                  {error && (
                    <span
                      title={t('ludoLobbyExtra.errorPrefix', { message: error })}
                      style={{
                        display: 'block',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        letterSpacing: '0.4px',
                        color: 'var(--text-main)',
                        textShadow: '0 0 10px rgb(var(--state-off-rgb) / 0.65)',
                      }}
                    >
                      {t('ludoLobbyExtra.errorPrefix', { message: error })}
                    </span>
                  )}
                </div>

                <div
                  className={WINDOW_BODY}
                  style={{
                    padding: 14,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                    minHeight: 0,
                  }}
                >
                  {/* Room Table: it fills the body, so the list is the box that
                      grows with the window and scrolls on its own. */}
                  <div
                    style={{
                      border: '1px solid rgb(var(--accent-cyan-rgb) / 0.25)',
                      borderRadius: 6,
                      background: 'rgba(5, 2, 18, 0.8)',
                      overflow: 'hidden',
                      display: 'flex',
                      flexDirection: 'column',
                      flex: '1 1 auto',
                      minHeight: 0,
                    }}
                  >
                    {/* Header and rows share one scroll box, so the scrollbar takes
                        the same width from both and the tracks stay aligned. */}
                    <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
                      {/* Header Row */}
                      <div
                        style={{
                          position: 'sticky',
                          top: 0,
                          zIndex: 1,
                          display: 'grid',
                          gridTemplateColumns: ROOM_GRID_COLUMNS,
                          gap: 8,
                          padding: '10px 14px',
                          background: 'rgb(var(--bg-card-rgb) / 0.98)',
                          borderBottom: '1px solid rgb(var(--accent-cyan-rgb) / 0.25)',
                          fontSize: '0.68rem',
                          fontWeight: 'bold',
                          color: 'var(--accent-cyan)',
                          fontFamily: 'var(--font-mono)',
                          textAlign: 'left',
                        }}
                      >
                        <div style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                          {t('ludoLobbyPasses.colSectorCode')}
                        </div>
                        <div style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                          {t('ludoLobbyPasses.colHostCallsign')}
                        </div>
                        <div style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                          {t('ludoLobbyPasses.colCapacity')}
                        </div>
                        <div style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                          {t('ludoLobbyPasses.colStakes')}
                        </div>
                        <div style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                          {t('ludoLobbyPasses.colModes')}
                        </div>
                        <div style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                          {t('ludoLobbyPasses.colAction')}
                        </div>
                      </div>

                      {/* Room Rows */}
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                        }}
                      >
                        {rooms === null ? (
                          <div
                            style={{
                              padding: '28px 0',
                              textAlign: 'center',
                              color: 'var(--accent-yellow)',
                              fontSize: '0.78rem',
                            }}
                          >
                            {t('ludoLobbyExtra.scanningOpenSectors')}
                          </div>
                        ) : filteredRooms.length === 0 ? (
                          <div
                            style={{
                              padding: '28px 0',
                              textAlign: 'center',
                              color: 'var(--text-soft)',
                              fontSize: 'calc(0.78rem + 1pt)',
                            }}
                          >
                            {t('ludoLobbyPasses.noOpenRooms')}
                          </div>
                        ) : (
                          filteredRooms.map((room) => {
                            const isMySeat = room.mySeat ?? room.hostUsername === username;
                            const full = room.seats >= room.maxSeats;
                            const hue = hueForHost(room.host);
                            return (
                              <RoomRow
                                key={room.id}
                                room={room}
                                isMySeat={isMySeat}
                                full={full}
                                hue={hue}
                                joining={joiningRoomId === room.id}
                                lockedByActiveGame={lockedByActiveGame}
                                onRejoin={() => onRejoinRoom(room)}
                                onJoin={() => onOpenJoinRoom(room)}
                              />
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </section>
  );
}
