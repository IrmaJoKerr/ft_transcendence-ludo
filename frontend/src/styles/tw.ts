// Shared Tailwind utility strings for classes reused across components.

export const RETRO_BTN =
  'inline-flex items-center gap-1.5 px-4 py-2.5 uppercase cursor-pointer outline-none text-[0.7rem] text-[var(--text-main)] bg-[var(--btn-bg)] border-2 border-(--accent-cyan) shadow-[var(--box-shadow)] [font-family:var(--font-heading)] [transition:all_0.2s_ease] hover:-translate-y-0.5 hover:shadow-[var(--btn-hover-shadow)] active:translate-y-px';

export const THEME_TRIGGER_BTN_BASE =
  "font-['Atkinson_Hyperlegible_Next',sans-serif] text-[0.65rem] h-[38px] w-[125px] px-2.5 box-border inline-flex items-center justify-between rounded gap-1 relative shrink-0 cursor-pointer outline-none [transition:background_0.2s_ease,border-color_0.2s_ease,box-shadow_0.2s_ease,color_0.2s_ease]";

export const THEME_POPOVER_MENU_BASE =
  'absolute top-[calc(100%+10px)] right-0 z-[10001] bg-[var(--fs-bg)] border-2 border-[var(--fs-border)] shadow-[0_14px_40px_rgb(var(--shade-rgb)/.9),0_0_25px_var(--fs-glow)] p-2.5 rounded-md min-w-[240px] [transform-origin:top_right] backdrop-blur-[10px]';

export const THEME_POPOVER_MENU_ACTIVE_DOWN =
  'block [animation:popover-slide-down_0.3s_cubic-bezier(.175,.885,.32,1.275)_forwards]';

// RetroNavbar's `#mainNav`
export const RETRO_FLOATING_DOCK =
  'relative z-[9999] flex justify-between items-center px-5 py-2.5 min-h-14 bg-(--bg-card) [border:var(--card-border-style)] shadow-(--box-shadow) backdrop-blur-[10px] m-0 rounded-md box-border';

// Auth form element styles (Login/Signup/ForgotPassword/ResetPassword/
// TwoFactor).
export const RETRO_AUTH_TITLE =
  "font-['Atkinson_Hyperlegible_Next',sans-serif] font-black tracking-[2.5px] text-4xl leading-[1.1] bg-[linear-gradient(135deg,var(--accent-cyan)_0%,var(--accent-pink)_50%,#9d00ff_100%)] bg-clip-text text-transparent";

export const RETRO_AUTH_SUBTITLE =
  "text-[rgba(184,166,228,.8)] text-base mt-2.5 font-['Atkinson_Hyperlegible_Mono',monospace]";

export const RETRO_AUTH_LABEL =
  "font-['Atkinson_Hyperlegible_Next',sans-serif] text-xs font-bold tracking-[1.5px] text-[rgb(var(--accent-cyan-rgb)/.75)] uppercase";

export const RETRO_AUTH_INPUT =
  "w-full [border:1.5px_solid_rgb(var(--accent-cyan-rgb)/.28)] rounded-[11px] py-4 px-[18px] [font:500_16.5px_'Atkinson_Hyperlegible_Mono',monospace] text-(--text-main) bg-[rgb(var(--shade-rgb)/.45)] outline-none [transition:all_0.2s_ease] box-border placeholder:text-[rgba(184,166,228,.35)] focus:border-(--accent-cyan) focus:shadow-[0_0_18px_rgb(var(--accent-cyan-rgb)/.35),inset_0_0_8px_rgb(var(--accent-cyan-rgb)/.1)] focus:bg-[rgb(var(--shade-rgb)/.6)]";

export const RETRO_AUTH_BTN =
  "border-0 rounded-xl py-[17px] px-[22px] [font:900_16px_'Atkinson_Hyperlegible_Next',sans-serif] tracking-[1.8px] text-(--text-main) cursor-pointer bg-[linear-gradient(135deg,var(--accent-pink),#9d00ff)] shadow-[0_0_22px_rgb(var(--accent-pink-rgb)/.4),0_8px_26px_rgba(157,0,255,.35)] [transition:all_0.22s_ease] uppercase hover:-translate-y-px hover:shadow-[0_0_32px_rgb(var(--accent-pink-rgb)/.65),0_12px_34px_rgba(157,0,255,.45),0_0_65px_rgb(var(--accent-cyan-rgb)/.2)] active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:translate-y-0";

export const RETRO_AUTH_BTN_OUTLINE =
  "[border:1.5px_solid_rgb(var(--accent-cyan-rgb)/.3)] rounded-[11px] py-[15px] px-[18px] [font:700_14.5px_'Atkinson_Hyperlegible_Mono',monospace] text-[rgb(var(--ink-rgb)/.88)] cursor-pointer bg-[rgb(var(--accent-cyan-rgb)/.06)] [transition:all_0.2s_ease] flex items-center justify-center gap-2.5 hover:border-(--accent-cyan) hover:bg-[rgb(var(--accent-cyan-rgb)/.15)] hover:shadow-[0_0_16px_rgb(var(--accent-cyan-rgb)/.3)] hover:text-(--text-main)";

