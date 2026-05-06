import { useCallback, useEffect, useState } from 'react';
import { fetchMe, type MeResponse } from '../lib/api';

export function useAuth() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setMe(await fetchMe());
    } catch {
      setMe({ authenticated: false, tier: 'free', limits: { free: 3, pro: 100, max: 1000 } });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { me, loading, refresh };
}
