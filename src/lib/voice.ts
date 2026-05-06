// Web Speech API wrapper. Press-to-talk only — no always-on listening.
// Maps spoken text to one of three commands.

export type VoiceCommand = 'analyze' | 'clear' | 'upload' | null;

const ANALYZE = ['analyze', 'detect', 'scan', 'forge eye', 'run analysis'];
const CLEAR = ['clear', 'reset', 'wipe', 'remove'];
const UPLOAD = ['upload', 'open file', 'pick file', 'choose file'];

export function parseCommand(transcript: string): VoiceCommand {
  const t = transcript.toLowerCase().trim();
  if (!t) return null;
  if (ANALYZE.some((k) => t.includes(k))) return 'analyze';
  if (CLEAR.some((k) => t.includes(k))) return 'clear';
  if (UPLOAD.some((k) => t.includes(k))) return 'upload';
  return null;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

export function isSpeechSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(
    (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition,
  );
}

export function createRecognizer(): SpeechRecognitionLike | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = 'en-US';
  rec.continuous = false;
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  return rec;
}
