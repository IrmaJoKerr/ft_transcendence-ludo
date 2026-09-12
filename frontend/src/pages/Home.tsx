import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getApi } from '../api';
import { UserAvatar } from '../components/UserAvatar';
import { RetroNavbar } from '../components/RetroNavbar';
import { LegalModal, type LegalDocType } from '../components/LegalModal';
import { useNotifications } from '../hooks/useNotifications';
import { navigate } from '../router';
import { useApp } from '../store';
import { retroAudio } from '../utils/audio';
import { getRankTier } from '../utils/ranks';
import { RankBadge } from '../components/RankBadge';
import '../styles/retrowave.css';
import {
  PAGE_SHELL,
  GRID_BACKGROUND,
  SYNTHWAVE_SUN,
  PERSPECTIVE_GRID,
  GRID_HORIZON,
  HERO_SECTION,
  HERO_TITLE,
  HERO_SUBTITLE,
  BADGE_BAR,
  RETRO_BADGE,
  DASHBOARD_GRID,
  RETRO_WINDOW,
  WINDOW_HEADER,
  WINDOW_CONTROLS,
  WINDOW_BTN_MIN,
  WINDOW_BTN_MAX,
  WINDOW_BODY,
  RETRO_BTN,
  ARCADE_CONTAINER,
  ARCADE_SCREEN_FRAME,
  ARCADE_START_OVERLAY,
  ARCADE_START_TITLE,
  ARCADE_START_SUB,
  COL_4,
  COL_8,
  RETRO_FOOTER,
  CYBER_CASSETTE_CHASSIS,
  OLED_SCREEN,
  OLED_TITLE,
  OLED_META,
  CYBER_EQ_DECK,
  CYBER_EQ_COL,
  CYBER_TRANSPORT_CLUSTER,
  CYBER_DECK_KEY,
  CYBER_DECK_KEY_PLAY,
  CYBER_DECK_KEY_PLAY_ACTIVE,
  CYBER_KEY_ICON,
  CYBER_KEY_LABEL,
  CYBER_KEY_SUB,
  CYBER_VOL_CONSOLE,
  CYBER_FADER_TRACK_ROW,
  CYBER_VOL_STEP_BTN,
  CYBER_VOL_LED_BAR,
  CYBER_VOL_LED_SEGMENT,
  LED_LIT_CYAN,
  LED_LIT_AMBER,
  LED_LIT_PINK,
} from '../styles/tw';

type Friend = {
  id: string;
  username: string;
  displayName?: string;
  avatarStyle?: string | null;
  hasAvatarPhoto?: boolean;
  rating?: number;
  friendsSince?: string;
  status?: 'online' | 'playing' | 'offline';
};

const STATUS_STYLE: Record<string, { label: string; color: string; border: string; bg: string }> = {
  online: {
    label: 'Online',
    color: '#00ff88',
    border: 'rgba(0, 255, 136, 0.4)',
    bg: 'rgba(0, 255, 136, 0.12)',
  },
  playing: {
    label: 'In Game',
    color: '#ffe600',
    border: 'rgba(255, 230, 0, 0.4)',
    bg: 'rgba(255, 230, 0, 0.12)',
  },
  offline: {
    label: 'Offline',
    color: '#7a889b',
    border: 'rgba(122, 136, 155, 0.3)',
    bg: 'rgba(122, 136, 155, 0.08)',
  },
};

