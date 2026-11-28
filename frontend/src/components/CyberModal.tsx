import React, { useCallback, useEffect, useState, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { retroAudio } from '../utils/audio';
import {
  CYBER_MODAL_OVERLAY,
  CYBER_MODAL_BOX,
  CYBER_MODAL_BODY,
  CYBER_MODAL_BODY_BACKDROP,
  CYBER_MODAL_BACKDROP_PLATE,
  CYBER_MODAL_CONTENT,
  CYBER_MODAL_VERSION,
  CYBER_MODAL_H2,
  CYBER_MODAL_H2_SPAN,
  CYBER_MODAL_BODY_TEXT,
  CYBER_MODAL_ACTIONS,
  CYBER_MODAL_GLITCH,
  CYBER_BTN_BASE,
  CYBER_BTN_PINK,
  CYBER_BTN_YELLOW,
  CYBER_BTN_DANGER,
  CYBER_BTN_BACKDROP,
  CYBER_BTN_BACKDROP_GLITCH,
  CYBER_BTN_CORNER,
  CYBER_BTN_KBD,
  CYBER_BTN_LABEL,
  CYBER_BTN_GLITCH_LAYER,
  CYBER_BTN_LETTERS,
} from '../styles/tw';

interface CyberButtonProps {
  label: string;
  shortcut?: string | ReactNode;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  variant?: 'cyan' | 'pink' | 'yellow' | 'danger';
  disabled?: boolean;
  style?: CSSProperties;
  className?: string;
  autoFocus?: boolean;
  type?: 'button' | 'submit' | 'reset';
}

export function CyberButton({
  label,
  shortcut,
  onClick,
  variant = 'cyan',
  disabled = false,
  style,
  className = '',
  autoFocus = false,
  type = 'button',
}: CyberButtonProps) {
  const variantClass =
    variant === 'pink'
      ? CYBER_BTN_PINK
      : variant === 'yellow'
        ? CYBER_BTN_YELLOW
        : variant === 'danger'
          ? CYBER_BTN_DANGER
          : '';

  const letters = typeof label === 'string' ? label.split('') : [];

  return (
    <button
      type={type}
      className={`${CYBER_BTN_BASE} ${variantClass} ${className}`}
      onClick={onClick}
      disabled={disabled}
      autoFocus={autoFocus}
      style={style}
    >
      <span className={CYBER_BTN_BACKDROP}>
        <span className={CYBER_BTN_CORNER} />
      </span>
      {shortcut && <kbd className={CYBER_BTN_KBD}>{shortcut}</kbd>}
      <span className={CYBER_BTN_LABEL}>{label}</span>

      {/* Cyber Glitch Layer on Hover */}
      {letters.length > 0 && (
        <div className={CYBER_BTN_GLITCH_LAYER} aria-hidden="true">
          <span className={CYBER_BTN_BACKDROP_GLITCH}>
            <span className={CYBER_BTN_CORNER} />
          </span>
          {shortcut && <kbd className={CYBER_BTN_KBD}>{shortcut}</kbd>}
          <span className={CYBER_BTN_LETTERS}>
            {letters.map((char, index) => (
              <span key={index}>{char === ' ' ? '\u00A0' : char}</span>
            ))}
          </span>
        </div>
      )}
    </button>
  );
}

interface CyberModalProps {
  isOpen: boolean;
  title: string;
  message: ReactNode;
  subMessage?: string;
  versionTag?: string;
  onCancel: () => void;
  onProceed: () => void;
  cancelLabel?: string;
  proceedLabel?: string;
  cancelShortcut?: string;
  proceedShortcut?: string;
  isDanger?: boolean;
  closeOnProceed?: boolean;
  panelStyle?: CSSProperties;
}

export function CyberModal({
  isOpen,
  title,
  message,
  subMessage,
  versionTag = 'v001.e1349837856',
  onCancel,
  onProceed,
  cancelLabel = 'CANCEL',
  proceedLabel = 'PROCEED',
  cancelShortcut = 'ESC',
  proceedShortcut = '↵',
  isDanger = false,
  closeOnProceed = true,
  panelStyle,
}: CyberModalProps) {
  const [mounted, setMounted] = useState(isOpen);
  const [isOpenActive, setIsOpenActive] = useState(false);
  const [isGlitching, setIsGlitching] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const glitchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      // Double rAF ensures DOM is painted before transition classes trigger
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsOpenActive(true);
          retroAudio.playCyberSlide();
        });
      });

      // Glitch timing choreography
      const kickOffGlitch = () => {
        setIsGlitching(true);
        setTimeout(() => setIsGlitching(false), 1600);
        const nextInterval = Math.random() * 8000 + 4000;
        glitchTimerRef.current = setTimeout(kickOffGlitch, nextInterval);
      };

      glitchTimerRef.current = setTimeout(kickOffGlitch, 1500);
    } else {
      setIsOpenActive(false);
      if (glitchTimerRef.current) clearTimeout(glitchTimerRef.current);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setMounted(false);
      }, 350);
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (glitchTimerRef.current) clearTimeout(glitchTimerRef.current);
    };
  }, [isOpen]);

  const handleCancel = useCallback(() => {
    retroAudio.playCyberReject();
    setIsOpenActive(false);
    setTimeout(() => {
      onCancel();
    }, 280);
  }, [onCancel]);

  const handleProceed = useCallback(() => {
    retroAudio.playCyberAccept();
    if (!closeOnProceed) {
      onProceed();
      return;
    }
    setIsOpenActive(false);
    setTimeout(() => {
      onProceed();
    }, 280);
  }, [closeOnProceed, onProceed]);

  useEffect(() => {
    if (!isOpenActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleProceed();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpenActive, handleCancel, handleProceed]);

  if (!mounted) return null;

  return (
    <div
      className={CYBER_MODAL_OVERLAY}
      data-modal-state={isOpenActive ? 'open' : 'closed'}
      data-glitching={isGlitching ? 'true' : 'false'}
      onClick={handleCancel}
    >
      <div className={CYBER_MODAL_BOX} style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <section className={CYBER_MODAL_BODY}>
          {/* Animated Sliding Backdrop Plate */}
          <div className={CYBER_MODAL_BODY_BACKDROP}>
            <div className={CYBER_MODAL_BACKDROP_PLATE} />
          </div>

          <div className={CYBER_MODAL_CONTENT}>
            <span className={CYBER_MODAL_VERSION}>{versionTag}</span>
            <h2 className={CYBER_MODAL_H2}>
              <span className={CYBER_MODAL_H2_SPAN}>{title}</span>
            </h2>
            <div className={CYBER_MODAL_BODY_TEXT}>
              {typeof message === 'string' ? <p>{message}</p> : message}
              {subMessage && <p>{subMessage}</p>}
            </div>

            {/* Glitch Keyframe Overlay */}
            <div className={CYBER_MODAL_GLITCH} aria-hidden="true">
              <h2 className={CYBER_MODAL_H2}>
                <span className={CYBER_MODAL_H2_SPAN}>{title}</span>
              </h2>
              <div className={CYBER_MODAL_BODY_TEXT}>
                {typeof message === 'string' ? <p>{message}</p> : message}
                {subMessage && <p>{subMessage}</p>}
              </div>
            </div>

            <div className={CYBER_MODAL_ACTIONS}>
              <CyberButton
                label={cancelLabel}
                shortcut={cancelShortcut}
                onClick={handleCancel}
                variant="pink"
              />
              <CyberButton
                label={proceedLabel}
                shortcut={proceedShortcut}
                onClick={handleProceed}
                variant={isDanger ? 'danger' : 'cyan'}
                autoFocus
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
