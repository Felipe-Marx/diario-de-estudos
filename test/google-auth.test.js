const assert = require('node:assert/strict');
const { once } = require('node:events');
const test = require('node:test');
const { OAuth2Client } = require('google-auth-library');

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'google-auth-test-secret';
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';

const credentials = new Map();
const originalVerifyIdToken = OAuth2Client.prototype.verifyIdToken;
OAuth2Client.prototype.verifyIdToken = async function ({ idToken, audience }) {
  assert.equal(audience, process.env.GOOGLE_CLIENT_ID);
  const payload = credentials.get(idToken);
  if (!payload) throw new Error('invalid test credential');
  return { getPayload: () => payload };
};

const { app, db } = require('../server');
let server;
let baseUrl;

test.before(async () => {
  server = app.listen(0);
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  db.close();
  OAuth2Client.prototype.verifyIdToken = originalVerifyIdToken;
});

async function request(pathname, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(baseUrl + pathname, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    response,
    data: await response.json(),
    cookie: response.headers.get('set-cookie')?.split(';')[0],
  };
}

test('Google: expõe o client ID, rejeita credenciais inválidas e cria sessão verificada', async () => {
  const config = await request('/api/config');
  assert.equal(config.data.googleClientId, process.env.GOOGLE_CLIENT_ID);

  const missing = await request('/api/auth/google', { method: 'POST', body: {} });
  assert.equal(missing.response.status, 400);

  const invalid = await request('/api/auth/google', {
    method: 'POST',
    body: { credential: 'invalid-token' },
  });
  assert.equal(invalid.response.status, 401);
  assert.equal(invalid.data.error, 'Não foi possível validar o login com Google');

  credentials.set('unverified-token', {
    sub: 'google-unverified', email: 'nao-verificado@example.test', email_verified: false,
  });
  const unverified = await request('/api/auth/google', {
    method: 'POST',
    body: { credential: 'unverified-token' },
  });
  assert.equal(unverified.response.status, 400);
  assert.equal(db.prepare('SELECT 1 FROM users WHERE email = ?').get('nao-verificado@example.test'), undefined);

  credentials.set('missing-sub-token', {
    email: 'sem-sub@example.test', email_verified: true,
  });
  const missingSubject = await request('/api/auth/google', {
    method: 'POST',
    body: { credential: 'missing-sub-token' },
  });
  assert.equal(missingSubject.response.status, 400);
  assert.equal(db.prepare('SELECT 1 FROM users WHERE email = ?').get('sem-sub@example.test'), undefined);

  credentials.set('new-account-token', {
    sub: 'google-new-user', email: 'Google.User@example.test',
    email_verified: true, name: 'Pessoa do Google',
  });
  const created = await request('/api/auth/google', {
    method: 'POST',
    body: { credential: 'new-account-token' },
  });
  assert.equal(created.response.status, 200);
  assert.ok(created.cookie?.startsWith('token='));
  assert.equal(created.data.email, 'google.user@example.test');
  assert.equal(created.data.username, 'Pessoa do Google');
  assert.equal(db.prepare('SELECT google_sub FROM users WHERE id = ?').get(created.data.id).google_sub, 'google-new-user');

  const data = await request('/api/all', { cookie: created.cookie });
  assert.equal(data.response.status, 200);
  assert.deepEqual(data.data.subjects, []);
});

test('Google: vincula conta existente pelo e-mail e reutiliza a mesma conta pelo subject', async () => {
  const registration = await request('/api/auth/register', {
    method: 'POST',
    body: {
      email: 'existing@example.test',
      password: 'senha-de-teste-segura',
      username: 'Conta Existente',
    },
  });
  assert.equal(registration.response.status, 200);
  const userId = registration.data.id;

  credentials.set('link-existing-token', {
    sub: 'google-linked-user', email: 'EXISTING@example.test',
    email_verified: true, name: 'Nome Google',
  });
  const linked = await request('/api/auth/google', {
    method: 'POST',
    body: { credential: 'link-existing-token' },
  });
  assert.equal(linked.response.status, 200);
  assert.equal(linked.data.id, userId);
  assert.equal(linked.data.username, 'Conta Existente');
  assert.equal(db.prepare('SELECT google_sub FROM users WHERE id = ?').get(userId).google_sub, 'google-linked-user');

  credentials.set('existing-google-token', {
    sub: 'google-linked-user', email: 'different-claim@example.test',
    email_verified: true, name: 'Outro Nome',
  });
  const loginAgain = await request('/api/auth/google', {
    method: 'POST',
    body: { credential: 'existing-google-token' },
  });
  assert.equal(loginAgain.response.status, 200);
  assert.equal(loginAgain.data.id, userId);
});