export const RETRO_AUTH_DIVIDER =
  "flex items-center gap-3.5 text-[rgba(184,166,228,.45)] [font:700_11px_'Atkinson_Hyperlegible_Next',sans-serif] tracking-[2px]";

export const RETRO_AUTH_DIVIDER_LINE =
  'flex-1 h-px bg-[linear-gradient(90deg,transparent,rgb(var(--accent-cyan-rgb)/.2),transparent)]';

export const RETRO_AUTH_LINK =
  'text-(--accent-cyan) cursor-pointer font-bold no-underline [transition:color_0.18s_ease,text-shadow_0.18s_ease] hover:text-(--accent-pink) hover:[text-shadow:0_0_10px_rgb(var(--accent-pink-rgb)/.5)]';

export const RETRO_AUTH_ERROR =
  "text-[#ff4081] text-[13px] leading-[1.4] font-['Atkinson_Hyperlegible_Mono',monospace] py-2 px-3 rounded-lg bg-[rgba(255,0,127,.08)] border border-[rgba(255,0,127,.2)]";

export const RETRO_AUTH_SUCCESS =
  "text-[#33ff88] text-[13px] leading-[1.4] font-['Atkinson_Hyperlegible_Mono',monospace] py-2 px-3 rounded-lg bg-[rgba(51,255,136,.08)] border border-[rgba(51,255,136,.2)]";

export const RETRO_AUTH_MUTED =
  "text-[rgba(184,166,228,.6)] text-[13px] font-['Atkinson_Hyperlegible_Mono',monospace]";

// Shared "page shell"
export const CRT_SCREEN = 'relative z-10 min-h-screen';

// The era image now paints on `html, body` via `--shell-image` (dimmed,
// rearmost, every UI surface in front of it). This layer owns only the
// converging grid; nothing here moves.
export const GRID_BACKGROUND = 'fixed inset-0 z-[0] pointer-events-none';

// The old isometric background, frozen: converging perspective lines that
// meet at a vanishing point and stay there — no scroll, no drift. Shown for
// synthwave only; retro70's colony image needs no grid over it.
export const STATIC_GRID =
  'absolute top-[55%] -left-1/2 w-[200%] h-[55vh] ' +
  'bg-[linear-gradient(0deg,transparent_24%,var(--grid-line-color)_25%,var(--grid-line-color)_26%,transparent_27%,transparent_74%,var(--grid-line-color)_75%,var(--grid-line-color)_76%,transparent_77%),linear-gradient(90deg,transparent_24%,var(--grid-line-color)_25%,var(--grid-line-color)_26%,transparent_27%,transparent_74%,var(--grid-line-color)_75%,var(--grid-line-color)_76%,transparent_77%)] ' +
  'bg-[length:50px_50px] [transform-origin:50%_0%] [transform:perspective(220px)_rotateX(65deg)] z-[2] [[data-theme=retro70]&]:hidden';

export const APP_WRAPPER =
  'max-w-[calc(100vw-335px)] w-[calc(100%-325px)] ml-[310px] mr-auto p-[14px_20px_20px] relative z-10 box-border';

export const HERO_SECTION =
  'text-center p-[18px_20px_16px] bg-(--bg-card) [border:var(--card-border-style)] shadow-(--box-shadow) mb-[18px] relative overflow-hidden rounded';

export const HERO_TITLE =
  '[font-family:var(--font-heading)] text-[2.2rem] leading-[1.25] text-(--text-main) [text-shadow:3px_3px_0_var(--accent-pink),-2px_-2px_0_var(--accent-cyan),0_0_22px_rgb(var(--accent-pink-rgb)/.85)] mb-2 tracking-[2px]';

export const HERO_SUBTITLE =
  '[font-family:var(--font-display)] text-[1.35rem] text-(--accent-yellow) [text-shadow:0_0_12px_var(--accent-yellow)] mb-0';

export const BADGE_BAR = 'flex justify-center gap-2.5 flex-wrap mt-2';

export const RETRO_BADGE =
  'bg-(--bg-secondary) border border-dashed border-(--accent-cyan) py-1 px-2.5 text-[0.74rem] text-(--accent-cyan)';

export const RETRO_WINDOW =
  'bg-(--bg-card) [border:var(--card-border-style)] shadow-(--box-shadow) rounded overflow-hidden flex flex-col';

export const WINDOW_HEADER =
  'bg-(--window-header-bg) text-(--window-header-text) py-2 px-3.5 [font-family:var(--font-heading)] text-[0.75rem] flex justify-between items-center select-none';

export const GAME_WINDOW_HEADER_EXTRA = '!bg-[#140a35] border-b-2 border-b-[#2121ff] !text-(--text-main)';

