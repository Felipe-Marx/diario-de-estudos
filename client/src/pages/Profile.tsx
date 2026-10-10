import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { api, type Character, type User } from '../api';
import { useAuth } from '../auth';
import {
  ACC_NAMES, Avatar, BACKGROUNDS, CLOTHES, HAIR_COLORS, HAIR_NAMES, SKIN, STYLE_NAMES,
} from '../pixel';

const rand = (n: number) => Math.floor(Math.random() * n);

// recorta a imagem em quadrado e reduz para 192px antes de enviar
function toAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      const size = 192, side = Math.min(im.width, im.height);
      const cv = document.createElement('canvas');
      cv.width = cv.height = size;
      cv.getContext('2d')!.drawImage(im, (im.width - side) / 2, (im.height - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(cv.toDataURL('image/webp', 0.85));
    };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não consegui ler essa imagem.')); };
    im.src = url;
  });
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="optrow"><span className="lbl">{label}</span>
    <div className="opts" role="radiogroup" aria-label={label}>{children}</div>
  </div>;
}

function moveRadio(e: KeyboardEvent<HTMLButtonElement>, index: number, count: number, onPick: (i: number) => void) {
  let next: number;
  switch (e.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      next = (index + 1) % count;
      break;
    case 'ArrowLeft':
    case 'ArrowUp':
      next = (index + count - 1) % count;
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = count - 1;
      break;
    default:
      return;
  }
  e.preventDefault();
  onPick(next);
  e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
}

function Swatches({ colors, value, onPick, name }: { colors: string[]; value: number; onPick: (i: number) => void; name: string }) {
  return <>{colors.map((c, i) => (
    <button key={c} type="button" className={'sw' + (i === value ? ' on' : '')} style={{ background: c }}
      role="radio" aria-label={`${name} ${i + 1}`} aria-checked={i === value} tabIndex={i === value ? 0 : -1}
      onKeyDown={(e) => moveRadio(e, i, colors.length, onPick)} onClick={() => onPick(i)} />
  ))}</>;
}

function Choices({ names, value, onPick }: { names: string[]; value: number; onPick: (i: number) => void }) {
  return <>{names.map((n, i) => (
    <button key={n} type="button" className={'chip' + (i === value ? ' on' : '')} role="radio"
      aria-checked={i === value} tabIndex={i === value ? 0 : -1}
      onKeyDown={(e) => moveRadio(e, i, names.length, onPick)} onClick={() => onPick(i)}>{n}</button>
  ))}</>;
}

export default function Profile({ user }: { user: User }) {
  const { setUser, logout } = useAuth();
  const [d, setD] = useState({ username: user.username, mode: user.avatarMode, image: user.avatarImage, character: user.character });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const ch = (k: keyof Character) => (i: number) => setD({ ...d, character: { ...d.character, [k]: i } });
  const c = d.character;

  const upload = async (f?: File) => {
    if (!f) return;
    try {
      setD({ ...d, image: await toAvatar(f), mode: 'image' });
      setMsg('');
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const randomize = () => setD({
    ...d, mode: 'character',
    character: { skin: rand(5), hair: rand(5), hc: rand(6), shirt: rand(6), style: rand(2), acc: rand(4), ac: rand(6), bg: rand(6) },
  });

  const save = async () => {
    setBusy(true);
    setMsg('');
    try {
      setUser(await api<User>('PUT', '/me', { username: d.username, avatarMode: d.mode, avatarImage: d.image, character: d.character }));
      setMsg('Perfil salvo!');
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="two prof">
      <section className="box preview">
        <Avatar user={{ avatarMode: d.mode, avatarImage: d.image, character: c }} size={160} />
        <div className="pname">{d.username || 'Seu nome'}</div>
        <span className="meta">{user.email}</span>
        <div className="row">
          <button className="p" onClick={save} disabled={busy}>{busy ? 'Salvando...' : 'Salvar perfil'}</button>
        </div>
        {msg && <p className="hint" role="status">{msg}</p>}
        <button className="dng" onClick={logout}>Sair da conta</button>
      </section>

      <section className="box">
        <h2>Nome de usuário</h2>
        <input className="full" value={d.username} onChange={(e) => setD({ ...d, username: e.target.value })} maxLength={30}
          aria-label="Nome de usuário" placeholder="Do jeito que você quiser" />
        <p className="hint">Pode usar espaços, acentos, símbolos e emojis (até 30 caracteres).</p>

        <h2>Avatar</h2>
        <div className="chips">
          <button className={'chip' + (d.mode === 'character' ? ' on' : '')} onClick={() => setD({ ...d, mode: 'character' })}>Meu personagem</button>
          <button className={'chip' + (d.mode === 'image' ? ' on' : '')} disabled={!d.image} onClick={() => setD({ ...d, mode: 'image' })}>Minha imagem</button>
          <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
          <button onClick={() => file.current?.click()}>Enviar imagem</button>
          {d.image && <button onClick={() => setD({ ...d, image: null, mode: 'character' })}>Remover imagem</button>}
        </div>

        <h2>Personagem</h2>
        <Row label="Pele"><Swatches colors={SKIN} value={c.skin} onPick={ch('skin')} name="Tom de pele" /></Row>
        <Row label="Cabelo"><Choices names={HAIR_NAMES} value={c.hair} onPick={ch('hair')} /></Row>
        <Row label="Cor do cabelo"><Swatches colors={HAIR_COLORS} value={c.hc} onPick={ch('hc')} name="Cor do cabelo" /></Row>
        <Row label="Roupa"><Choices names={STYLE_NAMES} value={c.style} onPick={ch('style')} /></Row>
        <Row label="Cor da roupa"><Swatches colors={CLOTHES} value={c.shirt} onPick={ch('shirt')} name="Cor da roupa" /></Row>
        <Row label="Acessório"><Choices names={ACC_NAMES} value={c.acc} onPick={ch('acc')} /></Row>
        <Row label="Cor do acessório"><Swatches colors={CLOTHES} value={c.ac} onPick={ch('ac')} name="Cor do acessório" /></Row>
        <Row label="Fundo"><Swatches colors={BACKGROUNDS} value={c.bg} onPick={ch('bg')} name="Cor do fundo" /></Row>
        <div className="row" style={{ marginTop: 12 }}><button onClick={randomize}>Sortear personagem</button></div>
      </section>
    </div>
  );
}
