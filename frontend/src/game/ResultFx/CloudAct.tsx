import type { CSSProperties } from 'react';
import {
  CLOUD_BELLY_HALF,
  CLOUD_BELLY_UP,
  CLOUD_CROWN_R,
  CLOUD_CROWN_UP,
  CLOUD_HEAD_R,
  CLOUD_HEAD_UP,
  CLOUD_HEAD_X,
  CLOUD_RING_R,
  CLOUD_RING_RY,
  CLOUD_STEM_BASE_HALF,
  CLOUD_STEM_TOP_HALF,
  CLOUD_STEM_TOP_UP,
  DOME_CX,
  GROUND_Y,
} from './geometry';

export function CloudAct({
  winnerColor,
  cloudGate,
  cloudFx,
  pivot,
  growsUp,
}: {
  winnerColor: string;
  cloudGate: CSSProperties;
  cloudFx: (name: string) => string;
  pivot: CSSProperties;
  growsUp: CSSProperties;
}) {
  return (
        <g transform={`translate(${DOME_CX} ${GROUND_Y})`} style={cloudGate}>
          <ellipse
            rx={CLOUD_RING_R}
            ry={CLOUD_RING_RY}
            fill='none'
            stroke={winnerColor}
            strokeWidth='3'
            style={{ ...pivot, animation: cloudFx('fxCloudRing') }}
          />
          <g style={{ ...growsUp, animation: cloudFx('fxCloudBody') }}>
            {/* the stem, veiled so the head reads in front of it */}
            <path
              d={
                `M ${-CLOUD_STEM_BASE_HALF} 0 L ${-CLOUD_STEM_TOP_HALF} ${-CLOUD_STEM_TOP_UP} ` +
                `L ${CLOUD_STEM_TOP_HALF} ${-CLOUD_STEM_TOP_UP} L ${CLOUD_STEM_BASE_HALF} 0 Z`
              }
              fill={winnerColor}
              opacity='.55'
            />
            {/* the head: a belly bar joining three puffs to the stem */}
            <rect
              x={-CLOUD_BELLY_HALF}
              y={-CLOUD_BELLY_UP}
              width={CLOUD_BELLY_HALF * 2}
              height={CLOUD_BELLY_UP - CLOUD_STEM_TOP_UP + 2}
              rx={(CLOUD_BELLY_UP - CLOUD_STEM_TOP_UP) / 2}
              fill={winnerColor}
            />
            <circle cx={-CLOUD_HEAD_X} cy={-CLOUD_HEAD_UP} r={CLOUD_HEAD_R} fill={winnerColor} />
            <circle cx={CLOUD_HEAD_X} cy={-CLOUD_HEAD_UP} r={CLOUD_HEAD_R} fill={winnerColor} />
            <circle cx={0} cy={-CLOUD_CROWN_UP} r={CLOUD_CROWN_R} fill={winnerColor} />
          </g>
        </g>
  );
}