export const WINDOW_BODY = 'p-5 grow';

export const WINDOW_CONTROLS = 'flex gap-1.5';

// Decorative traffic-light squares in a window header: pure chrome, so they take
// no pointer events and never show a hand. Nothing here is clickable.
export const WINDOW_BTN_MIN =
  'w-3.5 h-3.5 rounded-xs border border-[rgb(var(--shade-rgb)/.4)] bg-[#ffbd2e] pointer-events-none';

export const WINDOW_BTN_MAX =
  'w-3.5 h-3.5 rounded-xs border border-[rgb(var(--shade-rgb)/.4)] bg-[#27c93f] pointer-events-none';

export const APEX_CHAMPION_CARD =
  'scale-[1.02] shadow-[0_0_28px_rgba(255,23,68,.55),0_0_45px_rgba(255,215,0,.25),inset_0_0_16px_rgba(255,215,0,.15)] animate-none';

// One real 12-column grid for the page bodies. The gutters are 25 px from
// 1250 px up and clamp below that, so eleven of them can never exceed a narrow
// content box; the 360 px dock is paid for by the viewport, not by the gutter.
export const DASHBOARD_GRID = 'grid grid-cols-12 gap-x-[clamp(8px,2vw,25px)] gap-y-[25px] mb-[30px]';

// A pass is one of the lobby's three entry tickets: host a new arena, hotseat,
// bots. 124 px is its design height, set by the tallest content it carries.
export const RETRO_TICKET_PASS =
  'relative flex items-center justify-between rounded-xl py-[26px] px-8 min-h-[124px] gap-6 flex-wrap box-border cursor-pointer select-none [transition:box-shadow_0.22s_cubic-bezier(.16,1,.3,1),border-color_0.22s_ease,background_0.22s_ease]';

export const TICKET_PINK =
  'bg-[linear-gradient(90deg,rgba(255,0,127,.22)_0%,rgb(var(--bg-raise-rgb)/.96)_100%)] border-2 border-[#ff007f] shadow-[0_4px_20px_rgb(var(--shade-rgb)/.6),0_0_16px_rgba(255,0,127,.25)] hover:border-[#ff3399] hover:bg-[linear-gradient(90deg,rgba(255,0,127,.32)_0%,rgba(30,8,55,.98)_100%)] hover:shadow-[0_8px_30px_rgb(var(--shade-rgb)/.75),0_0_28px_rgba(255,0,127,.55),inset_0_0_16px_rgba(255,0,127,.2)]';

export const TICKET_YELLOW =
  'bg-[linear-gradient(90deg,rgba(255,230,0,.2)_0%,rgb(var(--bg-raise-rgb)/.96)_100%)] border-2 border-[#ffe600] shadow-[0_4px_20px_rgb(var(--shade-rgb)/.6),0_0_16px_rgba(255,230,0,.22)] hover:border-[#ffff33] hover:bg-[linear-gradient(90deg,rgba(255,230,0,.3)_0%,rgba(30,8,55,.98)_100%)] hover:shadow-[0_8px_30px_rgb(var(--shade-rgb)/.75),0_0_28px_rgba(255,230,0,.5),inset_0_0_16px_rgba(255,230,0,.18)]';

export const TICKET_GREEN =
  'bg-[linear-gradient(90deg,rgba(0,255,136,.2)_0%,rgb(var(--bg-raise-rgb)/.96)_100%)] border-2 border-[#00ff88] shadow-[0_4px_20px_rgb(var(--shade-rgb)/.6),0_0_16px_rgba(0,255,136,.22)] hover:border-[#33ffaa] hover:bg-[linear-gradient(90deg,rgba(0,255,136,.3)_0%,rgba(30,8,55,.98)_100%)] hover:shadow-[0_8px_30px_rgb(var(--shade-rgb)/.75),0_0_28px_rgb(var(--accent-pink-rgb)/.55),inset_0_0_16px_rgba(0,255,136,.18)]';

// The right-hand action pill inside a pass. The 1.5 px transparent border is not
// decoration: all three pills share one width (the widest label, see
// `PassActionPill`), and a pill without a border would be 3 px narrower than the
// two with one. Pills that want a coloured edge override only the colour.
export const TICKET_ACTION_PILL =
  'inline-flex items-center justify-center py-3 px-6 rounded-md border-[1.5px] border-solid [border-color:var(--pill-border,transparent)] [font-family:var(--font-heading)] text-[0.9rem] font-black tracking-[1px] [transition:all_0.2s_ease] pointer-events-none shrink-0';

// Home.tsx arcade cabinet + grid columns + footer.
export const ARCADE_CONTAINER = 'flex flex-col items-center gap-[15px]';

export const ARCADE_SCREEN_FRAME =
  'bg-[rgb(var(--shade-rgb))] p-0 border-4 border-[#333333] shadow-[inset_0_0_20px_rgb(var(--shade-rgb)),0_0_15px_var(--accent-cyan)] relative overflow-hidden w-full h-full cursor-pointer [transition:all_0.2s_ease]';

