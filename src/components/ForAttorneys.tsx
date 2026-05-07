import { GlassPanel } from './glass';

interface Props {
  onNavigate: (path: string) => void;
}

const DEMO_SLUG = '16556ae4db8d';

export function ForAttorneys({ onNavigate }: Props) {
  return (
    <main className="relative z-10 mx-auto w-full max-w-5xl px-4 pb-32 pt-24 sm:px-6 sm:pt-28">
      <button
        type="button"
        onClick={() => onNavigate('/')}
        className="mb-6 text-[10px] uppercase tracking-[0.32em] text-white/40 hover:text-ember-gold"
      >
        ← Back to Forge
      </button>

      <header className="mb-10 text-center">
        <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.4em] text-ember-gold/70">
          For Family-Law Attorneys
        </div>
        <h1 className="wordmark text-glow text-4xl font-semibold leading-[1.05] sm:text-6xl">
          The pre-screen
          <br className="hidden sm:block" />
          before the expert witness.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-white/65 sm:text-lg">
          Drop any photo, screenshot, or short video. Get a multi-model
          forensic verdict + a court-format PDF in 8&nbsp;seconds. SHA-256
          hashed. Model-tagged. Built for the file, not the closing argument.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => onNavigate('/')}
            className="rounded-full border border-ember-fire/50 bg-gradient-to-r from-ember-fire/30 to-ember-blood/30 px-6 py-3 text-[10px] font-semibold uppercase tracking-[0.28em] text-white shadow-ember-glow transition hover:from-ember-fire/45 hover:to-ember-blood/45"
          >
            Try free — 3 / day
          </button>
          <a
            href={`/v/${DEMO_SLUG}`}
            className="rounded-full border border-white/10 bg-white/[0.03] px-6 py-3 text-[10px] uppercase tracking-[0.28em] text-white/70 transition hover:border-ember-gold/40 hover:text-white"
          >
            See a sample verdict →
          </a>
        </div>
      </header>

      <section className="mb-16 grid grid-cols-1 gap-4 md:grid-cols-3">
        <UseCase
          title="Custody filings"
          body="Photos a client emails you that 'just don't look right.' Pre-screen before exhibits go in the file."
        />
        <UseCase
          title="Text-message screenshots"
          body="Fabricated 'threatening' messages from numbers neither party owned. Run the screenshot — leave the audit trail."
        />
        <UseCase
          title="Voicemail evidence"
          body="AI-cloned voices are now ~30 seconds of source audio away. Detect synthesis before depo."
        />
      </section>

      <section className="mb-16">
        <h2 className="mb-8 text-center font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          What goes in the file.
        </h2>
        <GlassPanel hot edge className="p-7 sm:p-10">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div>
              <ChecklistItem text="Confidence score (0–100% AI-generated)" />
              <ChecklistItem text="Multi-model verdict — Sightengine genai + deepfake" />
              <ChecklistItem text="Forensic narration — frequency, lighting, geometry, compression, reflection" />
              <ChecklistItem text="SHA-256 of original bytes (tamper-evidence)" />
            </div>
            <div>
              <ChecklistItem text="Subject filename + UTC timestamp" />
              <ChecklistItem text="Model tag with version (cite-able)" />
              <ChecklistItem text="Court-format PDF letterhead" />
              <ChecklistItem text="Public verdict URL for shared exhibits" />
            </div>
          </div>
        </GlassPanel>
      </section>

      <section className="mb-16">
        <h2 className="mb-8 text-center font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          The math vs. an expert witness.
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <GlassPanel edge className="p-6">
            <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-white/40">
              Traditional path
            </div>
            <div className="mt-2 font-display text-3xl font-semibold text-white">
              ~$4,000–6,000
            </div>
            <ul className="mt-3 space-y-2 text-sm text-white/55">
              <li>• Retain digital-forensics expert</li>
              <li>• 2–4 week turnaround</li>
              <li>• Specific to one exhibit</li>
              <li>• Bills hourly thereafter</li>
            </ul>
          </GlassPanel>
          <GlassPanel hot edge className="p-6">
            <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-ember-gold">
              Mythos pre-screen
            </div>
            <div className="mt-2 font-display text-3xl font-semibold text-glow text-ember-gold">
              $19/mo · 100/day
            </div>
            <ul className="mt-3 space-y-2 text-sm text-white/75">
              <li>• Verdict in 8 seconds</li>
              <li>• Court-format PDF + public URL per exhibit</li>
              <li>• Unlimited subjects</li>
              <li>• Decide which cases warrant the $4k expert</li>
            </ul>
          </GlassPanel>
        </div>
        <p className="mt-6 text-center font-mono text-[10px] uppercase leading-relaxed tracking-[0.22em] text-white/35">
          Not a substitute for expert testimony · advisory output, not legal evidence
        </p>
      </section>

      <section className="mb-16">
        <h2 className="mb-8 text-center font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          How attorneys are using it.
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Workflow
            n="1"
            title="Intake screening"
            body="Every photo or screenshot a client emails goes through Mythos before it's filed. 30 seconds per item."
          />
          <Workflow
            n="2"
            title="Exhibit attachment"
            body="The PDF gets saved as Exhibit-N. Cover memo references the SHA-256 + verdict. Builds the chain."
          />
          <Workflow
            n="3"
            title="Opposing-counsel pressure"
            body="Run their exhibits. If the verdict is suspect, lead the depo with it. Two attorneys report withdrawn exhibits."
          />
        </div>
      </section>

      <section className="text-center">
        <h2 className="mb-3 font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          Try it on this week's intake.
        </h2>
        <p className="mb-8 text-base text-white/60">
          Free 3 verdicts/day. Pro $19/mo gets you 100/day + PDF reports. No card needed for free.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => onNavigate('/')}
            className="rounded-full border border-ember-fire/50 bg-gradient-to-r from-ember-fire/30 to-ember-blood/30 px-6 py-3 text-[10px] font-semibold uppercase tracking-[0.28em] text-white shadow-ember-glow transition hover:from-ember-fire/45 hover:to-ember-blood/45"
          >
            Open the Forge
          </button>
          <button
            type="button"
            onClick={() => onNavigate('/pricing')}
            className="rounded-full border border-white/10 bg-white/[0.03] px-6 py-3 text-[10px] uppercase tracking-[0.28em] text-white/70 hover:border-ember-gold/40 hover:text-white"
          >
            See pricing
          </button>
        </div>
        <p className="mt-10 text-center font-mono text-[10px] uppercase leading-relaxed tracking-[0.28em] text-white/30">
          Questions? Email{' '}
          <a href="mailto:nick@mythos0x.com" className="text-ember-gold hover:text-ember-fire">
            nick@mythos0x.com
          </a>
        </p>
      </section>
    </main>
  );
}

function UseCase({ title, body }: { title: string; body: string }) {
  return (
    <GlassPanel edge className="p-6">
      <h3 className="font-display text-lg font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-white/55">{body}</p>
    </GlassPanel>
  );
}

function ChecklistItem({ text }: { text: string }) {
  return (
    <div className="mb-2 flex items-start gap-2.5 text-sm text-white/75">
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ember-fire shadow-ember-glow" />
      {text}
    </div>
  );
}

function Workflow({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <GlassPanel edge className="flex flex-col gap-3 p-6">
      <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-ember-gold/70">
        Step {n}
      </div>
      <h3 className="font-display text-lg font-semibold text-white">{title}</h3>
      <p className="text-sm leading-relaxed text-white/55">{body}</p>
    </GlassPanel>
  );
}
