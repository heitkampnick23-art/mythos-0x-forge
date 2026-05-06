import { useEffect, useMemo, useState } from 'react';
import Particles, { initParticlesEngine } from '@tsparticles/react';
import { loadSlim } from '@tsparticles/slim';
import type { ISourceOptions } from '@tsparticles/engine';
import { useReducedMotion } from '../hooks/useReducedMotion';

export type EmberMode = 'idle' | 'scanning' | 'flagged';

interface EmberFieldProps {
  mode?: EmberMode;
  /** scaling factor 0..1 — used for mobile / reduced-motion */
  density?: number;
  className?: string;
}

const COLORS_BY_MODE: Record<EmberMode, string[]> = {
  idle: ['#ffb347', '#ff7a1f', '#ff5722'],
  scanning: ['#ff7a1f', '#ff5722', '#c81d25'],
  flagged: ['#c81d25', '#ff5722', '#6b2fb3'],
};

export function EmberField({ mode = 'idle', density = 1, className = '' }: EmberFieldProps) {
  const reduced = useReducedMotion();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    initParticlesEngine(async (engine) => {
      await loadSlim(engine);
    }).then(() => setReady(true));
  }, []);

  const options = useMemo<ISourceOptions>(() => {
    const baseCount = reduced ? 12 : 80;
    const speed =
      mode === 'flagged' ? 1.4 : mode === 'scanning' ? 1.1 : 0.55;
    return {
      fullScreen: { enable: false },
      background: { color: { value: 'transparent' } },
      detectRetina: true,
      fpsLimit: 60,
      particles: {
        number: {
          value: Math.round(baseCount * density),
          density: { enable: true, width: 1920, height: 1080 },
        },
        color: { value: COLORS_BY_MODE[mode] },
        shape: { type: 'circle' },
        opacity: {
          value: { min: 0.15, max: 0.65 },
          animation: { enable: !reduced, speed: 0.6, sync: false },
        },
        size: {
          value: { min: 0.6, max: 2.6 },
          animation: { enable: !reduced, speed: 1.2, sync: false },
        },
        move: {
          enable: true,
          direction: 'top',
          speed: { min: speed * 0.4, max: speed },
          straight: false,
          random: true,
          outModes: { default: 'out', top: 'out', bottom: 'out' },
        },
        life: {
          duration: { value: { min: 3, max: 8 } },
          count: 0,
        },
      },
      emitters: reduced
        ? []
        : [
            {
              direction: 'top',
              rate: { delay: 0.2, quantity: mode === 'flagged' ? 4 : 2 },
              size: { width: 100, height: 0, mode: 'percent' },
              position: { x: 50, y: 100 },
              particles: {
                shape: { type: 'circle' },
                color: { value: COLORS_BY_MODE[mode] },
                opacity: { value: { min: 0.3, max: 0.9 } },
                size: { value: { min: 0.8, max: 2.2 } },
                move: { speed: { min: speed * 0.6, max: speed * 1.4 } },
              },
            },
          ],
      interactivity: {
        events: { onHover: { enable: !reduced, mode: 'attract' }, resize: { enable: true } },
        modes: { attract: { distance: 120, duration: 0.4, factor: 2 } },
      },
    };
  }, [mode, density, reduced]);

  if (!ready) return null;

  return (
    <Particles
      id="ember-field"
      className={`pointer-events-none absolute inset-0 ${className}`}
      options={options}
    />
  );
}
