// Shared Tailwind utility strings for classes reused across components.

export const RETRO_BTN =
  'inline-flex items-center gap-1.5 px-4 py-2.5 uppercase cursor-pointer outline-none text-[0.7rem] text-[var(--text-main)] bg-[var(--btn-bg)] border-2 border-[var(--accent-cyan)] shadow-[var(--box-shadow)] [font-family:var(--font-heading)] [transition:all_0.2s_ease] hover:-translate-y-0.5 hover:shadow-[var(--btn-hover-shadow)] active:translate-y-px';

export const THEME_TRIGGER_BTN_BASE =
  "font-['Atkinson_Hyperlegible_Next',sans-serif] text-[0.65rem] h-[38px] w-[125px] px-2.5 box-border inline-flex items-center justify-between rounded gap-1 relative shrink-0 cursor-pointer outline-none [transition:background_0.2s_ease,border-color_0.2s_ease,box-shadow_0.2s_ease,color_0.2s_ease]";

export const THEME_POPOVER_MENU_BASE =
  'absolute top-[calc(100%+10px)] right-0 z-[10001] bg-[var(--fs-bg)] border-2 border-[var(--fs-border)] shadow-[0_14px_40px_rgba(0,0,0,.9),0_0_25px_var(--fs-glow)] p-2.5 rounded-md min-w-[240px] [transform-origin:top_right] backdrop-blur-[10px]';

export const THEME_POPOVER_MENU_HIDDEN = 'hidden';

export const THEME_POPOVER_MENU_ACTIVE_DOWN =
  'block [animation:popover-slide-down_0.3s_cubic-bezier(.175,.885,.32,1.275)_forwards]';

export const THEME_POPOVER_MENU_ACTIVE_UP =
  'block [animation:popover-slide-up_0.3s_cubic-bezier(.175,.885,.32,1.275)_forwards]';

// RetroNavbar's `#mainNav`
export const RETRO_FLOATING_DOCK =
  'relative z-[9999] flex justify-between items-center px-5 py-2.5 min-h-14 bg-(--bg-card) [border:var(--card-border-style)] shadow-(--box-shadow) backdrop-blur-[10px] m-0 rounded-md box-border';

// Auth form element styles (Login/Signup/ForgotPassword/ResetPassword/
// TwoFactor).
export const RETRO_AUTH_TITLE =
  "font-['Atkinson_Hyperlegible_Next',sans-serif] font-black tracking-[2.5px] text-4xl leading-[1.1] bg-[linear-gradient(135deg,#00f0ff_0%,#ff007f_50%,#9d00ff_100%)] bg-clip-text text-transparent";

export const RETRO_AUTH_SUBTITLE =
  "text-[rgba(184,166,228,.8)] text-base mt-2.5 font-['Atkinson_Hyperlegible_Mono',monospace]";

export const RETRO_AUTH_LABEL =
  "font-['Atkinson_Hyperlegible_Next',sans-serif] text-xs font-bold tracking-[1.5px] text-[rgba(0,240,255,.75)] uppercase";

export const RETRO_AUTH_INPUT =
  "w-full [border:1.5px_solid_rgba(0,240,255,.28)] rounded-[11px] py-4 px-[18px] [font:500_16.5px_'Atkinson_Hyperlegible_Mono',monospace] text-white bg-[rgba(0,0,0,.45)] outline-none [transition:all_0.2s_ease] box-border placeholder:text-[rgba(184,166,228,.35)] focus:border-[#00f0ff] focus:shadow-[0_0_18px_rgba(0,240,255,.35),inset_0_0_8px_rgba(0,240,255,.1)] focus:bg-[rgba(0,0,0,.6)]";

export const RETRO_AUTH_BTN =
  "border-0 rounded-xl py-[17px] px-[22px] [font:900_16px_'Atkinson_Hyperlegible_Next',sans-serif] tracking-[1.8px] text-white cursor-pointer bg-[linear-gradient(135deg,#ff007f,#9d00ff)] shadow-[0_0_22px_rgba(255,0,127,.4),0_8px_26px_rgba(157,0,255,.35)] [transition:all_0.22s_ease] uppercase hover:-translate-y-px hover:shadow-[0_0_32px_rgba(255,0,127,.65),0_12px_34px_rgba(157,0,255,.45),0_0_65px_rgba(0,240,255,.2)] active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:translate-y-0";

