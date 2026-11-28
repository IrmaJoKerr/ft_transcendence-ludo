import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../../store';
import { DISPLAY_TAG } from '../../styles/tw';
import { retroAudio } from '../../utils/audio';
import { systemLineText } from '../chatCardTypes';
import type { ChatCardLine } from '../chatCardTypes';

// The transcript. Newest line at the bottom, scrolled there as it arrives, and a
//  live region so a line is announced rather than only painted.
export function ChatCardFeed({
  lines,
  onOpenName,
  senderColor,
  autoScroll = true,
  emptyTitleKey = 'chat.emptyTitle',
  emptyDescKey = 'chat.emptyDesc',
}: {
  lines: ChatCardLine[];
  onOpenName?: (line: ChatCardLine, anchor: DOMRect) => void;
  senderColor?: (line: ChatCardLine) => string | undefined;
  // A live card follows its newest line. An archived transcript opts out so it
  // opens at the oldest line instead of jumping to its own end.
  autoScroll?: boolean;
  emptyTitleKey?: string;
  emptyDescKey?: string;
}) {
  const feedRef = useRef<HTMLDivElement>(null);
  // Stick to the bottom only while the reader is already there: a scrollback must not
  // be yanked away by the next line (R8).
  const atBottomRef = useRef(autoScroll);

  useEffect(() => {
    if (!autoScroll) return;
    const feed = feedRef.current;
    if (feed && atBottomRef.current) feed.scrollTop = feed.scrollHeight;
  }, [lines.length, autoScroll]);

  return (
    <div
      ref={feedRef}
      aria-live="polite"
      className="chat-card-feed"
      onScroll={(event) => {
        const el = event.currentTarget;
        atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
      style={{
        flex: '1 1 0',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: lines.length === 0 ? 'center' : 'flex-start',
        alignItems: lines.length === 0 ? 'center' : 'stretch',
        gap: 6,
        padding: 10,
        overflowY: 'auto',
        borderRadius: 8,
        background: 'rgb(var(--shade-rgb) / 0.45)',
        border: '1px solid rgb(var(--accent-cyan-rgb) / 0.16)',
        textAlign: lines.length === 0 ? 'center' : 'left',
      }}
    >
      {lines.length === 0 ? (
        <FeedEmpty titleKey={emptyTitleKey} descKey={emptyDescKey} />
      ) : (
        lines.map((line) => (
          <FeedLine
            key={line.id}
            line={line}
            onOpenName={onOpenName}
            senderColor={senderColor}
          />
        ))
      )}
    </div>
  );
}

// One line of the transcript. A player's line is two rows (the sender above, the
//  text below), which is the layout that survives a 400 px card and a long name. A
//  system line is one centred row of muted text, because nobody said it.
function FeedLine({
  line,
  onOpenName,
  senderColor,
}: {
  line: ChatCardLine;
  onOpenName?: (line: ChatCardLine, anchor: DOMRect) => void;
  senderColor?: (line: ChatCardLine) => string | undefined;
}) {
  const { t } = useTranslation();
  const { user } = useApp();

  if (line.kind === 'system') {
    return (
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.6rem',
          letterSpacing: '0.4px',
          color: 'var(--text-muted)',
          textAlign: 'center',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
        }}
      >
        {systemLineText(t, line)}
      </span>
    );
  }

  const mine = user?.id === line.senderId;
  const nameStyle = {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.58rem',
    fontWeight: 900,
    letterSpacing: '0.5px',
    color: senderColor?.(line) ?? (mine ? 'var(--accent-cyan)' : 'var(--text-main)'),
    padding: 0,
    margin: 0,
    background: 'none',
    border: 'none',
    textAlign: 'left' as const,
    cursor: mine || !onOpenName ? 'default' : 'pointer',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
        {mine || !onOpenName ? (
          <span style={nameStyle}>{line.senderName}</span>
        ) : (
          <button
            type="button"
            style={nameStyle}
            title={line.senderName}
            onClick={(event) => {
              retroAudio.playUiBeep(640, 0.05);
              onOpenName(line, event.currentTarget.getBoundingClientRect());
            }}
          >
            {line.senderName}
          </button>
        )}
      </div>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.72rem',
          lineHeight: 1.45,
          color: mine ? 'var(--accent-cyan)' : 'var(--text-main)',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
        }}
      >
        {line.text}
      </span>
    </div>
  );
}

// The transcript's empty state. It stays a live region like the feed, so the first
//  line is announced where the placeholder was.
function FeedEmpty({ titleKey, descKey }: { titleKey: string; descKey: string }) {
  const { t } = useTranslation();
  return (
    <>
      <span
        className={DISPLAY_TAG}
      >
        {t(titleKey)}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.58rem',
          letterSpacing: '0.5px',
          lineHeight: 1.5,
          color: 'var(--text-muted)',
          maxWidth: 300,
        }}
      >
        {t(descKey)}
      </span>
    </>
  );
}
