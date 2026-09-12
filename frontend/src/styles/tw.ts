// Shared Tailwind utility strings for classes reused across components; each
// constant is the utility equivalent of the CSS rule it replaced. Rationale
// and per-constant notes: docs/frontend/frontend-components-system.md.

export const RETRO_BTN =
  'inline-flex items-center gap-1.5 px-4 py-2.5 uppercase cursor-pointer outline-none text-[0.7rem] text-[var(--text-main)] bg-[var(--btn-bg)] border-2 border-[var(--accent-cyan)] shadow-[var(--box-shadow)] [font-family:var(--font-heading)] [transition:all_0.2s_ease] hover:-translate-y-0.5 hover:shadow-[var(--btn-hover-shadow)] active:translate-y-px';

// Consumers set inline bg/border/shadow, so the theme variants need `!`. Only
// the `.retro-floating-dock`-scoped theme rules were reachable; `active` stays
// a literal class so `&.active` can still target it.
export const THEME_TRIGGER_BTN_BASE =
  "font-['Press_Start_2P',cursive] text-[0.65rem] h-[38px] w-[125px] px-2.5 box-border inline-flex items-center justify-between rounded gap-1 relative shrink-0 cursor-pointer outline-none [transition:background_0.2s_ease,border-color_0.2s_ease,box-shadow_0.2s_ease,color_0.2s_ease] [[data-theme=win95]_&]:!bg-[#c0c0c0] [[data-theme=win95]_&]:!border-t-2 [[data-theme=win95]_&]:!border-t-white [[data-theme=win95]_&]:!border-l-2 [[data-theme=win95]_&]:!border-l-white [[data-theme=win95]_&]:!border-r-2 [[data-theme=win95]_&]:!border-r-black [[data-theme=win95]_&]:!border-b-2 [[data-theme=win95]_&]:!border-b-black [[data-theme=win95]_&]:!rounded-none [[data-theme=win95]_&]:!text-black [[data-theme=win95]_&]:!shadow-[1px_1px_0px_#000] [[data-theme=win95]_&.active]:!bg-[#000080] [[data-theme=win95]_&.active]:!text-white [[data-theme=win95]_&.active]:!border-t-black [[data-theme=win95]_&.active]:!border-l-black [[data-theme=win95]_&.active]:!border-r-white [[data-theme=win95]_&.active]:!border-b-white [[data-theme=win95]_&.active]:!shadow-[inset_1px_1px_0px_#000] [[data-theme=terminal]_&]:!bg-[#0a1f0a] [[data-theme=terminal]_&]:!border [[data-theme=terminal]_&]:!border-[rgba(51,255,51,.4)] [[data-theme=terminal]_&]:!rounded [[data-theme=terminal]_&]:!text-[#33ff33] [[data-theme=terminal]_&.active]:!bg-[#116611] [[data-theme=terminal]_&.active]:!border-[#33ff33] [[data-theme=terminal]_&.active]:!text-white [[data-theme=terminal]_&.active]:!shadow-[0_0_12px_#33ff33,inset_0_0_8px_#33ff33]";

// `--fs-*` vars cover the colours; win95/terminal radius/shadow/blur need `!`
// variants. Open state uses the *_HIDDEN/_ACTIVE_* classes; keyframes stay in
// retrowave.css.
export const THEME_POPOVER_MENU_BASE =
  'absolute top-[calc(100%+10px)] right-0 z-[10001] bg-[var(--fs-bg)] border-2 border-[var(--fs-border)] shadow-[0_14px_40px_rgba(0,0,0,.9),0_0_25px_var(--fs-glow)] p-2.5 rounded-md min-w-[240px] [transform-origin:top_right] backdrop-blur-[10px] [[data-theme=win95]_&]:!bg-[#c0c0c0] [[data-theme=win95]_&]:!border-t-2 [[data-theme=win95]_&]:!border-t-white [[data-theme=win95]_&]:!border-l-2 [[data-theme=win95]_&]:!border-l-white [[data-theme=win95]_&]:!border-r-2 [[data-theme=win95]_&]:!border-r-black [[data-theme=win95]_&]:!border-b-2 [[data-theme=win95]_&]:!border-b-black [[data-theme=win95]_&]:!rounded-none [[data-theme=win95]_&]:!shadow-[3px_3px_0px_#000] [[data-theme=win95]_&]:!text-black [[data-theme=win95]_&]:!backdrop-blur-none [[data-theme=terminal]_&]:!bg-[rgba(5,16,5,.98)] [[data-theme=terminal]_&]:!border-[1.5px] [[data-theme=terminal]_&]:!border-[#33ff33] [[data-theme=terminal]_&]:!shadow-[0_0_25px_rgba(51,255,51,.35)] [[data-theme=terminal]_&]:!rounded-[4px] [[data-theme=terminal]_&]:!text-[#33ff33]';

export const THEME_POPOVER_MENU_HIDDEN = 'hidden';

export const THEME_POPOVER_MENU_ACTIVE_DOWN =
  'block [animation:popover-slide-down_0.3s_cubic-bezier(.175,.885,.32,1.275)_forwards]';

export const THEME_POPOVER_MENU_ACTIVE_UP =
  'block [animation:popover-slide-up_0.3s_cubic-bezier(.175,.885,.32,1.275)_forwards]';

// RetroNavbar's `#mainNav` — no inline bg/border/shadow here, so no `!` is
// needed (the arbitrary variants' higher specificity wins).
export const RETRO_FLOATING_DOCK =
  'relative z-[9999] flex justify-between items-center px-5 py-2.5 min-h-14 bg-(--bg-card) [border:var(--card-border-style)] shadow-(--box-shadow) backdrop-blur-[10px] m-0 rounded-md box-border [[data-theme=win95]_&]:bg-[#c0c0c0] [[data-theme=win95]_&]:border-t-2 [[data-theme=win95]_&]:border-t-white [[data-theme=win95]_&]:border-l-2 [[data-theme=win95]_&]:border-l-white [[data-theme=win95]_&]:border-r-2 [[data-theme=win95]_&]:border-r-black [[data-theme=win95]_&]:border-b-2 [[data-theme=win95]_&]:border-b-black [[data-theme=win95]_&]:rounded-none [[data-theme=win95]_&]:shadow-[3px_3px_0px_#000,inset_1px_1px_0px_#dfdfdf] [[data-theme=win95]_&]:backdrop-blur-none [[data-theme=win95]_&]:text-black [[data-theme=terminal]_&]:bg-[rgba(5,16,5,.95)] [[data-theme=terminal]_&]:border-[1.5px] [[data-theme=terminal]_&]:border-[#33ff33] [[data-theme=terminal]_&]:shadow-[0_0_25px_rgba(51,255,51,.3),inset_0_0_15px_rgba(51,255,51,.15)] [[data-theme=terminal]_&]:rounded [[data-theme=terminal]_&]:[backdrop-filter:blur(12px)] [[data-theme=terminal]_&]:text-[#33ff33]';

// Auth form element styles (Login/Signup/ForgotPassword/ResetPassword/
// TwoFactor). Not theme-scoped anywhere in retrowave.css — these pages
// only ever render in the default synthwave look.
export const RETRO_AUTH_TITLE =
  "font-['Orbitron',sans-serif] font-black tracking-[2.5px] text-4xl leading-[1.1] bg-[linear-gradient(135deg,#00f0ff_0%,#ff007f_50%,#9d00ff_100%)] bg-clip-text text-transparent";

export const RETRO_AUTH_SUBTITLE =
  "text-[rgba(184,166,228,.8)] text-base mt-2.5 font-['Share_Tech_Mono',monospace]";

export const RETRO_AUTH_LABEL =
  "font-['Orbitron',sans-serif] text-xs font-bold tracking-[1.5px] text-[rgba(0,240,255,.75)] uppercase";

export const RETRO_AUTH_INPUT =
  "w-full [border:1.5px_solid_rgba(0,240,255,.28)] rounded-[11px] py-4 px-[18px] [font:500_16.5px_'Share_Tech_Mono',monospace] text-white bg-[rgba(0,0,0,.45)] outline-none [transition:all_0.2s_ease] box-border placeholder:text-[rgba(184,166,228,.35)] focus:border-[#00f0ff] focus:shadow-[0_0_18px_rgba(0,240,255,.35),inset_0_0_8px_rgba(0,240,255,.1)] focus:bg-[rgba(0,0,0,.6)]";

