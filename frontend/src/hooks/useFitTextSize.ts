import { useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

type FitTextSizeOptions = {
  // Font size (px) kept whenever the text already fits: the design size.
  maxFontSize: number;
  // Lower bound (px) so long locales never shrink into illegibility.
  minFontSize?: number;
  // Extra horizontal px kept free around the text as breathing room.
  reserve?: number;
};

// Font size the off-screen measuring span is rendered at.
const REFERENCE_FONT_SIZE = 100;
// Fitted sizes are floored to this step to avoid sub-pixel clipping.
const FONT_SIZE_STEP = 0.25;
// Separator used to turn the candidate strings into a stable dependency key.
const TEXT_SEPARATOR = '\u0000';

let measureSpan: HTMLSpanElement | null = null;

// Width of `text` rendered in `font` (a CSS font shorthand) with letter-spacing
// switched off, so callers can add their own tracking back into the equation.
function measureTextWidth(text: string, font: string): number {
  if (!measureSpan) {
    measureSpan = document.createElement('span');
    measureSpan.setAttribute('aria-hidden', 'true');
    // Out of flow and hidden: never painted, never part of the layout.
    measureSpan.style.position = 'absolute';
    measureSpan.style.top = '0';
    measureSpan.style.left = '-9999px';
    measureSpan.style.whiteSpace = 'pre';
    measureSpan.style.visibility = 'hidden';
    measureSpan.style.letterSpacing = '0';
    measureSpan.style.pointerEvents = 'none';
    document.body.appendChild(measureSpan);
  }
  measureSpan.style.font = font;
  measureSpan.textContent = text;
  return measureSpan.getBoundingClientRect().width;
}

// Keeps single-line text (input placeholder/value, nowrap labels) inside its own box regardless of
// locale: the returned `fontSize` is the largest size at or below `maxFontSize` for which every
// entry of `texts` fits the element's content box.
export function useFitTextSize<T extends HTMLElement = HTMLInputElement>(
  texts: ReadonlyArray<string | null | undefined>,
  { maxFontSize, minFontSize = 9, reserve = 0 }: FitTextSizeOptions,
): { ref: RefObject<T | null>; fontSize: number } {
  const ref = useRef<T>(null);
  const [fontSize, setFontSize] = useState(maxFontSize);
  const textsKey = texts.join(TEXT_SEPARATOR);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;

    const fit = () => {
      if (cancelled) return;
      const computed = getComputedStyle(el);
      // clientWidth spans the content box plus padding (borders are excluded).
      const available =
        el.clientWidth -
        (parseFloat(computed.paddingLeft) || 0) -
        (parseFloat(computed.paddingRight) || 0) -
        reserve;
      if (available <= 0) return;

      const letterSpacing = parseFloat(computed.letterSpacing) || 0; // 'normal' -> NaN
      const font = `${computed.fontWeight} ${REFERENCE_FONT_SIZE}px ${computed.fontFamily}`;

      let fitted = maxFontSize;
      for (const text of textsKey ? textsKey.split(TEXT_SEPARATOR) : []) {
        if (!text) continue;
        const referenceWidth = measureTextWidth(text, font);
        if (referenceWidth <= 0) continue;
        // required(size) = referenceWidth * size / REFERENCE_FONT_SIZE
        //                  + letterSpacing * (length - 1)
        const usable = available - letterSpacing * Math.max(text.length - 1, 0);
        fitted = Math.min(fitted, (usable * REFERENCE_FONT_SIZE) / referenceWidth);
      }

      const stepped = Math.floor(fitted / FONT_SIZE_STEP) * FONT_SIZE_STEP;
      const next = Math.min(Math.max(stepped, minFontSize), maxFontSize);
      setFontSize((prev) => (prev === next ? prev : next));
    };

    fit();
    // Web fonts may still be loading on first paint: re-fit once they are ready.
    void document.fonts.ready.then(() => fit());
    const observer = new ResizeObserver(fit);
    observer.observe(el);

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [textsKey, maxFontSize, minFontSize, reserve]);

  return { ref, fontSize };
}