export const RETRO_AUTH_BTN_OUTLINE =
  "[border:1.5px_solid_rgba(0,240,255,.3)] rounded-[11px] py-[15px] px-[18px] [font:700_14.5px_'Atkinson_Hyperlegible_Mono',monospace] text-[rgba(255,255,255,.88)] cursor-pointer bg-[rgba(0,240,255,.06)] [transition:all_0.2s_ease] flex items-center justify-center gap-2.5 hover:border-[#00f0ff] hover:bg-[rgba(0,240,255,.15)] hover:shadow-[0_0_16px_rgba(0,240,255,.3)] hover:text-white";

export const RETRO_AUTH_DIVIDER =
  "flex items-center gap-3.5 text-[rgba(184,166,228,.45)] [font:700_11px_'Atkinson_Hyperlegible_Next',sans-serif] tracking-[2px]";

export const RETRO_AUTH_DIVIDER_LINE =
  'flex-1 h-px bg-[linear-gradient(90deg,transparent,rgba(0,240,255,.2),transparent)]';

export const RETRO_AUTH_LINK =
  'text-[#00f0ff] cursor-pointer font-bold no-underline [transition:color_0.18s_ease,text-shadow_0.18s_ease] hover:text-[#ff007f] hover:[text-shadow:0_0_10px_rgba(255,0,127,.5)]';

export const RETRO_AUTH_ERROR =
  "text-[#ff4081] text-[13px] leading-[1.4] font-['Atkinson_Hyperlegible_Mono',monospace] py-2 px-3 rounded-lg bg-[rgba(255,0,127,.08)] border border-[rgba(255,0,127,.2)]";

export const RETRO_AUTH_SUCCESS =
  "text-[#33ff88] text-[13px] leading-[1.4] font-['Atkinson_Hyperlegible_Mono',monospace] py-2 px-3 rounded-lg bg-[rgba(51,255,136,.08)] border border-[rgba(51,255,136,.2)]";

export const RETRO_AUTH_MUTED =
  "text-[rgba(184,166,228,.6)] text-[13px] font-['Atkinson_Hyperlegible_Mono',monospace]";

// Shared "page shell"
export const CRT_SCREEN = 'relative z-10 min-h-screen';

// Synthwave cityscape background
export const GRID_BACKGROUND =
  "fixed inset-0 w-full h-full z-0 pointer-events-none overflow-hidden bg-cover bg-center bg-no-repeat bg-[url('/synthwave-cityscape.jpeg')] after:content-[''] after:absolute after:inset-0 after:bg-[linear-gradient(to_bottom,rgba(13,2,33,0.3)_0%,rgba(13,2,33,0.5)_100%)]";

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
  'bg-(--bg-card) [border:var(--card-border-style)] shadow-(--box-shadow) rounded overflow-hidden flex flex-col';

export const WINDOW_HEADER =
  'bg-(--window-header-bg) text-(--window-header-text) py-2 px-3.5 [font-family:var(--font-heading)] text-[0.75rem] flex justify-between items-center select-none';

export const GAME_WINDOW_HEADER_EXTRA = '!bg-[#140a35] border-b-2 border-b-[#2121ff] !text-white';

export const WINDOW_BODY = 'p-5 grow';

export const WINDOW_CONTROLS = 'flex gap-1.5';

export const WINDOW_BTN_MIN =
  'w-3.5 h-3.5 rounded-xs border border-black/40 cursor-pointer bg-[#ffbd2e]';

export const WINDOW_BTN_MAX =
  'w-3.5 h-3.5 rounded-xs border border-black/40 cursor-pointer bg-[#27c93f]';

export const APEX_CHAMPION_CARD =
  'scale-[1.02] shadow-[0_0_28px_rgba(255,23,68,.55),0_0_45px_rgba(255,215,0,.25),inset_0_0_16px_rgba(255,215,0,.15)] animate-none';

