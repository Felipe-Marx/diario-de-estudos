import type { Character, User } from './api';

/* ---------- desenho genérico de pixel art ---------- */
const PAL: Record<string, string> = { p: '#F28AAE', y: '#F7D56B', g: '#5E9E4C', b: '#9A6B43' };

export function Pix({ m, px, pal }: { m: string[]; px: number; pal?: Record<string, string> }) {
  const P = { ...PAL, ...pal };
  return (
    <svg width={m[0].length * px} height={m.length * px} viewBox={`0 0 ${m[0].length} ${m.length}`} shapeRendering="crispEdges" aria-hidden="true">
      {m.flatMap((row, y) => [...row].map((v, x) => (v === '.' ? null : <rect key={x + ',' + y} x={x} y={y} width={1} height={1} fill={P[v]} />)))}
    </svg>
  );
}

export const SPR = {
  sun: ['..yyy..', '.yyyyy.', 'yyyyyyy', 'yyyyyyy', 'yyyyyyy', '.yyyyy.', '..yyy..'],
  wild: ['..ppp..', '.ppypp.', '..ppp..', '...g...', '.g.g.g.', '..ggg..'],
  seed: ['.......', '.......', '.......', '.......', '.......', '.......', '..bbb..', '.bbbbb.'],
  sprout: ['.......', '.......', '.......', '..g.g..', '..ggg..', '...g...', '..bbb..', '.bbbbb.'],
  bud: ['.......', '...p...', '..ppp..', '...g...', '.g.g.g.', '..ggg..', '..bgb..', '.bbbbb.'],
  flower: ['..ppp..', '.ppypp.', '..ppp..', '...g...', '.g.g.g.', '..ggg..', '..bgb..', '.bbbbb.'],
};
export const stage = (v: number) => (v >= 100 ? SPR.flower : v >= 60 ? SPR.bud : v >= 25 ? SPR.sprout : SPR.seed);

/* ---------- personagem personalizável ---------- */
export const SKIN = ['#FDDBB4', '#F1C27D', '#D9A066', '#A9714B', '#6B4226'];
export const HAIR_COLORS = ['#2B2118', '#7A4A21', '#D9A441', '#C8553D', '#8E7CC3', '#E8E4DC'];
export const CLOTHES = ['#6FA85B', '#7FB9E6', '#F28AAE', '#F5B93C', '#B79AE0', '#E7E0D0'];
export const BACKGROUNDS = ['#BFE6F5', '#F9D5E1', '#DDF0C4', '#FBE7B0', '#DCD3F2', '#F2E8D5'];
export const HAIR_NAMES = ['Careca', 'Curto', 'Longo', 'Coque', 'Espetado'];
export const ACC_NAMES = ['Nenhum', 'Chapéu', 'Óculos', 'Flor'];
export const STYLE_NAMES = ['Lisa', 'Listrada'];

const BODY = [
  '............', '............', '...ssssss...', '...ssssss...', '...sesses...', '...ssssss...',
  '....ssss....', '...cccccc...', '..cccccccc..', '..sccccccs..', '..sccccccs..', '...pppppp...',
  '...pp..pp...', '...pp..pp...', '...kk..kk...', '............',
];
type Layer = Record<number, string>;
const HAIR: Layer[] = [
  {},
  { 1: '....hhhh....', 2: '...hhhhhh...', 3: '...h....h...' },
  { 1: '....hhhh....', 2: '...hhhhhh...', 3: '..hh....hh..', 4: '..hh....hh..', 5: '..hh....hh..', 6: '..hh....hh..', 7: '..hh....hh..' },
  { 0: '.....hh.....', 1: '....hhhh....', 2: '...hhhhhh...', 3: '...h....h...' },
  { 0: '...h.hh.h...', 1: '...hhhhhh...', 2: '...hhhhhh...', 3: '...h....h...' },
];
const ACC: Layer[] = [
  {},
  { 0: '....xxxx....', 1: '...xxxxxx...', 2: '..xxxxxxxx..' },
  { 4: '...l.ll.l...' },
  { 1: '.......ff...', 2: '.......ff...' },
];

function shade(hex: string, f = 0.78) {
  const n = parseInt(hex.slice(1), 16);
  return '#' + [16, 8, 0].map((s) => Math.round(((n >> s) & 255) * f).toString(16).padStart(2, '0')).join('');
}

export function CharacterSprite({ c, px = 8 }: { c: Character; px?: number }) {
  const shirt = CLOTHES[c.shirt];
  const pal: Record<string, string> = {
    s: SKIN[c.skin], e: '#3B2A1E', c: shirt, d: shade(shirt), p: '#7C8DB8', k: '#5A4632',
    h: HAIR_COLORS[c.hc], x: CLOTHES[c.ac], l: '#5A4632', f: CLOTHES[c.ac],
  };
  const g = BODY.map((r) => r.split(''));
  if (c.style === 1) [8, 10].forEach((y) => (g[y] = g[y].map((v) => (v === 'c' ? 'd' : v))));
  for (const layer of [HAIR[c.hair], ACC[c.acc]]) {
    for (const [y, row] of Object.entries(layer)) row.split('').forEach((v, x) => { if (v !== '.') g[+y][x] = v; });
  }
  return <Pix m={g.map((r) => r.join(''))} px={px} pal={pal} />;
}

export function Avatar({ user, size = 64 }: { user: Pick<User, 'avatarMode' | 'avatarImage' | 'character'>; size?: number }) {
  const img = user.avatarMode === 'image' && user.avatarImage;
  return (
    <div className="avatar" style={{ width: size, height: size, background: BACKGROUNDS[user.character.bg] }}>
      {img ? <img src={img} alt="" width={size} height={size} /> : <CharacterSprite c={user.character} px={size / 16} />}
    </div>
  );
}

/* ---------- cenário ---------- */
const FLOWER_COLORS = ['#F28AAE', '#7FB9E6', '#FFFFFF', '#F5B93C'];
const GROUND = Array.from({ length: 18 }, (_, i) => ({
  left: (i * 5.7 + 2) % 96, top: -14 + ((i * 11) % 36), px: 3 + (i % 2), color: FLOWER_COLORS[i % 4],
}));

export function Sky() {
  return (
    <>
      <div className="cloud c1" /><div className="cloud c2" />
      <div className="sun" aria-hidden="true"><Pix m={SPR.sun} px={7} /></div>
    </>
  );
}

export function Ground() {
  return (
    <div className="ground" aria-hidden="true">
      {GROUND.map((f, i) => (
        <span key={i} style={{ left: f.left + '%', top: f.top }}>
          <Pix m={SPR.wild} px={f.px} pal={{ p: f.color, y: f.color === '#F5B93C' ? '#F28AAE' : '#F7D56B' }} />
        </span>
      ))}
    </div>
  );
}
