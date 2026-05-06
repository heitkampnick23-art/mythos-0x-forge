# Mythos 0X Forge

> **Command Reality. Forge Truth.**
>
> A premium dark-futuristic AI-media-authentication app. Drop an image or short video into the **Forge Eye** and watch ember-driven forensics scan it for generative artifacts.

Domain: `mythos0x.ai` (planned).

## Stack

- **Vite 5** + **React 18** + **TypeScript** (strict)
- **Tailwind CSS 3** for styling
- **tsParticles** (`@tsparticles/react` + `@tsparticles/slim`) for the ember field
- Client-side only — no router, no auth, no persistence

## Quickstart

```bash
pnpm install
pnpm dev          # http://localhost:5173
pnpm typecheck    # tsc --noEmit
pnpm build        # production bundle in dist/
pnpm preview      # serve the production bundle
```

## v1 Detection: simulated

`src/lib/analyzeMedia.ts` ships a **deterministic simulated** detector — same file always returns the same confidence (0.60–0.98), findings, and bounding boxes. Replace the body of `analyzeMedia()` with a `fetch()` to a real provider (Reality Defender, Hive, Sensity) or your own Cloudflare Worker proxy. The return shape (`AnalysisResult`) is the swap contract.

## Voice commands

Press the mic in the command bar. Three commands:

| Say                                  | Effect                               |
| ------------------------------------ | ------------------------------------ |
| `analyze` / `detect` / `scan`        | Run Forge Eye on currently loaded media |
| `clear` / `reset` / `wipe`           | Discard current media + results      |
| `upload` / `open file` / `pick file` | Open the file picker                 |

Falls back gracefully when the Web Speech API is unsupported (mic icon hidden).

## File constraints

- Images: `jpg`, `png`, `webp` — ≤ 20 MB
- Video: `mp4`, `webm` — ≤ 50 MB, ≤ 30 s
- Anything else → styled toast, no upload

## Accessibility

`prefers-reduced-motion` is honored: ember count drops, scan-mode swarm disables, panels fade instead of slide, confidence ring stops pulsing.

## Out of scope for v1

- Real detection backend
- Auth, accounts, history
- Per-frame video tracking
- Mobile-first polish (desktop-first by design)