export const DASHBOARD_GRID = 'grid grid-cols-12 gap-[25px] mb-[30px]';

export const RETRO_TICKET_PASS =
  'relative flex items-center justify-between rounded-xl py-[26px] px-8 min-h-[108px] gap-6 flex-wrap box-border cursor-pointer select-none [transition:box-shadow_0.22s_cubic-bezier(.16,1,.3,1),border-color_0.22s_ease,background_0.22s_ease]';

export const TICKET_PINK =
  'bg-[linear-gradient(90deg,rgba(255,0,127,.22)_0%,rgba(20,6,42,.96)_100%)] border-2 border-[#ff007f] shadow-[0_4px_20px_rgba(0,0,0,.6),0_0_16px_rgba(255,0,127,.25)] hover:border-[#ff3399] hover:bg-[linear-gradient(90deg,rgba(255,0,127,.32)_0%,rgba(30,8,55,.98)_100%)] hover:shadow-[0_8px_30px_rgba(0,0,0,.75),0_0_28px_rgba(255,0,127,.55),inset_0_0_16px_rgba(255,0,127,.2)]';

export const TICKET_YELLOW =
  'bg-[linear-gradient(90deg,rgba(255,230,0,.2)_0%,rgba(20,6,42,.96)_100%)] border-2 border-[#ffe600] shadow-[0_4px_20px_rgba(0,0,0,.6),0_0_16px_rgba(255,230,0,.22)] hover:border-[#ffff33] hover:bg-[linear-gradient(90deg,rgba(255,230,0,.3)_0%,rgba(30,8,55,.98)_100%)] hover:shadow-[0_8px_30px_rgba(0,0,0,.75),0_0_28px_rgba(255,230,0,.5),inset_0_0_16px_rgba(255,230,0,.18)]';

export const TICKET_GREEN =
  'bg-[linear-gradient(90deg,rgba(0,255,136,.2)_0%,rgba(20,6,42,.96)_100%)] border-2 border-[#00ff88] shadow-[0_4px_20px_rgba(0,0,0,.6),0_0_16px_rgba(0,255,136,.22)] hover:border-[#33ffaa] hover:bg-[linear-gradient(90deg,rgba(0,255,136,.3)_0%,rgba(30,8,55,.98)_100%)] hover:shadow-[0_8px_30px_rgba(0,0,0,.75),0_0_28px_rgba(255,0,127,.55),inset_0_0_16px_rgba(0,255,136,.18)]';

// LudoLobby room-code ticket only. Deliberately no hover styles: the strip
// keeps its resting look while the mouse is over it.
export const TICKET_CYAN =
  'bg-[linear-gradient(90deg,rgba(0,240,255,.2)_0%,rgba(20,6,42,.96)_100%)] border-2 border-(--accent-cyan) shadow-[0_4px_20px_rgba(0,0,0,.6),0_0_16px_rgba(0,240,255,.22)]';

export const TICKET_ACTION_PILL =
  'inline-flex items-center justify-center py-3 px-6 rounded-md [font-family:var(--font-heading)] text-[0.9rem] font-black tracking-[1px] [transition:all_0.2s_ease] pointer-events-none shrink-0';

// Home.tsx arcade cabinet + grid columns + footer.
export const ARCADE_CONTAINER = 'flex flex-col items-center gap-[15px]';

export const ARCADE_SCREEN_FRAME =
  'bg-black p-0 border-4 border-[#333333] shadow-[inset_0_0_20px_#000000,0_0_15px_var(--accent-cyan)] relative overflow-hidden w-full h-full cursor-pointer [transition:all_0.2s_ease]';

export const ARCADE_START_OVERLAY =
  'absolute bottom-6 left-1/2 -translate-x-1/2 w-[82%] max-w-[580px] bg-[rgba(13,2,33,.45)] backdrop-blur-[8px] border-2 border-(--accent-pink) shadow-[0_0_20px_rgba(255,0,127,.35),inset_0_0_12px_rgba(0,240,255,.2)] rounded-md py-3 px-[18px] text-center flex flex-col items-center gap-1.5 pointer-events-none [animation:arcade-start-pulse_1.8s_infinite_ease-in-out] [transition:all_0.2s_ease] box-border';

