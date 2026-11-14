import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavDock } from '../components/NavDock';
import { PieceFigure } from '../components/PieceFigure';
import { navigate } from '../router';
import { useApp } from '../store';
import { BOARD_QUADRANTS, COL, COLOR_KEYS, type ColorKey } from '../theme';
import { retroAudio } from '../utils/audio';
import {
  BADGE_BAR,
  CRT_SCREEN,
  HERO_SECTION,
  HERO_SUBTITLE,
  HERO_TITLE,
  LOBBY_SECTION_TITLE,
  RETRO_BADGE,
  RETRO_BTN,
  RETRO_WINDOW,
  WINDOW_BODY,
  WINDOW_BTN_MAX,
  WINDOW_BTN_MIN,
  WINDOW_CONTROLS,
  WINDOW_HEADER,
} from '../styles/tw';

/**
 * MEET THE SQUADS: four squads a decade, drawn in the colours they play.
 *
 * **One page per era, not one page with a toggle** (34, decision 21). The era is the
 * theme, so the page reads the store's `theme` and renders that decade's four squads:
 * a toggle here would be a second theme switcher in the app, and §33 spent a pass
 * removing the first one's duplicates.
 *
 * **The art is the live figure, not a still** (decision 23). `PieceFigure` renders
 * the same `<g>` content the board does, in the 100-unit box both sets are authored
 * in, at whatever size the card gives it — so the page costs no new asset, cannot
 * drift from the board's drawing, and needs no fetch. Only the front pose is shown.
 *
 * **The nicknames come from the art, not from a list** (decision 22): the 80s rows
 * are the four characters in `pieceParts80.ts` (`PUNK`, `NETRUNNER`, `BIKER`,
 * `CYBORG`), the 70s rows the four helmets in `pieceParts.ts` (`H2`, `H3`, `H4`,
 * `H1`). A page whose red squad were drawn in another colour's helmet would be a lie
 * about the board, so the mapping is the table's own.
 *
 * The colours run in `BOARD_QUADRANTS` order — red and green on the top row, blue and
 * yellow below — which is the corner picker's 2×2 and the board's own geometry.
 */

/** The colour word, then the colour's own separator, then the nickname
 *  (`RED — CREAM PLATE CREW`), the rule the board's prison labels already follow. The
 *  separator lives here rather than in the locale: it is punctuation, not a word. */
const NICK_SEPARATOR = ' — ';

/** `red` -> `Red`: the locale keys are `nickRed70`/`bioRed80`, one per seat. */
function seatKey(ck: ColorKey): string {
  return ck.charAt(0).toUpperCase() + ck.slice(1);
}

