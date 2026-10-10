import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, type User } from '../api';
import { useAuth } from '../auth';
import { CharacterSprite, Ground, Sky } from '../pixel';

const DEMO = { skin: 1, hair: 1, hc: 1, shirt: 0, style: 1, acc: 3, ac: 2, bg: 0 };

interface GoogleCredentialResponse { credential: string }
interface GoogleIdentity {
  accounts: {
    id: {
      initialize: (options: { client_id: string; callback: (response: GoogleCredentialResponse) => void }) => void;
      renderButton: (element: HTMLElement, options: {
        theme: 'outline'; size: 'large'; text: 'continue_with'; width: number; locale: 'pt-BR';
      }) => void;
    };
  };
}

declare global {
  interface Window { google?: GoogleIdentity }
}

function GoogleButton({ clientId, busy, onCredential, onFailure }: {
  clientId: string;
  busy: boolean;
  onCredential: (c: string) => void;
  onFailure: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const cb = useRef(onCredential);
  const fail = useRef(onFailure);
  cb.current = onCredential;
  fail.current = onFailure;

  useEffect(() => {
    let disposed = false;
    const start = () => {
      if (disposed || !window.google || !box.current) return;
      try {
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response) => {
            if (typeof response.credential === 'string' && response.credential) cb.current(response.credential);
            else fail.current();
          },
        });
        window.google.accounts.id.renderButton(box.current, {
          theme: 'outline', size: 'large', text: 'continue_with', width: 280, locale: 'pt-BR',
        });
      } catch {
        fail.current();
      }
    };
    if (window.google) {
      start();
      return () => { disposed = true; };
    }

    const src = 'https://accounts.google.com/gsi/client';
    const script = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`) || document.createElement('script');
    const isNew = !script.isConnected;
    if (isNew) {
      script.src = src;
      script.async = true;
    }
    const onLoad = () => start();
    const onError = () => fail.current();
    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    if (isNew) document.head.appendChild(script);
    return () => {
      disposed = true;
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
    };
  }, [clientId]);

  return <div ref={box} className="gbtn" aria-busy={busy} style={{ pointerEvents: busy ? 'none' : undefined, opacity: busy ? 0.6 : 1 }} />;
}

export default function Login() {
  const { setUser } = useAuth();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [f, setF] = useState({ username: '', email: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [gid, setGid] = useState<string | null>(null);
  const [googleConfigLoaded, setGoogleConfigLoaded] = useState(false);
  const [googleConfigError, setGoogleConfigError] = useState('');

  useEffect(() => {
    api<{ googleClientId: string | null }>('GET', '/config')
      .then((c) => {
        setGid(c.googleClientId);
        setGoogleConfigLoaded(true);
      })
      .catch(() => {
        setGoogleConfigError('Não foi possível falar com o servidor. Tente novamente.');
        setGoogleConfigLoaded(true);
      });
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      setUser(await api<User>('POST', mode === 'in' ? '/auth/login' : '/auth/register', f));
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const google = async (credential: string) => {
    setBusy(true);
    setErr('');
    try {
      setUser(await api<User>('POST', '/auth/google', { credential }));
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'Não foi possível conectar ao servidor para entrar com Google.');
    } finally {
      setBusy(false);
    }
  };

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <div className="page">
      <header className="sky"><Sky /></header>
      <main className="auth">
        <div className="authhead">
          <CharacterSprite c={DEMO} px={7} />
          <div>
            <h1>Diário de Estudos</h1>
            <p className="sub">Um cantinho tranquilo para organizar seus estudos.</p>
          </div>
        </div>
        <section className="box">
          <div className="chips">
            <button className={'chip' + (mode === 'in' ? ' on' : '')} onClick={() => setMode('in')}>Entrar</button>
            <button className={'chip' + (mode === 'up' ? ' on' : '')} onClick={() => setMode('up')}>Criar conta</button>
          </div>
          <form onSubmit={submit}>
            {mode === 'up' && (
              <label className="field">Nome de usuário
                <input value={f.username} onChange={set('username')} maxLength={30} autoComplete="nickname" placeholder="Como você quer ser chamado" />
              </label>
            )}
            <label className="field">E-mail
              <input type="email" value={f.email} onChange={set('email')} required autoComplete="email" />
            </label>
            <label className="field">Senha
              <input type="password" value={f.password} onChange={set('password')} required minLength={mode === 'up' ? 8 : undefined}
                autoComplete={mode === 'up' ? 'new-password' : 'current-password'} />
              {mode === 'up' && <span className="hint">Mínimo de 8 caracteres.</span>}
            </label>
            {err && <p className="error" role="alert">{err}</p>}
            <button className="p wide" disabled={busy}>{busy ? 'Aguarde...' : mode === 'in' ? 'Entrar' : 'Criar conta'}</button>
          </form>
          <div className="or"><span>ou</span></div>
          {gid ? <GoogleButton clientId={gid} busy={busy} onCredential={google} onFailure={() => setErr('O Google não conseguiu concluir a autenticação. Tente novamente.')} /> : googleConfigError ? (
            <p className="hint" role="status">Não foi possível carregar a configuração do login com Google: {googleConfigError}</p>
          ) : googleConfigLoaded ? (
            <p className="hint">Login com Google indisponível: configure o GOOGLE_CLIENT_ID no servidor (veja o README).</p>
          ) : <p className="hint" role="status">Carregando a configuração do login com Google...</p>}
        </section>
      </main>
      <Ground />
    </div>
  );
}
