import { useEffect, useRef, useState } from 'react';

export type Mode = 'foco' | 'pausa';
const TOTAL: Record<Mode, number> = { foco: 1500, pausa: 300 };

export const mmss = (s: number) => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');

function beep() {
  try {
    const c = new AudioContext(), o = c.createOscillator();
    o.connect(c.destination);
    o.start();
    o.stop(c.currentTime + 0.4);
  } catch { /* sem áudio, tudo bem */ }
}

export function useTimer(onFocusDone: () => void) {
  const [mode, setMode] = useState<Mode>('foco');
  const [left, setLeft] = useState(TOTAL.foco);
  const [run, setRun] = useState(false);
  const end = useRef(0);
  const done = useRef(onFocusDone);
  done.current = onFocusDone;

  useEffect(() => {
    if (!run) return;
    const id = setInterval(() => {
      const l = Math.max(0, Math.round((end.current - Date.now()) / 1000));
      setLeft(l);
      if (!l) {
        setRun(false);
        beep();
        if (mode === 'foco') done.current();
        const next: Mode = mode === 'foco' ? 'pausa' : 'foco';
        setMode(next);
        setLeft(TOTAL[next]);
      }
    }, 250);
    return () => clearInterval(id);
  }, [run, mode]);

  useEffect(() => {
    document.title = run ? mmss(left) + ' - Diário de Estudos' : 'Diário de Estudos';
  }, [run, left]);

  const pick = (m: Mode) => { setRun(false); setMode(m); setLeft(TOTAL[m]); };
  const toggle = () => { if (!run) end.current = Date.now() + left * 1000; setRun(!run); };
  return { mode, left, run, total: TOTAL[mode], toggle, reset: () => pick(mode), pick };
}
export type Timer = ReturnType<typeof useTimer>;