export const RETRO_AUTH_BTN =
  "border-0 rounded-xl py-[17px] px-[22px] [font:900_16px_'Orbitron',sans-serif] tracking-[1.8px] text-white cursor-pointer bg-[linear-gradient(135deg,#ff007f,#9d00ff)] shadow-[0_0_22px_rgba(255,0,127,.4),0_8px_26px_rgba(157,0,255,.35)] [transition:all_0.22s_ease] uppercase hover:-translate-y-px hover:shadow-[0_0_32px_rgba(255,0,127,.65),0_12px_34px_rgba(157,0,255,.45),0_0_65px_rgba(0,240,255,.2)] active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:translate-y-0";

export const RETRO_AUTH_BTN_OUTLINE =
  "[border:1.5px_solid_rgba(0,240,255,.3)] rounded-[11px] py-[15px] px-[18px] [font:700_14.5px_'Share_Tech_Mono',monospace] text-[rgba(255,255,255,.88)] cursor-pointer bg-[rgba(0,240,255,.06)] [transition:all_0.2s_ease] flex items-center justify-center gap-2.5 hover:border-[#00f0ff] hover:bg-[rgba(0,240,255,.15)] hover:shadow-[0_0_16px_rgba(0,240,255,.3)] hover:text-white";

export const RETRO_AUTH_DIVIDER =
  "flex items-center gap-3.5 text-[rgba(184,166,228,.45)] [font:700_11px_'Orbitron',sans-serif] tracking-[2px]";

export const RETRO_AUTH_DIVIDER_LINE =
  'flex-1 h-px bg-[linear-gradient(90deg,transparent,rgba(0,240,255,.2),transparent)]';

export const RETRO_AUTH_LINK =
  'text-[#00f0ff] cursor-pointer font-bold no-underline [transition:color_0.18s_ease,text-shadow_0.18s_ease] hover:text-[#ff007f] hover:[text-shadow:0_0_10px_rgba(255,0,127,.5)]';

export const RETRO_AUTH_ERROR =
  "text-[#ff4081] text-[13px] leading-[1.4] font-['Share_Tech_Mono',monospace] py-2 px-3 rounded-lg bg-[rgba(255,0,127,.08)] border border-[rgba(255,0,127,.2)]";

export const RETRO_AUTH_SUCCESS =
  "text-[#33ff88] text-[13px] leading-[1.4] font-['Share_Tech_Mono',monospace] py-2 px-3 rounded-lg bg-[rgba(51,255,136,.08)] border border-[rgba(51,255,136,.2)]";

export const RETRO_AUTH_MUTED =
  "text-[rgba(184,166,228,.6)] text-[13px] font-['Share_Tech_Mono',monospace]";

// Shared "page shell" for 7 pages: fully custom-property driven, so it needs
// no theme-aware logic here.
export const PAGE_SHELL = 'relative z-10 min-h-screen';

// Animated synthwave grid + sun (RetroAuthLayout + dashboard pages); the theme
// `display:none` rules become `&` variants, keyframes stay in retrowave.css.
export const GRID_BACKGROUND =
  'fixed top-0 left-0 w-screen h-screen z-0 pointer-events-none overflow-hidden';

export const SYNTHWAVE_SUN =
  'absolute top-[15%] left-1/2 -translate-x-1/2 w-60 h-60 rounded-full bg-[linear-gradient(to_bottom,#ffe600_0%,#ff007f_70%,#9d00ff_100%)] shadow-[0_0_60px_#ff007f,0_0_100px_#ffe600] z-[1] opacity-[0.85] transition-opacity duration-500 [[data-theme=win95]_&]:hidden [[data-theme=terminal]_&]:hidden';

export const PERSPECTIVE_GRID =
  'absolute top-[55%] -left-1/2 w-[200%] h-[55vh] bg-[linear-gradient(0deg,transparent_24%,var(--grid-line-color)_25%,var(--grid-line-color)_26%,transparent_27%,transparent_74%,var(--grid-line-color)_75%,var(--grid-line-color)_76%,transparent_77%),linear-gradient(90deg,transparent_24%,var(--grid-line-color)_25%,var(--grid-line-color)_26%,transparent_27%,transparent_74%,var(--grid-line-color)_75%,var(--grid-line-color)_76%,transparent_77%)] bg-[length:50px_50px] [transform-origin:50%_0%] [transform:perspective(220px)_rotateX(65deg)] [animation:grid-scroll_3.5s_linear_infinite] z-[2] [[data-theme=win95]_&]:hidden';

export const GRID_HORIZON =
  'absolute top-[55%] left-0 w-full h-0.5 bg-(--accent-cyan) shadow-[0_0_15px_var(--accent-cyan)] z-[3] [[data-theme=win95]_&]:hidden';

export const APP_WRAPPER =
  'max-w-[calc(100vw-335px)] w-[calc(100%-325px)] ml-[310px] mr-auto p-[14px_20px_20px] relative z-10 box-border';

export const HERO_SECTION =
  'text-center p-[18px_20px_16px] bg-(--bg-card) [border:var(--card-border-style)] shadow-(--box-shadow) mb-[18px] relative overflow-hidden rounded';

export const HERO_TITLE =
  '[font-family:var(--font-heading)] text-[2.2rem] leading-[1.25] text-white [text-shadow:3px_3px_0_var(--accent-pink),-2px_-2px_0_var(--accent-cyan),0_0_22px_rgba(255,0,127,.85)] mb-2 tracking-[2px]';

export const HERO_SUBTITLE =
  '[font-family:var(--font-display)] text-[1.35rem] text-(--accent-yellow) [text-shadow:0_0_12px_var(--accent-yellow)] mb-0';

export const BADGE_BAR = 'flex justify-center gap-2.5 flex-wrap mt-2';

export const RETRO_BADGE =
  'bg-(--bg-secondary) border border-dashed border-(--accent-cyan) py-1 px-2.5 text-[0.74rem] text-(--accent-cyan)';

export const RETRO_WINDOW =
  'bg-(--bg-card) [border:var(--card-border-style)] shadow-(--box-shadow) rounded overflow-hidden flex flex-col [[data-theme=win95]_&]:bg-[#c0c0c0] [[data-theme=win95]_&]:border-t-2 [[data-theme=win95]_&]:border-t-white [[data-theme=win95]_&]:border-l-2 [[data-theme=win95]_&]:border-l-white [[data-theme=win95]_&]:border-r-2 [[data-theme=win95]_&]:border-r-black [[data-theme=win95]_&]:border-b-2 [[data-theme=win95]_&]:border-b-black [[data-theme=win95]_&]:shadow-[2px_2px_0px_#000] [[data-theme=win95]_&]:rounded-none [[data-theme=win95]_&]:text-black [[data-theme=terminal]_&]:bg-[rgba(10,31,10,.95)] [[data-theme=terminal]_&]:border-[1.5px] [[data-theme=terminal]_&]:border-[#33ff33] [[data-theme=terminal]_&]:shadow-[0_0_18px_rgba(51,255,51,.25)] [[data-theme=terminal]_&]:text-[#33ff33]';

// Theme reskin restored for all pages; `!` is required to tie-break against
// GAME_WINDOW_HEADER_EXTRA on Game.tsx.
export const WINDOW_HEADER =
  'bg-(--window-header-bg) text-(--window-header-text) py-2 px-3.5 [font-family:var(--font-heading)] text-[0.75rem] flex justify-between items-center select-none [[data-theme=win95]_&]:![background:linear-gradient(90deg,#000080,#1084d0)] [[data-theme=win95]_&]:!text-white [[data-theme=win95]_&]:py-1.5 [[data-theme=win95]_&]:px-2.5 [[data-theme=win95]_&]:rounded-none [[data-theme=terminal]_&]:!bg-[#116611] [[data-theme=terminal]_&]:!text-[#33ff33] [[data-theme=terminal]_&]:border-b [[data-theme=terminal]_&]:border-[#33ff33]';

