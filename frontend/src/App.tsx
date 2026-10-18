import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Friends } from './pages/Friends';
import { Game } from './pages/Game';
import { Home } from './pages/Home';
import { Leaderboard } from './pages/Leaderboard';
import { Lobby } from './pages/Lobby';
import { LudoLobby } from './pages/LudoLobby';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { Profile } from './pages/Profile';
import { TwoFactor } from './pages/TwoFactor';
import { ForgotPassword } from './pages/ForgotPassword';
import { ResetPassword } from './pages/ResetPassword';
import { VerifyEmail } from './pages/VerifyEmail';
import { LegalPage } from './pages/LegalPage';
import { navigate, useRoute } from './router';
import { AppProvider, useApp } from './store';
import { NotificationsProvider, useNotifications } from './hooks/useNotifications';
import { NotificationToasts } from './components/NotificationToast';

/** All routes render full-screen. */
const FULL_ROUTES: Record<string, () => ReactNode> = {
  '/home': () => <Home />,
  '/leaderboard': () => <Leaderboard />,
  '/friends': () => <Friends />,
  '/profile': () => <Profile />,
  '/login': () => <Login />,
  '/signup': () => <Signup />,
  '/2fa': () => <TwoFactor />,
  '/forgot-password': () => <ForgotPassword />,
  '/reset-password': () => <ResetPassword />,
  '/verify-email': () => <VerifyEmail />,
  '/gamelobby': () => <LudoLobby />,
  '/gamelobby/table': () => <Lobby />,
  // The guest setup screen: the same seat/bot/rules controls, no session, and
  // its launch posts the public guest endpoint instead of /api/match/create.
  '/guest': () => <Lobby guest />,
  '/game': () => <Game />,
  '/privacy': () => <LegalPage initialDoc="privacy" />,
  '/terms': () => <LegalPage initialDoc="terms" />,
};

/** Public routes, can be reached wihout a session */
const PUBLIC_ROUTES = new Set([
  '/login',
  '/signup',
  '/guest',
  '/2fa',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/privacy',
  '/terms',
]);

/** Routes reached by an emailed account action rather than by browsing. A
 * signed-in user must still see them: most such arrivals are recognizable from
 * the query string, but the router cannot see a URL fragment. */
const ACCOUNT_ACTION_ROUTES = new Set(['/verify-email', '/reset-password']);

function Screen() {
  const { path, query } = useRoute();
  const { user, authReady, activeMatch } = useApp();
  const { toasts, dismissToast } = useNotifications();
  const known = path in FULL_ROUTES;
  // /game is public only for a guest handoff held in memory. A guest has no
  // session, so the usual "must be signed in" gate would bounce them to /login
  // one render after the mint.
  const isPublic =
    PUBLIC_ROUTES.has(path) || (path === '/game' && activeMatch?.isGuest === true);
  // Account-action arrivals (verified/reset/error/token) belong to a specific
  // account action, not the session, so a logged-in user must still see them.
  const hasNotice =
    ACCOUNT_ACTION_ROUTES.has(path) ||
    ['verified', 'reset', 'error', 'token'].some((k) => !!query.get(k));

  useEffect(() => {
    // Wait for the /me session check. Else, a refresh while logged in
    // would bounce to /login before the cookie has been verified
    if (!authReady) return;
    if (!known) navigate(user ? '/home' : '/login', { replace: true });
    else if (!user && !isPublic) navigate('/login', { replace: true });
    else if (user && isPublic && !hasNotice) navigate('/home', { replace: true });
  }, [authReady, known, user, isPublic, hasNotice, activeMatch?.isGuest]);

  if (!authReady) return null;
  if (!known || (!user && !isPublic) || (user && isPublic && !hasNotice)) return null;

  return (
    <>
      {path === '/game' ? <Game key={query.get('gameId') ?? 'game'} /> : FULL_ROUTES[path]()}
      {user && <NotificationToasts toasts={toasts} onDismiss={dismissToast} />}
    </>
  );
}

export default function App() {
  return (
    <AppProvider>
      <NotificationsProvider>
        <Screen />
      </NotificationsProvider>
    </AppProvider>
  );
}
