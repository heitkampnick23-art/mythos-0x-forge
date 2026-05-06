import { useCallback, useRef, useState } from 'react';
import { Hero } from './components/Hero';
import { CommandBar } from './components/CommandBar';
import { ForgeEye, type ForgeEyeHandle, type ForgeState } from './components/ForgeEye';
import { EmberField, type EmberMode } from './components/EmberField';
import { ToastStack, type ToastMessage } from './components/Toast';

export default function App() {
  const [state, setState] = useState<ForgeState>({ kind: 'idle' });
  const [emberMode, setEmberMode] = useState<EmberMode>('idle');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const forgeRef = useRef<ForgeEyeHandle>(null);

  const pushToast = useCallback((text: string, tone: ToastMessage['tone'] = 'error') => {
    setToasts((t) => [...t, { id: Date.now() + Math.random(), text, tone }]);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const onCommand = useCallback(
    (cmd: 'analyze' | 'clear' | 'upload') => {
      const f = forgeRef.current;
      if (!f) return;
      if (cmd === 'upload') f.pickFile();
      else if (cmd === 'clear') f.reset();
      else if (cmd === 'analyze') {
        if (state.kind === 'previewing') f.startScan();
        else if (state.kind === 'idle')
          pushToast('Drop media into the Forge Eye first.', 'info');
      }
    },
    [state, pushToast],
  );

  const heroVis = state.kind === 'idle' ? 1 : 0.25;

  return (
    <div className="relative min-h-screen w-full">
      {/* Background ember field, pinned to viewport */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <EmberField mode={emberMode} />
      </div>

      <Hero visibility={heroVis} />

      <ForgeEye
        ref={forgeRef}
        state={state}
        setState={setState}
        onError={(msg) => pushToast(msg, 'error')}
        onModeChange={setEmberMode}
      />

      <CommandBar onCommand={onCommand} />

      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <footer className="relative z-10 px-6 pb-28 pt-4 text-center font-mono text-[10px] uppercase tracking-[0.32em] text-white/25">
        Mythos · 0X · Forge — v0.1 simulated cortex
      </footer>
    </div>
  );
}