// Game.tsx-only header look; `!` lets it beat WINDOW_HEADER's default while
// WINDOW_HEADER's `!`-marked theme variants still win on win95/terminal.
export const GAME_WINDOW_HEADER_EXTRA = '!bg-[#140a35] border-b-2 border-b-[#2121ff] !text-white';

export const WINDOW_BODY = 'p-5 grow';

export const WINDOW_CONTROLS = 'flex gap-1.5';

export const WINDOW_BTN_MIN =
  'w-3.5 h-3.5 rounded-xs border border-black/40 cursor-pointer bg-[#ffbd2e]';

export const WINDOW_BTN_MAX =
  'w-3.5 h-3.5 rounded-xs border border-black/40 cursor-pointer bg-[#27c93f]';

// Leaderboard.tsx #1 podium card glow. Single-use, not theme-scoped.
export const APEX_CHAMPION_CARD =
  'scale-[1.02] shadow-[0_0_28px_rgba(255,23,68,.55),0_0_45px_rgba(255,215,0,.25),inset_0_0_16px_rgba(255,215,0,.15)] animate-none';

// Shared by Home/LudoLobby/Lobby/Game. Not theme-scoped.
export const DASHBOARD_GRID = 'grid grid-cols-12 gap-[25px] mb-[30px]';

// Merged effective values from two cascading win95/terminal override blocks in
// the old CSS (per property, later block wins) — not a copy of either.
export const RETRO_TICKET_PASS =
  'relative flex items-center justify-between rounded-xl py-[26px] px-8 min-h-[108px] gap-6 flex-wrap box-border cursor-pointer select-none [transition:transform_0.22s_cubic-bezier(.16,1,.3,1),box-shadow_0.22s_cubic-bezier(.16,1,.3,1),border-color_0.22s_ease,background_0.22s_ease] hover:-translate-y-1 active:translate-y-px [[data-theme=win95]_&]:bg-[#c0c0c0] [[data-theme=win95]_&]:border-2 [[data-theme=win95]_&]:border-white [[data-theme=win95]_&]:shadow-[inset_2px_2px_0_#fff,inset_-2px_-2px_0_#000,3px_3px_0_#000] [[data-theme=win95]_&]:rounded-none [[data-theme=win95]_&]:text-black [[data-theme=terminal]_&]:bg-none [[data-theme=terminal]_&]:bg-[rgba(10,31,10,.96)] [[data-theme=terminal]_&]:border-2 [[data-theme=terminal]_&]:border-[#33ff33] [[data-theme=terminal]_&]:shadow-[0_0_16px_rgba(51,255,51,.25)] [[data-theme=terminal]_&]:rounded-[4px] [[data-theme=terminal]_&]:text-[#33ff33]';

export const TICKET_PINK =
  'bg-[linear-gradient(90deg,rgba(255,0,127,.22)_0%,rgba(20,6,42,.96)_100%)] border-2 border-[#ff007f] shadow-[0_4px_20px_rgba(0,0,0,.6),0_0_16px_rgba(255,0,127,.25)] hover:border-[#ff3399] hover:bg-[linear-gradient(90deg,rgba(255,0,127,.32)_0%,rgba(30,8,55,.98)_100%)] hover:shadow-[0_8px_30px_rgba(0,0,0,.75),0_0_28px_rgba(255,0,127,.55),inset_0_0_16px_rgba(255,0,127,.2)]';

export const TICKET_YELLOW =
  'bg-[linear-gradient(90deg,rgba(255,230,0,.2)_0%,rgba(20,6,42,.96)_100%)] border-2 border-[#ffe600] shadow-[0_4px_20px_rgba(0,0,0,.6),0_0_16px_rgba(255,230,0,.22)] hover:border-[#ffff33] hover:bg-[linear-gradient(90deg,rgba(255,230,0,.3)_0%,rgba(30,8,55,.98)_100%)] hover:shadow-[0_8px_30px_rgba(0,0,0,.75),0_0_28px_rgba(255,230,0,.5),inset_0_0_16px_rgba(255,230,0,.18)]';

export const TICKET_GREEN =
  'bg-[linear-gradient(90deg,rgba(0,255,136,.2)_0%,rgba(20,6,42,.96)_100%)] border-2 border-[#00ff88] shadow-[0_4px_20px_rgba(0,0,0,.6),0_0_16px_rgba(0,255,136,.22)] hover:border-[#33ffaa] hover:bg-[linear-gradient(90deg,rgba(0,255,136,.3)_0%,rgba(30,8,55,.98)_100%)] hover:shadow-[0_8px_30px_rgba(0,0,0,.75),0_0_28px_rgba(0,255,136,.5),inset_0_0_16px_rgba(0,255,136,.18)]';

export const TICKET_CYAN =
  'bg-[linear-gradient(90deg,rgba(0,240,255,.2)_0%,rgba(20,6,42,.96)_100%)] border-2 border-(--accent-cyan) shadow-[0_4px_20px_rgba(0,0,0,.6),0_0_16px_rgba(0,240,255,.22)] hover:border-[#33f6ff] hover:bg-[linear-gradient(90deg,rgba(0,240,255,.3)_0%,rgba(30,8,55,.98)_100%)] hover:shadow-[0_8px_30px_rgba(0,0,0,.75),0_0_28px_rgba(0,240,255,.5),inset_0_0_16px_rgba(0,240,255,.18)]';

export const TICKET_ACTION_PILL =
  'inline-flex items-center justify-center py-3 px-6 rounded-md [font-family:var(--font-heading)] text-[0.9rem] font-black tracking-[1px] [transition:all_0.2s_ease] pointer-events-none shrink-0 [[data-theme=win95]_&]:bg-[#000080] [[data-theme=win95]_&]:text-white [[data-theme=win95]_&]:[border:2px_outset_#fff] [[data-theme=win95]_&]:rounded-none [[data-theme=win95]_&]:shadow-[1px_1px_0px_#000] [[data-theme=terminal]_&]:bg-[#116611] [[data-theme=terminal]_&]:text-[#33ff33] [[data-theme=terminal]_&]:border [[data-theme=terminal]_&]:border-[#33ff33] [[data-theme=terminal]_&]:shadow-[0_0_12px_rgba(51,255,51,.4)]';

// Home.tsx arcade cabinet + grid columns + footer.
export const ARCADE_CONTAINER = 'flex flex-col items-center gap-[15px]';

export const ARCADE_SCREEN_FRAME =
  'bg-black p-0 border-4 border-[#333333] shadow-[inset_0_0_20px_#000000,0_0_15px_var(--accent-cyan)] relative overflow-hidden w-full h-full cursor-pointer [transition:all_0.2s_ease]';

// win95 swaps the pulse animation off; terminal swaps it for its own
// `terminal-start-pulse` keyframe (still defined in retrowave.css, applied
// here via arbitrary `animation:` value — same approach as PERSPECTIVE_GRID).
export const ARCADE_START_OVERLAY =
  'absolute bottom-6 left-1/2 -translate-x-1/2 w-[82%] max-w-[580px] bg-[rgba(13,2,33,.45)] backdrop-blur-[8px] border-2 border-(--accent-pink) shadow-[0_0_20px_rgba(255,0,127,.35),inset_0_0_12px_rgba(0,240,255,.2)] rounded-md py-3 px-[18px] text-center flex flex-col items-center gap-1.5 pointer-events-none [animation:arcade-start-pulse_1.8s_infinite_ease-in-out] [transition:all_0.2s_ease] box-border [[data-theme=win95]_&]:w-[70%] [[data-theme=win95]_&]:bg-[rgba(192,192,192,.85)] [[data-theme=win95]_&]:border-t-white [[data-theme=win95]_&]:border-l-white [[data-theme=win95]_&]:border-r-[#808080] [[data-theme=win95]_&]:border-b-[#808080] [[data-theme=win95]_&]:shadow-[inset_1px_1px_0px_#fff,inset_-1px_-1px_0px_#000,2px_2px_6px_rgba(0,0,0,.3)] [[data-theme=win95]_&]:rounded-none [[data-theme=win95]_&]:[animation:none] [[data-theme=terminal]_&]:bg-[rgba(2,16,2,.75)] [[data-theme=terminal]_&]:border-[1.5px] [[data-theme=terminal]_&]:border-(--accent-cyan) [[data-theme=terminal]_&]:shadow-[0_0_15px_rgba(51,255,51,.35),inset_0_0_10px_rgba(51,255,51,.15)] [[data-theme=terminal]_&]:rounded-none [[data-theme=terminal]_&]:[animation:terminal-start-pulse_1.8s_infinite_ease-in-out]';

