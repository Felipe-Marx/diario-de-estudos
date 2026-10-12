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

export function useTimer(onFocusMinutes: (minutes: number) => void) {
  const [mode, setMode] = useState<Mode>('foco');
  const [left, setLeft] = useState(TOTAL.foco);
  const [run, setRun] = useState(false);
  const end = useRef(0);
  const segmentStartLeft = useRef(0);
  const focusElapsedSeconds = useRef(0);
  const reportedFocusMinutes = useRef(0);
  const saveFocusMinutes = useRef(onFocusMinutes);
  saveFocusMinutes.current = onFocusMinutes;

  const reportFocusMinutes = () => {
    const completedMinutes = Math.floor(focusElapsedSeconds.current / 60);
    const minutes = completedMinutes - reportedFocusMinutes.current;
    if (minutes > 0) {
      reportedFocusMinutes.current = completedMinutes;
      saveFocusMinutes.current(minutes);
    }
  };

  const stopFocusSegment = (remaining: number) => {
    if (mode !== 'foco') return;
    focusElapsedSeconds.current += Math.max(0, segmentStartLeft.current - remaining);
    segmentStartLeft.current = 0;
    reportFocusMinutes();
  };

  const finishCycle = (finishedMode: Mode) => {
    if (finishedMode === 'foco') {
      focusElapsedSeconds.current += segmentStartLeft.current;
      segmentStartLeft.current = 0;
      reportFocusMinutes();
      focusElapsedSeconds.current = 0;
      reportedFocusMinutes.current = 0;
    }
    setRun(false);
    beep();
    const next: Mode = finishedMode === 'foco' ? 'pausa' : 'foco';
    setMode(next);
    setLeft(TOTAL[next]);
  };

  useEffect(() => {
    if (!run) return;
    const id = setInterval(() => {
      const l = Math.max(0, Math.round((end.current - Date.now()) / 1000));
      setLeft(l);
      if (!l) {
        finishCycle(mode);
      }
    }, 250);
    return () => clearInterval(id);
  }, [run, mode]);

  useEffect(() => {
    document.title = run ? mmss(left) + ' - Diário de Estudos' : 'Diário de Estudos';
  }, [run, left]);

  const pick = (m: Mode) => {
    if (run) {
      const remaining = Math.max(0, Math.round((end.current - Date.now()) / 1000));
      stopFocusSegment(remaining);
    }
    setRun(false);
    setMode(m);
    setLeft(TOTAL[m]);
    focusElapsedSeconds.current = 0;
    reportedFocusMinutes.current = 0;
  };
  const toggle = () => {
    if (!run) {
      end.current = Date.now() + left * 1000;
      segmentStartLeft.current = left;
      setRun(true);
      return;
    }
    const remaining = Math.max(0, Math.round((end.current - Date.now()) / 1000));
    if (!remaining) {
      finishCycle(mode);
      return;
    }
    stopFocusSegment(remaining);
    setLeft(remaining);
    setRun(false);
  };
  return { mode, left, run, total: TOTAL[mode], toggle, reset: () => pick(mode), pick };
}
export type Timer = ReturnType<typeof useTimer>;