export function Squads() {
  const { t } = useTranslation();
  const { theme } = useApp();
  // The locale keys carry the decade as a suffix, because both decades' words ship
  // in every locale: `nickRed70` and `nickRed80` are two different crews.
  const era = theme === 'retro70' ? '70' : '80';

  // Read once at mount, like every other page: the CRT look is a page-level choice.
  const [crtEnabled] = useState(() => localStorage.getItem('retro_crt') !== 'false');

  return (
    <div
      className={`${CRT_SCREEN} crt-screen ${crtEnabled ? 'relative' : ''}`}
      id="crtScreen"
      style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
    >
      {/* The page is a fixed-height column, not a scrolling document: the deck inside
          the window is the only part that grows (a full-length bio in three locales),
          so it takes the scroll and the heading, the era badge and the way back stay
          where they are. `h-screen` on the row and `h-full` on the column are what
          give the window a height to shrink into — with `min-h-screen` the column was
          content-sized, the window outgrew the 100vh root and an 800px window clipped
          the second row of squads with nothing to scroll (found in the 34 item-2 pass). */}
      <div className="relative z-10 box-border flex h-screen w-full flex-row items-start justify-center gap-7 px-6 py-8">
        <NavDock activeRoute="/gamelobby" />

        <div className="flex h-full w-full min-w-0 flex-1 flex-col" style={{ margin: 0, padding: 0 }}>
          <header
            className={HERO_SECTION}
            style={{ margin: 0, padding: '16px 0', flexShrink: 0 }}
          >
            <h1
              className={HERO_TITLE}
              style={{ fontSize: '1.45rem', margin: 0, letterSpacing: '1.5px' }}
            >
              {t('squadsPage.title')}
            </h1>
            <p className={HERO_SUBTITLE} style={{ marginTop: 6 }}>
              {t('squadsPage.subtitle')}
            </p>

            <div className={BADGE_BAR} style={{ marginTop: 10 }}>
              {/* Which decade these four are: the page's one badge, and the only
                  word on it that is not a squad's own. */}
              <span
                className={RETRO_BADGE}
                style={{
                  border: '1px solid var(--accent-cyan)',
                  color: 'var(--accent-cyan)',
                  background: 'rgb(var(--accent-cyan-rgb) / 0.12)',
                  fontSize: '0.74rem',
                  padding: '4px 12px',
                  borderRadius: 4,
                  fontFamily: 'var(--font-display)',
                  fontWeight: 'bold',
                }}
              >
                {t(theme === 'retro70' ? 'squadsPage.era70' : 'squadsPage.era80')}
              </span>
            </div>
          </header>

          <section
            className={RETRO_WINDOW}
            style={{
              width: '100%',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              minHeight: 0,
            }}
          >
            <div
              className={WINDOW_HEADER}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 18px',
                fontSize: '0.85rem',
                flexShrink: 0,
              }}
            >
              <span style={{ fontFamily: 'var(--font-display)', letterSpacing: '0.04em' }}>
                {t('squadsPage.title')}
              </span>
              <div className={WINDOW_CONTROLS} style={{ gap: 6 }}>
                <span className={WINDOW_BTN_MIN} />
                <span className={WINDOW_BTN_MAX} />
              </div>
            </div>

            {/* The cards scroll inside the window, so the heading and the way back
                stay put however long the bios run in a given locale. */}
            <div
              className={WINDOW_BODY}
              style={{
                display: 'grid',
                // Two columns, not "as many as fit" (34, item 2): the four squads sit in
                // `BOARD_QUADRANTS` order, so a third column would put blue on the top row
                // and leave yellow under red — the board's 2x2, read wrong. The floor is
                // `max(320px, 45%)`: 320 is what a card's figure + nickname pair needs, and
                // 45% is what keeps a third track from ever fitting (three of 45% plus two
                // gaps is over 100%), so the deck is 2×2 from 660 px up and one column
                // below, at 1440 and at 1920 alike. `min(100%, …)` is the phone guard: a
                // container narrower than 320px must not push its card off the edge.
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, max(320px, 45%)), 1fr))',
                gap: 16,
                padding: '16px 18px',
                overflowY: 'auto',
                flex: 1,
                minHeight: 0,
              }}
            >
              {BOARD_QUADRANTS.map((ck) => {
                const hue = COL[ck].base;
                const seat = seatKey(ck);
                const colour = t(COLOR_KEYS[ck]).toUpperCase();
                const nick = t(`squadsPage.nick${seat}${era}`);
                return (
                  <article
                    key={ck}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 12,
                      padding: 16,
                      borderRadius: 10,
                      border: `1px solid ${hue}55`,
                      background: `${hue}0f`,
                      boxShadow: `0 0 24px ${hue}22`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
                      <span
                        style={{
                          width: 96,
                          height: 96,
                          flexShrink: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: 8,
                          border: `1px solid ${hue}44`,
                          background: 'rgba(5, 2, 18, 0.55)',
                        }}
                      >
                        {/* The board's own drawing, in this seat's silhouette: one
                            figure per colour, front pose, no new asset. */}
                        <svg
                          viewBox="0 0 100 100"
                          width={88}
                          height={88}
                          role="img"
                          aria-label={`${colour}${NICK_SEPARATOR}${nick}`}
                        >
                          <PieceFigure ck={ck} set={theme} />
                        </svg>
                      </span>
                      <h2
                        className={LOBBY_SECTION_TITLE}
                        style={{ margin: 0, minWidth: 0, color: hue }}
                      >
                        {colour}
                        {NICK_SEPARATOR}
                        {nick}
                      </h2>
                    </div>

                    <p
                      style={{
                        margin: 0,
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'calc(0.76rem + 1pt)',
                        lineHeight: 1.6,
                        color: 'var(--text-soft)',
                      }}
                    >
                      {t(`squadsPage.bio${seat}${era}`)}
                    </p>
                  </article>
                );
              })}
            </div>
          </section>

          {/* The rooms page's own way back, so the two screens leave the lobby the
              same way (34, decision 25). */}
          <button
            className={RETRO_BTN}
            style={{
              width: '100%',
              marginTop: 12,
              padding: '12px 0',
              fontSize: '0.84rem',
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.5px',
              background: 'rgb(var(--accent-cyan-rgb) / 0.12)',
              border: '1px solid var(--accent-cyan)',
              color: 'var(--accent-cyan)',
              cursor: 'pointer',
            }}
            onClick={() => {
              retroAudio.playUiBeep(440, 0.05);
              navigate('/gamelobby');
            }}
          >
            {t('lobby.returnToGameLobby')}
          </button>
        </div>
      </div>
    </div>
  );
}