// `whitespace-nowrap` fixes a pre-existing wrap bug: at 1.5px letter-spacing
// the spaced arrows wrapped onto their own lines.
export const ARCADE_START_TITLE =
  '[font-family:var(--font-heading)] text-[0.95rem] text-(--accent-yellow) [text-shadow:0_0_10px_var(--accent-yellow),0_0_20px_var(--accent-pink)] tracking-[1.5px] font-bold whitespace-nowrap [[data-theme=win95]_&]:text-black [[data-theme=win95]_&]:[text-shadow:none] [[data-theme=win95]_&]:text-[0.82rem] [[data-theme=win95]_&]:tracking-[0.5px] [[data-theme=terminal]_&]:text-(--accent-cyan) [[data-theme=terminal]_&]:[text-shadow:0_0_8px_var(--accent-cyan)]';

export const ARCADE_START_SUB =
  '[font-family:var(--font-mono)] text-[0.82rem] text-(--accent-cyan) tracking-[0.5px] [[data-theme=win95]_&]:text-[#333333] [[data-theme=terminal]_&]:text-(--accent-yellow)';

export const COL_4 = 'col-span-4 max-[992px]:col-span-12';

export const COL_8 = 'col-span-8 max-[992px]:col-span-12';

// Home's "CYBERSOUND DECK": theme overrides as `&` variants, JS-chosen LED
// classes, and the unused reel/matrix rules removed.
export const CYBER_CASSETTE_CHASSIS =
  "relative overflow-hidden flex flex-col gap-2 py-2.5 px-3 rounded-lg border border-[rgba(0,240,255,.4)] bg-[linear-gradient(180deg,#18092e_0%,#0c021a_100%)] shadow-[0_0_16px_rgba(0,0,0,.6),inset_0_0_12px_rgba(0,240,255,.15)] before:content-[''] before:absolute before:top-0 before:left-0 before:right-0 before:h-0.5 before:bg-[linear-gradient(90deg,var(--accent-cyan),var(--accent-pink),var(--accent-yellow))] [[data-theme=win95]_&]:bg-none [[data-theme=win95]_&]:bg-[#c0c0c0] [[data-theme=win95]_&]:border-t-2 [[data-theme=win95]_&]:border-t-white [[data-theme=win95]_&]:border-l-2 [[data-theme=win95]_&]:border-l-white [[data-theme=win95]_&]:border-r-2 [[data-theme=win95]_&]:border-r-[#808080] [[data-theme=win95]_&]:border-b-2 [[data-theme=win95]_&]:border-b-[#808080] [[data-theme=win95]_&]:shadow-none [[data-theme=terminal]_&]:bg-none [[data-theme=terminal]_&]:bg-[#000500] [[data-theme=terminal]_&]:border-[#33ff33] [[data-theme=terminal]_&]:shadow-[0_0_12px_rgba(51,255,51,.25)]";

export const OLED_SCREEN =
  'flex flex-col gap-0.5 py-1.5 px-2 rounded bg-[#020008] border border-[rgba(0,240,255,.3)] [[data-theme=win95]_&]:bg-black [[data-theme=win95]_&]:border-[#808080] [[data-theme=terminal]_&]:bg-[#000a00] [[data-theme=terminal]_&]:border-[#33ff33]';

export const OLED_TITLE =
  '[font-family:var(--font-heading)] text-[0.78rem] text-(--accent-yellow) tracking-[0.5px] whitespace-nowrap overflow-hidden text-ellipsis [text-shadow:0_0_8px_rgba(255,230,0,.5)] [[data-theme=terminal]_&]:text-[#33ff33]';

export const OLED_META =
  '[font-family:var(--font-mono)] text-[0.64rem] text-(--accent-cyan) flex justify-between [[data-theme=terminal]_&]:text-[#33ff33]';

export const CYBER_EQ_DECK =
  'flex items-end justify-between h-7 py-0.5 px-1 gap-0.5 rounded bg-black/80 border border-white/[0.08]';

export const CYBER_EQ_COL =
  'flex-1 rounded-[1px] min-h-[3px] bg-[linear-gradient(0deg,#00f0ff_0%,#ffe600_65%,#ff007f_100%)] [transition:height_0.1s_ease] [[data-theme=win95]_&]:bg-none [[data-theme=win95]_&]:bg-[#00ff00] [[data-theme=terminal]_&]:bg-none [[data-theme=terminal]_&]:bg-[#33ff33] [[data-theme=terminal]_&]:shadow-[0_0_4px_#33ff33]';

export const CYBER_TRANSPORT_CLUSTER =
  'grid gap-1.5 py-1 px-1 rounded-md bg-black/40 border border-white/[0.08] [grid-template-columns:1fr_1.5fr_1fr] [[data-theme=win95]_&]:bg-[#c0c0c0] [[data-theme=win95]_&]:border-[#808080] [[data-theme=terminal]_&]:bg-[#000800] [[data-theme=terminal]_&]:border-[#33ff33]';

export const CYBER_DECK_KEY =
  'relative flex flex-col items-center justify-center py-[5px] px-1 rounded-[5px] text-(--text-main) cursor-pointer overflow-hidden bg-[linear-gradient(180deg,rgba(35,15,70,.8)_0%,rgba(15,5,35,.95)_100%)] border-[1.5px] border-[rgba(0,240,255,.35)] shadow-[0_3px_8px_rgba(0,0,0,.5),inset_0_1px_1px_rgba(255,255,255,.15)] [transition:all_0.18s_cubic-bezier(.2,.8,.2,1)] hover:border-(--accent-cyan) hover:bg-[linear-gradient(180deg,rgba(50,25,95,.9)_0%,rgba(20,8,45,.95)_100%)] hover:shadow-[0_0_12px_rgba(0,240,255,.4),inset_0_1px_1px_rgba(255,255,255,.25)] hover:-translate-y-px active:translate-y-px active:shadow-[0_2px_4px_rgba(0,0,0,.6)] [[data-theme=win95]_&]:bg-none [[data-theme=win95]_&]:bg-[#c0c0c0] [[data-theme=win95]_&]:border-t-2 [[data-theme=win95]_&]:border-t-white [[data-theme=win95]_&]:border-l-2 [[data-theme=win95]_&]:border-l-white [[data-theme=win95]_&]:border-r-2 [[data-theme=win95]_&]:border-r-[#808080] [[data-theme=win95]_&]:border-b-2 [[data-theme=win95]_&]:border-b-[#808080] [[data-theme=win95]_&]:shadow-none [[data-theme=win95]_&]:rounded-none [[data-theme=win95]_&]:text-black [[data-theme=win95]_&]:active:border-t-[#808080] [[data-theme=win95]_&]:active:border-l-[#808080] [[data-theme=win95]_&]:active:border-r-white [[data-theme=win95]_&]:active:border-b-white [[data-theme=terminal]_&]:bg-none [[data-theme=terminal]_&]:bg-[#001200] [[data-theme=terminal]_&]:border [[data-theme=terminal]_&]:border-[#33ff33] [[data-theme=terminal]_&]:text-[#33ff33] [[data-theme=terminal]_&]:shadow-[0_0_8px_rgba(51,255,51,.3)]';

export const CYBER_DECK_KEY_PLAY =
  'bg-[linear-gradient(180deg,rgba(255,0,127,.3)_0%,rgba(13,2,33,.95)_100%)] border-[1.5px] border-(--accent-pink) shadow-[0_0_12px_rgba(255,0,127,.35),inset_0_1px_2px_rgba(255,255,255,.2)] hover:border-white hover:shadow-[0_0_18px_rgba(255,0,127,.75),inset_0_1px_2px_rgba(255,255,255,.3)] hover:-translate-y-px';

export const CYBER_DECK_KEY_PLAY_ACTIVE =
  'bg-[linear-gradient(180deg,rgba(255,0,127,.6)_0%,rgba(120,0,60,.95)_100%)] border-white shadow-[0_0_18px_rgba(255,0,127,.8),inset_0_0_8px_rgba(255,255,255,.3)]';

