import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import {
  RETRO_WINDOW,
  WINDOW_HEADER,
  WINDOW_CONTROLS,
  WINDOW_BTN_MIN,
  WINDOW_BTN_MAX,
  WINDOW_BODY,
  ARCADE_CONTAINER,
  ARCADE_SCREEN_FRAME,
  ARCADE_START_OVERLAY,
  ARCADE_START_TITLE,
  ARCADE_START_SUB,
  COL_8,
} from '../../styles/tw';

export function HeroCabinet({
  canvasRef,
  isWarpingToLobby,
  onLaunch,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  isWarpingToLobby: boolean;
  onLaunch: () => void;
}) {
  const { t } = useTranslation();
  return (
              <section className={`${RETRO_WINDOW} ${COL_8}`} id="arcadeWindow">
                <div className={WINDOW_HEADER}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span>{t('homeExtended.arcadeArenaTitle')}</span>
                  </div>
                  <div className={WINDOW_CONTROLS}>
                    <span className={WINDOW_BTN_MIN} />
                    <span className={WINDOW_BTN_MAX} />
                  </div>
                </div>
                <div className={`${WINDOW_BODY} ${ARCADE_CONTAINER}`}>
                  {/* Arcade Canvas Frame & Interactive Press Start Overlay */}
                  <div
                    className={ARCADE_SCREEN_FRAME}
                    style={
                      isWarpingToLobby
                        ? {
                            border: '4px solid rgb(var(--ink-rgb))',
                            boxShadow: '0 0 35px rgb(var(--ink-rgb)), 0 0 50px var(--accent-cyan)',
                          }
                        : undefined
                    }
                  >
                    <canvas id="arcadeCanvas" ref={canvasRef} width={720} height={400} />

                    {/* Interactive Translucent Press Start Banner Overlay. Both eras
                        print the same two lines: the two cards are the same card now,
                        so the copy no longer asks which theme is on. It is also the
                        cabinet's one control: the screen around it is a picture, so a
                        click on the art is not a launch — Space or Enter still are,
                        from anywhere on the page. */}
                    <div
                      className={ARCADE_START_OVERLAY}
                      onClick={onLaunch}
                      title={t('home.enterLobbyTooltip')}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        // The page's own Space/Enter handler already launches, so the
                        // focused banner only has to stop the key from also scrolling.
                        if (e.key === 'Enter' || e.key === ' ') e.preventDefault();
                      }}
                    >
                      <span className={ARCADE_START_TITLE}>
                        {t('homeExtended.pressStartTitle')}
                      </span>
                      <span className={ARCADE_START_SUB}>
                        {t('homeExtended.pressStartSub')}
                      </span>
                    </div>

                    {/* Hyperdrive Warp Flash on Launch */}
                    {isWarpingToLobby && (
                      <div
                        style={{
                          position: 'absolute',
                          inset: 0,
                          background: 'rgb(var(--ink-rgb) / 0.85)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontFamily: 'var(--font-heading)',
                          fontSize: '1.2rem',
                          color: 'rgb(var(--bg-primary-rgb))',
                          animation: 'pulse 0.2s infinite',
                        }}
                      >
                        {t('homeExtended.warpingToArena')}
                      </div>
                    )}
                  </div>
                </div>
              </section>
  );
}
