import type { ReactNode } from 'react';
import { GlassPanel } from '../glass';

interface Props {
  title: string;
  effective: string;
  onBack: () => void;
  children: ReactNode;
}

export function LegalLayout({ title, effective, onBack, children }: Props) {
  return (
    <main className="relative z-10 mx-auto w-full max-w-3xl px-4 pb-24 pt-28 sm:px-6 sm:pt-32">
      <button
        type="button"
        onClick={onBack}
        className="mb-6 text-[10px] uppercase tracking-[0.32em] text-white/40 hover:text-ember-gold"
      >
        ← Back to Forge
      </button>
      <header className="mb-8">
        <div className="text-[10px] font-medium uppercase tracking-[0.4em] text-ember-gold/70">
          Legal
        </div>
        <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          {title}
        </h1>
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.22em] text-white/35">
          Effective {effective}
        </p>
      </header>
      <GlassPanel edge className="prose-invert legal p-7 sm:p-10">
        {children}
      </GlassPanel>
    </main>
  );
}
