type Path = string;

interface Props {
  onNavigate: (path: Path) => void;
  authenticated: boolean;
}

export function Footer({ onNavigate, authenticated }: Props) {
  const link = (label: string, path: Path) => (
    <button
      type="button"
      onClick={() => onNavigate(path)}
      className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/35 transition hover:text-ember-gold"
    >
      {label}
    </button>
  );

  return (
    <footer className="relative z-10 border-t border-white/[0.04] px-6 pb-16 pt-10">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-6">
        <div className="text-center">
          <div className="wordmark text-glow text-2xl font-semibold tracking-tight">
            Mythos&nbsp;<span className="font-mono font-light italic">0X</span>&nbsp;Forge
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.32em] text-white/30">
            Command Reality. Forge Truth.
          </div>
        </div>

        <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
          {link('Forge', '/')}
          {link('Heartbeat', '/agents')}
          {link('Feed', '/feed')}
          {link('Bulk', '/batch')}
          {link('For Attorneys', '/for-attorneys')}
          {link('Pricing', '/pricing')}
          {authenticated && link('History', '/history')}
          {authenticated && link('Account', '/account')}
          <span className="h-3 w-px bg-white/10" />
          {link('Terms', '/terms')}
          {link('Privacy', '/privacy')}
          {link('Acceptable Use', '/aup')}
        </nav>

        <p className="max-w-2xl text-center font-mono text-[9px] uppercase leading-relaxed tracking-[0.22em] text-white/25">
          Verdicts are probabilistic estimates from automated detection models. They are not
          legal evidence. Use accordingly.
        </p>

        <div className="font-mono text-[9px] uppercase tracking-[0.32em] text-white/20">
          © 2026 Mythos · v0.3
        </div>
      </div>
    </footer>
  );
}
