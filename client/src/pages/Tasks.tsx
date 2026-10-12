import { useRef, useState } from 'react';
import { api, type Act, type AllData, type Project, type Subject, type Task, updateTasks } from '../api';
import { byDue, fmt, today } from '../lib';

export default function Tasks({ tasks, subjects, projects, act }: { tasks: Task[]; subjects: Subject[]; projects: Project[]; act: Act }) {
  const [filter, setFilter] = useState<'p' | 'all'>('p');
  const [title, setTitle] = useState('');
  const [sid, setSid] = useState('');
  const [pid, setPid] = useState('');
  const [due, setDue] = useState('');
  const [pending, setPending] = useState<Set<number>>(() => new Set());
  const input = useRef<HTMLInputElement>(null);
  const temporaryId = useRef(-1);
  const list = tasks.filter((t) => filter === 'all' || !t.done).sort(byDue);
  const subj = (id: number | null) => subjects.find((s) => s.id === id);
  const proj = (id: number | null) => projects.find((p) => p.id === id);

  const runTaskAction = (id: number, action: () => Promise<unknown>, optimistic: (data: AllData) => AllData,
    reconcile?: (data: AllData, result: unknown) => AllData) => {
    setPending((current) => new Set(current).add(id));
    void act(action, optimistic, reconcile).finally(() => {
      setPending((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    });
  };

  const add = () => {
    const t = title.trim();
    if (!t) return input.current?.focus();
    const id = temporaryId.current--;
    const newTask: Task = {
      id,
      title: t,
      subject_id: sid ? +sid : null,
      project_id: pid ? +pid : null,
      due,
      done: 0,
    };
    setTitle('');
    runTaskAction(id,
      () => api<{ id: number }>('POST', '/tasks', {
        title: t,
        subject_id: newTask.subject_id,
        project_id: newTask.project_id,
        due,
      }),
      (data) => updateTasks(data, (current) => [...current, newTask]),
      (data, result) => {
        if (!result || typeof result !== 'object' || !('id' in result) || typeof result.id !== 'number') return data;
        const serverId = result.id;
        return updateTasks(data, (current) => current.map((task) => task.id === id ? { ...task, id: serverId } : task));
      });
    input.current?.focus();
  };

  return (
    <section className="box">
      <div className="form">
        <input ref={input} className="grow" value={title} onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="O que vamos fazer hoje?" maxLength={120} aria-label="Tarefa" />
        <select value={sid} onChange={(e) => setSid(e.target.value)} aria-label="Matéria">
          <option value="">Sem matéria</option>
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={pid} onChange={(e) => setPid(e.target.value)} aria-label="Projeto">
          <option value="">Sem projeto</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Prazo" />
        <button className="p" onClick={add}>Adicionar tarefa</button>
      </div>
      <div className="chips">
        <button className={'chip' + (filter === 'p' ? ' on' : '')} onClick={() => setFilter('p')}>Pendentes</button>
        <button className={'chip' + (filter === 'all' ? ' on' : '')} onClick={() => setFilter('all')}>Todas</button>
      </div>
      {list.length ? (
        <ul className="l">
          {list.map((t) => {
            const late = !t.done && t.due && t.due < today();
            const s = subj(t.subject_id);
            const p = proj(t.project_id);
            return (
              <li key={t.id} className={t.done ? 'dn' : ''}>
                <input type="checkbox" checked={!!t.done}
                  aria-label={`${t.done ? 'Reabrir' : 'Concluir'} tarefa: ${t.title}`}
                  disabled={pending.has(t.id) || t.id < 0}
                  onChange={() => runTaskAction(t.id,
                    () => api('PATCH', '/tasks/' + t.id, { done: !t.done }),
                    (data) => updateTasks(data, (current) => current.map((task) =>
                      task.id === t.id ? { ...task, done: Number(!t.done) } : task)))}
                />
                <span className="tx">{t.title}</span>
                {s && <span className="meta"><i className="d" style={{ background: s.color }} />{s.name}</span>}
                {p && <span className="meta">Projeto: {p.name}</span>}
                {t.due && <span className={'meta' + (late ? ' late' : '')}>{late ? 'atrasada ' : ''}{fmt(t.due)}</span>}
                {projects.length > 0 && (
                  <select value={t.project_id ?? ''} aria-label={'Projeto de ' + t.title} disabled={pending.has(t.id) || t.id < 0}
                    onChange={(e) => {
                      const projectId = e.target.value ? +e.target.value : null;
                      runTaskAction(t.id,
                        () => api('PATCH', '/tasks/' + t.id, { project_id: projectId }),
                        (data) => updateTasks(data, (current) => current.map((task) =>
                          task.id === t.id ? { ...task, project_id: projectId } : task)));
                    }}>
                    <option value="">Sem projeto</option>
                    {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                  </select>
                )}
                <button disabled={pending.has(t.id) || t.id < 0} onClick={() => runTaskAction(t.id,
                  () => api('DELETE', '/tasks/' + t.id),
                  (data) => updateTasks(data, (current) => current.filter((task) => task.id !== t.id)))}>
                  Excluir
                </button>
              </li>
            );
          })}
        </ul>
      ) : <p className="emp">Nenhuma tarefa por aqui. Que tal escrever a primeira?</p>}
    </section>
  );
}
