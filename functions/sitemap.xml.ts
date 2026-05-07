// Dynamic sitemap — includes static routes + every public verdict.
// Cached 10 min. Crawlers (Google, Bing) re-fetch periodically; freshly-public
// verdicts get indexed within a day.

interface PagesContext {
  request: Request;
  env: Record<string, unknown>;
}

const API = 'https://api.mythos0x.com';
const SITE = 'https://mythos0x.com';

const STATIC_ROUTES = [
  { path: '/', priority: '1.0', changefreq: 'daily' },
  { path: '/for-attorneys', priority: '0.9', changefreq: 'weekly' },
  { path: '/pricing', priority: '0.8', changefreq: 'weekly' },
  { path: '/agents', priority: '0.7', changefreq: 'daily' },
  { path: '/terms', priority: '0.3', changefreq: 'monthly' },
  { path: '/privacy', priority: '0.3', changefreq: 'monthly' },
  { path: '/aup', priority: '0.3', changefreq: 'monthly' },
];

interface RecentVerdict {
  share_slug: string;
  created_at: number;
}

export const onRequestGet = async (_ctx: PagesContext): Promise<Response> => {
  let verdicts: RecentVerdict[] = [];
  try {
    const r = await fetch(`${API}/v1/verdicts/recent`, { cf: { cacheTtl: 600 } });
    if (r.ok) {
      const data = (await r.json()) as { verdicts?: RecentVerdict[] };
      verdicts = data.verdicts ?? [];
    }
  } catch {
    /* fall through; static routes only */
  }

  const now = new Date().toISOString();
  const urls = [
    ...STATIC_ROUTES.map(
      (r) => `  <url>
    <loc>${SITE}${r.path}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>${r.changefreq}</changefreq>
    <priority>${r.priority}</priority>
  </url>`,
    ),
    ...verdicts.map(
      (v) => `  <url>
    <loc>${SITE}/v/${v.share_slug}</loc>
    <lastmod>${new Date(v.created_at * 1000).toISOString()}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`,
    ),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;

  return new Response(xml, {
    status: 200,
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=600',
    },
  });
};
