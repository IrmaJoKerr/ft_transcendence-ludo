import { useEffect, useRef, useState } from 'react';
import { retroAudio } from '../../utils/audio';

export function useUsernameCopy(username: string) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const copyUsername = () => {
    retroAudio.playUiBeep(720, 0.06);
    navigator.clipboard
      .writeText(username)
      .then(() => {
        setCopied(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), 1500);
      })
      .catch((err) => {
        console.error('Failed to copy username:', err);
      });
  };

  return { copied, copyUsername };
}
