const assert = require('node:assert/strict');
const test = require('node:test');
const { newDb } = require('pg-mem');

process.env.DB_PATH = ':memory:';
const { createPostgresStore } = require('../db');

test('PostgreSQL inicializa o schema, retorna IDs e mantém isolamento e progresso transacional', async () => {
  const memory = newDb({ autoCreateForeignKeyIndices: true });
  const { Pool } = memory.adapters.createPg();
  const db = createPostgresStore('postgres://test:test@localhost/test', Pool);

  try {
    await db.ready;
    const owner = await db.run(
      'INSERT INTO users (email, username, character) VALUES (?, ?, ?)',
      'owner@example.test',
      'Owner',
      '{}',
    );
    const other = await db.run(
      'INSERT INTO users (email, username, character) VALUES (?, ?, ?)',
      'other@example.test',
      'Other',
      '{}',
    );
    assert.ok(owner.lastInsertRowid);
    assert.ok(other.lastInsertRowid);

    const project = await db.run('INSERT INTO projects (name, user_id) VALUES (?, ?)', 'Projeto', owner.lastInsertRowid);
    const task = await db.run(
      'INSERT INTO tasks (title, project_id, user_id) VALUES (?, ?, ?)',
      'Etapa',
      project.lastInsertRowid,
      owner.lastInsertRowid,
    );
    assert.ok(task.lastInsertRowid);

    await db.transaction(async (tx) => {
      await tx.run('UPDATE tasks SET done = ? WHERE id = ? AND user_id = ?', 1, task.lastInsertRowid, owner.lastInsertRowid);
      const { total, done } = await tx.get(
        'SELECT COUNT(*) AS total, COALESCE(SUM(done), 0) AS done FROM tasks WHERE user_id = ? AND project_id = ?',
        owner.lastInsertRowid,
        project.lastInsertRowid,
      );
      assert.equal(total, 1);
      assert.equal(done, 1);
      await tx.run(
        'UPDATE projects SET progress = ? WHERE id = ? AND user_id = ?',
        Math.round(done / total * 100),
        project.lastInsertRowid,
        owner.lastInsertRowid,
      );
    });

    assert.equal(
      (await db.get('SELECT progress FROM projects WHERE id = ? AND user_id = ?', project.lastInsertRowid, owner.lastInsertRowid)).progress,
      100,
    );
    const emptyProject = await db.run('INSERT INTO projects (name, user_id) VALUES (?, ?)', 'Vazio', owner.lastInsertRowid);
    const summaries = await db.all(`
      SELECT p.id, p.name,
        CASE WHEN COUNT(t.id) = 0 THEN 0
        ELSE SUM(t.done) * 100.0 / COUNT(t.id) END AS progress
      FROM projects p
      LEFT JOIN tasks t ON t.project_id = p.id AND t.user_id = p.user_id
      WHERE p.user_id = ?
      GROUP BY p.id, p.name
      ORDER BY p.id
    `, owner.lastInsertRowid);
    assert.equal(Math.round(Number(summaries.find((row) => row.id === project.lastInsertRowid).progress)), 100);
    assert.equal(Math.round(Number(summaries.find((row) => row.id === emptyProject.lastInsertRowid).progress)), 0);
    assert.equal(await db.get('SELECT id FROM projects WHERE id = ? AND user_id = ?', project.lastInsertRowid, other.lastInsertRowid), undefined);

  } finally {
    await db.close();
  }
});

test('PostgreSQL preserva validação TLS ao configurar a CA do banco', async () => {
  const memory = newDb();
  const { Pool } = memory.adapters.createPg();
  const originalCa = process.env.DATABASE_CA_CERT;
  process.env.DATABASE_CA_CERT = 'test-root-certificate';
  let poolOptions;
  class CapturingPool extends Pool {
    constructor(options) {
      poolOptions = options;
      super(options);
    }
  }

  const db = createPostgresStore('postgresql://user:password@localhost/test?sslmode=require', CapturingPool);
  try {
    const connectionUrl = new URL(poolOptions.connectionString);
    assert.equal(connectionUrl.searchParams.has('sslmode'), false);
    assert.deepEqual(poolOptions.ssl, { ca: 'test-root-certificate', rejectUnauthorized: true });
    await db.ready;
  } finally {
    await db.close();
    if (originalCa === undefined) delete process.env.DATABASE_CA_CERT;
    else process.env.DATABASE_CA_CERT = originalCa;
  }
});