export const ARCADE_START_OVERLAY =
  'absolute bottom-6 left-1/2 -translate-x-1/2 w-[82%] max-w-[580px] bg-(--start-overlay-bg) backdrop-blur-[8px] border-2 border-(--accent-pink) shadow-[0_0_20px_var(--start-overlay-glow),inset_0_0_12px_var(--start-overlay-inset)] rounded-md py-3 px-[18px] text-center flex flex-col items-center gap-1.5 pointer-events-none [animation:arcade-start-pulse_1.8s_infinite_ease-in-out] [transition:all_0.2s_ease] box-border';

export const ARCADE_START_TITLE =
  '[font-family:var(--font-heading)] text-[0.95rem] text-(--accent-yellow) [text-shadow:0_0_10px_var(--accent-yellow),0_0_20px_var(--accent-pink)] tracking-[1.5px] font-bold whitespace-nowrap';

export const ARCADE_START_SUB =
  '[font-family:var(--font-mono)] text-[0.82rem] text-(--accent-cyan) tracking-[0.5px]';

// Column spans inside `DASHBOARD_GRID`.
//
// A divided dashboard collapses at 992 px, 288 px below where the dock changes
// shape (1280). A docked page that divides therefore has to pick its own
// breakpoint at 1280: below it the dock is a rail and the content jumps 181 px
// wider, so a span that only collapses at 992 would hold a divided layout in
// that range. LudoLobby does not divide — it is one stack (passes, then the rooms
// window) — so it lays out as a flex column instead of a row of spans.
export const COL_4 = 'col-span-4 max-[992px]:col-span-12';

export const COL_8 = 'col-span-8 max-[992px]:col-span-12';

export const RETRO_FOOTER =
  'text-center p-5 bg-(--bg-card) [border:var(--card-border-style)] mt-5 text-[0.85rem] text-(--text-muted)';

// CyberModal
export const CYBER_MODAL_OVERLAY =
  'group/modal fixed inset-0 bg-[rgba(5,2,14,.78)] backdrop-blur-[12px] backdrop-saturate-[1.8] z-[10002] grid place-items-center p-6 [transition:opacity_0.3s_ease] opacity-0 pointer-events-none data-[modal-state=open]:opacity-100 data-[modal-state=open]:pointer-events-auto';

export const CYBER_MODAL_BOX =
  "[--corner:12px] [--border:2px] [--clip:polygon(0_0,100%_0,100%_calc(100%_-_var(--corner)),calc(100%_-_var(--corner))_100%,0%_100%)] [--modal-accent:var(--accent-cyan)] [--modal-shadow:var(--accent-pink)] text-(--modal-accent) w-[clamp(340px,90vw,500px)] relative box-border [font-family:var(--font-display,sans-serif)] overflow-visible bg-transparent before:content-[''] before:absolute before:top-px before:bottom-px before:right-full before:w-4 before:[border:var(--border)_solid_var(--modal-accent)] before:[translate:-25%_0] before:opacity-0 before:backdrop-blur-[6px] before:backdrop-saturate-[180%] before:[transition-property:opacity,translate] before:duration-200 before:ease-out before:[transition-delay:325ms] before:[background:var(--modal-accent)] before:[mask:linear-gradient(#fff,hsl(0_0%_100%/0.6)_15%_95%,#fff)] after:content-[''] after:absolute after:top-px after:bottom-px after:right-full after:w-4 after:[border:var(--border)_solid_var(--modal-accent)] after:[translate:-25%_0] after:opacity-0 after:backdrop-blur-[6px] after:backdrop-saturate-[180%] after:[transition-property:opacity,translate] after:duration-200 after:ease-out after:[transition-delay:325ms] group-data-[modal-state=open]/modal:before:opacity-100 group-data-[modal-state=open]/modal:before:[translate:var(--border)_0] group-data-[modal-state=open]/modal:before:[animation:cyberModalFlicker_0.625s_var(--flicker)_none] group-data-[modal-state=open]/modal:before:[animation-delay:200ms] group-data-[modal-state=open]/modal:before:[transition-delay:0s] group-data-[modal-state=open]/modal:after:opacity-100 group-data-[modal-state=open]/modal:after:[translate:var(--border)_0]";

export const CYBER_MODAL_BODY =
  'relative backdrop-blur-[8px] backdrop-saturate-[180%] [clip-path:inset(0_calc(100%_+_(2_*_var(--border)))_0_0)] [transition-property:clip-path] duration-[260ms] [transition-delay:75ms] group-data-[modal-state=open]/modal:[clip-path:inset(0_calc(var(--border)_*_-1)_0_0)] group-data-[modal-state=open]/modal:[transition-delay:220ms]';

