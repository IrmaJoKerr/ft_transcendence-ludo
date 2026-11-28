import { useTranslation } from 'react-i18next';
import { UserAvatar } from '../../components/UserAvatar';
import { useApp } from '../../store';
import { COLOR_KEYS, type ColorKey } from '../../theme';
import { retroAudio } from '../../utils/audio';
import { localizedPilotName } from '../../utils/botName';
import { HEADING_ELLIPSIS } from '../../styles/tw';
import { EMPTY_CARD_HUE, REMOVE_SEAT_BTN, SEAT_HUES } from './lobbyStyles';
import type { Seat } from '../../store';

export function SeatCard({
  seat,
  index,
  editing,
  editName,
  guest,
  botRoom,
  hostSeated,
  onRemove,
  onRename,
  onEditingSeat,
  onEditName,
  onPickColor,
}: {
  seat: Seat;
  index: number;
  editing: boolean;
  editName: string;
  guest: boolean;
  botRoom: boolean;
  hostSeated: boolean;
  onRemove: () => void;
  onRename: (name: string) => void;
  onEditingSeat: (index: number | null) => void;
  onEditName: (name: string) => void;
  onPickColor: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useApp();
  const ck: ColorKey | null = seat.type === 'empty' ? null : seat.color;
  const hue = ck ? SEAT_HUES[ck] : EMPTY_CARD_HUE;
  const colorName = ck ? t(COLOR_KEYS[ck]).toUpperCase() : t('lobby.freeSeat');
  return (
    <div
      style={{
        position: 'relative',
        borderRadius: 6,
        background: 'rgb(var(--bg-panel-rgb) / 0.85)',
        border: ck ? `1.5px solid ${hue}` : `1.5px dashed ${hue}66`,
        boxShadow: ck ? `0 0 10px ${hue}25` : 'none',
        display: 'flex',
        flexDirection: 'column',
        height: 190,
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      {/* Color Header Stripe */}
      <div style={{ height: 4, background: ck ? hue : `${hue}44` }} />

      <div
        style={{
          padding: 14,
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        {/* SEAT BADGE HEADER */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span
            style={{
              fontSize: '0.72rem',
              fontFamily: 'var(--font-mono)',
              color: hue,
              fontWeight: 'bold',
            }}
          >
            {t('lobby.seatBadgeHeader', { color: colorName })}
          </span>
          {/* The host card carries the same ✕ as every other card:
                                giving the seat back frees its colour and reopens
                                the palette, because the host picks first. */}
          {seat.type === 'you' && (
            <button
              onClick={() => {
                retroAudio.playUiBeep(320, 0.05);
                onRemove();
              }}
              style={REMOVE_SEAT_BTN}
              title={t('lobby.removeSeatTooltip')}
            >
              ✕
            </button>
          )}
        </div>

        {/* SEAT CONTENT */}
        {seat.type === 'you' && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              flex: 1,
              justifyContent: 'space-between',
              marginTop: 4,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                minWidth: 0,
              }}
            >
              <UserAvatar
                username={user?.username ?? ''}
                userId={user?.id}
                hasAvatarPhoto={user?.hasAvatarPhoto ?? false}
                avatarStyle={user?.avatarStyle}
                size={40}
                fallbackStyle={{
                  width: 40,
                  height: 40,
                  borderRadius: 6,
                  background: hue,
                  color: 'rgb(var(--bg-primary-rgb))',
                  fontWeight: 'bold',
                  display: 'grid',
                  placeItems: 'center',
                }}
                style={{
                  borderRadius: 6,
                  border: `1px solid ${hue}`,
                  flex: 'none',
                }}
              />
              <div style={{ minWidth: 0 }}>
                <div
                  className={HEADING_ELLIPSIS}
                  title={
                    (user?.displayName ?? user?.username ?? '') ||
                    (guest ? t('guest.playerName') : t('common.you'))
                  }
                >
                  {(user?.displayName ?? user?.username ?? '').toUpperCase() ||
                    (guest ? t('guest.playerName') : t('common.you'))}
                </div>
                <div
                  style={{
                    color: hue,
                    fontSize: '0.72rem',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {t('lobby.hostPilotTag')}
                </div>
              </div>
            </div>
            <div
              style={{
                fontSize: '0.74rem',
                color: 'var(--state-on)',
                fontFamily: 'var(--font-mono)',
                fontWeight: 'bold',
              }}
            >
              {t('lobby.stateReadyHost')}
            </div>
          </div>
        )}

        {seat.type === 'bot' && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              flex: 1,
              justifyContent: 'space-between',
              marginTop: 4,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  minWidth: 0,
                }}
              >
                {/* A bot has no account: a generated avatar, seeded from the
                                      assistant name this seat was assigned here. */}
                <UserAvatar
                  username={seat.name}
                  isBot
                  size={38}
                  fallbackStyle={{
                    width: 38,
                    height: 38,
                    borderRadius: 6,
                    background: `${hue}25`,
                    border: `1px solid ${hue}`,
                    color: hue,
                    fontWeight: 'bold',
                    display: 'grid',
                    placeItems: 'center',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.82rem',
                  }}
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 6,
                    border: `1px solid ${hue}`,
                    flex: 'none',
                  }}
                />
                <div style={{ minWidth: 0 }}>
                  <div className={HEADING_ELLIPSIS} title={seat.name}>
                    {seat.name}
                  </div>
                  <div
                    style={{
                      color: 'var(--text-muted)',
                      fontSize: '0.72rem',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {t('lobby.aiBotTag')}
                  </div>
                </div>
              </div>

              <button
                onClick={() => {
                  retroAudio.playUiBeep(320, 0.05);
                  onRemove();
                }}
                style={REMOVE_SEAT_BTN}
                title={t('lobby.removeSeatTooltip')}
              >
                ✕
              </button>
            </div>
            <div
              style={{
                fontSize: '0.74rem',
                color: hue,
                fontFamily: 'var(--font-mono)',
              }}
            >
              {t('lobby.stateAiReady')}
            </div>
          </div>
        )}

        {seat.type === 'player' && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              flex: 1,
              justifyContent: 'space-between',
              marginTop: 4,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  flex: 1,
                  minWidth: 0,
                }}
              >
                {/* Local hotseat pilots have no account, so the DiceBear
                                      avatar is seeded from the name typed here. Only the
                                      host's seat above can show an uploaded photo. */}
                <UserAvatar
                  username={seat.name}
                  size={38}
                  fallbackStyle={{
                    width: 38,
                    height: 38,
                    borderRadius: 6,
                    background: `${hue}25`,
                    border: `1px solid ${hue}`,
                    color: hue,
                    fontWeight: 'bold',
                    display: 'grid',
                    placeItems: 'center',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.82rem',
                  }}
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 6,
                    border: `1px solid ${hue}`,
                    flex: 'none',
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  {editing ? (
                    <input
                      autoFocus
                      value={editName}
                      onChange={(e) => onEditName(e.target.value)}
                      onBlur={() => {
                        onRename(editName.trim() || seat.name);
                        onEditingSeat(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          onRename(editName.trim() || seat.name);
                          onEditingSeat(null);
                        }
                      }}
                      style={{
                        width: '90%',
                        background: 'rgb(var(--shade-rgb) / 0.8)',
                        border: `1px solid ${hue}`,
                        borderRadius: 4,
                        color: 'var(--text-main)',
                        padding: '3px 8px',
                        fontSize: '0.86rem',
                        fontFamily: 'var(--font-mono)',
                      }}
                    />
                  ) : (
                    <div
                      onClick={() => {
                        retroAudio.playUiBeep(520, 0.05);
                        onEditingSeat(index);
                        onEditName(localizedPilotName(t, seat.name));
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        minWidth: 0,
                        fontWeight: 800,
                        fontSize: '0.92rem',
                        color: 'var(--text-main)',
                        fontFamily: 'var(--font-heading)',
                        cursor: 'pointer',
                      }}
                      title={t('lobby.clickToRename')}
                    >
                      {/* The pencil stays outside the ellipsized span, so a
                                            long name cannot hide the rename affordance. */}
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          minWidth: 0,
                        }}
                      >
                        {localizedPilotName(t, seat.name)}
                      </span>
                      <span style={{ flex: 'none' }}>✎</span>
                    </div>
                  )}
                  <div
                    style={{
                      color: 'var(--text-muted)',
                      fontSize: '0.72rem',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {t('lobby.hotseatPilotTag')}
                  </div>
                </div>
              </div>

              <button
                onClick={() => {
                  retroAudio.playUiBeep(320, 0.05);
                  onRemove();
                }}
                style={REMOVE_SEAT_BTN}
                title={t('lobby.removeSeatTooltip')}
              >
                ✕
              </button>
            </div>
            <div
              style={{
                fontSize: '0.74rem',
                color: 'var(--state-on)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {t('lobby.stateStandby')}
            </div>
          </div>
        )}

        {seat.type === 'empty' && (
          <div
            onClick={() => {
              retroAudio.playUiBeep(520, 0.05);
              // One palette, one target: the card. While the host is unseated this fills *this* card with the
              // host, which is what "the host picks first" means; afterwards it adds a bot (bot room) or a local
              // pilot at the picked colour.
              onPickColor();
            }}
            style={{
              flex: 1,
              border: `1.5px dashed ${hue}66`,
              borderRadius: 4,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              cursor: 'pointer',
              background: 'rgb(var(--shade-rgb) / 0.4)',
              transition: 'all 0.2s ease',
              marginTop: 4,
            }}
          >
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: '50%',
                border: `1.5px dashed ${hue}`,
                color: hue,
                display: 'grid',
                placeItems: 'center',
                fontSize: '1.1rem',
                fontWeight: 'bold',
              }}
            >
              +
            </div>
            <div
              style={{
                fontSize: '0.78rem',
                color: hue,
                fontFamily: 'var(--font-mono)',
                fontWeight: 'bold',
                textAlign: 'center',
                padding: '0 4px',
              }}
            >
              {!hostSeated
                ? t('lobby.pickColorTitle')
                : botRoom
                  ? t('lobby.addAiBot')
                  : t('lobby.addHumanPilot')}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
