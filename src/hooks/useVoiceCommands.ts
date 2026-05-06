import { useCallback, useEffect, useRef, useState } from 'react';
import { createRecognizer, isSpeechSupported, parseCommand, type VoiceCommand } from '../lib/voice';

export interface UseVoiceCommandsOpts {
  onCommand: (cmd: VoiceCommand, raw: string) => void;
}

export function useVoiceCommands({ onCommand }: UseVoiceCommandsOpts) {
  const supported = isSpeechSupported();
  const [listening, setListening] = useState(false);
  const [lastTranscript, setLastTranscript] = useState('');
  const recRef = useRef<ReturnType<typeof createRecognizer>>(null);

  const start = useCallback(() => {
    if (!supported || listening) return;
    const rec = createRecognizer();
    if (!rec) return;
    recRef.current = rec;
    rec.onresult = (e) => {
      const transcript = e.results[0]?.[0]?.transcript ?? '';
      setLastTranscript(transcript);
      onCommand(parseCommand(transcript), transcript);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [supported, listening, onCommand]);

  const stop = useCallback(() => {
    recRef.current?.stop();
    setListening(false);
  }, []);

  useEffect(() => () => recRef.current?.stop(), []);

  return { supported, listening, lastTranscript, start, stop };
}
