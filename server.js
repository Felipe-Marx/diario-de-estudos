const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { OAuth2Client } = require('google-auth-library');
const { initializeDatabase, TABLES } = require('./database');

try { process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* .env é opcional */ }

const PORT = process.env.PORT || 3000;
const GID = process.env.GOOGLE_CLIENT_ID || '';
const PROD = process.env.NODE_ENV === 'production';
const gclient = new OAuth2Client();

let SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  const f = path.join(__dirname, '.jwt-secret');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  SECRET = fs.readFileSync(f, 'utf8').trim();
}

/* ---------- banco ---------- */
const db = new Database(process.env.DB_PATH || path.join(__dirname, 'estudos.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
initializeDatabase(db);

const COLORS = ['#F28AAE', '#7FB9E6', '#8CC46F', '#F3B65B', '#B79AE0', '#6CCFC2'];
const DEF = { skin: 1, hair: 1, hc: 1, shirt: 0, style: 0, acc: 0, ac: 2, bg: 0 };
const MAX = { skin: 4, hair: 4, hc: 5, shirt: 5, style: 1, acc: 3, ac: 5, bg: 5 };
const IMG = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

/* ---------- helpers ---------- */
const str = (v, max) => (typeof v === 'string' ? [...v.trim()].slice(0, max).join('') : '');
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const getUser = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);

function cleanChar(c) {
  if (!c || typeof c !== 'object') return null;
  const o = {};
  for (const k in MAX) {
    const v = Number(c[k]);
    if (!Number.isInteger(v) || v < 0 || v > MAX[k]) return null;
    o[k] = v;
  }
  return o;
}

const pub = (u) => ({
  id: u.id,
  email: u.email,
  username: u.username,
  avatarMode: u.avatar_mode,
  avatarImage: u.avatar_image,
  character: JSON.parse(u.character),
  hasPassword: !!u.password_hash,
});

function refreshProjectProgress(uid, projectId) {
  const project = db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').get(projectId, uid);
  if (!project) return;
  const { total, done } = db.prepare(`
    SELECT COUNT(*) AS total, COALESCE(SUM(done), 0) AS done
    FROM tasks WHERE user_id = ? AND project_id = ?
  `).get(uid, projectId);
  const pct = total ? Math.round((done / total) * 100) : 0;
  db.prepare('UPDATE projects SET progress = ? WHERE id = ? AND user_id = ?').run(pct, projectId, uid);
}

function onNewUser(uid) {
  const first = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 1;
  const orphans = db.prepare('SELECT COUNT(*) AS n FROM subjects WHERE user_id IS NULL').get().n;
  if (first && orphans) {
    // dados da v1 passam a pertencer ao primeiro usuário cadastrado
    TABLES.forEach((t) => db.prepare(`UPDATE ${t} SET user_id = ? WHERE user_id IS NULL`).run(uid));
  }
}

function createUser({ email, hash = null, sub = null, username }) {
  const r = db.prepare('INSERT INTO users (email, password_hash, google_sub, username, character) VALUES (?, ?, ?, ?, ?)')
    .run(email, hash, sub, username, JSON.stringify(DEF));
  onNewUser(r.lastInsertRowid);
  return getUser(r.lastInsertRowid);
}

function startSession(res, u) {
  const token = jwt.sign({ id: u.id }, SECRET, { expiresIn: '30d' });
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: 30 * 864e5 });
  res.json(pub(u));
}

function auth(req, res, next) {
  try {
    const { id } = jwt.verify(req.cookies.token || '', SECRET);
    const u = getUser(id);
    if (!u) throw new Error('sem usuário');
    req.user = u;
    next();
  } catch {
    bad(res, 'Não autenticado', 401);
  }
}

// limite simples de tentativas por IP nas rotas de login
const hits = new Map();
function limit(req, res, next) {
  const now = Date.now();
  const recent = (hits.get(req.ip) || []).filter((t) => now - t < 15 * 60 * 1000);
  if (recent.length >= 20) return bad(res, 'Muitas tentativas. Tente de novo em alguns minutos.', 429);
  recent.push(now);
  hits.set(req.ip, recent);
  next();
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

/* ---------- rotas públicas ---------- */
app.get('/api/config', (req, res) => res.json({ googleClientId: GID || null }));

app.post('/api/auth/register', limit, async (req, res) => {
  const email = str(req.body.email, 254).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad(res, 'E-mail inválido');
  if (password.length < 8 || password.length > 72) return bad(res, 'A senha precisa ter de 8 a 72 caracteres');
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) return bad(res, 'Esse e-mail já tem conta. Entre ou use o Google.', 409);
  const username = str(req.body.username, 30) || email.split('@')[0];
  startSession(res, createUser({ email, hash: await bcrypt.hash(password, 10), username }));
});

