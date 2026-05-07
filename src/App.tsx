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
import { VerdictPage } from './components/VerdictPage';
import { Batch } from './components/Batch';
import { ForAttorneys } from './components/ForAttorneys';
import { Feed } from './components/Feed';
import { Compare } from './components/Compare';
import { Onboarding } from './components/Onboarding';
import { RecentVerdicts } from './components/RecentVerdicts';
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
  | '/batch'
  | '/feed'
  | '/compare'
  | '/for-attorneys'
  | { kind: 'soul'; idOrSlug: string }
  | { kind: 'verdict'; slug: string };

const STATIC_ROUTES = [
  '/', '/pricing', '/account', '/history', '/terms', '/privacy', '/aup',
  '/agents', '/agents/new', '/batch', '/feed', '/compare', '/for-attorneys',
] as const;

function currentRoute(): Route {
  const p = window.location.pathname;
  if ((STATIC_ROUTES as readonly string[]).includes(p)) return p as Route;
  const soulMatch = p.match(/^\/agents\/([^/]+)$/);
  if (soulMatch) return { kind: 'soul', idOrSlug: soulMatch[1] };
  const verdictMatch = p.match(/^\/v\/([^/]+)$/);
  if (verdictMatch) return { kind: 'verdict', slug: verdictMatch[1] };
  return '/';
}

export default function App() {
  const [route, setRoute] = useState<Route>(currentRoute);
  const [state, setState] = useState<ForgeState>({ kind: 'idle' });
  const [emberMode, setEmberMode] = useState<EmberMode>('idle');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const forgeRef = useRef<ForgeEyeHandle>(null);
  const [signInOpen, setSignInOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
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

  // Capture ?ref=<code> on first landing → 30-day cookie. We attach this on
  // magic-link signup so the new user's referrer gets credited.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref && /^[a-z0-9]{4,12}$/i.test(ref)) {
      const max = 60 * 60 * 24 * 30;
      document.cookie = `mfr=${encodeURIComponent(ref)}; Path=/; Max-Age=${max}; Secure; SameSite=Lax`;
      // Strip the param so it doesn't churn analytics
      params.delete('ref');
      const qs = params.toString();
      const next = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
      window.history.replaceState(null, '', next);
    }
  }, []);

  // First-run onboarding: shown once per browser, or any time via ?welcome=1.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('welcome') === '1') {
      setWelcomeOpen(true);
      return;
    }
    try {
      const seen = localStorage.getItem('mfr_seen_welcome');
      if (!seen && window.location.pathname === '/') {
        // Defer briefly so the hero animates in first
        const t = setTimeout(() => setWelcomeOpen(true), 1200);
        return () => clearTimeout(t);
      }
    } catch {
      /* localStorage may be blocked */
    }
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
          {state.kind === 'idle' && <RecentVerdicts onNavigate={navigate} />}
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
      {route === '/batch' && <Batch me={me} onNavigate={navigate} />}
      {route === '/feed' && <Feed onNavigate={navigate} />}
      {route === '/compare' && <Compare onNavigate={navigate} />}
      {route === '/for-attorneys' && <ForAttorneys onNavigate={navigate} />}
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
      {typeof route === 'object' && route.kind === 'verdict' && (
        <VerdictPage
          slug={route.slug}
          me={me}
          onBack={() => navigate('/')}
          onUpgrade={() => navigate('/pricing')}
        />
      )}

      {welcomeOpen && (
        <Onboarding
          onClose={() => setWelcomeOpen(false)}
          onSignUp={() => {
            setWelcomeOpen(false);
            setSignInOpen(true);
          }}
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