export const CYBER_KEY_ICON = 'text-[0.8rem] leading-none mb-px [text-shadow:0_0_8px_currentColor]';

export const CYBER_KEY_LABEL =
  '[font-family:var(--font-display)] font-black text-[0.6rem] tracking-[0.5px] leading-none';

export const CYBER_KEY_SUB =
  '[font-family:var(--font-mono)] text-[0.46rem] opacity-70 tracking-[0.3px] mt-px';

export const CYBER_VOL_CONSOLE =
  'flex flex-col gap-1.5 py-2 px-2.5 rounded-md bg-[rgba(10,2,28,.85)] border border-[rgba(0,240,255,.3)] shadow-[inset_0_0_10px_rgba(0,0,0,.7)] [[data-theme=win95]_&]:bg-[#c0c0c0] [[data-theme=win95]_&]:border-[#808080] [[data-theme=terminal]_&]:bg-[#000a00] [[data-theme=terminal]_&]:border-[#33ff33]';

export const CYBER_FADER_TRACK_ROW = 'flex items-center gap-2';

export const CYBER_VOL_STEP_BTN =
  'w-[22px] h-[22px] rounded flex items-center justify-center p-0 cursor-pointer bg-(--bg-secondary) border border-(--border-color) text-(--accent-cyan) [font-family:var(--font-mono)] font-black text-[0.75rem] [transition:all_0.15s_ease] hover:bg-(--accent-cyan) hover:text-[#0d0221] hover:shadow-[0_0_8px_var(--accent-cyan)]';

export const CYBER_VOL_LED_BAR =
  'flex gap-[3px] flex-1 h-3.5 py-0.5 px-[3px] rounded-[3px] bg-black/70 border border-white/10 cursor-pointer';

export const CYBER_VOL_LED_SEGMENT =
  'flex-1 rounded-[1px] bg-white/[0.08] [transition:all_0.12s_ease]';

const LED_THEME_OVERRIDE =
  '[[data-theme=win95]_&]:bg-[#00ff00] [[data-theme=win95]_&]:shadow-none [[data-theme=terminal]_&]:bg-[#33ff33] [[data-theme=terminal]_&]:shadow-[0_0_4px_#33ff33]';

export const LED_LIT_CYAN = `bg-[#00f0ff] shadow-[0_0_6px_#00f0ff] ${LED_THEME_OVERRIDE}`;

export const LED_LIT_AMBER = `bg-[#ffe600] shadow-[0_0_6px_#ffe600] ${LED_THEME_OVERRIDE}`;

export const LED_LIT_PINK = `bg-[#ff007f] shadow-[0_0_8px_#ff007f] ${LED_THEME_OVERRIDE}`;

export const RETRO_FOOTER =
  'text-center p-5 bg-(--bg-card) [border:var(--card-border-style)] mt-5 text-[0.85rem] text-(--text-muted)';

// CyberModal writes `data-modal-state`/`data-glitching` on the overlay and the
// constants read them via `group-data-` variants. The group is NAMED
// (`group/modal`) so CyberButton's own unnamed group-hover can't match it.
export const CYBER_MODAL_OVERLAY =
  'group/modal fixed inset-0 bg-[rgba(5,2,14,.78)] backdrop-blur-[12px] backdrop-saturate-[1.8] z-[10002] grid place-items-center p-6 [transition:opacity_0.3s_ease] opacity-0 pointer-events-none data-[modal-state=open]:opacity-100 data-[modal-state=open]:pointer-events-auto';

export const CYBER_MODAL_BOX =
  "[--corner:12px] [--border:2px] [--clip:polygon(0_0,100%_0,100%_calc(100%_-_var(--corner)),calc(100%_-_var(--corner))_100%,0%_100%)] [--modal-accent:var(--accent-cyan,#00f0ff)] [--modal-shadow:var(--accent-pink,#ff007f)] text-(--modal-accent) w-[clamp(340px,90vw,500px)] relative box-border [font-family:var(--font-display,sans-serif)] overflow-visible bg-transparent before:content-[''] before:absolute before:top-px before:bottom-px before:right-full before:w-4 before:[border:var(--border)_solid_var(--modal-accent)] before:[translate:-25%_0] before:opacity-0 before:backdrop-blur-[6px] before:backdrop-saturate-[180%] before:[transition-property:opacity,translate] before:duration-200 before:ease-out before:[transition-delay:325ms] before:[background:var(--modal-accent)] before:[mask:linear-gradient(#fff,hsl(0_0%_100%/0.6)_15%_95%,#fff)] after:content-[''] after:absolute after:top-px after:bottom-px after:right-full after:w-4 after:[border:var(--border)_solid_var(--modal-accent)] after:[translate:-25%_0] after:opacity-0 after:backdrop-blur-[6px] after:backdrop-saturate-[180%] after:[transition-property:opacity,translate] after:duration-200 after:ease-out after:[transition-delay:325ms] group-data-[modal-state=open]/modal:before:opacity-100 group-data-[modal-state=open]/modal:before:[translate:var(--border)_0] group-data-[modal-state=open]/modal:before:[animation:cyberModalFlicker_0.625s_var(--flicker)_none] group-data-[modal-state=open]/modal:before:[animation-delay:200ms] group-data-[modal-state=open]/modal:before:[transition-delay:0s] group-data-[modal-state=open]/modal:after:opacity-100 group-data-[modal-state=open]/modal:after:[translate:var(--border)_0] [[data-theme=win95]_&]:before:hidden [[data-theme=win95]_&]:after:hidden";

export const CYBER_MODAL_BODY =
  'relative backdrop-blur-[8px] backdrop-saturate-[180%] [clip-path:inset(0_calc(100%_+_(2_*_var(--border)))_0_0)] [transition-property:clip-path] duration-[260ms] [transition-delay:75ms] group-data-[modal-state=open]/modal:[clip-path:inset(0_calc(var(--border)_*_-1)_0_0)] group-data-[modal-state=open]/modal:[transition-delay:220ms]';

export const CYBER_MODAL_BODY_BACKDROP =
  "absolute inset-0 [transition-property:translate] duration-[260ms] [translate:calc(-100%_-_(2_*_var(--border)))_0] [transition-delay:75ms] group-data-[modal-state=open]/modal:[translate:0_0] group-data-[modal-state=open]/modal:[transition-delay:220ms] after:content-[''] after:absolute after:left-full after:top-8 after:w-[calc(2*var(--border))] after:h-[40%] after:bg-(--modal-accent) after:opacity-70 after:[clip-path:polygon(0_0,0_100%,100%_calc(100%_-_6px),100%_6px)]";

export const CYBER_MODAL_BACKDROP_PLATE =
  'absolute z-[-1] inset-0 bg-[rgba(14,4,32,.95)] [clip-path:var(--clip)] [border:var(--border)_solid_var(--modal-accent)] shadow-[0_0_35px_rgba(0,240,255,.35),inset_0_0_20px_rgba(255,0,127,.15)] [[data-theme=win95]_&]:!bg-[#c0c0c0] [[data-theme=win95]_&]:!border-t-2 [[data-theme=win95]_&]:!border-t-white [[data-theme=win95]_&]:!border-l-2 [[data-theme=win95]_&]:!border-l-white [[data-theme=win95]_&]:!border-r-2 [[data-theme=win95]_&]:!border-r-black [[data-theme=win95]_&]:!border-b-2 [[data-theme=win95]_&]:!border-b-black [[data-theme=win95]_&]:!shadow-[3px_3px_0px_#000] [[data-theme=win95]_&]:![clip-path:none] [[data-theme=win95]_&]:!rounded-none [[data-theme=terminal]_&]:!bg-[rgba(5,16,5,.98)] [[data-theme=terminal]_&]:!border-[1.5px] [[data-theme=terminal]_&]:!border-[#33ff33] [[data-theme=terminal]_&]:!shadow-[0_0_25px_rgba(51,255,51,.4)]';

export const CYBER_MODAL_CONTENT =
  'py-[1.4rem] px-[1.4rem] pb-[1.2rem] relative [clip-path:inset(0_calc(100%_+_(2_*_var(--border)))_0_0)] [transition-property:clip-path] duration-[260ms] [transition-delay:75ms] group-data-[modal-state=open]/modal:[clip-path:inset(0_calc(var(--border)_*_-1)_0_0)] group-data-[modal-state=open]/modal:[transition-delay:220ms]';