export const CYBER_MODAL_BODY_BACKDROP =
  "absolute inset-0 [transition-property:translate] duration-[260ms] [translate:calc(-100%_-_(2_*_var(--border)))_0] [transition-delay:75ms] group-data-[modal-state=open]/modal:[translate:0_0] group-data-[modal-state=open]/modal:[transition-delay:220ms] after:content-[''] after:absolute after:left-full after:top-8 after:w-[calc(2*var(--border))] after:h-[40%] after:bg-(--modal-accent) after:opacity-70 after:[clip-path:polygon(0_0,0_100%,100%_calc(100%_-_6px),100%_6px)]";

export const CYBER_MODAL_BACKDROP_PLATE =
  'absolute z-[-1] inset-0 bg-[rgb(var(--bg-primary-rgb)/.95)] [clip-path:var(--clip)] [border:var(--border)_solid_var(--modal-accent)] shadow-[0_0_35px_rgb(var(--accent-cyan-rgb)/.35),inset_0_0_20px_rgb(var(--accent-pink-rgb)/.15)]';

export const CYBER_MODAL_CONTENT =
  'py-[1.4rem] px-[1.4rem] pb-[1.2rem] relative [clip-path:inset(0_calc(100%_+_(2_*_var(--border)))_0_0)] [transition-property:clip-path] duration-[260ms] [transition-delay:75ms] group-data-[modal-state=open]/modal:[clip-path:inset(0_calc(var(--border)_*_-1)_0_0)] group-data-[modal-state=open]/modal:[transition-delay:220ms]';

export const CYBER_MODAL_VERSION =
  'absolute right-3 top-2 text-[0.62rem] [font-family:var(--font-mono,monospace)] opacity-65 text-(--modal-accent)';

export const CYBER_MODAL_H2 =
  "pb-[0.6rem] mt-0 mb-4 mx-0 uppercase relative text-[1.15rem] [font-family:var(--font-heading)] tracking-[1px] text-(--text-main) after:content-[''] after:h-(--border) after:bottom-0 after:left-0 after:right-0 after:bg-(--modal-accent) after:shadow-[0_0_8px_var(--modal-accent)] after:absolute after:[transform-origin:0_50%] after:duration-[260ms] after:[transition-property:scale] after:ease-in after:[scale:0_1] group-data-[modal-state=open]/modal:after:[scale:1_1] group-data-[modal-state=open]/modal:after:[transition-delay:325ms] group-data-[modal-state=open]/modal:after:ease-out";

export const CYBER_MODAL_H2_SPAN =
  'opacity-0 [transition-property:opacity] ease-out duration-[260ms] group-data-[modal-state=open]/modal:opacity-100 group-data-[modal-state=open]/modal:[transition-delay:325ms]';

export const CYBER_MODAL_BODY_TEXT =
  '[font-family:var(--font-mono,monospace)] text-[0.85rem] leading-[1.6] text-[rgb(var(--ink-rgb)/.88)] opacity-0 [translate:0_-1lh] [transition-property:opacity,translate] duration-[260ms] ease-out group-data-[modal-state=open]/modal:[translate:0_0] group-data-[modal-state=open]/modal:opacity-100 group-data-[modal-state=open]/modal:[transition-delay:325ms] [&>p]:m-0 [&>p]:mb-[0.8rem] [&>p:last-child]:mb-0 [&>p:last-child]:font-bold [&>p:last-child]:text-(--accent-yellow)';

export const CYBER_MODAL_ACTIONS =
  'flex items-center gap-[0.8rem] pt-[1.2rem] [transition-property:translate,opacity] duration-100 ease-out opacity-0 [translate:-24px_0] group-data-[modal-state=open]/modal:opacity-100 group-data-[modal-state=open]/modal:[translate:0_0] group-data-[modal-state=open]/modal:[transition-delay:500ms]';

export const CYBER_MODAL_GLITCH =
  '[--shimmy-distance:2] [--clip-one:polygon(0_2%,100%_2%,100%_95%,95%_95%,95%_90%,85%_90%,85%_95%,8%_95%,0_70%)] [--clip-two:polygon(0_78%,100%_78%,100%_100%,95%_100%,95%_90%,85%_90%,85%_100%,8%_100%,0_78%)] [--clip-three:polygon(0_44%,100%_44%,100%_54%,95%_54%,95%_54%,85%_54%,85%_54%,8%_54%,0_54%)] [--clip-four:polygon(0_0,100%_0,100%_0,95%_0,95%_0,85%_0,85%_0,8%_0,0_0)] [--clip-five:polygon(0_0,100%_0,100%_0,95%_0,95%_0,85%_0,85%_0,8%_0,0_0)] [--clip-six:polygon(0_40%,100%_40%,100%_85%,95%_85%,95%_85%,85%_85%,85%_85%,8%_85%,0_70%)] [--clip-seven:polygon(0_63%,100%_63%,100%_80%,95%_80%,95%_80%,85%_80%,85%_80%,8%_80%,0_70%)] absolute inset-0 p-[1.4rem] text-(--modal-shadow) pointer-events-none z-[-1] opacity-0 group-data-[glitching=true]/modal:opacity-100 group-data-[glitching=true]/modal:[animation:cyberModalFullGlitch_1.6s_ease_forwards]';

