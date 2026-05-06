import { useCallback, useEffect, useRef, useState } from 'react';
import { Hero } from './components/Hero';
import { CommandBar } from './components/CommandBar';
import { ForgeEye, type ForgeEyeHandle, type ForgeState } from './components/ForgeEye';
import { EmberField, type EmberMode } from './components/EmberField';
import { ToastStack, type ToastMessage } from './components/Toast';
import { AuthBar } from './components/AuthBar';
import { Pricing } from './components/Pricing';
import { Account } from './components/Account';
import { History } from './components/History';
import { Footer } from './components/Footer';
import { Terms } from './components/legal/Terms';
import { Privacy } from './components/legal/Privacy';
import { AUP } from './components/legal/AUP';
import { useAuth } from './hooks/useAuth';

type Route = '/' | '/pricing' | '/account' | '/history' | '/terms' | '/privacy' | '/aup';

const ROUTES: Route[] = ['/', '/pricing', '/account', '/history', '/terms', '/privacy', '/aup'];

function currentRoute(): Route {
  const p = window.location.pathname as Route;
  return ROUTES.includes(p) ? p : '/';
}

export default function App() {
  const [route, setRoute] = useState<Route>(currentRoute);
  const [state, setState] = useState<ForgeState>({ kind: 'idle' });
  const [emberMode, setEmberMode] = useState<EmberMode>('idle');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const forgeRef = useRef<ForgeEyeHandle>(null);
  const { me, refresh } = useAuth();

  useEffect(() => {
    const onPop = () => setRoute(currentRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const pushToast = useCallback((text: string, tone: ToastMessage['tone'] = 'error') => {
    setToasts((t) => [...t, { id: Date.now() + Math.random(), text, tone }]);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const navigate = useCallback((path: Route) => {
    window.history.pushState(null, '', path);
    setRoute(path);
    window.scrollTo({ top: 0 });
  }, []);

  // Acknowledge auth + checkout query params on landing
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') === 'ok') {
      pushToast('Signed in.', 'info');
      void refresh();
      cleanQuery();
    } else if (params.get('auth') === 'expired') {
      pushToast('That sign-in link expired. Try again.', 'error');
      cleanQuery();
    } else if (params.get('checkout') === 'success') {
      pushToast('Payment received. Welcome to the Forge.', 'info');
      void refresh();
      cleanQuery();
    } else if (params.get('checkout') === 'cancel') {
      pushToast('Checkout cancelled.', 'info');
      cleanQuery();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      <div className="pointer-events-none fixed inset-0 z-0">
        <EmberField mode={emberMode} />
      </div>

      <AuthBar me={me} onRefresh={refresh} onNavigate={navigate} />

      {route === '/' && (
        <>
          <Hero visibility={heroVis} />
          <ForgeEye
            ref={forgeRef}
            state={state}
            setState={setState}
            onError={(msg) => pushToast(msg, 'error')}
            onModeChange={setEmberMode}
            onPaywall={(detail) => {
              pushToast(
                `${detail.tier === 'free' ? 'Free' : detail.tier} tier limit reached (${detail.used}/${detail.limit}). Upgrade for more.`,
                'error',
              );
              setTimeout(() => navigate('/pricing'), 800);
            }}
          />
          <CommandBar onCommand={onCommand} />
        </>
      )}

      {route === '/pricing' && <Pricing me={me} onNavigate={navigate} />}
      {route === '/account' && (
        <Account me={me} onRefresh={refresh} onNavigate={navigate} />
      )}
      {route === '/history' && <History me={me} onNavigate={navigate} />}
      {route === '/terms' && <Terms onBack={() => navigate('/')} />}
      {route === '/privacy' && <Privacy onBack={() => navigate('/')} />}
      {route === '/aup' && <AUP onBack={() => navigate('/')} />}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <Footer onNavigate={navigate} authenticated={!!me?.authenticated} />
    </div>
  );
}

function cleanQuery() {
  window.history.replaceState(null, '', window.location.pathname);
}