export const CYBER_MODAL_VERSION =
  'absolute right-3 top-2 text-[0.62rem] [font-family:var(--font-mono,monospace)] opacity-65 text-(--modal-accent)';

export const CYBER_MODAL_H2 =
  "pb-[0.6rem] mt-0 mb-4 mx-0 uppercase relative text-[1.15rem] [font-family:var(--font-heading)] tracking-[1px] text-white after:content-[''] after:h-(--border) after:bottom-0 after:left-0 after:right-0 after:bg-(--modal-accent) after:shadow-[0_0_8px_var(--modal-accent)] after:absolute after:[transform-origin:0_50%] after:duration-[260ms] after:[transition-property:scale] after:ease-in after:[scale:0_1] group-data-[modal-state=open]/modal:after:[scale:1_1] group-data-[modal-state=open]/modal:after:[transition-delay:325ms] group-data-[modal-state=open]/modal:after:ease-out [[data-theme=win95]_&]:!text-[#000080] [[data-theme=terminal]_&]:!text-[#33ff33]";

export const CYBER_MODAL_H2_SPAN =
  'opacity-0 [transition-property:opacity] ease-out duration-[260ms] group-data-[modal-state=open]/modal:opacity-100 group-data-[modal-state=open]/modal:[transition-delay:325ms]';

export const CYBER_MODAL_BODY_TEXT =
  '[font-family:var(--font-mono,monospace)] text-[0.85rem] leading-[1.6] text-white/88 opacity-0 [translate:0_-1lh] [transition-property:opacity,translate] duration-[260ms] ease-out group-data-[modal-state=open]/modal:[translate:0_0] group-data-[modal-state=open]/modal:opacity-100 group-data-[modal-state=open]/modal:[transition-delay:325ms] [&>p]:m-0 [&>p]:mb-[0.8rem] [&>p:last-child]:mb-0 [&>p:last-child]:font-bold [&>p:last-child]:text-(--accent-yellow) [[data-theme=win95]_&]:!text-black [[data-theme=terminal]_&]:!text-[#33ff33]';

export const CYBER_MODAL_ACTIONS =
  'flex items-center gap-[0.8rem] pt-[1.2rem] [transition-property:translate,opacity] duration-100 ease-out opacity-0 [translate:-24px_0] group-data-[modal-state=open]/modal:opacity-100 group-data-[modal-state=open]/modal:[translate:0_0] group-data-[modal-state=open]/modal:[transition-delay:500ms]';

export const CYBER_MODAL_GLITCH =
  '[--shimmy-distance:2] [--clip-one:polygon(0_2%,100%_2%,100%_95%,95%_95%,95%_90%,85%_90%,85%_95%,8%_95%,0_70%)] [--clip-two:polygon(0_78%,100%_78%,100%_100%,95%_100%,95%_90%,85%_90%,85%_100%,8%_100%,0_78%)] [--clip-three:polygon(0_44%,100%_44%,100%_54%,95%_54%,95%_54%,85%_54%,85%_54%,8%_54%,0_54%)] [--clip-four:polygon(0_0,100%_0,100%_0,95%_0,95%_0,85%_0,85%_0,8%_0,0_0)] [--clip-five:polygon(0_0,100%_0,100%_0,95%_0,95%_0,85%_0,85%_0,8%_0,0_0)] [--clip-six:polygon(0_40%,100%_40%,100%_85%,95%_85%,95%_85%,85%_85%,85%_85%,8%_85%,0_70%)] [--clip-seven:polygon(0_63%,100%_63%,100%_80%,95%_80%,95%_80%,85%_80%,85%_80%,8%_80%,0_70%)] absolute inset-0 p-[1.4rem] text-(--modal-shadow) pointer-events-none z-[-1] opacity-0 group-data-[glitching=true]/modal:opacity-100 group-data-[glitching=true]/modal:[animation:cyberModalFullGlitch_1.6s_ease_forwards]';

// --- CyberButton ---

export const CYBER_BTN_BASE =
  "group [--corner:10px] [--border:1.5px] [--clip:polygon(0_0,100%_0,100%_calc(100%_-_var(--corner)),calc(100%_-_var(--corner))_100%,0%_100%)] [--btn-accent:var(--accent-cyan,#00f0ff)] [--btn-shadow:var(--accent-pink,#ff007f)] [font-family:var(--font-display,'Orbitron',sans-serif)] font-black tracking-[1px] min-w-[140px] text-left uppercase inline-flex items-center gap-[0.6rem] py-[0.6rem] px-[0.8rem] border-0 bg-transparent relative text-(--btn-accent) cursor-pointer box-border select-none [transition:transform_0.15s_ease] overflow-visible disabled:opacity-40 disabled:cursor-not-allowed hover:text-[#0d0221] focus-visible:text-[#0d0221] [[data-theme=win95]_&]:![clip-path:none] [[data-theme=win95]_&]:!border-t-2 [[data-theme=win95]_&]:!border-t-white [[data-theme=win95]_&]:!border-l-2 [[data-theme=win95]_&]:!border-l-white [[data-theme=win95]_&]:!border-r-2 [[data-theme=win95]_&]:!border-r-black [[data-theme=win95]_&]:!border-b-2 [[data-theme=win95]_&]:!border-b-black [[data-theme=win95]_&]:!shadow-[2px_2px_0px_#000] [[data-theme=win95]_&]:!text-black [[data-theme=terminal]_&]:!text-[#33ff33] [[data-theme=terminal]_&]:![--btn-accent:#33ff33]";

// `!` required: CYBER_BTN_BASE's equal-specificity default otherwise wins
// regardless of className concatenation order.
export const CYBER_BTN_PINK = '![--btn-accent:var(--accent-pink,#ff007f)] ![--btn-shadow:#9d00ff]';

export const CYBER_BTN_YELLOW =
  '![--btn-accent:var(--accent-yellow,#ffe600)] ![--btn-shadow:#ff5500]';

export const CYBER_BTN_DANGER = '![--btn-accent:#ff0055] ![--btn-shadow:#ff0000]';

// `!` required: the `mask` shorthand resets the mask-* longhands and Tailwind
// emits it later, which would undo the bevel cut.
const CYBER_BTN_BACKDROP_SHARED =
  "absolute z-[1] inset-0 bg-[rgba(15,5,32,.85)] backdrop-blur-[8px] backdrop-saturate-[180%] [clip-path:var(--clip)] pointer-events-none [transition:background_0.2s_ease,box-shadow_0.2s_ease] before:content-[''] before:absolute before:inset-0 before:bg-(--btn-accent) before:[border:var(--border)_solid_transparent] before:[clip-path:var(--clip)] before:[mask:linear-gradient(#0000_0%_100%),linear-gradient(#fff_0%_100%)] before:![mask-clip:padding-box,border-box] before:![mask-repeat:no-repeat] before:![mask-composite:intersect] before:z-[2]";

export const CYBER_BTN_BACKDROP = `${CYBER_BTN_BACKDROP_SHARED} group-hover:bg-(--btn-accent) group-hover:shadow-[0_0_16px_var(--btn-accent)] [[data-theme=win95]_&]:![background:#c0c0c0] [[data-theme=win95]_&]:![clip-path:none]`;

export const CYBER_BTN_BACKDROP_GLITCH = `${CYBER_BTN_BACKDROP_SHARED} group-hover:bg-[#0d0221]`;

export const CYBER_BTN_CORNER =
  "absolute bottom-0 right-0 h-(--corner) w-(--corner) after:content-[''] after:h-[calc(var(--border)*2)] after:w-[200%] after:absolute after:top-1/2 after:left-1/2 after:[translate:-50%_-50%] after:[transform:rotate(135deg)] after:bg-(--btn-accent)";

export const CYBER_BTN_KBD =
  'relative z-[3] text-[#0d0221] [font-family:var(--font-mono,monospace)] font-bold h-5 min-w-[20px] inline-grid place-items-center text-[0.65rem] px-1 rounded [transition:color_0.2s_ease,background_0.2s_ease] bg-(--btn-accent) group-hover:text-(--btn-accent) group-hover:bg-[#0d0221]';

