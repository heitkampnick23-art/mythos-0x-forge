import { useEffect } from 'react';

export interface ToastMessage {
  id: number;
  text: string;
  tone: 'error' | 'info';
}

interface ToastProps {
  toast: ToastMessage;
  onDismiss: (id: number) => void;
}

export function Toast({ toast, onDismiss }: ToastProps) {
  useEffect(() => {
    const t = setTimeout(() => onDismiss(toast.id), 4500);
    return () => clearTimeout(t);
  }, [toast.id, onDismiss]);

  const accent =
    toast.tone === 'error'
      ? 'border-ember-blood/40 shadow-ember-glow'
      : 'border-white/10';

  return (
    <div
      role="status"
      className={`glass glass-edge animate-slide-up px-5 py-3.5 text-sm tracking-wide text-white/90 ${accent}`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`h-2 w-2 rounded-full ${
            toast.tone === 'error' ? 'bg-ember-blood animate-pulse-slow' : 'bg-ember-gold'
          }`}
        />
        <span>{toast.text}</span>
      </div>
    </div>
  );
}

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ToastMessage[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="pointer-events-none fixed right-6 top-6 z-50 flex w-[min(360px,90vw)] flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <Toast toast={t} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
}
