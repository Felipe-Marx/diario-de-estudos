import { useState } from 'react';
import { api, type Act, type AllData, type Project } from '../api';
import { byDue, fmt, loc, today } from '../lib';
import { Pix, stage } from '../pixel';
import { mmss, type Timer } from '../timer';

const DAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function ProjectRow({ p, act }: { p: Project; act: Act }) {
  return (
    <li>
      <div className="plant">
        <Pix m={stage(p.progress)} px={5} />
        <span className="tx"><b>{p.name}</b></span>
        <button onClick={() => act(() => api('DELETE', '/projects/' + p.id))}>Excluir</button>
      </div>
      <div className="project-progress-row">
        <div className="project-progress" role="progressbar" aria-label={'Progresso de ' + p.name}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.progress}>
          <div style={{ width: p.progress + '%' }} />
        </div>
        <span className="meta">{p.progress}%</span>
      </div>
    </li>
  );
}

export default function Today({ d, act, t }: { d: AllData; act: Act; t: Timer }) {
  const [pn, setPn] = useState('');
  const days = Array.from({ length: 7 }, (_, i) => { const day = loc(6 - i); return [day, d.sessions[day] || 0] as const; });
  const max = Math.max(60, ...days.map((x) => x[1]));
  const pend = d.tasks.filter((x) => !x.done).sort(byDue).slice(0, 5);
  const pct = (t.mode === 'foco' ? t.left / t.total : 1 - t.left / t.total) * 100;
  const energy = pct > 50 ? '#6FA85B' : pct > 20 ? '#E3B341' : '#D9825F';
  const subj = (id: number | null) => d.subjects.find((s) => s.id === id);
  const proj = (id: number | null) => d.projects.find((p) => p.id === id);

  const addProject = () => {
    const name = pn.trim();
    if (!name) return;
    setPn('');
    act(() => api('POST', '/projects', { name }));
  };

  return (
    <>
      <section className="box">
        <div className="modes">
          <button className={t.mode === 'foco' ? 'on' : ''} onClick={() => t.pick('foco')}>Foco 25 min</button>
          <button className={t.mode === 'pausa' ? 'on' : ''} onClick={() => t.pick('pausa')}>Descanso 5 min</button>
        </div>
        <span className="clock" role="timer">{mmss(t.left)}</span>
        <div className="lbl">Energia</div>
        <div className="energy"><div style={{ width: pct + '%', backgroundColor: energy }} /></div>
        <div className="row">
          <button className="p" onClick={t.toggle}>{t.run ? 'Pausar' : 'Iniciar'}</button>
          <button onClick={t.reset}>Zerar</button>
        </div>
      </section>

      <div className="two">
        <section className="box">
          <h2>Minutos focados hoje</h2>
          <p className="big">{d.sessions[today()] || 0}</p>
          <div className="wk" role="img" aria-label={'Minutos focados nos últimos 7 dias: ' + days.map(([day, minutes]) =>
            `${DAYS[new Date(day + 'T12:00').getDay()]}: ${minutes} minutos`).join(', ')}>
            {days.map(([day, v]) => (
              <div key={day} title={v + ' min'}>
                <i style={{ height: (v / max) * 64 }} />
                {DAYS[new Date(day + 'T12:00').getDay()]}
              </div>
            ))}
          </div>
        </section>
        <section className="box">
          <h2>Próximas tarefas</h2>
          {pend.length ? (
            <ul className="l">
              {pend.map((x) => {
                const p = proj(x.project_id);
                return (
                  <li key={x.id}>
                    <input type="checkbox" aria-label={'Concluir tarefa: ' + x.title}
                      onChange={() => act(() => api('PATCH', '/tasks/' + x.id, { done: true }))} />
                    <span className="tx">{x.title}</span>
                    {subj(x.subject_id) && <span className="meta"><i className="d" style={{ background: subj(x.subject_id)!.color }} />{subj(x.subject_id)!.name}</span>}
                    {p && <span className="meta">Projeto: {p.name}</span>}
                    {x.due && <span className={'meta' + (x.due < today() ? ' late' : '')}>{fmt(x.due)}</span>}
                  </li>
                );
              })}
            </ul>
          ) : <p className="emp">Nada pendente por enquanto. Respire fundo e aproveite o dia.</p>}
        </section>
      </div>

      <section className="box">
        <h2>Horta de projetos</h2>
        <div className="form">
          <input className="grow" value={pn} onChange={(e) => setPn(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addProject()}
            placeholder="Nome do projeto" maxLength={60} aria-label="Nome do projeto" />
          <button className="p" onClick={addProject}>Plantar projeto</button>
        </div>
        {d.projects.length
          ? <ul className="l">{d.projects.map((p) => <ProjectRow key={p.id + '-' + p.progress} p={p} act={act} />)}</ul>
          : <p className="emp">Plante um projeto e veja ele crescer conforme o progresso.</p>}
      </section>
    </>
  );
}