export const ARCADE_START_TITLE =
  '[font-family:var(--font-heading)] text-[0.95rem] text-(--accent-yellow) [text-shadow:0_0_10px_var(--accent-yellow),0_0_20px_var(--accent-pink)] tracking-[1.5px] font-bold whitespace-nowrap';

export const ARCADE_START_SUB =
  '[font-family:var(--font-mono)] text-[0.82rem] text-(--accent-cyan) tracking-[0.5px]';

export const COL_4 = 'col-span-4 max-[992px]:col-span-12';

export const COL_8 = 'col-span-8 max-[992px]:col-span-12';

export const RETRO_FOOTER =
  'text-center p-5 bg-(--bg-card) [border:var(--card-border-style)] mt-5 text-[0.85rem] text-(--text-muted)';

// CyberModal
export const CYBER_MODAL_OVERLAY =
  'group/modal fixed inset-0 bg-[rgba(5,2,14,.78)] backdrop-blur-[12px] backdrop-saturate-[1.8] z-[10002] grid place-items-center p-6 [transition:opacity_0.3s_ease] opacity-0 pointer-events-none data-[modal-state=open]:opacity-100 data-[modal-state=open]:pointer-events-auto';

export const CYBER_MODAL_BOX =
  "[--corner:12px] [--border:2px] [--clip:polygon(0_0,100%_0,100%_calc(100%_-_var(--corner)),calc(100%_-_var(--corner))_100%,0%_100%)] [--modal-accent:var(--accent-cyan,#00f0ff)] [--modal-shadow:var(--accent-pink,#ff007f)] text-(--modal-accent) w-[clamp(340px,90vw,500px)] relative box-border [font-family:var(--font-display,sans-serif)] overflow-visible bg-transparent before:content-[''] before:absolute before:top-px before:bottom-px before:right-full before:w-4 before:[border:var(--border)_solid_var(--modal-accent)] before:[translate:-25%_0] before:opacity-0 before:backdrop-blur-[6px] before:backdrop-saturate-[180%] before:[transition-property:opacity,translate] before:duration-200 before:ease-out before:[transition-delay:325ms] before:[background:var(--modal-accent)] before:[mask:linear-gradient(#fff,hsl(0_0%_100%/0.6)_15%_95%,#fff)] after:content-[''] after:absolute after:top-px after:bottom-px after:right-full after:w-4 after:[border:var(--border)_solid_var(--modal-accent)] after:[translate:-25%_0] after:opacity-0 after:backdrop-blur-[6px] after:backdrop-saturate-[180%] after:[transition-property:opacity,translate] after:duration-200 after:ease-out after:[transition-delay:325ms] group-data-[modal-state=open]/modal:before:opacity-100 group-data-[modal-state=open]/modal:before:[translate:var(--border)_0] group-data-[modal-state=open]/modal:before:[animation:cyberModalFlicker_0.625s_var(--flicker)_none] group-data-[modal-state=open]/modal:before:[animation-delay:200ms] group-data-[modal-state=open]/modal:before:[transition-delay:0s] group-data-[modal-state=open]/modal:after:opacity-100 group-data-[modal-state=open]/modal:after:[translate:var(--border)_0]";

export const CYBER_MODAL_BODY =
  'relative backdrop-blur-[8px] backdrop-saturate-[180%] [clip-path:inset(0_calc(100%_+_(2_*_var(--border)))_0_0)] [transition-property:clip-path] duration-[260ms] [transition-delay:75ms] group-data-[modal-state=open]/modal:[clip-path:inset(0_calc(var(--border)_*_-1)_0_0)] group-data-[modal-state=open]/modal:[transition-delay:220ms]';

export const CYBER_MODAL_BODY_BACKDROP =
  "absolute inset-0 [transition-property:translate] duration-[260ms] [translate:calc(-100%_-_(2_*_var(--border)))_0] [transition-delay:75ms] group-data-[modal-state=open]/modal:[translate:0_0] group-data-[modal-state=open]/modal:[transition-delay:220ms] after:content-[''] after:absolute after:left-full after:top-8 after:w-[calc(2*var(--border))] after:h-[40%] after:bg-(--modal-accent) after:opacity-70 after:[clip-path:polygon(0_0,0_100%,100%_calc(100%_-_6px),100%_6px)]";

