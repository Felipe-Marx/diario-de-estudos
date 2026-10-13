const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');
const { initializeDatabase } = require('../database');

test('migra bancos existentes para adicionar project_id e preserva tarefas', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  try {
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT,
        google_sub TEXT UNIQUE, username TEXT NOT NULL, avatar_mode TEXT NOT NULL DEFAULT 'character',
        avatar_image TEXT, character TEXT NOT NULL
      );
      CREATE TABLE subjects (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '', user_id INTEGER REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE projects (
        id INTEGER PRIMARY KEY, name TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY, title TEXT NOT NULL,
        subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
        due TEXT NOT NULL DEFAULT '', done INTEGER NOT NULL DEFAULT 0,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE sessions (
        id INTEGER PRIMARY KEY, day TEXT NOT NULL, minutes INTEGER NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE
      );
      INSERT INTO users (id, email, username, character)
        VALUES (1, 'legado@exemplo.test', 'Legado', '{}');
      INSERT INTO subjects (id, name, color, user_id)
        VALUES (1, 'Matéria legada', '#A8D68B', 1);
      INSERT INTO projects (id, name, user_id) VALUES (7, 'Projeto preservado', 1);
      INSERT INTO tasks (id, title, due, done, user_id)
        VALUES (9, 'Tarefa preservada', '', 1, 1);
    `);

    assert.doesNotThrow(() => initializeDatabase(db));

    const columns = db.prepare('PRAGMA table_info(tasks)').all();
    const foreignKeys = db.prepare('PRAGMA foreign_key_list(tasks)').all();
    const task = db.prepare('SELECT id, title, project_id FROM tasks WHERE id = 9').get();
    const flashcardForeignKeys = db.prepare('PRAGMA foreign_key_list(flashcards)').all();
    assert.ok(columns.some((column) => column.name === 'project_id'));
    assert.ok(foreignKeys.some((key) =>
      key.from === 'project_id' && key.table === 'projects' && key.on_delete === 'SET NULL'
    ));
    assert.deepEqual(task, { id: 9, title: 'Tarefa preservada', project_id: null });
    assert.ok(flashcardForeignKeys.some((key) =>
      key.from === 'subject_id' && key.table === 'subjects' && key.on_delete === 'CASCADE'
    ));
    assert.ok(flashcardForeignKeys.some((key) =>
      key.from === 'user_id' && key.table === 'users' && key.on_delete === 'CASCADE'
    ));
    db.prepare('INSERT INTO flashcards (subject_id, front, back, user_id) VALUES (?, ?, ?, ?)')
      .run(1, 'Pergunta legada', 'Resposta legada', 1);
    db.prepare('DELETE FROM subjects WHERE id = 1').run();
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM flashcards').get().count, 0);
  } finally {
    db.close();
  }
});
