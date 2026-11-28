import type { CSSProperties } from 'react';
import { CAGE_HALF } from './keyframes';

export function JailAct({
  jailFx,
  cageFrom,
  cageCx,
  cageTopY,
  cageH,
  winnerColor,
  cageBars,
}: {
  jailFx: (name: string) => string;
  cageFrom: string;
  cageCx: number;
  cageTopY: number;
  cageH: number;
  winnerColor: string;
  cageBars: number;
}) {
  return (
    <g style={{ animation: jailFx('fxCage'), '--cageFrom': cageFrom } as CSSProperties}>
      <g style={{ animation: jailFx('fxArc') }}>
        <rect
          x={cageCx - CAGE_HALF}
          y={cageTopY}
          width={CAGE_HALF * 2}
          height="4"
          rx="2"
          fill={winnerColor}
        />
        {Array.from({ length: cageBars }, (_, i) => {
          const bx = cageCx - CAGE_HALF + ((CAGE_HALF * 2) / (cageBars - 1)) * i;
          return (
            <g key={`bar-${i}`}>
              <rect
                x={bx - 3.5}
                y={cageTopY}
                width="7"
                height={cageH}
                fill={winnerColor}
                opacity=".2"
              />
              <rect
                x={bx - 1.5}
                y={cageTopY}
                width="3"
                height={cageH}
                fill={winnerColor}
                opacity=".95"
              />
            </g>
          );
        })}
      </g>
    </g>
  );
}
