import { useState } from 'react';
import { GlassPanel } from './glass';
import { useVoiceCommands } from '../hooks/useVoiceCommands';
import { parseCommand, type VoiceCommand } from '../lib/voice';

interface CommandBarProps {
  onCommand: (cmd: Exclude<VoiceCommand, null>) => void;
  disabled?: boolean;
}

export function CommandBar({ onCommand, disabled = false }: CommandBarProps) {
  const [text, setText] = useState('');
  const { supported, listening, lastTranscript, start, stop } = useVoiceCommands({
    onCommand: (cmd) => {
      if (cmd) onCommand(cmd);
    },
  });

  const submit = (raw: string) => {
    const cmd = parseCommand(raw);
    if (cmd) onCommand(cmd);
    setText('');
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-6 sm:pb-8">
      <GlassPanel
        edge
        className="pointer-events-auto flex w-full max-w-2xl items-center gap-3 px-4 py-3 sm:px-5 sm:py-3.5"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ember-fire/40 bg-ember-fire/[0.08] shadow-ember-glow">
          <span className="h-1.5 w-1.5 animate-pulse-slow rounded-full bg-ember-fire" />
        </div>

        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit(text);
          }}
          disabled={disabled}
          placeholder={
            listening
              ? lastTranscript || 'Listening…'
              : 'Issue a command — analyze, clear, upload'
          }
          className="flex-1 bg-transparent font-display text-[15px] tracking-wide text-white placeholder:text-white/35 focus:outline-none disabled:opacity-40"
        />

        {supported && (
          <button
            type="button"
            onClick={listening ? stop : start}
            aria-label={listening ? 'Stop listening' : 'Start voice command'}
            className={`group flex h-10 w-10 items-center justify-center rounded-full border transition-all ${
              listening
                ? 'border-ember-blood/60 bg-ember-blood/15 shadow-ember-glow'
                : 'border-white/10 bg-white/[0.04] hover:border-ember-fire/40 hover:bg-ember-fire/[0.08]'
            }`}
          >
            <MicIcon active={listening} />
          </button>
        )}

        <button
          type="button"
          onClick={() => submit(text)}
          disabled={disabled || !text}
          className="hidden h-10 items-center gap-2 rounded-full border border-ember-fire/40 bg-gradient-to-r from-ember-fire/20 to-ember-blood/20 px-4 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:from-ember-fire/30 hover:to-ember-blood/30 disabled:opacity-30 sm:flex"
        >
          Execute
        </button>
      </GlassPanel>
    </div>
  );
}

function MicIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={active ? 'text-ember-blood' : 'text-white/70 group-hover:text-ember-gold'}
    >
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <line x1="12" y1="18" x2="12" y2="22" />
    </svg>
  );
}
