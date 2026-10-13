const OWNER = 'user_id INTEGER REFERENCES users(id) ON DELETE CASCADE';
const TABLES = ['subjects', 'tasks', 'projects', 'sessions'];

function initializeDatabase(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT,
      google_sub TEXT UNIQUE, username TEXT NOT NULL, avatar_mode TEXT NOT NULL DEFAULT 'character',
      avatar_image TEXT, character TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '', ${OWNER}
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY, title TEXT NOT NULL,
      subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      due TEXT NOT NULL DEFAULT '', done INTEGER NOT NULL DEFAULT 0, ${OWNER}
    );
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0, ${OWNER}
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY, day TEXT NOT NULL, minutes INTEGER NOT NULL, ${OWNER}
    );
    CREATE TABLE IF NOT EXISTS flashcards (
      id INTEGER PRIMARY KEY,
      subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      front TEXT NOT NULL,
      back TEXT NOT NULL,
      interval_days INTEGER NOT NULL DEFAULT 0,
      repetitions INTEGER NOT NULL DEFAULT 0,
      ease_factor REAL NOT NULL DEFAULT 2.5,
      next_review_at INTEGER NOT NULL DEFAULT 0,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS flashcards_user_due_idx ON flashcards(user_id, next_review_at);
    CREATE INDEX IF NOT EXISTS flashcards_subject_idx ON flashcards(subject_id);
  `);

  for (const table of TABLES) {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some((column) => column.name === 'user_id')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${OWNER}`);
    }
  }
  if (!db.prepare('PRAGMA table_info(tasks)').all().some((column) => column.name === 'project_id')) {
    db.exec('ALTER TABLE tasks ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL');
  }
}

module.exports = { initializeDatabase, TABLES };