export const CYBER_MODAL_BACKDROP_PLATE =
  'absolute z-[-1] inset-0 bg-[rgba(14,4,32,.95)] [clip-path:var(--clip)] [border:var(--border)_solid_var(--modal-accent)] shadow-[0_0_35px_rgba(0,240,255,.35),inset_0_0_20px_rgba(255,0,127,.15)]';

export const CYBER_MODAL_CONTENT =
  'py-[1.4rem] px-[1.4rem] pb-[1.2rem] relative [clip-path:inset(0_calc(100%_+_(2_*_var(--border)))_0_0)] [transition-property:clip-path] duration-[260ms] [transition-delay:75ms] group-data-[modal-state=open]/modal:[clip-path:inset(0_calc(var(--border)_*_-1)_0_0)] group-data-[modal-state=open]/modal:[transition-delay:220ms]';

export const CYBER_MODAL_VERSION =
  'absolute right-3 top-2 text-[0.62rem] [font-family:var(--font-mono,monospace)] opacity-65 text-(--modal-accent)';

export const CYBER_MODAL_H2 =
  "pb-[0.6rem] mt-0 mb-4 mx-0 uppercase relative text-[1.15rem] [font-family:var(--font-heading)] tracking-[1px] text-white after:content-[''] after:h-(--border) after:bottom-0 after:left-0 after:right-0 after:bg-(--modal-accent) after:shadow-[0_0_8px_var(--modal-accent)] after:absolute after:[transform-origin:0_50%] after:duration-[260ms] after:[transition-property:scale] after:ease-in after:[scale:0_1] group-data-[modal-state=open]/modal:after:[scale:1_1] group-data-[modal-state=open]/modal:after:[transition-delay:325ms] group-data-[modal-state=open]/modal:after:ease-out";

export const CYBER_MODAL_H2_SPAN =
  'opacity-0 [transition-property:opacity] ease-out duration-[260ms] group-data-[modal-state=open]/modal:opacity-100 group-data-[modal-state=open]/modal:[transition-delay:325ms]';

export const CYBER_MODAL_BODY_TEXT =
  '[font-family:var(--font-mono,monospace)] text-[0.85rem] leading-[1.6] text-white/88 opacity-0 [translate:0_-1lh] [transition-property:opacity,translate] duration-[260ms] ease-out group-data-[modal-state=open]/modal:[translate:0_0] group-data-[modal-state=open]/modal:opacity-100 group-data-[modal-state=open]/modal:[transition-delay:325ms] [&>p]:m-0 [&>p]:mb-[0.8rem] [&>p:last-child]:mb-0 [&>p:last-child]:font-bold [&>p:last-child]:text-(--accent-yellow)';

export const CYBER_MODAL_ACTIONS =
  'flex items-center gap-[0.8rem] pt-[1.2rem] [transition-property:translate,opacity] duration-100 ease-out opacity-0 [translate:-24px_0] group-data-[modal-state=open]/modal:opacity-100 group-data-[modal-state=open]/modal:[translate:0_0] group-data-[modal-state=open]/modal:[transition-delay:500ms]';

export const CYBER_MODAL_GLITCH =
  '[--shimmy-distance:2] [--clip-one:polygon(0_2%,100%_2%,100%_95%,95%_95%,95%_90%,85%_90%,85%_95%,8%_95%,0_70%)] [--clip-two:polygon(0_78%,100%_78%,100%_100%,95%_100%,95%_90%,85%_90%,85%_100%,8%_100%,0_78%)] [--clip-three:polygon(0_44%,100%_44%,100%_54%,95%_54%,95%_54%,85%_54%,85%_54%,8%_54%,0_54%)] [--clip-four:polygon(0_0,100%_0,100%_0,95%_0,95%_0,85%_0,85%_0,8%_0,0_0)] [--clip-five:polygon(0_0,100%_0,100%_0,95%_0,95%_0,85%_0,85%_0,8%_0,0_0)] [--clip-six:polygon(0_40%,100%_40%,100%_85%,95%_85%,95%_85%,85%_85%,85%_85%,8%_85%,0_70%)] [--clip-seven:polygon(0_63%,100%_63%,100%_80%,95%_80%,95%_80%,85%_80%,85%_80%,8%_80%,0_70%)] absolute inset-0 p-[1.4rem] text-(--modal-shadow) pointer-events-none z-[-1] opacity-0 group-data-[glitching=true]/modal:opacity-100 group-data-[glitching=true]/modal:[animation:cyberModalFullGlitch_1.6s_ease_forwards]';

