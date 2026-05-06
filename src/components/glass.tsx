import type { HTMLAttributes, ReactNode } from 'react';

interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  hot?: boolean;
  edge?: boolean;
}

export function GlassPanel({
  children,
  hot = false,
  edge = true,
  className = '',
  ...rest
}: GlassPanelProps) {
  const base = hot ? 'glass-hot' : 'glass';
  return (
    <div className={`${base} ${edge ? 'glass-edge' : ''} ${className}`} {...rest}>
      {children}
    </div>
  );
}
