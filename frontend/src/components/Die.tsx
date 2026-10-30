import { useEffect, useState } from 'react';

// Pip indexes (3×3 grid, row-major) lit per face value.
const PIP_MAP: Partial<Record<number, number[]>> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

export function Die({
  value,
  rolling,
  brakeTo = null,
}: {
  value: number;
  rolling: boolean;
  // Set while a braked roll decelerates: the face the server sent, whose neighbour
  // is shown until the roll lands. Null whenever no brake is running.
  brakeTo?: number | null;
}) {
  const [displayValue, setDisplayValue] = useState(value || 1);

  useEffect(() => {
    if (!rolling || brakeTo != null) {
      // At rest the face is the server's value. A braked die holds its last random
      // face and the near-miss below takes over.
      if (!rolling) setDisplayValue(value || 1);
      return;
    }

    // The tumble accelerates rather than ticking at a fixed rate, so it reads as
    // energy being spent. `brakeTo` stops it: the brake's own settle is the
    // deceleration, and it must not be interrupted by another random face.
    let delay = 120;
    let timer: ReturnType<typeof setTimeout>;
    const flip = () => {
      setDisplayValue(Math.floor(Math.random() * 6) + 1);
      delay = Math.max(55, Math.round(delay * 0.86));
      timer = setTimeout(flip, delay);
    };
    timer = setTimeout(flip, delay);

    return () => clearTimeout(timer);
  }, [rolling, value, brakeTo]);

  // The neighbouring face, never 0 or 7: what the braked die slows onto before the
  // real value lands.
  const nearMiss = brakeTo == null ? null : brakeTo === 6 ? 5 : brakeTo + 1;
  const on = PIP_MAP[nearMiss ?? (rolling ? displayValue : value || displayValue)] ?? [];

  return (
    <div
      style={{
        width: 80,
        height: 80,
        borderRadius: 17,
        background: 'linear-gradient(150deg,#fbf5e6,#e4d8bf)',
        boxShadow:
          'inset 0 2px 4px rgba(255,255,255,.8),inset 0 -6px 10px rgba(140,120,80,.35),0 14px 24px -10px rgba(0,0,0,.7)',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gridTemplateRows: '1fr 1fr 1fr',
        padding: 13,
        gap: 3,
        // A braked die wobbles more slowly: the same keyframes, longer, which is
        // what makes the settle look like a slowdown.
        animation: rolling
          ? `shake ${nearMiss == null ? 0.62 : 0.95}s ease-in-out infinite`
          : 'none',
        border: '1px solid #cbb99a',
        transition: 'transform 0.2s ease',
      }}
    >
      {Array.from({ length: 9 }, (_, i) => (
        <div key={i} style={{ display: 'grid', placeItems: 'center' }}>
          {on.includes(i) ? (
            <div
              style={{
                width: 13,
                height: 13,
                borderRadius: '50%',
                background: 'radial-gradient(circle at 35% 30%,#5a4a2e,#241a0c)',
                boxShadow: 'inset 0 1px 1px rgba(0,0,0,.5)',
              }}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}
