import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavDock } from '../../components/NavDock';
import { useApp } from '../../store';
import {
  CRT_SCREEN,
  HERO_SECTION,
  HERO_TITLE,
  RETRO_WINDOW,
  WINDOW_HEADER,
  WINDOW_CONTROLS,
  WINDOW_BTN_MIN,
  WINDOW_BTN_MAX,
  WINDOW_BODY,
} from '../../styles/tw';
import { LadderTable } from './LadderTable';
import { Podium } from './Podium';
import type { LeaderboardResponse } from './leaderboardTypes';

export function Leaderboard() {
  const { t } = useTranslation();
  const { user } = useApp();

  // **CRT CONTROLS**
  // A page-level look, not a dock control: read once at mount.
  const [crtEnabled] = useState(() => localStorage.getItem('retro_crt') !== 'false');

  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/leaderboard?mode=global&limit=50', { credentials: 'include' })
      .then((r) => (r.ok ? (r.json() as Promise<LeaderboardResponse>) : Promise.reject(r.status)))
      .then((body) => {
        if (!cancelled) setData(body);
      })
      .catch((e) => {
        console.error(e);
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      {/* CRT Monitor Overlay FX Container */}
      <div className={`${CRT_SCREEN} crt-screen ${crtEnabled ? 'relative' : ''}`} id="crtScreen">
        {/* Dynamic Full-Width Seated Sidebar & Content Layout Container */}
        <div className="page-fit-shell relative z-10 box-border flex min-h-screen w-full flex-row items-start justify-center gap-7 px-6 py-8">
          {/* Left-Seated Navigation Dock */}
          <NavDock activeRoute="/leaderboard" />

          {/* Main Content Flow */}
          <div
            className="page-fit-column sticky top-8 w-full min-w-0 flex-1"
            style={{ margin: 0, padding: 0 }}
          >
            {/* Hero Title (Clean, original font & color, taller Y-axis) */}
            <header
              className={HERO_SECTION}
              style={{ marginTop: 0, padding: '16px 0 18px', marginBottom: 12, flexShrink: 0 }}
            >
              <h1
                className={HERO_TITLE}
                style={{ fontSize: '1.45rem', margin: 0, letterSpacing: '1.5px' }}
              >
                {t('leaderboard.globalRankingHero')}
              </h1>
            </header>

            {/* Unified Leaderboard Window Container (Slightly shorter in Y-axis to balance page) */}
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
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontWeight: 'bold',
                    fontFamily: 'var(--font-display)',
                    letterSpacing: '0.04em',
                  }}
                >
                  <span>{t('leaderboard.leaderboardHeader', { count: data?.total ?? 0 })}</span>
                </div>
                <div
                  className={WINDOW_CONTROLS}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <span className={WINDOW_BTN_MIN} />
                  <span className={WINDOW_BTN_MAX} />
                </div>
              </div>

              <div
                className={WINDOW_BODY}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  padding: '12px 16px',
                  flex: 1,
                  overflow: 'hidden',
                  minHeight: 0,
                }}
              >
                {data && data.entries.length > 0 && <Podium entries={data.entries} />}

                <LadderTable
                  entries={data?.entries ?? null}
                  loading={loading}
                  username={user?.username}
                />
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