// **CyberButton**
export const CYBER_BTN_BASE =
  'group [--corner:10px] [--border:1.5px] [--clip:polygon(0_0,100%_0,100%_calc(100%_-_var(--corner)),calc(100%_-_var(--corner))_100%,0%_100%)] [--btn-accent:var(--accent-cyan,#00f0ff)] [--btn-shadow:var(--accent-pink,#ff007f)] [font-family:var(--font-display,sans-serif)] font-black tracking-[1px] min-w-[140px] text-left uppercase inline-flex items-center gap-[0.6rem] py-[0.6rem] px-[0.8rem] border-0 bg-transparent relative text-(--btn-accent) cursor-pointer box-border select-none [transition:transform_0.15s_ease] overflow-visible disabled:opacity-40 disabled:cursor-not-allowed hover:text-[#0d0221] focus-visible:text-[#0d0221]';

export const CYBER_BTN_PINK = '![--btn-accent:var(--accent-pink,#ff007f)] ![--btn-shadow:#9d00ff]';

export const CYBER_BTN_YELLOW =
  '![--btn-accent:var(--accent-yellow,#ffe600)] ![--btn-shadow:#ff5500]';

export const CYBER_BTN_DANGER = '![--btn-accent:#ff0055] ![--btn-shadow:#ff0000]';

const CYBER_BTN_BACKDROP_SHARED =
  "absolute z-[1] inset-0 bg-[rgba(15,5,32,.85)] backdrop-blur-[8px] backdrop-saturate-[180%] [clip-path:var(--clip)] pointer-events-none [transition:background_0.2s_ease,box-shadow_0.2s_ease] before:content-[''] before:absolute before:inset-0 before:bg-(--btn-accent) before:[border:var(--border)_solid_transparent] before:[clip-path:var(--clip)] before:[mask:linear-gradient(#0000_0%_100%),linear-gradient(#fff_0%_100%)] before:![mask-clip:padding-box,border-box] before:![mask-repeat:no-repeat] before:![mask-composite:intersect] before:z-[2]";

export const CYBER_BTN_BACKDROP = `${CYBER_BTN_BACKDROP_SHARED} group-hover:bg-(--btn-accent) group-hover:shadow-[0_0_16px_var(--btn-accent)]`;

export const CYBER_BTN_BACKDROP_GLITCH = `${CYBER_BTN_BACKDROP_SHARED} group-hover:bg-[#0d0221]`;

export const CYBER_BTN_CORNER =
  "absolute bottom-0 right-0 h-(--corner) w-(--corner) after:content-[''] after:h-[calc(var(--border)*2)] after:w-[200%] after:absolute after:top-1/2 after:left-1/2 after:[translate:-50%_-50%] after:[transform:rotate(135deg)] after:bg-(--btn-accent)";

export const CYBER_BTN_KBD =
  'relative z-[3] text-[#0d0221] [font-family:var(--font-mono,monospace)] font-bold h-5 min-w-[20px] inline-grid place-items-center text-[0.65rem] px-1 rounded [transition:color_0.2s_ease,background_0.2s_ease] bg-(--btn-accent) group-hover:text-(--btn-accent) group-hover:bg-[#0d0221]';

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
  'absolute top-0 left-0 w-full h-[115px] z-[2] box-border flex flex-col items-center justify-end pt-2.5 px-3.5 pb-3.5 bg-(--bg-secondary) border-[2.5px] border-(--accent-pink) rounded-[1.2em_1.2em_0.4em_0.4em] shadow-[0_10px_30px_rgba(0,0,0,.85)]';