export function Home() {
  const { t } = useTranslation();
  const { user, theme } = useApp();
  const [legalModalDoc, setLegalModalDoc] = useState<LegalDocType | null>(null);
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();

  // ------------------------------------------------------------------------
  // 2. LIVE PLAYER CAREER STATS API
  // ------------------------------------------------------------------------
  type PlayerStats = {
    rating?: number;
    highestRating?: number;
    totalGames: number;
    wins: number;
    losses: number;
    totalCaptures: number;
    totalPiecesInGoal: number;
    avgCapturesPerGame: number;
  };
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [leaderboardRank, setLeaderboardRank] = useState<number | null>(null);
  const [leaderboardMap, setLeaderboardMap] = useState<Record<string, number>>({});
  const [isStatsLoading, setIsStatsLoading] = useState(false);

  useEffect(() => {
    setIsStatsLoading(true);
    Promise.all([
      getApi<PlayerStats>('/api/stats').catch(() => null),
      getApi<{ myRank?: { rank: number }; entries?: Array<{ username: string; rank: number }> }>(
        '/api/leaderboard?mode=global&limit=50',
      ).catch(() => null),
    ])
      .then(([statsBody, lbBody]) => {
        if (statsBody && typeof statsBody.totalGames === 'number') {
          setStats(statsBody);
        }
        if (lbBody?.myRank?.rank) {
          setLeaderboardRank(lbBody.myRank.rank);
        }
        if (lbBody?.entries) {
          const map: Record<string, number> = {};
          lbBody.entries.forEach((e) => {
            map[e.username] = e.rank;
          });
          setLeaderboardMap(map);
        }
      })
      .catch((e) => {
        console.error(e);
      })
      .finally(() => {
        setIsStatsLoading(false);
      });
  }, []);


  // ------------------------------------------------------------------------
  // 4. CYBER COMM // FRIEND LIST & AUDIO
  // ------------------------------------------------------------------------
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [pendingRequestsCount, setPendingRequestsCount] = useState(0);
  const [isFriendsLoading, setIsFriendsLoading] = useState(false);

  const fetchFriendsData = () => {
    Promise.all([
      getApi<Friend[]>('/api/friends'),
      getApi<{ received: Array<{ id: string }> }>('/api/friends/requests'),
    ])
      .then(([friendsData, reqData]) => {
        const list = Array.isArray(friendsData) ? friendsData : [];
        list.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
        setFriends(list);
        setPendingRequestsCount(Array.isArray(reqData.received) ? reqData.received.length : 0);
      })
      .catch((e) => {
        console.error(e);
      });
  };

  useEffect(() => {
    setIsFriendsLoading(true);
    fetchFriendsData();
    setIsFriendsLoading(false);
    const iv = setInterval(fetchFriendsData, 12000);
    return () => {
      clearInterval(iv);
    };
  }, []);

  const [isPlayingAudio, setIsPlayingAudio] = useState(retroAudio.isPlaying);
  const [audioTrackIndex, setAudioTrackIndex] = useState(retroAudio.currentTrackIndex);
  const [audioVolume, setAudioVolume] = useState(Math.round(retroAudio.volume * 100));
  const [eqHeights, setEqHeights] = useState([8, 14, 20, 26, 18, 12, 22, 16, 10, 24, 15, 9]);

  const handleToggleAudio = () => {
    const playing = retroAudio.togglePlay();
    setIsPlayingAudio(playing);
  };

  const handleNextTrack = () => {
    retroAudio.nextTrack();
    setAudioTrackIndex(retroAudio.currentTrackIndex);
    retroAudio.playUiBeep(880, 0.04);
  };

  const handlePrevTrack = () => {
    retroAudio.prevTrack();
    setAudioTrackIndex(retroAudio.currentTrackIndex);
    retroAudio.playUiBeep(660, 0.04);
  };

  const handleStepVolume = (delta: number) => {
    const newVol = Math.max(0, Math.min(100, audioVolume + delta));
    setAudioVolume(newVol);
    retroAudio.setVolume(newVol / 100);
    retroAudio.playUiBeep(440 + newVol * 4, 0.03);
  };

  const handleLedSegmentClick = (segmentIndex: number) => {
    const newVol = (segmentIndex + 1) * 10;
    setAudioVolume(newVol);
    retroAudio.setVolume(newVol / 100);
    retroAudio.playUiBeep(440 + newVol * 4, 0.03);
  };

  // Equalizer spectrum visualizer animation
  useEffect(() => {
    if (!isPlayingAudio) {
      setEqHeights([4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4]);
      return;
    }
    const iv = setInterval(() => {
      setEqHeights((prev) => prev.map(() => Math.floor(Math.random() * 20) + 4));
    }, 120);
    return () => {
      clearInterval(iv);
    };
  }, [isPlayingAudio]);

  // 4b. HERO BADGE BAR: live site-wide online-player count (polled every 15s).
  const [onlineCount, setOnlineCount] = useState<number | null>(null);

  useEffect(() => {
    const fetchBadgeCounts = () => {
      getApi<{ count: number }>('/api/presence/online-count')
        .then((body) => {
          setOnlineCount(body.count);
        })
        .catch((e) => {
          console.error(e);
        });
    };
    fetchBadgeCounts();
    const iv = setInterval(fetchBadgeCounts, 15000);
    return () => {
      clearInterval(iv);
    };
  }, []);

  // ------------------------------------------------------------------------
  // 5. HUB ARCADE CABINET: 3D ATTRACT MODE & PRESS START
  // ------------------------------------------------------------------------
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isWarpingToLobby, setIsWarpingToLobby] = useState(false);

  const launchToLobby = useCallback(() => {
    if (isWarpingToLobby) return;
    setIsWarpingToLobby(true);
    // Arcade coin drop and power-up chime
    retroAudio.playUiBeep(987, 0.08);
    setTimeout(() => {
      retroAudio.playUiBeep(1318, 0.12);
    }, 90);
    setTimeout(() => {
      retroAudio.playUiBeep(1760, 0.2);
    }, 200);

    setTimeout(() => {
      navigate('/gamelobby');
    }, 350);
  }, [isWarpingToLobby]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') return;

      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        launchToLobby();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [launchToLobby]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let rotX = 0.4;
    let rotY = 0.6;
    let rotZ = 0.2;
    let gridOffset = 0;
    let time = 0;

    // Theme-specific color palettes
    const themeConfig = {
      synthwave: {
        bgTop: '#070114',
        bgMid: '#160530',
        bgBot: '#05010d',
        hasSun: true,
        sunC1: 'rgba(255, 230, 0, 0.72)',
        sunC2: 'rgba(255, 0, 127, 0.38)',
        sunScanline: '#070114',
        gridColor: 'rgba(0, 240, 255, 0.45)',
        starRgb: '255, 255, 255',
        diceBg: 'rgba(25, 8, 55, 0.32)',
        pipColor: '#ffffff',
        faces: [
          { v: [4, 5, 6, 7], pips: 1, color: '#ff007f', bg: 'rgba(255, 0, 127, 0.28)' },
          { v: [1, 0, 3, 2], pips: 6, color: '#00f0ff', bg: 'rgba(0, 240, 255, 0.28)' },
          { v: [0, 1, 5, 4], pips: 2, color: '#ffe600', bg: 'rgba(255, 230, 0, 0.28)' },
          { v: [3, 7, 6, 2], pips: 5, color: '#9d00ff', bg: 'rgba(157, 0, 255, 0.28)' },
          { v: [1, 2, 6, 5], pips: 3, color: '#00f0ff', bg: 'rgba(0, 240, 255, 0.28)' },
          { v: [0, 4, 7, 3], pips: 4, color: '#ff007f', bg: 'rgba(255, 0, 127, 0.28)' },
        ],
        sparks: ['#00f0ff', '#ff007f'],
        pawns: [
          { label: 'RED', color: '#ff0055', x: 85, y: 350 },
          { label: 'GREEN', color: '#00ff88', x: 230, y: 360 },
          { label: 'YELLOW', color: '#ffe600', x: 490, y: 360 },
          { label: 'BLUE', color: '#00f0ff', x: 635, y: 350 },
        ],
        marquee: '[ TRANSCENDENCE // CYBER LUDO ]',
        marqueeColor: '#00f0ff',
      },
      win95: {
        bgTop: '#000000',
        bgMid: '#000000',
        bgBot: '#000000',
        hasSun: false,
        sunC1: 'rgba(0, 0, 0, 0)',
        sunC2: 'rgba(0, 0, 0, 0)',
        sunScanline: '#000000',
        gridColor: 'rgba(0, 160, 160, 0.65)',
        starRgb: '255, 255, 255',
        diceBg: 'rgba(180, 180, 180, 0.28)',
        pipColor: '#ffffff',
        faces: [
          { v: [4, 5, 6, 7], pips: 1, color: '#ff4444', bg: 'rgba(230, 30, 30, 0.32)' },
          { v: [1, 0, 3, 2], pips: 6, color: '#4477ff', bg: 'rgba(30, 90, 255, 0.32)' },
          { v: [0, 1, 5, 4], pips: 2, color: '#ffdd00', bg: 'rgba(250, 200, 0, 0.32)' },
          { v: [3, 7, 6, 2], pips: 5, color: '#00dd44', bg: 'rgba(0, 180, 50, 0.32)' },
          { v: [1, 2, 6, 5], pips: 3, color: '#aa44ff', bg: 'rgba(120, 30, 220, 0.32)' },
          { v: [0, 4, 7, 3], pips: 4, color: '#00ddff', bg: 'rgba(0, 210, 240, 0.32)' },
        ],
        sparks: ['#ffffff', '#00ffff'],
        pawns: [
          { label: 'P1-RED', color: '#ff2222', x: 85, y: 350 },
          { label: 'P2-GRN', color: '#00cc33', x: 230, y: 360 },
          { label: 'P3-YLW', color: '#ffee00', x: 490, y: 360 },
          { label: 'P4-BLU', color: '#2255ff', x: 635, y: 350 },
        ],
        marquee: '[ DIRECTX 3D // CYBER LUDO 95 ]',
        marqueeColor: '#00ffff',
      },
      terminal: {
        bgTop: '#000800',
        bgMid: '#001400',
        bgBot: '#000400',
        hasSun: true,
        sunC1: 'rgba(0, 255, 102, 0.55)',
        sunC2: 'rgba(0, 180, 70, 0.25)',
        sunScanline: '#000800',
        gridColor: 'rgba(0, 255, 102, 0.4)',
        starRgb: '0, 255, 102',
        diceBg: 'rgba(0, 40, 10, 0.32)',
        pipColor: '#00ff66',
        faces: [
          { v: [4, 5, 6, 7], pips: 1, color: '#00ff66', bg: 'rgba(0, 255, 102, 0.22)' },
          { v: [1, 0, 3, 2], pips: 6, color: '#33ff88', bg: 'rgba(0, 255, 102, 0.22)' },
          { v: [0, 1, 5, 4], pips: 2, color: '#00dd55', bg: 'rgba(0, 255, 102, 0.22)' },
          { v: [3, 7, 6, 2], pips: 5, color: '#00ff66', bg: 'rgba(0, 255, 102, 0.22)' },
          { v: [1, 2, 6, 5], pips: 3, color: '#33ff88', bg: 'rgba(0, 255, 102, 0.22)' },
          { v: [0, 4, 7, 3], pips: 4, color: '#00dd55', bg: 'rgba(0, 255, 102, 0.22)' },
        ],
        sparks: ['#00ff66', '#33ff88'],
        pawns: [
          { label: 'NODE:RED', color: '#00ff66', x: 85, y: 350 },
          { label: 'NODE:GRN', color: '#33ff88', x: 230, y: 360 },
          { label: 'NODE:YLW', color: '#00ff66', x: 490, y: 360 },
          { label: 'NODE:BLU', color: '#33ff88', x: 635, y: 350 },
        ],
        marquee: '> SYS_EXEC: TRANSCENDENCE_LUDO_CORE.SH',
        marqueeColor: '#00ff66',
      },
    };

    const currentCfg = themeConfig[theme];

    // Background stars
    const stars = Array.from({ length: 65 }, () => ({
      x: Math.random() * 720,
      y: Math.random() * 260,
      size: Math.random() * 1.8 + 0.5,
      speed: Math.random() * 0.3 + 0.1,
      alpha: Math.random() * 0.7 + 0.3,
    }));

    // 3D Cube vertices (centered at origin, side length = 108)
    const cubeSize = 54;
    const rawVertices = [
      [-cubeSize, -cubeSize, -cubeSize],
      [cubeSize, -cubeSize, -cubeSize],
      [cubeSize, cubeSize, -cubeSize],
      [-cubeSize, cubeSize, -cubeSize],
      [-cubeSize, -cubeSize, cubeSize],
      [cubeSize, -cubeSize, cubeSize],
      [cubeSize, cubeSize, cubeSize],
      [-cubeSize, cubeSize, cubeSize],
    ];

    const faces = currentCfg.faces;

    const pipPositions: Partial<Record<number, number[][]>> = {
      1: [[0, 0]],
      2: [
        [-0.28, -0.28],
        [0.28, 0.28],
      ],
      3: [
        [-0.3, -0.3],
        [0, 0],
        [0.3, 0.3],
      ],
      4: [
        [-0.28, -0.28],
        [0.28, -0.28],
        [-0.28, 0.28],
        [0.28, 0.28],
      ],
      5: [
        [-0.28, -0.28],
        [0.28, -0.28],
        [0, 0],
        [-0.28, 0.28],
        [0.28, 0.28],
      ],
      6: [
        [-0.28, -0.32],
        [0.28, -0.32],
        [-0.28, 0],
        [0.28, 0],
        [-0.28, 0.32],
        [0.28, 0.32],
      ],
    };

    const loop = () => {
      time += 0.02;
      rotX += 0.012;
      rotY += 0.018;
      rotZ += 0.007;
      gridOffset = (gridOffset + 1.3) % 26;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 1. Deep Canvas Background with theme gradient
      const bgGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
      bgGrad.addColorStop(0, currentCfg.bgTop);
      bgGrad.addColorStop(0.65, currentCfg.bgMid);
      bgGrad.addColorStop(1, currentCfg.bgBot);
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // 2. Distant Sun (only for themes with sun)
      if (currentCfg.hasSun !== false) {
        const sunY = 250;
        const sunGrad = ctx.createRadialGradient(360, sunY, 7, 360, sunY, 90);
        sunGrad.addColorStop(0, currentCfg.sunC1);
        sunGrad.addColorStop(0.5, currentCfg.sunC2);
        sunGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = sunGrad;
        ctx.beginPath();
        ctx.arc(360, sunY, 90, Math.PI, 0, false);
        ctx.fill();

        // Sun horizon scanlines
        ctx.strokeStyle = currentCfg.sunScanline;
        ctx.lineWidth = 2;
        for (let sy = sunY - 60; sy < sunY; sy += 8) {
          ctx.beginPath();
          ctx.moveTo(265, sy);
          ctx.lineTo(455, sy);
          ctx.stroke();
        }
      }

      // 3. Floating Stars
      stars.forEach((st) => {
        st.y += st.speed;
        if (st.y > 260) st.y = 0;
        ctx.fillStyle = `rgba(${currentCfg.starRgb}, ${st.alpha * (0.8 + 0.2 * Math.sin(time * 3 + st.x))})`;
        ctx.beginPath();
        ctx.arc(st.x, st.y, st.size, 0, Math.PI * 2);
        ctx.fill();
      });

      // 4. Horizon Perspective Grid
      const horizonY = 260;
      ctx.save();
      ctx.strokeStyle = currentCfg.gridColor;
      ctx.lineWidth = 1;

      // Horizontal grid lines moving toward camera
      for (let gy = 0; gy < 140; gy += 14) {
        const y = horizonY + Math.pow((gy + gridOffset) / 145, 1.8) * 140;
        if (y <= canvas.height) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(canvas.width, y);
          ctx.stroke();
        }
      }

      // Perspective radiating vertical lines from vanishing point (360, 260)
      for (let x = -250; x <= canvas.width + 250; x += 45) {
        ctx.beginPath();
        ctx.moveTo(360, horizonY);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      ctx.restore();

      // 5. 3D Tumbling Ludo Dice in Center
      const centerX = 360;
      const centerY = 135 + Math.sin(time * 2.2) * 10;
      const cameraDist = 260;

      // 3D rotation matrix calculation
      const cosX = Math.cos(rotX),
        sinX = Math.sin(rotX);
      const cosY = Math.cos(rotY),
        sinY = Math.sin(rotY);
      const cosZ = Math.cos(rotZ),
        sinZ = Math.sin(rotZ);

      const transformedVertices = rawVertices.map(([x, y, z]) => {
        const x1 = x * cosY + z * sinY;
        const y1 = y;
        const z1 = -x * sinY + z * cosY;

        const x2 = x1;
        const y2 = y1 * cosX - z1 * sinX;
        const z2 = y1 * sinX + z1 * cosX;

        const x3 = x2 * cosZ - y2 * sinZ;
        const y3 = x2 * sinZ + y2 * cosZ;
        const z3 = z2;

        const scale = cameraDist / (cameraDist + z3);
        return {
          px: centerX + x3 * scale,
          py: centerY + y3 * scale,
          z: z3,
          orig: [x, y, z],
          rot: [x3, y3, z3],
        };
      });

      // Render glowing particle sparks behind dice
      for (let i = 0; i < 8; i++) {
        const sparkAngle = time * 3 + (i * Math.PI) / 4;
        const sparkR = 74 + Math.sin(time * 4 + i) * 15;
        const sx = centerX + Math.cos(sparkAngle) * sparkR;
        const sy = centerY + Math.sin(sparkAngle * 1.3) * (sparkR * 0.5);
        const sparkCol = currentCfg.sparks[i % currentCfg.sparks.length];
        ctx.fillStyle = sparkCol;
        ctx.shadowColor = sparkCol;
        ctx.shadowBlur = 9;
        ctx.beginPath();
        ctx.arc(sx, sy, 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Sort faces by average Z depth (Painter's algorithm)
      const faceList = faces.map((face) => {
        const pts = face.v.map((idx: number) => transformedVertices[idx]);
        const avgZ = (pts[0].z + pts[1].z + pts[2].z + pts[3].z) / 4;
        const v0 = pts[0],
          v1 = pts[1],
          v2 = pts[2];
        const normalZ = (v1.px - v0.px) * (v2.py - v0.py) - (v1.py - v0.py) * (v2.px - v0.px);
        return { ...face, pts, avgZ, normalZ };
      });

      faceList.sort((a, b) => a.avgZ - b.avgZ);

      faceList.forEach((face) => {
        const isBackface = face.normalZ <= 0;
        const alpha = isBackface ? 0.35 : 1.0;

        ctx.save();
        ctx.globalAlpha = alpha;

        // Draw face translucent background
        ctx.beginPath();
        ctx.moveTo(face.pts[0].px, face.pts[0].py);
        for (let i = 1; i < 4; i++) {
          ctx.lineTo(face.pts[i].px, face.pts[i].py);
        }
        ctx.closePath();

        ctx.fillStyle = face.bg || currentCfg.diceBg;
        ctx.fill();

        // Draw face edges
        ctx.strokeStyle = theme === 'win95' ? '#dfdfdf' : face.color;
        ctx.lineWidth = isBackface ? 1.5 : theme === 'win95' ? 2 : 3;
        ctx.shadowColor = theme === 'win95' || isBackface ? 'transparent' : face.color;
        ctx.shadowBlur = theme === 'win95' || isBackface ? 0 : 11;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Draw Pips on face
        const pips = pipPositions[face.pips] ?? [];
        const p0 = face.pts[0],
          p1 = face.pts[1],
          p2 = face.pts[2],
          p3 = face.pts[3];

        pips.forEach(([u, v]) => {
          const su = u + 0.5;
          const sv = v + 0.5;
          const topX = p0.px + (p1.px - p0.px) * su;
          const topY = p0.py + (p1.py - p0.py) * su;
          const botX = p3.px + (p2.px - p3.px) * su;
          const botY = p3.py + (p2.py - p3.py) * sv;
          const pipX = topX + (botX - topX) * sv;
          const pipY = topY + (botY - topY) * sv;

          ctx.fillStyle = currentCfg.pipColor;
          ctx.shadowColor = theme === 'win95' || isBackface ? 'transparent' : face.color;
          ctx.shadowBlur = theme === 'win95' || isBackface ? 0 : 8;
          ctx.beginPath();
          ctx.arc(pipX, pipY, isBackface ? 2.8 : 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        });
        ctx.restore();
      });

      // 6. 4-Player Army Hologram Nodes
      const pawns = currentCfg.pawns;

      pawns.forEach((p, idx) => {
        const pulse = Math.sin(time * 3 + idx * 1.5) * 2.4;
        ctx.save();
        ctx.fillStyle = p.color;
        ctx.shadowColor = theme === 'win95' ? 'transparent' : p.color;
        ctx.shadowBlur = theme === 'win95' ? 0 : 11;
        ctx.beginPath();
        ctx.arc(p.x, p.y + pulse, 7.5, 0, Math.PI * 2);
        ctx.fill();

        // Base ring
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y + 12, 15, 5, 0, 0, Math.PI * 2);
        ctx.stroke();

        ctx.font = '8.5px "Press Start 2P", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(p.label, p.x, p.y - 13 + pulse);
        ctx.restore();
      });

      // 7. Marquee Title on Top of Screen
      ctx.save();
      ctx.font = '12px "Press Start 2P", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = currentCfg.marqueeColor;
      ctx.shadowColor = currentCfg.marqueeColor;
      ctx.shadowBlur = 11;
      ctx.fillText(currentCfg.marquee, 360, 28);
      ctx.shadowBlur = 0;
      ctx.restore();

      animId = requestAnimationFrame(loop);
    };

    loop();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [theme]);

  const username = user?.username ?? t('common.you');
  const displayName = user?.displayName ?? username;

  return (
    <>
      {/* Animated 3D Synthwave Grid & Sun Background */}
      <div className={GRID_BACKGROUND}>
        <div className={SYNTHWAVE_SUN} />
        <div className={GRID_HORIZON} />
        <div className={PERSPECTIVE_GRID} />
      </div>

      {/* Page shell (full-height wrapper) */}
      <div
        className={`${PAGE_SHELL} page-shell flex min-h-screen w-full flex-col items-center justify-start`}
      >
        {/* Dynamic Full-Width Seated Sidebar & Content Layout Container */}
        <div className="relative z-10 box-border flex min-h-screen w-full flex-row items-start justify-center gap-7 px-6 py-8">
          {/* Left-Seated Navigation Dock */}
          <aside
            className="sticky top-8 w-[88px] shrink-0 xl:w-[270px]"
            style={{ margin: 0, padding: 0 }}
          >
            <RetroNavbar
              activeRoute="/home"


              notifications={notifications}
              unreadCount={unreadCount}
              onMarkRead={markRead}
              onMarkAllRead={markAllRead}
           />
          </aside>

          {/* Main Content Flow - Full Size Fit To Page */}
          <div className="sticky top-8 w-full min-w-0 flex-1" style={{ margin: 0, padding: 0 }}>
            {/* Hero Header Banner */}
            <header
              className={HERO_SECTION}
              style={{ marginTop: 0, padding: '20px 24px 18px', marginBottom: 24 }}
            >
              <h1 className={HERO_TITLE} style={{ marginBottom: 6 }}>
                RETROLUDO '42
              </h1>
              <p className={HERO_SUBTITLE}>
                {t('home.greeting', { name: displayName.toUpperCase() })} // PACE 24
              </p>

              <div className={BADGE_BAR} style={{ marginTop: 14, gap: 10 }}>
                <button
                  className={RETRO_BADGE}
                  style={{
                    cursor: 'pointer',
                    background: 'var(--bg-secondary)',
                    border: isPlayingAudio
                      ? '1px solid var(--accent-pink)'
                      : '1px dashed var(--accent-cyan)',
                    color: isPlayingAudio ? 'var(--accent-pink)' : 'var(--accent-cyan)',
                    fontFamily: 'var(--font-mono)',
                    outline: 'none',
                  }}
                  onClick={handleToggleAudio}
                  title={t('homeExtended.chiptuneToggleTitle')}
                >
                  {isPlayingAudio ? t('homeExtended.audioActive') : t('homeExtended.audioStandby')}
                </button>
                <span
                  className={RETRO_BADGE}
                  style={{
                    border: '1px solid var(--accent-cyan)',
                    color: 'var(--accent-cyan)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {t('homeExtended.onlinePlayers')} {onlineCount ?? '...'}
                </span>
              </div>
            </header>

            {/* Main Interactive Dashboard Grid */}
            <main className={`${DASHBOARD_GRID} dashboard-grid`}>
              {/* Widget 1: 3D Attract Mode Arcade Cabinet & Press Start */}
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
                            border: '4px solid #ffffff',
                            boxShadow: '0 0 35px #ffffff, 0 0 50px var(--accent-cyan)',
                          }
                        : undefined
                    }
                    onClick={launchToLobby}
                    title="Click or press Spacebar to enter Ludo Lobby"
                  >
                    <canvas id="arcadeCanvas" ref={canvasRef} width={720} height={400} />

                    {/* Interactive Translucent Press Start Banner Overlay */}
                    <div className={ARCADE_START_OVERLAY}>
                      <span className={ARCADE_START_TITLE}>
                        {theme === 'win95'
                          ? t('homeExtended.pressStartTitleWin95')
                          : theme === 'terminal'
                            ? t('homeExtended.pressStartTitleTerminal')
                            : t('homeExtended.pressStartTitleSynthwave')}
                      </span>
                      <span className={ARCADE_START_SUB}>
                        {theme === 'terminal'
                          ? t('homeExtended.pressStartSubTerminal')
                          : theme === 'win95'
                            ? t('homeExtended.pressStartSubWin95')
                            : t('homeExtended.pressStartSubSynthwave')}
                      </span>
                    </div>

                    {/* Hyperdrive Warp Flash on Launch */}
                    {isWarpingToLobby && (
                      <div
                        style={{
                          position: 'absolute',
                          inset: 0,
                          background: 'rgba(255, 255, 255, 0.85)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontFamily: 'var(--font-heading)',
                          fontSize: '1.2rem',
                          color: '#0d0221',
                          animation: 'pulse 0.2s infinite',
                        }}
                      >
                        {t('homeExtended.warpingToArena')}
                      </div>
                    )}
                  </div>
                </div>
              </section>

              {/* Widget 2: Friends List */}
              <section className={`${RETRO_WINDOW} ${COL_4}`} id="friendsWindow">
                <div className={WINDOW_HEADER}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>
                      {t('friends.title').toUpperCase()} ({friends?.length ?? 0})
                    </span>
                    {pendingRequestsCount > 0 && (
                      <button
                        style={{
                          background: 'var(--accent-pink)',
                          color: '#fff',
                          fontSize: '0.6rem',
                          padding: '2px 6px',
                          borderRadius: 3,
                          fontWeight: 'bold',
                          animation: 'pulse 1.5s infinite',
                          cursor: 'pointer',
                          border: 'none',
                          outline: 'none',
                          fontFamily: 'inherit',
                          display: 'inline-flex',
                          alignItems: 'center',
                          lineHeight: 1,
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          retroAudio.playUiBeep(650, 0.05);
                          navigate('/friends');
                        }}
                        title={`${pendingRequestsCount} pending friend request${pendingRequestsCount > 1 ? 's' : ''} - Click to review`}
                      >
                        {pendingRequestsCount} NEW
                      </button>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      className={RETRO_BTN}
                      onClick={() => {
                        retroAudio.playUiBeep(600, 0.05);
                        navigate('/friends');
                      }}
                      style={{
                        padding: '2px 8px',
                        fontSize: '0.65rem',
                        fontFamily: 'var(--font-display)',
                        fontWeight: 900,
                      }}
                    >
                      {t('homeExtended.manageBtn')}
                    </button>
                    <div className={WINDOW_CONTROLS}>
                      <span className={WINDOW_BTN_MIN} />
                      <span className={WINDOW_BTN_MAX} />
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    padding: '14px 16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    flex: 1,
                    overflowY: 'auto',
                    minHeight: 0,
                    maxHeight: 390,
                  }}
                >
                  {isFriendsLoading && friends === null ? (
                    <div
                      style={{
                        padding: 28,
                        textAlign: 'center',
                        color: 'var(--accent-yellow)',
                        fontSize: '0.82rem',
                        fontFamily: 'var(--font-display)',
                      }}
                    >
                      {t('homeExtended.scanningComms')}
                    </div>
                  ) : !friends || friends.length === 0 ? (
                    <div
                      style={{
                        padding: 28,
                        textAlign: 'center',
                        color: 'var(--text-muted)',
                        fontSize: '0.82rem',
                        fontFamily: 'var(--font-display)',
                      }}
                    >
                      {t('homeExtended.noFriendsLinked')}
                    </div>
                  ) : (
                    friends.map((f) => {
                      const fRank = leaderboardMap[f.username];
                      const fTier = getRankTier(f.rating ?? 1200, fRank);
                      const fStatus = STATUS_STYLE[f.status ?? 'offline'];

                      return (
                        <div
                          key={f.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '10px 14px',
                            borderRadius: 6,
                            background: 'rgba(10, 3, 26, 0.85)',
                            border: '1.5px solid rgba(0, 240, 255, 0.25)',
                            cursor: 'pointer',
                            transition: 'all 0.18s ease',
                            gap: 12,
                          }}
                          onClick={() => {
                            retroAudio.playUiBeep(640, 0.04);
                            navigate(`/profile?u=${encodeURIComponent(f.username)}`);
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(0, 240, 255, 0.16)';
                            e.currentTarget.style.borderColor = 'var(--accent-cyan)';
                            e.currentTarget.style.transform = 'translateX(2px)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'rgba(10, 3, 26, 0.85)';
                            e.currentTarget.style.borderColor = 'rgba(0, 240, 255, 0.25)';
                            e.currentTarget.style.transform = 'translateX(0)';
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 12,
                              minWidth: 0,
                              flex: 1,
                            }}
                          >
                            <div style={{ position: 'relative', flexShrink: 0 }}>
                              <div
                                style={{
                                  padding: 2,
                                  borderRadius: 5,
                                  background: `linear-gradient(135deg, ${fTier.color}, var(--accent-cyan))`,
                                  boxShadow: `0 0 8px ${fTier.glow}`,
                                }}
                              >
                                <UserAvatar
                                  username={f.username}
                                  userId={f.id}
                                  avatarStyle={f.avatarStyle}
                                  hasAvatarPhoto={f.hasAvatarPhoto}
                                  size={38}
                                  fallbackStyle={{
                                    width: 38,
                                    height: 38,
                                    borderRadius: 4,
                                    background: 'rgba(10, 2, 28, 0.95)',
                                    color: 'var(--accent-cyan)',
                                    display: 'grid',
                                    placeItems: 'center',
                                    fontWeight: 900,
                                    fontSize: '0.95rem',
                                  }}
                               />
                              </div>
                              <span
                                style={{
                                  position: 'absolute',
                                  right: -2,
                                  bottom: -2,
                                  width: 9,
                                  height: 9,
                                  borderRadius: '50%',
                                  background: fStatus.color,
                                  border: '2px solid #0d0221',
                                  boxShadow: `0 0 6px ${fStatus.color}`,
                                }}
                             />
                            </div>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  flexWrap: 'wrap',
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: '0.92rem',
                                    fontWeight: 900,
                                    color: '#ffffff',
                                    fontFamily: 'var(--font-display)',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    letterSpacing: '0.02em',
                                  }}
                                >
                                  {f.displayName ?? f.username}
                                </span>
                                <RankBadge tier={fTier} fontSize="9.5px" padding="2px 7px" />
                              </div>
                              <div
                                style={{
                                  fontSize: '0.68rem',
                                  color: fStatus.color,
                                  fontFamily: 'var(--font-display)',
                                  fontWeight: 'bold',
                                  marginTop: 2,
                                }}
                              >
                                ● {fStatus.label.toUpperCase()} // {t('homeExtended.alliedPilot')}
                              </div>
                            </div>
                          </div>

                          <div
                            style={{
                              textAlign: 'right',
                              flexShrink: 0,
                              display: 'flex',
                              alignItems: 'baseline',
                              gap: 4,
                            }}
                          >
                            <span
                              style={{
                                fontSize: '1.05rem',
                                fontWeight: 900,
                                color: '#ffffff',
                                fontFamily: 'var(--font-display)',
                                lineHeight: 1,
                              }}
                            >
                              {f.rating ?? 1200}
                            </span>
                            <span
                              style={{
                                fontSize: '0.64rem',
                                color: 'var(--accent-cyan)',
                                fontFamily: 'var(--font-display)',
                                fontWeight: 900,
                              }}
                            >
                              ELO
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </section>

              {/* Widget 3: Pilot Profile & Combat Stats */}
              <section className={`${RETRO_WINDOW} ${COL_8}`} id="pilotDossierWindow">
                <div className={WINDOW_HEADER}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span>{t('homeExtended.pilotProfileTitle')}</span>
                  </div>
                  <div className={WINDOW_CONTROLS}>
                    <span className={WINDOW_BTN_MIN} />
                    <span className={WINDOW_BTN_MAX} />
                  </div>
                </div>
                <div
                  className={WINDOW_BODY}
                  style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
                >
                  {/* Top Row: Pilot Profile Identity Header */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 16px',
                      background: 'rgba(0, 0, 0, 0.45)',
                      border: '1px solid var(--accent-cyan)',
                      borderRadius: 4,
                      flexWrap: 'wrap',
                      gap: 12,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      <UserAvatar
                        username={username}
                        userId={user?.id}
                        avatarStyle={user?.avatarStyle}
                        hasAvatarPhoto={user?.hasAvatarPhoto ?? false}
                        size={48}
                     />
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span
                            style={{
                              fontFamily: 'var(--font-heading)',
                              fontSize: '1rem',
                              color: '#ffffff',
                              letterSpacing: 1,
                            }}
                          >
                            {displayName.toUpperCase()}
                          </span>
                          <RankBadge
                            tier={getRankTier(stats?.rating ?? 1200, leaderboardRank)}
                            fontSize="0.75rem"
                            padding="3px 10px"
                         />
                        </div>
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.78rem',
                            color: 'var(--text-muted)',
                          }}
                        >
                          {t('homeExtended.callsign')}: {displayName.toUpperCase()} //{' '}
                          {t('homeExtended.rankedCombatant')}
                        </span>
                      </div>
                    </div>

                    <button
                      className={RETRO_BTN}
                      style={{
                        padding: '6px 14px',
                        fontSize: '0.72rem',
                        fontFamily: 'var(--font-display)',
                        fontWeight: 900,
                      }}
                      onClick={() => {
                        retroAudio.playUiBeep(600, 0.05);
                        navigate('/profile');
                      }}
                    >
                      {t('homeExtended.fullProfileBtn')}
                    </button>
                  </div>

                  {/* Bottom Row: 4 Retro Stat Metrics */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                      gap: 12,
                    }}
                  >
                    {/* Stat 1: Total Battles */}
                    <div
                      style={{
                        padding: '12px 14px',
                        background: 'rgba(25, 10, 56, 0.5)',
                        border: '1px solid rgba(0, 240, 255, 0.3)',
                        borderRadius: 4,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                      }}
                    >
                      <span
                        style={{
                          fontSize: '0.68rem',
                          color: 'var(--text-muted)',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {t('homeExtended.totalMatches')}
                      </span>
                      <span
                        style={{
                          fontFamily: 'var(--font-heading)',
                          fontSize: '1.2rem',
                          color: 'var(--accent-cyan)',
                        }}
                      >
                        {isStatsLoading ? '...' : stats ? stats.totalGames : 0}
                      </span>
                    </div>

                    {/* Stat 2: Victories & Defeats */}
                    <div
                      style={{
                        padding: '12px 14px',
                        background: 'rgba(25, 10, 56, 0.5)',
                        border: '1px solid rgba(255, 0, 127, 0.3)',
                        borderRadius: 4,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                      }}
                    >
                      <span
                        style={{
                          fontSize: '0.68rem',
                          color: 'var(--text-muted)',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {t('homeExtended.victoriesDefeats')}
                      </span>
                      <span
                        style={{
                          fontFamily: 'var(--font-heading)',
                          fontSize: '1.1rem',
                          color: 'var(--accent-pink)',
                        }}
                      >
                        {isStatsLoading
                          ? '...'
                          : stats
                            ? `${stats.wins}W / ${stats.losses}L`
                            : '0W / 0L'}
                      </span>
                    </div>

                    {/* Stat 3: Win Rate */}
                    <div
                      style={{
                        padding: '12px 14px',
                        background: 'rgba(25, 10, 56, 0.5)',
                        border: '1px solid rgba(255, 230, 0, 0.3)',
                        borderRadius: 4,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                      }}
                    >
                      <span
                        style={{
                          fontSize: '0.68rem',
                          color: 'var(--text-muted)',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {t('homeExtended.winRatio')}
                      </span>
                      <span
                        style={{
                          fontFamily: 'var(--font-heading)',
                          fontSize: '1.2rem',
                          color: 'var(--accent-yellow)',
                        }}
                      >
                        {isStatsLoading
                          ? '...'
                          : stats && stats.totalGames > 0
                            ? `${Math.round((stats.wins / stats.totalGames) * 100)}%`
                            : '0%'}
                      </span>
                    </div>

                    {/* Stat 4: Dynamic Tier ELO Rating (Clickable -> Leaderboard) */}
                    {(() => {
                      const currentRating = stats?.rating ?? 1200;
                      const tier = getRankTier(currentRating, leaderboardRank);

                      return (
                        <div
                          onClick={() => {
                            retroAudio.playUiBeep(720, 0.05);
                            navigate('/leaderboard');
                          }}
                          title="Click to view Global Leaderboard Ladder"
                          style={{
                            padding: '12px 14px',
                            background: 'rgba(25, 10, 56, 0.5)',
                            border: `1px solid ${tier.border}`,
                            borderRadius: 4,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 4,
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = tier.bg;
                            e.currentTarget.style.borderColor = tier.color;
                            e.currentTarget.style.boxShadow = `0 0 14px ${tier.glow}`;
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'rgba(25, 10, 56, 0.5)';
                            e.currentTarget.style.borderColor = tier.border;
                            e.currentTarget.style.boxShadow = 'none';
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                            }}
                          >
                            <span
                              style={{
                                fontSize: '0.68rem',
                                color: 'var(--text-muted)',
                                fontFamily: 'var(--font-mono)',
                              }}
                            >
                              {t('homeExtended.eloRating')}
                            </span>
                            <span
                              style={{
                                fontSize: '0.62rem',
                                color: tier.color,
                                fontFamily: 'var(--font-mono)',
                                fontWeight: 'bold',
                              }}
                            >
                              {tier.badge}
                            </span>
                          </div>
                          <span
                            style={{
                              fontFamily: 'var(--font-heading)',
                              fontSize: '1.2rem',
                              color: tier.color,
                              textShadow: `0 0 10px ${tier.glow}`,
                            }}
                          >
                            {isStatsLoading ? '...' : currentRating}
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </section>

              {/* Widget 4: Cyber Sound Deck & Cassette Synthesizer */}
              <section className={`${RETRO_WINDOW} ${COL_4}`} id="cyberSoundDeckWindow">
                <div className={WINDOW_HEADER}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>{t('homeExtended.chiptuneDeckTitle')}</span>
                    <span
                      style={{
                        fontSize: '0.62rem',
                        padding: '2px 6px',
                        borderRadius: 3,
                        background: isPlayingAudio
                          ? 'rgba(0, 240, 255, 0.2)'
                          : 'rgba(255, 255, 255, 0.08)',
                        border: isPlayingAudio
                          ? '1px solid var(--accent-cyan)'
                          : '1px solid rgba(255, 255, 255, 0.15)',
                        color: isPlayingAudio ? 'var(--accent-cyan)' : 'var(--text-muted)',
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 'bold',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: isPlayingAudio ? 'var(--accent-cyan)' : 'var(--text-muted)',
                          boxShadow: isPlayingAudio ? '0 0 6px var(--accent-cyan)' : 'none',
                        }}
                     />
                      {isPlayingAudio
                        ? t('homeExtended.chiptuneLiveStereo')
                        : t('homeExtended.chiptuneStandby')}
                    </span>
                  </div>
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
                    gap: 8,
                    justifyContent: 'space-between',
                  }}
                >
                  {/* Cyber Cassette Chassis */}
                  <div className={CYBER_CASSETTE_CHASSIS}>
                    {/* OLED Track HUD Display */}
                    <div className={OLED_SCREEN}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                      >
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.6rem',
                            color: 'var(--accent-pink)',
                            fontWeight: 'bold',
                          }}
                        >
                          {t('homeExtended.chiptuneTrackLabel')} 0{audioTrackIndex + 1} / 0
                          {retroAudio.tracks.length}
                        </span>
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.6rem',
                            color: isPlayingAudio ? 'var(--accent-cyan)' : 'var(--text-muted)',
                          }}
                        >
                          {isPlayingAudio
                            ? t('homeExtended.chiptunePlaying')
                            : t('homeExtended.chiptuneIdle')}
                        </span>
                      </div>
                      <div className={OLED_TITLE}>
                        {retroAudio.tracks[audioTrackIndex]?.name || "SYNTHWAVE NIGHTS '84"}
                      </div>
                      <div className={OLED_META}>
                        <span>{retroAudio.tracks[audioTrackIndex]?.tempo || 120} BPM // A-MIN</span>
                        <span>CHIPTUNE · 44.1kHz</span>
                      </div>
                    </div>

                    {/* Multi-Band Stereo Spectrum Equalizer */}
                    <div className={CYBER_EQ_DECK}>
                      {eqHeights.map((h, i) => (
                        <div key={i} className={CYBER_EQ_COL} style={{ height: `${h}px` }} />
                      ))}
                    </div>
                  </div>

                  {/* Primary Cyber Transport Hardware Cluster */}
                  <div className={CYBER_TRANSPORT_CLUSTER}>
                    <button
                      type="button"
                      className={CYBER_DECK_KEY}
                      onClick={handlePrevTrack}
                      title={t('homeExtended.chiptunePrevTrackTitle')}
                    >
                      <span className={CYBER_KEY_ICON} style={{ color: 'var(--accent-cyan)' }}>
                        ⏮
                      </span>
                      <span className={CYBER_KEY_LABEL}>{t('homeExtended.chiptunePrev')}</span>
                      <span className={CYBER_KEY_SUB}>{t('homeExtended.chiptuneRwTrack')}</span>
                    </button>

                    <button
                      type="button"
                      className={`${CYBER_DECK_KEY} ${CYBER_DECK_KEY_PLAY} ${isPlayingAudio ? CYBER_DECK_KEY_PLAY_ACTIVE : ''}`}
                      onClick={handleToggleAudio}
                      title={
                        isPlayingAudio
                          ? t('homeExtended.chiptunePauseAudio')
                          : t('homeExtended.chiptunePlayAudio')
                      }
                    >
                      <span
                        className={CYBER_KEY_ICON}
                        style={{ color: isPlayingAudio ? '#ffffff' : 'var(--accent-pink)' }}
                      >
                        {isPlayingAudio ? '⏸' : '▶'}
                      </span>
                      <span
                        className={CYBER_KEY_LABEL}
                        style={{ color: '#ffffff', fontSize: '0.64rem' }}
                      >
                        {isPlayingAudio
                          ? t('homeExtended.chiptunePause')
                          : t('homeExtended.chiptunePlaySynth')}
                      </span>
                      <span
                        className={CYBER_KEY_SUB}
                        style={{
                          color: isPlayingAudio ? 'var(--accent-yellow)' : 'var(--accent-cyan)',
                        }}
                      >
                        {isPlayingAudio
                          ? t('homeExtended.chiptuneLiveAudio')
                          : `○ ${t('homeExtended.chiptuneStandby')}`}
                      </span>
                    </button>

                    <button
                      type="button"
                      className={CYBER_DECK_KEY}
                      onClick={handleNextTrack}
                      title={t('homeExtended.chiptuneNextTrackTitle')}
                    >
                      <span className={CYBER_KEY_ICON} style={{ color: 'var(--accent-cyan)' }}>
                        ⏭
                      </span>
                      <span className={CYBER_KEY_LABEL}>{t('homeExtended.chiptuneNext')}</span>
                      <span className={CYBER_KEY_SUB}>{t('homeExtended.chiptuneFfTrack')}</span>
                    </button>
                  </div>

                  {/* Cyber Master Volume Console & 10-Segment LED Meter */}
                  <div className={CYBER_VOL_CONSOLE}>
                    <div className={CYBER_FADER_TRACK_ROW}>
                      <button
                        type="button"
                        className={CYBER_VOL_STEP_BTN}
                        onClick={() => {
                          handleStepVolume(-10);
                        }}
                        title={t('homeExtended.chiptuneDecreaseVolume')}
                      >
                        -
                      </button>

                      {/* 10 Interactive LED Bar Segments */}
                      <div
                        className={CYBER_VOL_LED_BAR}
                        title={t('homeExtended.chiptuneVolume', { volume: audioVolume })}
                      >
                        {Array.from({ length: 10 }).map((_, idx) => {
                          const isLit = audioVolume >= (idx + 1) * 10 - 5;
                          const colorClass =
                            idx < 5 ? LED_LIT_CYAN : idx < 8 ? LED_LIT_AMBER : LED_LIT_PINK;
                          return (
                            <div
                              key={idx}
                              className={`${CYBER_VOL_LED_SEGMENT} ${isLit ? colorClass : ''}`}
                              onClick={() => {
                                handleLedSegmentClick(idx);
                              }}
                           />
                          );
                        })}
                      </div>

                      <button
                        type="button"
                        className={CYBER_VOL_STEP_BTN}
                        onClick={() => {
                          handleStepVolume(10);
                        }}
                        title={t('homeExtended.chiptuneIncreaseVolume')}
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            </main>

            {/* Footer */}
            <footer className={RETRO_FOOTER}>
              <p>
                © 1942-2026 RETROLUDO '42 // 42KL // ALL RIGHTS RESERVED // WEB AUDIO & CANV-ARCADE
              </p>
              <div
                style={{
                  display: 'flex',
                  gap: 14,
                  justifyContent: 'center',
                  alignItems: 'center',
                  marginTop: 8,
                  fontSize: '0.74rem',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    retroAudio.playUiBeep(640, 0.05);
                    setLegalModalDoc('privacy');
                  }}
                  style={{
                    color: 'var(--accent-cyan)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    padding: 0,
                  }}
                >
                  {t('legal.privacyPolicy', 'PRIVACY POLICY')}
                </button>
                <span style={{ color: 'var(--text-muted)' }}>//</span>
                <button
                  type="button"
                  onClick={() => {
                    retroAudio.playUiBeep(640, 0.05);
                    setLegalModalDoc('terms');
                  }}
                  style={{
                    color: 'var(--accent-cyan)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    padding: 0,
                  }}
                >
                  {t('legal.termsOfService', 'TERMS OF SERVICE')}
                </button>
              </div>
            </footer>
          </div>
        </div>
      </div>

      <LegalModal
        isOpen={legalModalDoc !== null}
        initialDoc={legalModalDoc ?? 'privacy'}
        onClose={() => {
          setLegalModalDoc(null);
        }}
     />
    </>
  );
}
