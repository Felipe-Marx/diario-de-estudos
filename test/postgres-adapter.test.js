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
    assert.equal(await db.get('SELECT id FROM projects WHERE id = ? AND user_id = ?', project.lastInsertRowid, other.lastInsertRowid), undefined);

  } finally {
    await db.close();
  }
});
