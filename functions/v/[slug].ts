// Cloudflare Pages Function — intercepts /v/<slug> requests so social-platform
// crawlers (Twitter, Discord, Slack, iMessage, LinkedIn, Reddit) see custom
// Open Graph + Twitter Card metadata for each verdict.
//
// Browsers still get the regular Vite SPA shell — we just rewrite the <head>
// of the index.html response when the slug resolves to a public verdict.
//
// This is the "first 200ms" growth lever: a verdict shared on Reddit goes from
// "generic Mythos card" to "🔥 85% AI-Generated · subject filename" link
// preview, which 5-10x's click-through.

interface PagesContext {
  request: Request;
  env: { ASSETS: { fetch: (req: Request) => Promise<Response> } };
  params: { slug: string };
  next: () => Promise<Response>;
}

interface PublicVerdict {
  slug: string;
  kind: 'image' | 'video';
  confidence: number;
  verdict: 'authentic' | 'suspect' | 'synthetic';
  modelTag: string;
  durationMs: number;
  sha256: string | null;
  originalName: string | null;
  findings: Array<{ category: string; title: string; detail: string; weight: number }>;
}

const API = 'https://api.mythos0x.com';

export const onRequestGet = async (ctx: PagesContext): Promise<Response> => {
  const { params, env, request } = ctx;
  const slug = (params.slug ?? '').toString();

  // Fetch the verdict data + the SPA index.html in parallel
  const [verdictRes, shellRes] = await Promise.all([
    fetch(`${API}/v1/verdicts/${encodeURIComponent(slug)}`, { cf: { cacheTtl: 60 } }),
    env.ASSETS.fetch(new Request(new URL('/index.html', request.url).toString())),
  ]);

  // If verdict isn't public/found, fall through to the SPA with default meta
  if (!verdictRes.ok) return shellRes;

  let verdict: PublicVerdict;
  try {
    verdict = await verdictRes.json();
  } catch {
    return shellRes;
  }

  // Compose tailored meta tags
  const pct = Math.round(verdict.confidence * 100);
  const verdictText =
    verdict.verdict === 'synthetic'
      ? `🔥 ${pct}% AI-Generated`
      : verdict.verdict === 'suspect'
      ? `⚠️ ${pct}% Suspect`
      : `✅ ${pct}% Likely Authentic`;
  const subject = verdict.originalName || `${verdict.kind} verdict`;
  const title = `${verdictText} — Mythos 0X Forge`;
  const description = `Forensic AI media verdict on ${escape(subject)}. Multi-model analysis (${verdict.modelTag}) returned ${pct}% AI-generation probability with ${verdict.findings.length} forensic finding${verdict.findings.length === 1 ? '' : 's'}. Verified at mythos0x.com.`;
  const url = `https://mythos0x.com/v/${verdict.slug}`;

  // Inject into <head> by replacing the default title + description + OG/Twitter blocks
  const html = await shellRes.text();
  const patched = html
    .replace(
      /<title>[^<]*<\/title>/,
      `<title>${escape(title)}</title>`,
    )
    .replace(
      /<meta\s+name="description"[^>]*>/,
      `<meta name="description" content="${escape(description)}">`,
    )
    .replace(
      /<meta\s+property="og:title"[^>]*>/,
      `<meta property="og:title" content="${escape(title)}">`,
    )
    .replace(
      /<meta\s+property="og:description"[^>]*>/,
      `<meta property="og:description" content="${escape(description)}">`,
    )
    .replace(
      /<meta\s+property="og:url"[^>]*>/,
      `<meta property="og:url" content="${escape(url)}">`,
    )
    .replace(
      /<meta\s+property="og:type"[^>]*>/,
      `<meta property="og:type" content="article">`,
    )
    .replace(
      /<meta\s+name="twitter:title"[^>]*>/,
      `<meta name="twitter:title" content="${escape(title)}">`,
    )
    .replace(
      /<meta\s+name="twitter:description"[^>]*>/,
      `<meta name="twitter:description" content="${escape(description)}">`,
    );

  // Add structured data (helps Google search snippets too)
  const ldJson = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description,
    url,
    publisher: {
      '@type': 'Organization',
      name: 'Mythos 0X Forge',
      url: 'https://mythos0x.com',
    },
    datePublished: new Date().toISOString(),
  };
  const ldTag = `<script type="application/ld+json">${JSON.stringify(ldJson).replace(/</g, '\\u003c')}</script>`;
  const finalHtml = patched.replace('</head>', `${ldTag}</head>`);

  return new Response(finalHtml, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
};

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .slice(0, 300);
}