export const CYBER_BTN_LABEL = 'relative z-[3] text-[0.76rem] tracking-[0.5px]';

export const CYBER_BTN_GLITCH_LAYER =
  'hidden absolute inset-0 items-center gap-[0.6rem] py-[0.6rem] px-[0.8rem] pointer-events-none text-(--btn-accent) [text-shadow:0_1px_var(--btn-shadow)] z-[4] group-hover:inline-flex group-hover:[animation:cyberBtnGlitch_1.8s_infinite]';

export const CYBER_BTN_LETTERS =
  'flex [&>span:nth-of-type(2)]:[scale:1_-1] [&>span:nth-of-type(5)]:[scale:1_-1] [&>span:nth-of-type(3)]:[scale:-1_-1] [&>span:nth-of-type(6)]:[scale:-1_-1] [&>span:nth-of-type(7)]:[scale:-1_-1]';

// Values read from getComputedStyle() on the live modal (all 3 themes): the
// older "receipt printer" block cascaded into this one, so some properties
// (top-6, z-5, VT323, share-tech-mono, ...) survive from it.
export const TICKET_CONTAINER =
  'relative z-[100] w-[min(95%,560px)] mx-auto flex flex-col items-center [font-family:var(--font-mono)] box-border max-[520px]:w-[95%]';

export const RESULTS_INVOICE_CONTAINER =
  'relative z-[100] w-full h-[660px] mx-auto mb-8 flex flex-col items-center box-border';

export const INVOICE_SLOT_BOTTOM =
  'absolute top-0 left-0 w-full h-[115px] z-[2] box-border flex flex-col items-center justify-end pt-2.5 px-3.5 pb-3.5 bg-(--bg-secondary) border-[2.5px] border-(--accent-pink) rounded-[1.2em_1.2em_0.4em_0.4em] shadow-[0_10px_30px_rgba(0,0,0,.85)] [[data-theme=win95]_&]:bg-[#c0c0c0] [[data-theme=win95]_&]:border-white [[data-theme=win95]_&]:shadow-[inset_1.5px_1.5px_0_#fff,inset_-1.5px_-1.5px_0_#000,3px_3px_0_#000] [[data-theme=terminal]_&]:bg-[#0a1f0a] [[data-theme=terminal]_&]:border-[#33ff33]';

export const SLOT_HOLE_BOTTOM =
  'mx-auto w-[88%] h-8 box-border rounded-full border-[2.5px] border-[#ff007f] shadow-[inset_0_0_14px_#000] bg-[#020006] [[data-theme=win95]_&]:bg-black [[data-theme=win95]_&]:border-2 [[data-theme=win95]_&]:border-[#808080] [[data-theme=win95]_&]:shadow-[inset_2px_2px_0_#000,inset_-1px_-1px_0_#dfdfdf] [[data-theme=terminal]_&]:bg-[#000c00] [[data-theme=terminal]_&]:border-[#33ff33]';

export const INVOICE_SLOT_TOP =
  'absolute top-0 left-0 w-full h-[82px] z-20 box-border flex flex-col items-center justify-between pt-2.5 px-3.5 pointer-events-none bg-(--bg-secondary) border-[2.5px] border-b-0 border-(--accent-pink) rounded-t-[1.2em] [[data-theme=win95]_&]:bg-[#c0c0c0] [[data-theme=win95]_&]:border-white [[data-theme=win95]_&]:shadow-[inset_1.5px_1.5px_0_#fff,inset_-1.5px_0_0_#000] [[data-theme=terminal]_&]:bg-[#0a1f0a] [[data-theme=terminal]_&]:border-[#33ff33] [[data-theme=terminal]_&]:shadow-none';

export const VENDING_HEADER_BAR =
  'w-full flex items-center justify-between text-[0.68rem] tracking-[1.5px] text-(--accent-yellow) uppercase [font-family:var(--font-heading)] font-extrabold px-1 box-border';

export const SLOT_HOLE_TOP =
  'mx-auto w-[88%] h-4 box-border rounded-t-full border-[2.5px] border-b-0 border-[#ff007f] shadow-none bg-[#020006] [[data-theme=win95]_&]:bg-black [[data-theme=win95]_&]:border-2 [[data-theme=win95]_&]:border-[#808080] [[data-theme=terminal]_&]:bg-[#000c00] [[data-theme=terminal]_&]:border-[#33ff33]';

export const TICKET_PAPER_WRAPPER =
  'w-[80%] mt-[70px] mx-auto relative z-10 flex flex-col items-center box-border [clip-path:inset(0px_-50px_-10000px_-50px)]';

// `top-6`/`z-5`/Share-Tech-Mono survive from the old "receipt printer"
// block — see the section comment above. `@keyframes printVendingTicketJitter`
// stays in retrowave.css, applied here via arbitrary `animation:` value.
export const RESULTS_INVOICE =
  "relative top-6 z-[5] w-full mx-auto left-0 right-0 [font-family:'Share_Tech_Mono',sans-serif] bg-[rgba(18,7,42,.97)] text-(--text-muted) py-[1.8em] px-[1.5em] rounded-b-[1.2em] border-[2.5px] border-(--accent-cyan) [border-top:2px_dashed_rgba(0,240,255,.6)] shadow-[0_15px_40px_rgba(0,0,0,.8)] [animation:printVendingTicketJitter_0.72s_cubic-bezier(.22,1,.36,1)_forwards] [transform-origin:top_center] box-border [will-change:transform,opacity] [backface-visibility:hidden] [transform:translate3d(0,0,0)] max-[520px]:py-[1.2em] max-[520px]:px-[1em] [[data-theme=win95]_&]:bg-[#dfdfdf] [[data-theme=win95]_&]:text-[#404040] [[data-theme=win95]_&]:border-2 [[data-theme=win95]_&]:border-white [[data-theme=win95]_&]:[border-top:1px_dashed_#808080] [[data-theme=win95]_&]:shadow-[inset_1px_1px_0_#fff,inset_-1px_-1px_0_#000,2px_2px_0_#000] [[data-theme=terminal]_&]:bg-[rgba(10,31,10,.97)] [[data-theme=terminal]_&]:text-[#22aa22] [[data-theme=terminal]_&]:border-2 [[data-theme=terminal]_&]:border-[#33ff33] [[data-theme=terminal]_&]:[border-top:1px_dashed_#33ff33] [[data-theme=terminal]_&]:shadow-[0_15px_40px_rgba(0,0,0,.8)]";

const TICKET_NOTCH_BASE = 'absolute top-[55px] w-4 h-4 rounded-full z-[6] bg-(--bg-primary)';

export const TICKET_NOTCH_LEFT = `${TICKET_NOTCH_BASE} -left-[9px] shadow-[inset_-2px_0_4px_rgba(0,0,0,.6)]`;

export const TICKET_NOTCH_RIGHT = `${TICKET_NOTCH_BASE} -right-[9px] shadow-[inset_2px_0_4px_rgba(0,0,0,.6)]`;

// win95/terminal TEXT COLOR overrides here come from the old block (no
// competing rule in the current one); the ::before/::after tick-mark
// pattern overrides come from the current block. See section comment above.
export const INVOICE_TITLE =
  "relative text-[1.12rem] [font-family:var(--font-heading)] py-[0.7em] tracking-[1px] text-center mb-[1.4em] font-bold text-(--text-main) uppercase before:content-[''] before:absolute before:h-0.5 before:w-full before:top-0 before:left-0 before:[background-image:repeating-linear-gradient(90deg,var(--accent-pink),var(--accent-pink)_10px,transparent_10px,transparent_20px)] after:content-[''] after:absolute after:h-0.5 after:w-full after:bottom-0 after:left-0 after:[background-image:repeating-linear-gradient(90deg,var(--accent-pink),var(--accent-pink)_10px,transparent_10px,transparent_20px)] max-[520px]:text-[0.9rem] max-[520px]:py-[0.5em] [[data-theme=win95]_&]:text-[#000080] [[data-theme=win95]_&]:[font-family:'Press_Start_2P',cursive] [[data-theme=win95]_&]:text-[0.85rem] [[data-theme=win95]_&]:before:[background-image:repeating-linear-gradient(90deg,#000,#000_10px,transparent_10px,transparent_20px)] [[data-theme=win95]_&]:after:[background-image:repeating-linear-gradient(90deg,#000,#000_10px,transparent_10px,transparent_20px)] [[data-theme=terminal]_&]:text-[#33ff33] [[data-theme=terminal]_&]:[text-shadow:0_0_8px_#33ff33] [[data-theme=terminal]_&]:text-[1.3rem] [[data-theme=terminal]_&]:before:[background-image:repeating-linear-gradient(90deg,#33ff33,#33ff33_10px,transparent_10px,transparent_20px)] [[data-theme=terminal]_&]:after:[background-image:repeating-linear-gradient(90deg,#33ff33,#33ff33_10px,transparent_10px,transparent_20px)]";

