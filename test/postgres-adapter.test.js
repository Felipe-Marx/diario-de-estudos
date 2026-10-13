const assert = require('node:assert/strict');
const test = require('node:test');
const { newDb } = require('pg-mem');

process.env.DB_PATH = ':memory:';
const { createPostgresStore } = require('../db');

test('PostgreSQL inicializa o schema, retorna IDs e mantém isolamento e progresso transacional', async () => {
  const memory = newDb({ autoCreateForeignKeyIndices: true });
  memory.public.registerFunction({ name: 'floor', args: ['float'], returns: 'integer', implementation: Math.floor });
  const { Pool: BasePool } = memory.adapters.createPg();
  let initializationQueries = 0;
  class CountingPool extends BasePool {
    async connect() {
      const client = await super.connect();
      const query = client.query.bind(client);
      client.query = (...args) => {
        initializationQueries += 1;
        const result = query(...args);
        return args[0].includes('CREATE TABLE IF NOT EXISTS users')
          ? Promise.resolve(result).then((rows) => [rows])
          : result;
      };
      return client;
    }
  }
  const Pool = CountingPool;
  const db = createPostgresStore('postgres://test:test@localhost/test', Pool);

  try {
    await db.ready;
    assert.equal(initializationQueries, 3, 'schema initialization uses BEGIN, one DDL batch, and COMMIT');
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
    const subject = await db.run('INSERT INTO subjects (name, color, user_id) VALUES (?, ?, ?)', 'Matéria', '#A8D68B', owner.lastInsertRowid);
    const flashcard = await db.run(
      'INSERT INTO flashcards (subject_id, front, back, user_id) VALUES (?, ?, ?, ?)',
      subject.lastInsertRowid, 'Pergunta', 'Resposta', owner.lastInsertRowid,
    );
    assert.ok(flashcard.lastInsertRowid);
    assert.equal(
      (await db.get('SELECT front FROM flashcards WHERE id = ? AND user_id = ?', flashcard.lastInsertRowid, owner.lastInsertRowid)).front,
      'Pergunta',
    );
    const task = await db.run(
      `INSERT INTO tasks (title, subject_id, project_id, due, user_id)
        VALUES (
          ?,
          (SELECT id FROM subjects WHERE id = ? AND user_id = ?),
          (SELECT id FROM projects WHERE id = ? AND user_id = ?),
          ?,
          ?
        )`,
      'Etapa',
      subject.lastInsertRowid,
      owner.lastInsertRowid,
      project.lastInsertRowid,
      owner.lastInsertRowid,
      '',
      owner.lastInsertRowid,
    );
    assert.ok(task.lastInsertRowid);

    await db.transaction(async (tx) => {
      const updated = await tx.get(
        'UPDATE tasks SET done = ? WHERE id = ? AND user_id = ? RETURNING project_id',
        1,
        task.lastInsertRowid,
        owner.lastInsertRowid,
      );
      assert.equal(updated.project_id, project.lastInsertRowid);
      await tx.run(`
        UPDATE projects
        SET progress = (
          SELECT CASE WHEN COUNT(*) = 0 THEN 0
            ELSE FLOOR(SUM(done) * 100.0 / COUNT(*) + 0.5) END
          FROM tasks WHERE user_id = ? AND project_id = ?
        )
        WHERE id = ? AND user_id = ?
      `, owner.lastInsertRowid, project.lastInsertRowid, project.lastInsertRowid, owner.lastInsertRowid);
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
    const deleted = await db.get('DELETE FROM tasks WHERE id = ? AND user_id = ? RETURNING project_id', task.lastInsertRowid, owner.lastInsertRowid);
    assert.equal(deleted.project_id, project.lastInsertRowid);
    await db.run(`
      UPDATE projects
      SET progress = (
        SELECT CASE WHEN COUNT(*) = 0 THEN 0
          ELSE FLOOR(SUM(done) * 100.0 / COUNT(*) + 0.5) END
        FROM tasks WHERE user_id = ? AND project_id = ?
      )
      WHERE id = ? AND user_id = ?
    `, owner.lastInsertRowid, deleted.project_id, deleted.project_id, owner.lastInsertRowid);
    assert.equal(
      (await db.get('SELECT progress FROM projects WHERE id = ? AND user_id = ?', project.lastInsertRowid, owner.lastInsertRowid)).progress,
      0,
    );

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