// **CyberButton**
export const CYBER_BTN_BASE =
  'group [--corner:10px] [--border:1.5px] [--clip:polygon(0_0,100%_0,100%_calc(100%_-_var(--corner)),calc(100%_-_var(--corner))_100%,0%_100%)] [--btn-accent:var(--accent-cyan)] [--btn-shadow:var(--accent-pink)] [font-family:var(--font-display,sans-serif)] font-black tracking-[1px] min-w-[140px] text-left uppercase inline-flex items-center gap-[0.6rem] py-[0.6rem] px-[0.8rem] border-0 bg-transparent relative text-(--btn-accent) cursor-pointer box-border select-none [transition:transform_0.15s_ease] overflow-visible disabled:opacity-40 disabled:cursor-not-allowed hover:text-[rgb(var(--bg-primary-rgb))] focus-visible:text-[rgb(var(--bg-primary-rgb))]';

export const CYBER_BTN_PINK = '![--btn-accent:var(--accent-pink)] ![--btn-shadow:#9d00ff]';

export const CYBER_BTN_YELLOW =
  '![--btn-accent:var(--accent-yellow,#ffe600)] ![--btn-shadow:#ff5500]';

export const CYBER_BTN_DANGER = '![--btn-accent:#ff0055] ![--btn-shadow:#ff0000]';

const CYBER_BTN_BACKDROP_SHARED =
  "absolute z-[1] inset-0 bg-[rgb(var(--bg-primary-rgb)/.85)] backdrop-blur-[8px] backdrop-saturate-[180%] [clip-path:var(--clip)] pointer-events-none [transition:background_0.2s_ease,box-shadow_0.2s_ease] before:content-[''] before:absolute before:inset-0 before:bg-(--btn-accent) before:[border:var(--border)_solid_transparent] before:[clip-path:var(--clip)] before:[mask:linear-gradient(#0000_0%_100%),linear-gradient(rgb(var(--ink-rgb))_0%_100%)] before:![mask-clip:padding-box,border-box] before:![mask-repeat:no-repeat] before:![mask-composite:intersect] before:z-[2]";

export const CYBER_BTN_BACKDROP = `${CYBER_BTN_BACKDROP_SHARED} group-hover:bg-(--btn-accent) group-hover:shadow-[0_0_16px_var(--btn-accent)]`;

export const CYBER_BTN_BACKDROP_GLITCH = `${CYBER_BTN_BACKDROP_SHARED} group-hover:bg-[rgb(var(--bg-primary-rgb))]`;

export const CYBER_BTN_CORNER =
  "absolute bottom-0 right-0 h-(--corner) w-(--corner) after:content-[''] after:h-[calc(var(--border)*2)] after:w-[200%] after:absolute after:top-1/2 after:left-1/2 after:[translate:-50%_-50%] after:[transform:rotate(135deg)] after:bg-(--btn-accent)";

export const CYBER_BTN_KBD =
  'relative z-[3] text-[rgb(var(--bg-primary-rgb))] [font-family:var(--font-mono,monospace)] font-bold h-5 min-w-[20px] inline-grid place-items-center text-[0.65rem] px-1 rounded [transition:color_0.2s_ease,background_0.2s_ease] bg-(--btn-accent) group-hover:text-(--btn-accent) group-hover:bg-[rgb(var(--bg-primary-rgb))]';

export const CYBER_BTN_LABEL = 'relative z-[3] text-[0.76rem] tracking-[0.5px] uppercase';

export const CYBER_BTN_GLITCH_LAYER =
  'hidden absolute inset-0 items-center gap-[0.6rem] py-[0.6rem] px-[0.8rem] pointer-events-none text-(--btn-accent) [text-shadow:0_1px_var(--btn-shadow)] z-[4] group-hover:inline-flex group-hover:[animation:cyberBtnGlitch_1.8s_infinite]';

export const CYBER_BTN_LETTERS =
  'flex [&>span:nth-of-type(2)]:[scale:1_-1] [&>span:nth-of-type(5)]:[scale:1_-1] [&>span:nth-of-type(3)]:[scale:-1_-1] [&>span:nth-of-type(6)]:[scale:-1_-1] [&>span:nth-of-type(7)]:[scale:-1_-1]';

export const TICKET_CONTAINER =
  'relative z-[100] w-[min(95%,560px)] mx-auto flex flex-col items-center [font-family:var(--font-mono)] box-border max-[520px]:w-[95%]';

export const RESULTS_INVOICE_CONTAINER =
  'relative z-[100] w-full h-[660px] mx-auto mb-8 flex flex-col items-center box-border';

