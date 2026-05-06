# Mythos 0X Forge — Deployment

Same pattern as Bulldog Legal: **Cloudflare Registrar (domain) → Vercel (hosting) → Cloudflare DNS (records)**.

> **What I can't do for you (and why):** registering a domain or connecting a Vercel/GitHub account requires entering payment info or completing OAuth login — both are gated actions I cannot perform on your behalf. Every other step is automatable; the manual steps are clearly marked **(USER)**.

---

## 0. Domain — pick & buy **(USER, ~$10–$13)**

**Strong candidates** (in order of brand fit; check availability at https://registrar.cloudflare.com):

| Domain          | Why                                                          |
| --------------- | ------------------------------------------------------------ |
| `mythos0x.ai`   | Spec-canonical. `.ai` is on-brand for an AI product. ~$60/yr (`.ai` is pricier). |
| `mythos0x.com`  | Defensive + cheap (~$10/yr). Buy this even if you primary-on `.ai`. |
| `mythos0x.app`  | Tied to product category, $14/yr.                            |
| `myth0sforge.ai` | Backup if `mythos0x.ai` is taken.                           |
| `forge.mythos.ai` | Subdomain — only if you'll register `mythos.ai` itself.    |

**Recommendation:** buy `mythos0x.ai` (primary) **and** `mythos0x.com` (defensive redirect → primary). Total: ~$70/year.

Steps:
1. Go to https://registrar.cloudflare.com
2. Search `mythos0x.ai` → add to cart
3. Search `mythos0x.com` → add to cart
4. Check out (~$70/yr).
5. Cloudflare auto-creates a DNS zone for each. **Don't change nameservers** — you want Cloudflare DNS for proxying.

---

## 1. Push the repo to GitHub **(if not already)**

The branch `claude/romantic-matsumoto-fbf727` is already pushed to
`https://github.com/heitkampnick23-art/bulldog-legal`. Either:

- **Option A (fast):** open a PR from that branch into `main`, merge, then deploy from `main`.
- **Option B (cleaner):** create a separate `mythos-forge` repo and push just this folder. The product has its own domain and lifecycle, so a separate repo is the right long-term shape.

Option B steps:
```bash
# From the worktree root
cd mythos-forge
git init
git add -A
git commit -m "feat: initial Mythos 0X Forge v1"

# Create empty repo at github.com/new (name: mythos-0x-forge)
git branch -M main
git remote add origin https://github.com/<your-user>/mythos-0x-forge.git
git push -u origin main
```

---

## 2. Deploy to Vercel **(USER → automated thereafter)**

1. Go to https://vercel.com/new
2. Import the GitHub repo (`mythos-0x-forge` if you did Option B; otherwise `bulldog-legal` and set the **Root Directory** below).
3. **Root Directory:** `mythos-forge` (only needed if deploying from the bulldog-legal repo; skip for a dedicated repo).
4. **Framework Preset:** Vite (auto-detected).
5. **Build Command:** `npm run build` (auto).
6. **Output Directory:** `dist` (auto).
7. **Environment Variables:** none required for v1 (no backend yet).
8. Click **Deploy**. First build takes ~30 seconds.

Vercel gives you a `*.vercel.app` URL immediately. Verify it works before attaching the custom domain.

---

## 3. Attach `mythos0x.ai` **(USER, 5 min)**

In Vercel:
1. Project → Settings → Domains → Add `mythos0x.ai` and `www.mythos0x.ai`.
2. Vercel shows the DNS records to add (a CNAME or A records).

In Cloudflare DNS for `mythos0x.ai`:
1. **Apex (`@`):** Type `CNAME`, Target `cname.vercel-dns.com`, Proxy **OFF** (grey cloud — Vercel issues SSL).
2. **`www`:** Type `CNAME`, Target `cname.vercel-dns.com`, Proxy **OFF**.
3. Wait 2–5 minutes for SSL provisioning.

Verify:
```bash
curl -I https://mythos0x.ai            # → 200 OK
curl -I https://www.mythos0x.ai        # → 200 or 308 redirect to apex
```

---

## 4. Redirect `.com` → `.ai` **(USER, 2 min)**

In Cloudflare DNS for `mythos0x.com`:
1. Add a **Page Rule** (Rules → Page Rules → Create):
   - URL: `mythos0x.com/*`
   - Setting: **Forwarding URL** → 301 → `https://mythos0x.ai/$1`
2. Add a placeholder DNS A record (`@` → `192.0.2.1`, proxy ON) so the page rule fires.

Verify: `curl -I https://mythos0x.com` → `301` to `https://mythos0x.ai/`.

---

## 5. Future: real detection backend

When you swap `analyzeMedia()` for a real provider, add a `VITE_FORGE_API_URL` (Cloudflare Worker proxy URL) in Vercel project settings → Environment Variables. The worker holds the provider API key server-side; the client never sees it.

---

## Summary of what each side does

| Step | I do | You do |
|---|---|---|
| Build the app | ✅ done | — |
| Add `vercel.json` | ✅ done | — |
| Push to GitHub | ✅ done (current branch) | optional: split into own repo |
| Buy `mythos0x.ai` + `.com` | — | **YES** (payment) |
| Vercel project import | — | **YES** (OAuth) |
| Add custom domain in Vercel | — | **YES** (UI click) |
| DNS records in Cloudflare | — | **YES** (UI click) |
| Verify SSL + redirects | — | YES (`curl`) |

Once you've done step 0 and 2, ping me with the Vercel project URL — I can verify the deploy with curl from here and help debug any DNS hiccups.
