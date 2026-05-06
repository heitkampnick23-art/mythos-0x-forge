import { useEffect, useRef } from 'react';
import type { BoundingBox } from '../lib/analyzeMedia';

interface Props {
  boxes: BoundingBox[];
  /** progress 0..1 — boxes draw in sequentially during scan */
  reveal: number;
}

export function BoundingBoxOverlay({ boxes, reveal }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  // Force a tick on mount for any pulse animations driven by canvas;
  // the boxes themselves are SVG and animate via CSS.
  useEffect(() => {
    const tick = () => {
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const visibleCount = Math.ceil(boxes.length * Math.max(0, Math.min(1, reveal)));

  return (
    <div ref={ref} className="pointer-events-none absolute inset-0">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="h-full w-full"
      >
        {boxes.slice(0, visibleCount).map((b, i) => {
          const x = b.x * 100;
          const y = b.y * 100;
          const w = b.width * 100;
          const h = b.height * 100;
          const stroke =
            b.severity > 0.75 ? '#c81d25' : b.severity > 0.55 ? '#ff5722' : '#ffb347';
          return (
            <g key={i} className="animate-fade-in" style={{ animationDelay: `${i * 120}ms` }}>
              {/* faint fill */}
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                fill={stroke}
                opacity={0.06}
                rx={0.6}
              />
              {/* corner brackets */}
              {corners(x, y, w, h).map((d, k) => (
                <path
                  key={k}
                  d={d}
                  stroke={stroke}
                  strokeWidth={0.45}
                  fill="none"
                  vectorEffect="non-scaling-stroke"
                  opacity={0.95}
                />
              ))}
              {/* label */}
              <foreignObject x={x} y={Math.max(0, y - 4)} width={w} height={4}>
                <div
                  style={{
                    fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                    fontSize: '1.3px',
                    color: stroke,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    textShadow: '0 0 1.5px rgba(0,0,0,0.9)',
                  }}
                >
                  ◢ {b.label}
                </div>
              </foreignObject>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function corners(x: number, y: number, w: number, h: number): string[] {
  const c = Math.min(w, h) * 0.18;
  return [
    `M ${x} ${y + c} L ${x} ${y} L ${x + c} ${y}`,
    `M ${x + w - c} ${y} L ${x + w} ${y} L ${x + w} ${y + c}`,
    `M ${x + w} ${y + h - c} L ${x + w} ${y + h} L ${x + w - c} ${y + h}`,
    `M ${x + c} ${y + h} L ${x} ${y + h} L ${x} ${y + h - c}`,
  ];
}