export const INVOICE_SLOT_BOTTOM =
  'absolute top-0 left-0 w-full h-[115px] z-[2] box-border flex flex-col items-center justify-end pt-2.5 px-3.5 pb-3.5 bg-(--bg-secondary) border-[2.5px] border-(--accent-pink) rounded-[1.2em_1.2em_0.4em_0.4em] shadow-[0_10px_30px_rgb(var(--shade-rgb)/.85)]';

export const SLOT_HOLE_BOTTOM =
  'mx-auto w-[88%] h-8 box-border rounded-full border-[2.5px] border-(--accent-pink) shadow-[inset_0_0_14px_rgb(var(--shade-rgb))] bg-[#020006]';

export const INVOICE_SLOT_TOP =
  'absolute top-0 left-0 w-full h-[82px] z-20 box-border flex flex-col items-center justify-between pt-2.5 px-3.5 pointer-events-none bg-(--bg-secondary) border-[2.5px] border-b-0 border-(--accent-pink) rounded-t-[1.2em]';

export const VENDING_HEADER_BAR =
  'w-full flex items-center justify-between text-[0.68rem] tracking-[1.5px] text-(--accent-yellow) uppercase [font-family:var(--font-heading)] font-extrabold px-1 box-border';

export const SLOT_HOLE_TOP =
  'mx-auto w-[88%] h-4 box-border rounded-t-full border-[2.5px] border-b-0 border-(--accent-pink) shadow-none bg-[#020006]';

export const TICKET_PAPER_WRAPPER =
  'w-[80%] mt-[70px] mx-auto relative z-10 flex flex-col items-center box-border [clip-path:inset(0px_-50px_-10000px_-50px)]';

export const RESULTS_INVOICE =
  "relative top-6 z-[5] w-full mx-auto left-0 right-0 [font-family:'Atkinson_Hyperlegible_Mono',monospace] bg-[rgb(var(--bg-raise-rgb)/.97)] text-(--text-muted) py-[1.8em] px-[1.5em] rounded-b-[1.2em] border-[2.5px] border-(--accent-cyan) [border-top:2px_dashed_rgb(var(--accent-cyan-rgb)/.6)] shadow-[0_15px_40px_rgb(var(--shade-rgb)/.8)] [animation:printVendingTicketJitter_0.72s_cubic-bezier(.22,1,.36,1)_forwards] [transform-origin:top_center] box-border [will-change:transform,opacity] [backface-visibility:hidden] [transform:translate3d(0,0,0)] max-[520px]:py-[1.2em] max-[520px]:px-[1em]";

const TICKET_NOTCH_BASE = 'absolute top-[55px] w-4 h-4 rounded-full z-[6] bg-(--bg-primary)';

export const TICKET_NOTCH_LEFT = `${TICKET_NOTCH_BASE} -left-[9px] shadow-[inset_-2px_0_4px_rgb(var(--shade-rgb)/.6)]`;

export const TICKET_NOTCH_RIGHT = `${TICKET_NOTCH_BASE} -right-[9px] shadow-[inset_2px_0_4px_rgb(var(--shade-rgb)/.6)]`;

export const INVOICE_TITLE =
  "relative text-[1.12rem] [font-family:var(--font-heading)] py-[0.7em] tracking-[1px] text-center mb-[1.4em] font-bold text-(--text-main) uppercase before:content-[''] before:absolute before:h-0.5 before:w-full before:top-0 before:left-0 before:[background-image:repeating-linear-gradient(90deg,var(--accent-pink),var(--accent-pink)_10px,transparent_10px,transparent_20px)] after:content-[''] after:absolute after:h-0.5 after:w-full after:bottom-0 after:left-0 after:[background-image:repeating-linear-gradient(90deg,var(--accent-pink),var(--accent-pink)_10px,transparent_10px,transparent_20px)] max-[520px]:text-[0.9rem] max-[520px]:py-[0.5em]";

export const INVOICE_AMOUNT =
  'flex items-center justify-between text-[1.05rem] mb-[0.6em] [font-family:var(--font-display)]';

export const INVOICE_VALUE =
  "font-extrabold text-(--accent-cyan) text-[1.1rem] [font-family:'Atkinson_Hyperlegible_Mono',monospace]";

export const PAYERS_LIST = 'list-none my-[0.8em]';

export const PAYERS_LI = 'flex items-center py-[0.2em] border-b-[1.5px] border-b-white/10';

export const PAYERS_LI_P =
  'grow min-w-0 flex justify-between items-center text-[1.02rem] py-[0.6em] px-[0.8em] text-(--text-main) [font-family:var(--font-display)] font-bold max-[520px]:text-[0.88rem]';

export const PAYER_IMAGE_CONTAINER =
  'shrink-0 flex items-center justify-center py-[0.5em] px-[0.8em] border-r-[1.5px] border-r-white/10';

export const PAY_TAG_BASE =
  'shrink-0 inline-flex items-center gap-1.5 whitespace-nowrap border-[1.5px] border-[rgb(var(--accent-cyan-rgb)/.4)] rounded-lg py-[0.35em] px-[0.65em] text-[0.78rem] [font-family:var(--font-mono)] font-bold max-[520px]:text-[0.7rem]';