export const SLOT_HOLE_BOTTOM =
  'mx-auto w-[88%] h-8 box-border rounded-full border-[2.5px] border-[#ff007f] shadow-[inset_0_0_14px_#000] bg-[#020006]';

export const INVOICE_SLOT_TOP =
  'absolute top-0 left-0 w-full h-[82px] z-20 box-border flex flex-col items-center justify-between pt-2.5 px-3.5 pointer-events-none bg-(--bg-secondary) border-[2.5px] border-b-0 border-(--accent-pink) rounded-t-[1.2em]';

export const VENDING_HEADER_BAR =
  'w-full flex items-center justify-between text-[0.68rem] tracking-[1.5px] text-(--accent-yellow) uppercase [font-family:var(--font-heading)] font-extrabold px-1 box-border';

export const SLOT_HOLE_TOP =
  'mx-auto w-[88%] h-4 box-border rounded-t-full border-[2.5px] border-b-0 border-[#ff007f] shadow-none bg-[#020006]';

export const TICKET_PAPER_WRAPPER =
  'w-[80%] mt-[70px] mx-auto relative z-10 flex flex-col items-center box-border [clip-path:inset(0px_-50px_-10000px_-50px)]';

export const RESULTS_INVOICE =
  "relative top-6 z-[5] w-full mx-auto left-0 right-0 [font-family:'Atkinson_Hyperlegible_Mono',monospace] bg-[rgba(18,7,42,.97)] text-(--text-muted) py-[1.8em] px-[1.5em] rounded-b-[1.2em] border-[2.5px] border-(--accent-cyan) [border-top:2px_dashed_rgba(0,240,255,.6)] shadow-[0_15px_40px_rgba(0,0,0,.8)] [animation:printVendingTicketJitter_0.72s_cubic-bezier(.22,1,.36,1)_forwards] [transform-origin:top_center] box-border [will-change:transform,opacity] [backface-visibility:hidden] [transform:translate3d(0,0,0)] max-[520px]:py-[1.2em] max-[520px]:px-[1em]";

const TICKET_NOTCH_BASE = 'absolute top-[55px] w-4 h-4 rounded-full z-[6] bg-(--bg-primary)';

export const TICKET_NOTCH_LEFT = `${TICKET_NOTCH_BASE} -left-[9px] shadow-[inset_-2px_0_4px_rgba(0,0,0,.6)]`;

export const TICKET_NOTCH_RIGHT = `${TICKET_NOTCH_BASE} -right-[9px] shadow-[inset_2px_0_4px_rgba(0,0,0,.6)]`;

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
  'shrink-0 inline-flex items-center gap-1.5 whitespace-nowrap border-[1.5px] border-[rgba(0,240,255,.4)] rounded-lg py-[0.35em] px-[0.65em] text-[0.78rem] [font-family:var(--font-mono)] font-bold max-[520px]:text-[0.7rem]';

export const PAY_TAG_WIN =
  'border-[#ffe600] text-[#ffe600] bg-[rgba(255,230,0,.15)] shadow-[0_0_8px_rgba(255,230,0,.3)]';

export const PAY_TAG_RUNNER =
  'border-(--accent-cyan) text-(--accent-cyan) bg-[rgba(0,240,255,.15)]';

export const PAY_TAG_THIRD = 'border-[#ff9900] text-[#ff9900] bg-[rgba(255,153,0,.15)]';

export const PAY_TAG_FOURTH = 'border-white/35 text-(--text-muted) bg-white/[0.08]';

export const PAY_NOW_BTN =
  'w-full [font-family:var(--font-heading)] text-base bg-(--accent-pink) text-white py-[1.1em] border-2 border-(--accent-pink) rounded-[0.85em] shadow-[0_0_20px_rgba(255,0,127,.45)] cursor-pointer tracking-[1.5px] [transition:all_0.2s_ease] mt-[1.2em] hover:bg-[#00f0ff] hover:border-[#00f0ff] hover:text-[#0d0221] hover:shadow-[0_0_28px_#00f0ff] hover:-translate-y-0.5 max-[520px]:text-[0.88rem]';
