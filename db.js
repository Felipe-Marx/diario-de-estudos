const path = require('node:path');
const { initializeDatabase } = require('./database');

function sqliteStore(raw) {
  let queue = Promise.resolve();

  const exclusive = async (operation) => {
    const previous = queue;
    let release;
    queue = new Promise((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  };

  const direct = {
    get: (sql, ...params) => raw.prepare(sql).get(...params),
    all: (sql, ...params) => raw.prepare(sql).all(...params),
    run: (sql, ...params) => raw.prepare(sql).run(...params),
  };

  return {
    kind: 'sqlite',
    ready: Promise.resolve(),
    get: (sql, ...params) => exclusive(() => direct.get(sql, ...params)),
    all: (sql, ...params) => exclusive(() => direct.all(sql, ...params)),
    run: (sql, ...params) => exclusive(() => direct.run(sql, ...params)),
    transaction: (operation) => exclusive(async () => {
      raw.exec('BEGIN IMMEDIATE');
      try {
        const result = await operation({
          get: async (sql, ...params) => direct.get(sql, ...params),
          all: async (sql, ...params) => direct.all(sql, ...params),
          run: async (sql, ...params) => direct.run(sql, ...params),
        });
        raw.exec('COMMIT');
        return result;
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    }),
    close: async () => raw.close(),
    raw,
  };
}

function postgresStore(connectionString, PoolClass) {
  const pg = require('pg');
  const Pool = PoolClass || pg.Pool;
  const pool = new Pool({
    connectionString,
    ssl: true,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  });

  const placeholders = (sql) => {
    let position = 0;
    return sql.replace(/\?/g, () => `$${++position}`).replace(/date\('now', '-10 day'\)/g, 'CURRENT_DATE - INTERVAL \'10 days\'');
  };

  const executor = (client) => ({
    get: async (sql, ...params) => {
      const result = await client.query(placeholders(sql), params);
      return result.rows[0];
    },
    all: async (sql, ...params) => {
      const result = await client.query(placeholders(sql), params);
      return result.rows;
    },
    run: async (sql, ...params) => {
      const statement = /^\s*INSERT\s+INTO\b/i.test(sql) && !/\bRETURNING\b/i.test(sql)
        ? `${sql} RETURNING id`
        : sql;
      const result = await client.query(placeholders(statement), params);
      return { lastInsertRowid: result.rows[0]?.id };
    },
  });

  const queries = executor(pool);
  const store = {
    kind: 'postgres',
    ready: null,
    get: queries.get,
    all: queries.all,
    run: queries.run,
    transaction: async (operation) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await operation(executor(client));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };

  store.ready = initializePostgres(store);
  return store;
}

async function initializePostgres(db) {
  await db.transaction(async (tx) => {
    await tx.run(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT,
        google_sub TEXT UNIQUE,
        username TEXT NOT NULL,
        avatar_mode TEXT NOT NULL DEFAULT 'character',
        avatar_image TEXT,
        character TEXT NOT NULL
      )
    `);
    await tx.run(`
      CREATE TABLE IF NOT EXISTS subjects (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    await tx.run(`
      CREATE TABLE IF NOT EXISTS projects (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        progress INTEGER NOT NULL DEFAULT 0,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    await tx.run(`
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
        project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        due TEXT NOT NULL DEFAULT '',
        done INTEGER NOT NULL DEFAULT 0,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    await tx.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        day TEXT NOT NULL,
        minutes INTEGER NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    await tx.run('CREATE INDEX IF NOT EXISTS subjects_user_id_idx ON subjects(user_id)');
    await tx.run('CREATE INDEX IF NOT EXISTS tasks_user_id_idx ON tasks(user_id)');
    await tx.run('CREATE INDEX IF NOT EXISTS tasks_project_id_idx ON tasks(project_id)');
    await tx.run('CREATE INDEX IF NOT EXISTS projects_user_id_idx ON projects(user_id)');
    await tx.run('CREATE INDEX IF NOT EXISTS sessions_user_day_idx ON sessions(user_id, day)');
  });
}

const store = process.env.DATABASE_URL
  ? postgresStore(process.env.DATABASE_URL)
  : sqliteStore(new (require('better-sqlite3'))(process.env.DB_PATH || path.join(__dirname, 'estudos.db')));

if (store.kind === 'sqlite') {
  store.raw.pragma('journal_mode = WAL');
  store.raw.pragma('foreign_keys = ON');
  initializeDatabase(store.raw);
}

module.exports = store;
module.exports.createPostgresStore = postgresStore;
