import { useEffect, useRef, useState } from 'react';
import { api, type Act, type Subject } from '../api';
import { md } from '../lib';

export default function Subjects({ subjects, act }: { subjects: Subject[]; act: Act }) {
  const [cur, setCur] = useState<number | null>(null);
  const [preview, setPreview] = useState(false);
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState(false);
  const s = subjects.find((x) => x.id === cur) ?? subjects[0];
  const [notes, setNotes] = useState(s?.notes ?? '');
  const timer = useRef<number>();

  useEffect(() => { setNotes(s?.notes ?? ''); setConfirm(false); }, [s?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (value: string) => {
    setNotes(value);
    clearTimeout(timer.current);
    const id = s.id;
    timer.current = window.setTimeout(() => act(() => api('PUT', '/subjects/' + id, { notes: value })), 600);
  };

  const add = () => {
    const n = name.trim();
    if (!n) return;
    setName('');
    act(async () => { const r = await api<{ id: number }>('POST', '/subjects', { name: n }); setCur(r.id); setPreview(false); });
  };

  const remove = () => {
    if (!confirm) return setConfirm(true);
    setCur(null);
    act(() => api('DELETE', '/subjects/' + s.id));
  };

  return (
    <>
      <div className="chips">
        {subjects.map((x) => (
          <button key={x.id} className={'chip' + (x.id === s?.id ? ' on' : '')} onClick={() => { setCur(x.id); setPreview(false); }}>
            <i className="d" style={{ background: x.color }} /> {x.name}
          </button>
        ))}
        <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="Nova matéria" maxLength={40} aria-label="Nome da nova matéria" />
        <button onClick={add}>Plantar matéria</button>
      </div>
      {s ? (
        <section className="box">
          <div className="bar2">
            <h2 style={{ margin: 0 }}>{s.name}</h2>
            <span>
              <button onClick={() => setPreview(!preview)}>{preview ? 'Editar' : 'Visualizar'}</button>
              <button className="dng" onClick={remove}>{confirm ? 'Confirmar exclusão' : 'Excluir matéria'}</button>
            </span>
          </div>
          {preview
            ? <div className="md" dangerouslySetInnerHTML={{ __html: md(notes) || '<p class="emp">Nenhuma anotação ainda.</p>' }} />
            : <textarea value={notes} onChange={(e) => edit(e.target.value)} spellCheck={false} aria-label="Notas em Markdown"
                placeholder="Escreva em Markdown: # título, - lista, **negrito**, `código`" />}
        </section>
      ) : <p className="emp">Plante sua primeira matéria acima.</p>}
    </>
  );
}