export const PAY_TAG_WIN =
  'border-(--accent-yellow) text-(--accent-yellow) bg-[rgb(var(--accent-yellow-rgb)/.15)] shadow-[0_0_8px_rgb(var(--accent-yellow-rgb)/.3)]';

export const PAY_TAG_RUNNER =
  'border-(--accent-cyan) text-(--accent-cyan) bg-[rgb(var(--accent-cyan-rgb)/.15)]';

export const PAY_TAG_THIRD = 'border-[#ff9900] text-[#ff9900] bg-[rgba(255,153,0,.15)]';

export const PAY_TAG_FOURTH = 'border-[rgb(var(--ink-rgb)/.35)] text-(--text-muted) bg-[rgb(var(--ink-rgb)/0.08)]';

export const PAY_NOW_BTN =
  'w-full [font-family:var(--font-heading)] text-base bg-(--accent-pink) text-(--text-main) py-[1.1em] border-2 border-(--accent-pink) rounded-[0.85em] shadow-[0_0_20px_rgb(var(--accent-pink-rgb)/.45)] cursor-pointer tracking-[1.5px] [transition:all_0.2s_ease] mt-[1.2em] hover:bg-(--accent-cyan) hover:border-(--accent-cyan) hover:text-[rgb(var(--bg-primary-rgb))] hover:shadow-[0_0_28px_var(--accent-cyan)] hover:-translate-y-0.5 max-[520px]:text-[0.88rem]';

// OAuthButtons' provider button: the one survivor of `theme.ts`'s twelve `CSSProperties`
// constants. It was `btnOutline` spread at the call site and then overridden there (font
// 14, padding 11/10, a flex row), so this string writes the recipe the button actually
// rendered: section 33's action D, which deleted the other eleven because nothing
// imported them. The browns are the 70s palette's warm chrome and stay literals until
// their own family lands.
export const OAUTH_BTN =
  "flex items-center justify-center gap-2 cursor-pointer rounded-xl px-[10px] py-[11px] [border:1px_solid_#4a3826] text-[#e8dcc6] bg-[linear-gradient(180deg,#2b2118,#20180f)] [font:700_14px_'Atkinson_Hyperlegible_Next',sans-serif]";

// Section 33, action A: the twelve recipes that passes 1 and 2 left in an inline `style`
// and used in more than one place, as class strings. Each was a fully static object, so
// nothing computed is being frozen into a class; the constant is the channel rule's
// second rung, and the 30 sites that carried the recipe now read it instead of restating
// it. The twelfth recipe - six paint-only `{ color: 'var(--text-main)' }` - needed no
// constant, because `text-(--text-main)` is one utility. The 71 single-use recipes are
// style objects by rule and are not here (todo.md section 33, the ruling).
export const DISPLAY_TITLE =
  'text-[1.05rem] font-black leading-none text-(--text-main) [font-family:var(--font-display)]';

export const LOBBY_SECTION_TITLE =
  '[font-family:var(--font-heading)] text-[1.22rem] font-black text-(--text-main) tracking-[1.8px] mb-[6px]';

export const DISPLAY_LABEL = '[font-family:var(--font-display)] text-[0.84rem] font-black text-(--text-main)';

export const DISPLAY_TAG =
  '[font-family:var(--font-display)] text-[0.78rem] font-black tracking-[1px] text-(--text-main)';

export const DISPLAY_SUBTITLE =
  'text-[0.8rem] font-black [font-family:var(--font-display)] text-(--text-main) mb-[8px]';

export const INLINE_CHIP =
  'bg-[rgb(var(--shade-rgb)/0.6)] text-(--text-main) border border-(--border-color) rounded-[3px] [font-family:var(--font-mono)] text-[0.72rem] [padding:1px_3px] cursor-pointer';

export const DISPLAY_ELLIPSIS =
  'text-[0.92rem] font-black text-(--text-main) [font-family:var(--font-display)] whitespace-nowrap overflow-hidden text-ellipsis tracking-[0.02em]';

export const DISPLAY_MEDIUM =
  'text-[1.1rem] font-bold text-(--text-main) [font-family:var(--font-display)] tracking-[0.04em]';

export const DISPLAY_STAT =
  'text-[1.35rem] font-black text-(--text-main) [font-family:var(--font-display)] tracking-[0.04em] mt-[2px]';

export const STAT_FOOTER =
  'flex justify-between mt-[16px] pt-[12px] border-t border-[rgb(var(--ink-rgb)/0.08)] text-[0.78rem] text-(--text-muted) [font-family:var(--font-display)] tracking-[0.03em]';

export const HEADING_ELLIPSIS =
  'font-extrabold text-[0.92rem] text-(--text-main) [font-family:var(--font-heading)] overflow-hidden text-ellipsis whitespace-nowrap';

