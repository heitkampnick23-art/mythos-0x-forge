interface HeroProps {
  /** 1 = full hero; 0 = collapsed (when media is loaded) */
  visibility: number;
}

export function Hero({ visibility }: HeroProps) {
  const o = Math.max(0, Math.min(1, visibility));
  return (
    <header
      className="pointer-events-none relative z-10 flex flex-col items-center px-6 pt-24 text-center transition-all duration-700"
      style={{
        opacity: o,
        transform: `translateY(${(1 - o) * -40}px) scale(${0.92 + 0.08 * o})`,
      }}
    >
      <div className="mb-3 flex items-center gap-3 text-[10px] font-medium uppercase tracking-[0.4em] text-ember-gold/70">
        <span className="h-px w-8 bg-gradient-to-r from-transparent to-ember-gold/60" />
        Forensic AI Authentication
        <span className="h-px w-8 bg-gradient-to-l from-transparent to-ember-gold/60" />
      </div>
      <h1 className="wordmark text-glow text-6xl leading-[0.95] sm:text-7xl md:text-[88px]">
        Mythos&nbsp;<span className="font-mono font-light italic">0X</span>&nbsp;Forge
      </h1>
      <p className="mt-5 max-w-xl font-display text-base font-light tracking-[0.16em] text-white/55 sm:text-lg">
        Command Reality. Forge Truth.
      </p>
    </header>
  );
}
