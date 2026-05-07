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
import { Marketplace as Heartbeat } from './components/heartbeat/Marketplace';
import { CreateSoul } from './components/heartbeat/CreateSoul';
import { SoulChat } from './components/heartbeat/SoulChat';
import { useAuth } from './hooks/useAuth';

type Route =
  | '/'
  | '/pricing'
  | '/account'
  | '/history'
  | '/terms'
  | '/privacy'
  | '/aup'
  | '/agents'
  | '/agents/new'
  | { kind: 'soul'; idOrSlug: string };

const STATIC_ROUTES = [
  '/', '/pricing', '/account', '/history', '/terms', '/privacy', '/aup',
  '/agents', '/agents/new',
] as const;

function currentRoute(): Route {
  const p = window.location.pathname;
  if ((STATIC_ROUTES as readonly string[]).includes(p)) return p as Route;
  const m = p.match(/^\/agents\/([^/]+)$/);
  if (m) return { kind: 'soul', idOrSlug: m[1] };
  return '/';
}

export default function App() {
  const [route, setRoute] = useState<Route>(currentRoute);
  const [state, setState] = useState<ForgeState>({ kind: 'idle' });
  const [emberMode, setEmberMode] = useState<EmberMode>('idle');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const forgeRef = useRef<ForgeEyeHandle>(null);
  const [signInOpen, setSignInOpen] = useState(false);
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

  const navigate = useCallback((path: string) => {
    window.history.pushState(null, '', path);
    // Reparse from URL so dynamic routes like /agents/:slug land correctly
    setRoute(currentRoute());
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

      <AuthBar
        me={me}
        onRefresh={refresh}
        onNavigate={navigate}
        forceSignInOpen={signInOpen}
        onSignInClose={() => setSignInOpen(false)}
      />

      {route === '/' && (
        <>
          <Hero visibility={heroVis} />
          <ForgeEye
            ref={forgeRef}
            state={state}
            setState={setState}
            onError={(msg) => pushToast(msg, 'error')}
            onModeChange={setEmberMode}
            authenticated={!!me?.authenticated}
            tier={me?.user?.tier ?? 'free'}
            onUpgrade={() => navigate('/pricing')}
            onSignIn={() => setSignInOpen(true)}
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

      {route === '/agents' && (
        <Heartbeat
          me={me}
          onOpen={(idOrSlug) => navigate(`/agents/${idOrSlug}`)}
          onCreate={() => {
            if (!me?.authenticated) setSignInOpen(true);
            else if ((me.user?.tier ?? 'free') === 'free') navigate('/pricing');
            else navigate('/agents/new');
          }}
        />
      )}
      {route === '/agents/new' && (
        <CreateSoul
          me={me}
          onCreated={(idOrSlug) => navigate(`/agents/${idOrSlug}`)}
          onBack={() => navigate('/agents')}
        />
      )}
      {typeof route === 'object' && route.kind === 'soul' && (
        <SoulChat
          idOrSlug={route.idOrSlug}
          me={me}
          onBack={() => navigate('/agents')}
          onUpgrade={() => navigate('/pricing')}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      <Footer onNavigate={navigate} authenticated={!!me?.authenticated} />
    </div>
  );
}

function cleanQuery() {
  window.history.replaceState(null, '', window.location.pathname);
}
