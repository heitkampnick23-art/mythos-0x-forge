// Embeddable verdict card. Returns a self-contained HTML page suitable for
// dropping into an <iframe> on any site (journalists embedding in articles,
// lawyers in evidence packets, anyone in a blog post).
//
// Free organic distribution: every embed is a backlink + brand impression.
//
// Usage:
//   <iframe src="https://mythos0x.com/embed/v/<slug>"
//           width="480" height="280" frameborder="0"
//           style="border:0;border-radius:12px"></iframe>

interface PagesContext {
  request: Request;
  params: { slug: string };
}

interface PublicVerdict {
  slug: string;
  kind: 'image' | 'video';
  confidence: number;
  verdict: 'authentic' | 'suspect' | 'synthetic';
  originalName: string | null;
  createdAt: number;
  hasMedia: boolean;
}

const API = 'https://api.mythos0x.com';

export const onRequestGet = async (ctx: PagesContext): Promise<Response> => {
  const slug = (ctx.params.slug ?? '').toString();
  const res = await fetch(`${API}/v1/verdicts/${encodeURIComponent(slug)}`, {
    cf: { cacheTtl: 60 },
  });
  if (!res.ok) {
    return new Response(notFoundHtml(), {
      status: 200, // 200 so the iframe still renders our message
      headers: htmlHeaders(),
    });
  }
  const v = (await res.json()) as PublicVerdict;
  return new Response(renderEmbed(v), {
    status: 200,
    headers: htmlHeaders(),
  });
};

function htmlHeaders(): HeadersInit {
  return {
    'content-type': 'text/html; charset=utf-8',
    // Allow framing from anywhere — the whole point.
    'x-frame-options': 'ALLOWALL',
    'content-security-policy': "frame-ancestors *",
    'cache-control': 'public, max-age=300',
  };
}

const VERDICT_COLOR = {
  authentic: '#7be3a4',
  suspect: '#ffb347',
  synthetic: '#c81d25',
} as const;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function renderEmbed(v: PublicVerdict): string {
  const pct = Math.round(v.confidence * 100);
  const color = VERDICT_COLOR[v.verdict];
  const name = escapeHtml(v.originalName ?? 'Untitled media');
  const verdictLabel = v.verdict.toUpperCase();
  const fullUrl = `https://mythos0x.com/v/${v.slug}`;
  const mediaUrl = v.hasMedia ? `${API}/v1/verdicts/${v.slug}/image` : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mythos Verdict · ${pct}% ${verdictLabel}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0a0608;color:#fff;overflow:hidden}
  a{color:inherit;text-decoration:none}
  .card{display:flex;height:100vh;min-height:200px;background:linear-gradient(135deg,#120a0d 0%,#0a0608 60%);border:1px solid rgba(255,255,255,0.08);border-radius:12px;overflow:hidden}
  .thumb{position:relative;flex:0 0 40%;max-width:240px;background:#000;overflow:hidden}
  .thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0.65}
  .thumb::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent 60%,rgba(10,6,8,0.95))}
  .body{flex:1;padding:18px 20px;display:flex;flex-direction:column;justify-content:space-between;min-width:0}
  .top{display:flex;align-items:baseline;gap:8px}
  .pct{font-size:42px;font-weight:700;letter-spacing:-0.02em;color:${color};line-height:1}
  .verdict{font-size:11px;letter-spacing:0.28em;text-transform:uppercase;color:${color};opacity:0.9}
  .name{margin-top:6px;font-size:13px;color:rgba(255,255,255,0.7);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .meta{font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:rgba(255,255,255,0.4)}
  .footer{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:10px}
  .brand{font-size:11px;letter-spacing:0.28em;text-transform:uppercase;background:linear-gradient(180deg,#ffe6c4,#ffb347 50%,#c81d25);-webkit-background-clip:text;background-clip:text;color:transparent;font-weight:700}
  .cta{font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:rgba(255,255,255,0.55);border:1px solid rgba(255,255,255,0.12);border-radius:999px;padding:6px 12px}
  .cta:hover{color:#ffb347;border-color:rgba(255,179,71,0.4)}
  .dot{width:8px;height:8px;border-radius:50%;background:${color};box-shadow:0 0 12px ${color}}
  @media (max-width:380px){.thumb{display:none}}
</style>
</head>
<body>
<a class="card" href="${fullUrl}" target="_blank" rel="noopener">
  ${mediaUrl ? `<div class="thumb"><img src="${mediaUrl}" alt="${name}" loading="lazy"></div>` : ''}
  <div class="body">
    <div>
      <div class="top">
        <span class="dot"></span>
        <span class="pct">${pct}%</span>
        <span class="verdict">${verdictLabel}</span>
      </div>
      <div class="name">${name}</div>
      <div class="meta" style="margin-top:4px">${v.kind.toUpperCase()} · ${new Date(v.createdAt * 1000).toISOString().slice(0, 10)}</div>
    </div>
    <div class="footer">
      <span class="brand">Mythos 0X Forge</span>
      <span class="cta">View full report →</span>
    </div>
  </div>
</a>
</body>
</html>`;
}

function notFoundHtml(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Verdict not found</title>
<style>body{font-family:-apple-system,sans-serif;background:#0a0608;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}</style>
</head><body><div style="text-align:center"><div style="font-size:11px;letter-spacing:0.3em;text-transform:uppercase;color:#888">Mythos 0X Forge</div><div style="margin-top:8px">Verdict not available</div></div></body></html>`;
}