app.post('/api/auth/login', limit, async (req, res) => {
  const email = str(req.body.email, 254).toLowerCase();
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const ok = u && u.password_hash && typeof req.body.password === 'string' && (await bcrypt.compare(req.body.password, u.password_hash));
  if (!ok) return bad(res, 'E-mail ou senha incorretos', 401);
  startSession(res, u);
});

app.post('/api/auth/google', limit, async (req, res, next) => {
  if (!GID) return bad(res, 'Login com Google não está configurado neste servidor', 501);
  const credential = typeof req.body.credential === 'string' ? req.body.credential : '';
  if (!credential) return bad(res, 'Credencial do Google ausente');

  let ticket;
  try {
    ticket = await gclient.verifyIdToken({ idToken: credential, audience: GID });
  } catch {
    bad(res, 'Não foi possível validar o login com Google', 401);
    return;
  }

  const payload = ticket.getPayload();
  if (!payload || typeof payload.sub !== 'string' || !payload.sub
    || typeof payload.email !== 'string' || !payload.email || payload.email_verified !== true) {
    return bad(res, 'O Google não retornou um e-mail verificado válido');
  }

  const email = payload.email.toLowerCase();
  try {
    let user = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(payload.sub)
      || db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (user && !user.google_sub) {
      db.prepare('UPDATE users SET google_sub = ? WHERE id = ? AND google_sub IS NULL').run(payload.sub, user.id);
      user = getUser(user.id);
    }
    if (!user) {
      user = createUser({ email, sub: payload.sub, username: str(payload.name, 30) || email.split('@')[0] });
    }
    startSession(res, user);
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

/* ---------- rotas protegidas ---------- */
app.use('/api', auth);

app.get('/api/me', (req, res) => res.json(pub(req.user)));

app.put('/api/me', (req, res) => {
  const b = req.body, u = req.user;
  const username = b.username === undefined ? u.username : str(b.username, 30);
  if (!username) return bad(res, 'Escolha um nome de usuário');
  let character = u.character;
  if (b.character !== undefined) {
    const c = cleanChar(b.character);
    if (!c) return bad(res, 'Personagem inválido');
    character = JSON.stringify(c);
  }
  let image = u.avatar_image;
  if (b.avatarImage !== undefined) {
    if (b.avatarImage === null) image = null;
    else if (typeof b.avatarImage === 'string' && b.avatarImage.length <= 400000 && IMG.test(b.avatarImage)) image = b.avatarImage;
    else return bad(res, 'Imagem inválida. Use PNG, JPG ou WebP.');
  }
  const want = b.avatarMode === undefined ? u.avatar_mode : b.avatarMode;
  const mode = want === 'image' && image ? 'image' : 'character';
  db.prepare('UPDATE users SET username = ?, character = ?, avatar_image = ?, avatar_mode = ? WHERE id = ?')
    .run(username, character, image, mode, u.id);
  res.json(pub(getUser(u.id)));
});

app.get('/api/all', (req, res) => {
  const uid = req.user.id;
  const sessions = {};
  db.prepare("SELECT day, SUM(minutes) AS m FROM sessions WHERE user_id = ? AND day >= date('now', '-10 day') GROUP BY day")
    .all(uid).forEach((r) => (sessions[r.day] = r.m));
  db.prepare('SELECT id FROM projects WHERE user_id = ?').all(uid).forEach((p) => refreshProjectProgress(uid, p.id));
  res.json({
    subjects: db.prepare('SELECT id, name, color, notes FROM subjects WHERE user_id = ? ORDER BY id').all(uid),
    tasks: db.prepare('SELECT id, title, subject_id, project_id, due, done FROM tasks WHERE user_id = ? ORDER BY id').all(uid),
    projects: db.prepare('SELECT id, name, progress FROM projects WHERE user_id = ? ORDER BY id').all(uid),
    sessions,
  });
});

// Matérias
app.post('/api/subjects', (req, res) => {
  const name = str(req.body.name, 40);
  if (!name) return bad(res, 'Nome obrigatório');
  const n = db.prepare('SELECT COUNT(*) AS n FROM subjects WHERE user_id = ?').get(req.user.id).n;
  const r = db.prepare('INSERT INTO subjects (name, color, notes, user_id) VALUES (?, ?, ?, ?)')
    .run(name, COLORS[n % COLORS.length], `# ${name}\n\n`, req.user.id);
  res.status(201).json({ id: r.lastInsertRowid });
});
app.put('/api/subjects/:id', (req, res) => {
  const { name, notes } = req.body;
  db.prepare('UPDATE subjects SET name = COALESCE(?, name), notes = COALESCE(?, notes) WHERE id = ? AND user_id = ?')
    .run(typeof name === 'string' ? str(name, 40) : null, typeof notes === 'string' ? notes.slice(0, 200000) : null, req.params.id, req.user.id);
  res.json({ ok: true });
});
app.delete('/api/subjects/:id', (req, res) => {
  db.prepare('DELETE FROM subjects WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// Tarefas
app.post('/api/tasks', (req, res) => {
  const title = str(req.body.title, 120);
  if (!title) return bad(res, 'Título obrigatório');
  const sid = db.prepare('SELECT id FROM subjects WHERE id = ? AND user_id = ?').get(Number(req.body.subject_id) || 0, req.user.id)?.id ?? null;
  const pid = Number(req.body.project_id) || 0;
  const projectId = pid && db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').get(pid, req.user.id)?.id ? pid : null;
  const due = isDay(req.body.due) ? req.body.due : '';
  const create = db.transaction(() => {
    const r = db.prepare('INSERT INTO tasks (title, subject_id, project_id, due, user_id) VALUES (?, ?, ?, ?, ?)')
      .run(title, sid, projectId, due, req.user.id);
    if (projectId) refreshProjectProgress(req.user.id, projectId);
    return r;
  });
  const r = create();
  res.status(201).json({ id: r.lastInsertRowid });
});
app.patch('/api/tasks/:id', (req, res) => {
  const existing = db.prepare('SELECT project_id FROM tasks WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!existing) return bad(res, 'Tarefa não encontrada', 404);
  const pid = req.body.project_id === undefined ? existing.project_id : (req.body.project_id === null ? null : (db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').get(Number(req.body.project_id) || 0, req.user.id)?.id ?? null));
  const done = req.body.done === undefined ? undefined : Number(Boolean(req.body.done));
  const updates = [];
  const values = [];
  if (done !== undefined) {
    updates.push('done = ?');
    values.push(done);
  }
  if (req.body.project_id !== undefined) {
    updates.push('project_id = ?');
    values.push(pid);
  }
  if (!updates.length) return res.json({ ok: true });
  const update = db.transaction(() => {
    db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).run(...values, req.params.id, req.user.id);
    const affected = new Set([existing.project_id, pid].filter(Boolean));
    affected.forEach((projectId) => refreshProjectProgress(req.user.id, projectId));
  });
  update();
  res.json({ ok: true });
});
app.delete('/api/tasks/:id', (req, res) => {
  const task = db.prepare('SELECT project_id FROM tasks WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  const remove = db.transaction(() => {
    db.prepare('DELETE FROM tasks WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
    if (task && task.project_id) refreshProjectProgress(req.user.id, task.project_id);
  });
  remove();
  res.json({ ok: true });
});

// Projetos
app.post('/api/projects', (req, res) => {
  const name = str(req.body.name, 60);
  if (!name) return bad(res, 'Nome obrigatório');
  const r = db.prepare('INSERT INTO projects (name, user_id) VALUES (?, ?)').run(name, req.user.id);
  res.status(201).json({ id: r.lastInsertRowid });
});
app.delete('/api/projects/:id', (req, res) => {
  db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// Sessões de foco
app.post('/api/sessions', (req, res) => {
  const minutes = Math.max(1, Math.min(240, Math.round(Number(req.body.minutes) || 0)));
  const day = isDay(req.body.day) ? req.body.day : new Date().toISOString().slice(0, 10);
  db.prepare('INSERT INTO sessions (day, minutes, user_id) VALUES (?, ?, ?)').run(day, minutes, req.user.id);
  res.status(201).json({ ok: true });
});

app.use('/api', (req, res) => bad(res, 'Rota não encontrada', 404));

/* ---------- frontend compilado ---------- */
const DIST = path.join(__dirname, 'client', 'dist');
app.use(express.static(DIST));
app.get(/^\/(?!api).*/, (req, res) => {
  const index = path.join(DIST, 'index.html');
  if (fs.existsSync(index)) return res.sendFile(index);
  res.status(200).send('Frontend ainda não compilado. Rode "npm run build" ou use "npm run dev" dentro da pasta client.');
});

app.use((err, req, res, next) => {
  console.error(err);
  bad(res, 'Erro interno', 500);
});

if (require.main === module) {
  const server = app.listen(PORT, () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : PORT;
    console.log(`Diário de Estudos rodando em http://localhost:${port}`);
  });
}

module.exports = { app, db };
