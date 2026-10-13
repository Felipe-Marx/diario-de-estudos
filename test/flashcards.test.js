const assert = require('node:assert/strict');
const { once } = require('node:events');
const test = require('node:test');

process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'flashcards-test-secret';

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

test('flashcards isolam matérias por usuário e atualizam intervalos espaçados', async () => {
  const owner = await request('/api/auth/register', {
    method: 'POST',
    body: { email: 'cards-owner@example.test', password: 'senha-segura-owner' },
  });
  const other = await request('/api/auth/register', {
    method: 'POST',
    body: { email: 'cards-other@example.test', password: 'senha-segura-other' },
  });
  const ownerSubject = await request('/api/subjects', {
    method: 'POST',
    cookie: owner.cookie,
    body: { name: 'Biologia' },
  });
  const otherSubject = await request('/api/subjects', {
    method: 'POST',
    cookie: other.cookie,
    body: { name: 'História' },
  });

  const invalidSubject = await request('/api/flashcards', {
    method: 'POST',
    cookie: owner.cookie,
    body: { subject_id: otherSubject.data.id, front: 'Pergunta', back: 'Resposta' },
  });
  assert.equal(invalidSubject.response.status, 404);
  const missingFields = await request('/api/flashcards', {
    method: 'POST',
    cookie: owner.cookie,
    body: { subject_id: ownerSubject.data.id, front: 'Pergunta', back: '' },
  });
  assert.equal(missingFields.response.status, 400);

  const created = await request('/api/flashcards', {
    method: 'POST',
    cookie: owner.cookie,
    body: { subject_id: ownerSubject.data.id, front: 'O que é mitose?', back: 'Divisão celular.' },
  });
  assert.equal(created.response.status, 201);
  const cardId = created.data.id;
  const ownCards = await request('/api/all', { cookie: owner.cookie });
  const otherCards = await request('/api/all', { cookie: other.cookie });
  assert.equal(ownCards.data.flashcards.length, 1);
  assert.equal(ownCards.data.flashcards[0].front, 'O que é mitose?');
  assert.deepEqual(otherCards.data.flashcards, []);

  const wrongOwnerReview = await request(`/api/flashcards/${cardId}/review`, {
    method: 'PATCH',
    cookie: other.cookie,
    body: { rating: 'good' },
  });
  assert.equal(wrongOwnerReview.response.status, 404);
  const invalidRating = await request(`/api/flashcards/${cardId}/review`, {
    method: 'PATCH',
    cookie: owner.cookie,
    body: { rating: 'perfect' },
  });
  assert.equal(invalidRating.response.status, 400);
  const inheritedRating = await request(`/api/flashcards/${cardId}/review`, {
    method: 'PATCH',
    cookie: owner.cookie,
    body: { rating: 'toString' },
  });
  assert.equal(inheritedRating.response.status, 400);

  const expected = [
    { rating: 'good', repetitions: 1, interval_days: 1 },
    { rating: 'easy', repetitions: 2, interval_days: 6 },
    { rating: 'hard', repetitions: 3, interval_days: 16 },
    { rating: 'again', repetitions: 0, interval_days: 0 },
  ];
  for (const item of expected) {
    const reviewed = await request(`/api/flashcards/${cardId}/review`, {
      method: 'PATCH',
      cookie: owner.cookie,
      body: { rating: item.rating },
    });
    assert.equal(reviewed.response.status, 200);
    assert.equal(reviewed.data.repetitions, item.repetitions);
    assert.equal(reviewed.data.interval_days, item.interval_days);
    assert.ok(reviewed.data.ease_factor >= 1.3);
    assert.ok(reviewed.data.next_review_at > Date.now());
  }

  const wrongOwnerDelete = await request(`/api/flashcards/${cardId}`, {
    method: 'DELETE',
    cookie: other.cookie,
  });
  assert.equal(wrongOwnerDelete.response.status, 404);
  const deletedSubject = await request(`/api/subjects/${ownerSubject.data.id}`, {
    method: 'DELETE',
    cookie: owner.cookie,
  });
  assert.equal(deletedSubject.response.status, 200);
  const afterCascade = await request('/api/all', { cookie: owner.cookie });
  assert.deepEqual(afterCascade.data.flashcards, []);
});
