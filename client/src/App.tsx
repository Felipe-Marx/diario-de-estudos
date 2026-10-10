import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type AllData, type User } from './api';
import { useAuth } from './auth';
import { today } from './lib';
import { Avatar, Ground, Sky } from './pixel';
import { useTimer } from './timer';
import Login from './pages/Login';
import Profile from './pages/Profile';
import Subjects from './pages/Subjects';
import Tasks from './pages/Tasks';
import Today from './pages/Today';

type Tab = 'hoje' | 'mat' | 'tar' | 'perfil';
const TABS: [Tab, string][] = [['hoje', 'Hoje'], ['mat', 'Matérias'], ['tar', 'Tarefas'], ['perfil', 'Perfil']];
const EMPTY: AllData = { subjects: [], tasks: [], projects: [], sessions: {} };

function useData() {
  const { setUser } = useAuth();
  const [d, setD] = useState<AllData>(EMPTY);
  const [offline, setOffline] = useState(false);
  const [actionError, setActionError] = useState('');

  const reload = useCallback(async () => {
    try {
      setD(await api<AllData>('GET', '/all'));
      setOffline(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setUser(null);
      else setOffline(true);
    }
  }, [setUser]);

  useEffect(() => { reload(); }, [reload]);

  const act = useCallback(async (f: () => Promise<unknown>) => {
    try {
      await f();
      setActionError('');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Não foi possível concluir a ação. Tente novamente.');
    }
    await reload();
  }, [reload]);

  return { d, offline, actionError, setActionError, act };
}

function Shell({ user }: { user: User }) {
  const [tab, setTab] = useState<Tab>('hoje');
  const { d, offline, actionError, setActionError, act } = useData();
  const timer = useTimer(() => { act(() => api('POST', '/sessions', { minutes: 25, day: today() })); });

  const h = new Date().getHours();
  const greeting = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';

  return (
    <div className="page">
      <header className="sky">
        <Sky />
        <div className="wrap">
          <div className="top">
            <div>
              <h1>{greeting}, {user.username}</h1>
              <p className="sub">{new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
            </div>
            <button className="me" onClick={() => setTab('perfil')} aria-label="Abrir perfil"><Avatar user={user} size={56} /></button>
          </div>
          <nav aria-label="Seções">
            {TABS.map(([k, n]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{n}</button>)}
          </nav>
        </div>
      </header>
      <main className="wrap panel">
        {offline && <div className="err" role="alert">Não consegui falar com o servidor. Ele está rodando? Rode <b>npm start</b> e recarregue a página.</div>}
        {actionError && <div className="err" role="alert">{actionError}
          <button aria-label="Fechar aviso" onClick={() => setActionError('')}>×</button>
        </div>}
        {tab === 'hoje' && <Today d={d} act={act} t={timer} />}
        {tab === 'mat' && <Subjects subjects={d.subjects} act={act} />}
        {tab === 'tar' && <Tasks tasks={d.tasks} subjects={d.subjects} projects={d.projects} act={act} />}
        {tab === 'perfil' && <Profile user={user} />}
      </main>
      <Ground />
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <p className="boot">Carregando...</p>;
  return user ? <Shell user={user} /> : <Login />;
}
