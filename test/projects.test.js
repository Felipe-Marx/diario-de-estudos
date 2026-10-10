const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diario-projects-'));
process.env.DB_PATH = path.join(tempDir, 'test.db');
process.env.JWT_SECRET = 'test-secret-not-used-outside-tests';

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
  fs.rmSync(tempDir, { recursive: true, force: true });
});

async function request(pathname, { cookie, method = 'GET', body } = {}) {
  const response = await fetch(baseUrl + pathname, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  return { response, data };
}

async function register(email) {
  const { response, data } = await request('/api/auth/register', {
    method: 'POST',
    body: { email, password: 'senha-teste-123', username: email.split('@')[0] },
  });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}

async function createProject(cookie, name) {
  const { response, data } = await request('/api/projects', {
    cookie,
    method: 'POST',
    body: { name },
  });
  assert.equal(response.status, 201);
  return data.id;
}

async function createTask(cookie, title, projectId) {
  const { response, data } = await request('/api/tasks', {
    cookie,
    method: 'POST',
    body: { title, project_id: projectId },
  });
  assert.equal(response.status, 201);
  return data.id;
}

async function all(cookie) {
  const { response, data } = await request('/api/all', { cookie });
  assert.equal(response.status, 200);
  return data;
}

function progress(data, projectId) {
  return data.projects.find((project) => project.id === projectId).progress;
}

test('calcula progresso ao criar, concluir, reabrir, mover e excluir tarefas', async () => {
  const owner = await register('progresso@exemplo.test');
  const otherUser = await register('outra-conta@exemplo.test');
  const alpha = await createProject(owner, 'Projeto Alpha');
  const beta = await createProject(owner, 'Projeto Beta');
  const foreignProject = await createProject(otherUser, 'Projeto privado');
  let data = await all(owner);
  assert.equal(progress(data, alpha), 0);
  assert.equal(progress(data, beta), 0);

  const first = await createTask(owner, 'Primeira etapa', alpha);
  const second = await createTask(owner, 'Segunda etapa', alpha);

  assert.equal(progress(await all(owner), alpha), 0);

  await request(`/api/tasks/${first}`, { cookie: owner, method: 'PATCH', body: { done: true } });
  assert.equal(progress(await all(owner), alpha), 50);

  await request(`/api/tasks/${first}`, { cookie: owner, method: 'PATCH', body: { done: false } });
  assert.equal(progress(await all(owner), alpha), 0);

  await request(`/api/tasks/${first}`, { cookie: owner, method: 'PATCH', body: { done: true } });
  assert.equal(progress(await all(owner), alpha), 50);

  await request(`/api/tasks/${first}`, { cookie: owner, method: 'PATCH', body: { project_id: beta } });
  data = await all(owner);
  assert.equal(progress(data, alpha), 0);
  assert.equal(progress(data, beta), 100);

  const third = await createTask(owner, 'Terceira etapa', beta);
  assert.equal(progress(await all(owner), beta), 50);
  const fourth = await createTask(owner, 'Quarta etapa', beta);
  assert.equal(progress(await all(owner), beta), 33);
  await request(`/api/tasks/${fourth}`, { cookie: owner, method: 'DELETE' });
  assert.equal(progress(await all(owner), beta), 50);
  await request(`/api/tasks/${third}`, { cookie: owner, method: 'PATCH', body: { project_id: alpha } });
  data = await all(owner);
  assert.equal(progress(data, alpha), 0);
  assert.equal(progress(data, beta), 100);

  await request(`/api/tasks/${first}`, { cookie: owner, method: 'DELETE' });
  assert.equal(progress(await all(owner), beta), 0);
  await request(`/api/tasks/${third}`, { cookie: owner, method: 'DELETE' });
  assert.equal(progress(await all(owner), alpha), 0);

  const foreignTask = await createTask(owner, 'Sem projeto permitido', foreignProject);
  data = await all(owner);
  assert.equal(data.tasks.find((task) => task.id === foreignTask).project_id, null);
  await request(`/api/tasks/${foreignTask}`, { cookie: owner, method: 'PATCH', body: { project_id: foreignProject } });
  data = await all(owner);
  assert.equal(data.tasks.find((task) => task.id === foreignTask).project_id, null);
  assert.equal(progress(await all(otherUser), foreignProject), 0);

  const { response: manualProgressResponse } = await request(`/api/projects/${alpha}`, {
    cookie: owner,
    method: 'PATCH',
    body: { progress: 100 },
  });
  assert.equal(manualProgressResponse.status, 404);

  const deletedProject = await createProject(owner, 'Projeto para excluir');
  const detachedTask = await createTask(owner, 'Tarefa que permanece', deletedProject);
  await request(`/api/tasks/${detachedTask}`, { cookie: owner, method: 'PATCH', body: { done: true } });
  const { response: deleteProjectResponse } = await request(`/api/projects/${deletedProject}`, {
    cookie: owner,
    method: 'DELETE',
  });
  assert.equal(deleteProjectResponse.status, 200);
  data = await all(owner);
  assert.equal(data.projects.some((project) => project.id === deletedProject), false);
  assert.equal(data.tasks.find((task) => task.id === detachedTask).project_id, null);
});
