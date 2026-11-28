import { useTranslation } from 'react-i18next';
import {
  RETRO_WINDOW,
  WINDOW_HEADER,
  WINDOW_CONTROLS,
  WINDOW_BTN_MIN,
  WINDOW_BTN_MAX,
  WINDOW_BODY,
  RETRO_BTN,
} from '../../styles/tw';
import type { Seat } from '../../store';
import { RoomRulesPanel } from './RoomRulesPanel';

export function LobbySummary({
  playerCount,
  emptyCount,
  botRoom,
  visible,
  isLocal,
  canLaunch,
  canStart,
  lockedByActiveGame,
  hostSeated,
  starting,
  startError,
  onStart,
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
  playerCount: number;
  emptyCount: number;
  botRoom: boolean;
  visible: Seat[];
  isLocal: boolean;
  canLaunch: boolean;
  canStart: boolean;
  lockedByActiveGame: boolean;
  hostSeated: boolean;
  starting: boolean;
  startError: string | null;
  onStart: () => void;
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
              <section
                className={RETRO_WINDOW}
                style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
              >
                <div className={WINDOW_HEADER} style={{ fontSize: '0.84rem' }}>
                  <span>{t('lobby.arenaLaunchControlTitle')}</span>
                  <div className={WINDOW_CONTROLS}>
                    <span className={WINDOW_BTN_MIN} />
                    <span className={WINDOW_BTN_MAX} />
                  </div>
                </div>

                <div
                  className={WINDOW_BODY}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 22,
                    padding: '28px 24px',
                    flex: 1,
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '0.9rem',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      <span className="text-(--text-muted)">
                        {t('lobby.activePilotsLabel')}
                      </span>
                      <span style={{ color: 'var(--text-main)', fontWeight: 'bold' }}>
                        {playerCount - emptyCount} / {playerCount}
                      </span>
                    </div>

                    {/* Only where a bot can actually be seated: hotseat (`bots=0`)
                        fills its seats with local pilots, so a bot tally there
                        would read a permanent `0 UNITS`. */}
                    {botRoom && (
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: '0.9rem',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        <span className="text-(--text-muted)">
                          {t('lobby.botUnitsLabel')}
                        </span>
                        <span style={{ color: 'var(--state-on)', fontWeight: 'bold' }}>
                          {t('lobby.unitsCount', {
                            count: visible.filter((s) => s.type === 'bot').length,
                            plural: visible.filter((s) => s.type === 'bot').length === 1 ? '' : 'S',
                          })}
                        </span>
                      </div>
                    )}

                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '0.9rem',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      <span className="text-(--text-muted)">
                        {t('lobby.arenaModeLabel')}
                      </span>
                      <span style={{ color: 'var(--accent-yellow)', fontWeight: 'bold' }}>
                        {isLocal ? t('lobby.localHotseat') : t('lobby.pveArena')}
                      </span>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '0.9rem',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      <span className="text-(--text-muted)">
                        {t('lobby.sectorMatrixLabel')}
                      </span>
                      <span style={{ color: 'var(--accent-cyan)', fontWeight: 'bold' }}>
                        {t('lobby.combatCross')}
                      </span>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '0.9rem',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      <span className="text-(--text-muted)">
                        {t('lobby.winConditionLabel')}
                      </span>
                      <span style={{ color: 'var(--state-on)', fontWeight: 'bold' }}>
                        {t('lobby.fourPiecesInGoal')}
                      </span>
                    </div>

                    <RoomRulesPanel
                      clashEnabled={clashEnabled}
                      onClash={onClash}
                      clashShiftCount={clashShiftCount}
                      onClashShiftCount={onClashShiftCount}
                      clashKeyShift={clashKeyShift}
                      onClashKeyShift={onClashKeyShift}
                      freeExit={freeExit}
                      onFreeExit={onFreeExit}
                      noSafeZones={noSafeZones}
                      onNoSafeZones={onNoSafeZones}
                      captureFx={captureFx}
                      onCaptureFx={onCaptureFx}
                    />
                    {/* Status Info Box */}
                    <div
                      style={{
                        padding: '16px 18px',
                        background: 'rgb(var(--shade-rgb) / 0.5)',
                        border: '1px solid rgb(var(--accent-cyan-rgb) / 0.3)',
                        borderRadius: 4,
                        textAlign: 'center',
                        // All four messages share one size: the panel's 0.62 rem retro mono sub-line, not a size
                        // per state that would move the launch button when the text changes.
                        fontSize: '0.62rem',
                        fontFamily: 'var(--font-mono)',
                        color: canLaunch ? 'var(--state-on)' : 'var(--accent-yellow)',
                        marginTop: 12,
                        lineHeight: 1.5,
                      }}
                    >
                      {lockedByActiveGame
                        ? t('lobby.activeGameLockError')
                        : !hostSeated
                          ? t('lobby.pickColorTitle')
                          : canStart
                            ? t('lobby.allSystemsPassed')
                            : t('lobby.assignAtLeastOne')}
                    </div>
                  </div>

                  <div>
                    {/* LAUNCH BUTTON. The label is centred in the full-width frame: the
                        shared `RETRO_BTN` is an `inline-flex` row with no `justify`, so a
                        short line like `// ADD BOT TO START //` sat against its left edge
                        while the frame ran on to the panel's right one. */}
                    <button
                      onClick={() => {
                        void onStart();
                      }}
                      disabled={!canLaunch || starting}
                      className={`${RETRO_BTN} justify-center`}
                      title={lockedByActiveGame ? t('lobby.activeGameLockTooltip') : undefined}
                      style={{
                        width: '100%',
                        padding: '16px 0',
                        fontSize: '1rem',
                        fontFamily: 'var(--font-heading)',
                        letterSpacing: '1.2px',
                        background: canLaunch
                          ? 'rgb(var(--state-on-rgb) / 0.2)'
                          : 'rgb(var(--ink-rgb) / 0.05)',
                        border: canLaunch
                          ? '1px solid var(--state-on)'
                          : '1px solid rgb(var(--ink-rgb) / 0.2)',
                        color: canLaunch ? 'var(--state-on)' : 'var(--text-muted)',
                        cursor: canLaunch ? 'pointer' : 'not-allowed',
                        boxShadow: canLaunch ? '0 0 15px rgb(var(--state-on-rgb) / 0.4)' : 'none',
                      }}
                    >
                      {lockedByActiveGame
                        ? t('lobby.activeGameLockLabel')
                        : starting
                          ? t('lobby.initializingArena')
                          : canStart
                            ? t('lobby.launchArenaMatch')
                            : !hostSeated
                              ? t('lobby.pickColorTitle')
                              : botRoom
                                ? t('lobby.addBotToStart')
                                : t('lobby.addPlayerToStart')}
                    </button>

                    {startError && (
                      <div
                        style={{
                          textAlign: 'center',
                          color: 'var(--state-off)',
                          fontSize: '0.72rem',
                          fontFamily: 'var(--font-mono)',
                          marginTop: 8,
                        }}
                      >
                        {startError}
                      </div>
                    )}
                  </div>
                </div>
              </section>
  );
}