export const INVOICE_AMOUNT =
  'flex items-center justify-between text-[1.05rem] mb-[0.6em] [font-family:var(--font-display)]';

// VT323 font survives from the old block; terminal's text-shadow/font-size
// also survive from the old block's terminal override (the current block's
// terminal override only touches color). See section comment above.
export const INVOICE_VALUE =
  "font-extrabold text-(--accent-cyan) text-[1.1rem] [font-family:'VT323',monospace] [[data-theme=win95]_&]:text-[#000080] [[data-theme=terminal]_&]:text-[#33ff33] [[data-theme=terminal]_&]:[text-shadow:0_0_6px_#aaffaa] [[data-theme=terminal]_&]:text-[1.4rem]";

export const PAYERS_LIST = 'list-none my-[0.8em]';

export const PAYERS_LI =
  'flex items-center py-[0.2em] border-b-[1.5px] border-b-white/10 [[data-theme=win95]_&]:border-b [[data-theme=win95]_&]:border-b-[#808080] [[data-theme=terminal]_&]:border-b [[data-theme=terminal]_&]:border-b-[#116611]';

export const PAYERS_LI_P =
  'grow flex justify-between items-center text-[1.02rem] py-[0.6em] px-[0.8em] text-(--text-main) [font-family:var(--font-display)] font-bold max-[520px]:text-[0.88rem] [[data-theme=win95]_&]:text-black [[data-theme=terminal]_&]:text-[#33ff33]';

export const PAYER_IMAGE_CONTAINER =
  'flex items-center justify-center py-[0.5em] px-[0.8em] border-r-[1.5px] border-r-white/10 [[data-theme=win95]_&]:border-r [[data-theme=win95]_&]:border-r-[#808080] [[data-theme=terminal]_&]:border-r [[data-theme=terminal]_&]:border-r-[#116611]';

// win95/terminal override border/bg/colour regardless of rank, so order
// relative to the rank modifiers doesn't matter.
export const PAY_TAG_BASE =
  'inline-flex items-center gap-1.5 whitespace-nowrap border-[1.5px] border-[rgba(0,240,255,.4)] rounded-lg py-[0.35em] px-[0.65em] text-[0.78rem] [font-family:var(--font-mono)] font-bold max-[520px]:text-[0.7rem] [[data-theme=win95]_&]:border [[data-theme=win95]_&]:border-black [[data-theme=win95]_&]:bg-white [[data-theme=win95]_&]:text-black [[data-theme=win95]_&]:shadow-none [[data-theme=terminal]_&]:border [[data-theme=terminal]_&]:border-[#33ff33] [[data-theme=terminal]_&]:text-[#33ff33] [[data-theme=terminal]_&]:bg-[rgba(51,255,51,.1)] [[data-theme=terminal]_&]:shadow-none';

export const PAY_TAG_WIN =
  'border-[#ffe600] text-[#ffe600] bg-[rgba(255,230,0,.15)] shadow-[0_0_8px_rgba(255,230,0,.3)]';

export const PAY_TAG_RUNNER =
  'border-(--accent-cyan) text-(--accent-cyan) bg-[rgba(0,240,255,.15)]';

export const PAY_TAG_THIRD = 'border-[#ff9900] text-[#ff9900] bg-[rgba(255,153,0,.15)]';

export const PAY_TAG_FOURTH = 'border-white/35 text-(--text-muted) bg-white/[0.08]';

export const PAY_NOW_BTN =
  'w-full [font-family:var(--font-heading)] text-base bg-(--accent-pink) text-white py-[1.1em] border-2 border-(--accent-pink) rounded-[0.85em] shadow-[0_0_20px_rgba(255,0,127,.45)] cursor-pointer tracking-[1.5px] [transition:all_0.2s_ease] mt-[1.2em] hover:bg-[#00f0ff] hover:border-[#00f0ff] hover:text-[#0d0221] hover:shadow-[0_0_28px_#00f0ff] hover:-translate-y-0.5 max-[520px]:text-[0.88rem] [[data-theme=win95]_&]:bg-[#c0c0c0] [[data-theme=win95]_&]:text-black [[data-theme=win95]_&]:border-white [[data-theme=win95]_&]:shadow-[inset_1px_1px_0_#fff,inset_-1px_-1px_0_#000,2px_2px_0_#000] [[data-theme=win95]_&]:hover:bg-[#000080] [[data-theme=win95]_&]:hover:text-white [[data-theme=win95]_&]:hover:translate-y-0 [[data-theme=terminal]_&]:bg-[#0a1f0a] [[data-theme=terminal]_&]:text-[#33ff33] [[data-theme=terminal]_&]:border-[1.5px] [[data-theme=terminal]_&]:border-[#33ff33] [[data-theme=terminal]_&]:shadow-[0_0_16px_rgba(51,255,51,.45)] [[data-theme=terminal]_&]:hover:bg-[#33ff33] [[data-theme=terminal]_&]:hover:text-[#051005]';

// Static `::before`/`::after` glow (mamee/milo tiers), verified against the
// compiled CSS after a prior Tailwind JIT bug dropped rules here.
export const BADGE_MAMEE_AURA =
  "before:content-[''] before:absolute before:[inset:-8px_-4px_-2px_-4px] before:[border-radius:45%_45%_8px_8px/65%_65%_15%_15%] before:bg-[radial-gradient(ellipse_at_50%_110%,rgba(255,255,255,.95)_0%,rgba(255,230,0,.9)_30%,rgba(255,80,0,.8)_60%,rgba(255,23,68,.65)_80%,transparent_96%)] before:blur-[5px] before:z-[-2] before:opacity-95 before:[animation:mamee-flame-steady-wave_2.4s_ease-in-out_infinite_alternate] after:content-[''] after:absolute after:[inset:-4px_-2px_-1px_-2px] after:[border-radius:50%_50%_6px_6px/70%_70%_15%_15%] after:bg-[radial-gradient(ellipse_at_50%_120%,rgba(255,230,0,.75)_0%,rgba(255,23,68,.7)_60%,transparent_85%)] after:blur-[4px] after:z-[-1] after:opacity-90 after:[animation:mamee-flame-steady-halo_3.2s_ease-in-out_infinite_alternate] after:pointer-events-none";

export const BADGE_MILO_AURA =
  "before:content-[''] before:absolute before:[inset:-10px_-6px_-4px_-6px] before:[border-radius:45%_45%_8px_8px/65%_65%_15%_15%] before:bg-[radial-gradient(ellipse_at_50%_115%,rgba(255,255,255,.95)_0%,rgba(0,240,255,.9)_25%,rgba(255,0,255,.85)_55%,rgba(189,0,255,.75)_78%,transparent_96%)] before:blur-[5px] before:z-[-2] before:opacity-95 before:[animation:milo-plasma-aura-wave_2.4s_ease-in-out_infinite_alternate] before:pointer-events-none after:content-[''] after:absolute after:[inset:-5px_-3px_-2px_-3px] after:[border-radius:50%_50%_6px_6px/70%_70%_15%_15%] after:bg-[radial-gradient(ellipse_at_50%_120%,rgba(0,240,255,.8)_0%,rgba(255,0,255,.75)_50%,rgba(189,0,255,.65)_75%,transparent_90%)] after:blur-[4px] after:z-[-1] after:opacity-[0.92] after:[animation:milo-plasma-aura-halo_3.2s_ease-in-out_infinite_alternate] after:pointer-events-none";
