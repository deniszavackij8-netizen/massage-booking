// Хранилище записей и блокировок.
//
// Если задана переменная окружения DATABASE_URL — всё хранится в базе
// PostgreSQL (например, бесплатный Neon). Данные там постоянные и не
// пропадают при перезапуске/обновлении сайта на Render.
//
// Если DATABASE_URL не задана — работаем с JSON-файлами в папке data/
// (удобно для запуска на своём компьютере). На бесплатном Render файлы
// стираются при каждом деплое, поэтому там нужна база.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const BOOKINGS_FILE = path.join(DATA_DIR, 'bookings.json');
const BLOCKS_FILE = path.join(DATA_DIR, 'blocks.json');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

// ---------------------------------------------------------------------------
// Общие помощники
// ---------------------------------------------------------------------------

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return fallback;
  }
}

function readJsonArray(file) {
  const data = readJson(file, []);
  return Array.isArray(data) ? data : [];
}

// Атомарная запись: временный файл + переименование, чтобы сбой посреди
// записи не оставил обрезанный JSON (который читался бы как пустой список).
function writeJsonAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function sortBookings(list) {
  return [...list].sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)));
}

function sortBlocks(list) {
  return [...list].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.time === b.time) return 0;
    if (a.time === null) return -1; // «весь день» показываем первым
    if (b.time === null) return 1;
    return a.time.localeCompare(b.time);
  });
}

// Хеш токена отмены — наружу (в админку, в ответы API) никогда не отдаём.
function publicBooking(b) {
  if (!b) return b;
  const { cancelTokenHash, ...rest } = b;
  return rest;
}

// ---------------------------------------------------------------------------
// Вариант 1: JSON-файлы (без базы данных)
// ---------------------------------------------------------------------------

function createFileStore() {
  // Очередь операций: каждая запись/удаление выполняется строго после
  // предыдущей, чтобы два одновременных запроса не записались на одно время.
  let queue = Promise.resolve();
  function exclusive(fn) {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  }

  return {
    kind: 'file',

    async init() {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    },

    async bookingsForDate(date) {
      return readJsonArray(BOOKINGS_FILE).filter((b) => b.date === date).map(publicBooking);
    },

    async blocksForDate(date) {
      return readJsonArray(BLOCKS_FILE).filter((b) => b.date === date);
    },

    async allBookings() {
      return sortBookings(readJsonArray(BOOKINGS_FILE)).map(publicBooking);
    },

    async allBlocks() {
      return sortBlocks(readJsonArray(BLOCKS_FILE));
    },

    // fn получает «транзакцию» с методами чтения и insertBooking.
    // Всё внутри выполняется без участия других запросов.
    withBookingLock(date, phone, fn) {
      return exclusive(async () => {
        const bookings = readJsonArray(BOOKINGS_FILE);
        const blocks = readJsonArray(BLOCKS_FILE);
        const phoneKey = normalizePhone(phone);
        const tx = {
          bookingsForDate: async () => bookings.filter((b) => b.date === date),
          blocksForDate: async () => blocks.filter((b) => b.date === date),
          countActiveForPhone: async (fromDate) =>
            bookings.filter((b) => normalizePhone(b.phone) === phoneKey && b.date >= fromDate).length,
          insertBooking: async (booking) => {
            bookings.push(booking);
            writeJsonAtomic(BOOKINGS_FILE, bookings);
          }
        };
        return fn(tx);
      });
    },

    async findBookingByTokenHash(hash) {
      return readJsonArray(BOOKINGS_FILE).find((b) => b.cancelTokenHash && b.cancelTokenHash === hash) || null;
    },

    // Удаляет запись по id, только если её токен совпадает. Возвращает удалённую запись или null.
    deleteBookingByToken(id, hash) {
      return exclusive(async () => {
        const bookings = readJsonArray(BOOKINGS_FILE);
        const found = bookings.find((b) => b.id === id && b.cancelTokenHash === hash);
        if (!found) return null;
        writeJsonAtomic(BOOKINGS_FILE, bookings.filter((b) => b !== found));
        return publicBooking(found);
      });
    },

    deleteBooking(id) {
      return exclusive(async () => {
        const bookings = readJsonArray(BOOKINGS_FILE);
        const next = bookings.filter((b) => b.id !== id);
        if (next.length === bookings.length) return false;
        writeJsonAtomic(BOOKINGS_FILE, next);
        return true;
      });
    },

    // Возвращает созданную блокировку или null, если такая уже есть.
    createBlock(block) {
      return exclusive(async () => {
        const blocks = readJsonArray(BLOCKS_FILE);
        if (blocks.some((b) => b.date === block.date && b.time === block.time)) return null;
        blocks.push(block);
        writeJsonAtomic(BLOCKS_FILE, blocks);
        return block;
      });
    },

    deleteBlock(id) {
      return exclusive(async () => {
        const blocks = readJsonArray(BLOCKS_FILE);
        const next = blocks.filter((b) => b.id !== id);
        if (next.length === blocks.length) return false;
        writeJsonAtomic(BLOCKS_FILE, next);
        return true;
      });
    },

    // «Застолбить» ключ (например, «сводка за 2026-10-18 отправлена»).
    // true — ключ был свободен и теперь наш; false — его уже кто-то занял.
    claimState(key) {
      return exclusive(async () => {
        const state = readJson(STATE_FILE, {});
        if (Object.prototype.hasOwnProperty.call(state, key)) return false;
        state[key] = new Date().toISOString();
        writeJsonAtomic(STATE_FILE, state);
        return true;
      });
    },

    releaseState(key) {
      return exclusive(async () => {
        const state = readJson(STATE_FILE, {});
        delete state[key];
        writeJsonAtomic(STATE_FILE, state);
      });
    },

    async close() {}
  };
}

// ---------------------------------------------------------------------------
// Вариант 2: PostgreSQL (Neon и т.п.)
// ---------------------------------------------------------------------------

// Даты храним как текст 'YYYY-MM-DD', а не тип DATE: драйвер превращает
// DATE в объект Date в часовом поясе сервера, и дата может «съехать» на
// день. Текст в таком формате корректно сравнивается и сортируется.
// Все команды безопасно выполнять повторно при каждом запуске.
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS bookings (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  phone            TEXT NOT NULL,
  phone_key        TEXT NOT NULL,
  date             TEXT NOT NULL,
  time             TEXT NOT NULL,
  service_id       TEXT,
  service_name     TEXT,
  duration_minutes INTEGER,
  slots_count      INTEGER NOT NULL DEFAULT 1,
  price            INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS lang TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancel_token_hash TEXT;
CREATE INDEX IF NOT EXISTS bookings_date_idx ON bookings (date);
CREATE INDEX IF NOT EXISTS bookings_phone_key_idx ON bookings (phone_key, date);
CREATE UNIQUE INDEX IF NOT EXISTS bookings_cancel_token_idx ON bookings (cancel_token_hash)
  WHERE cancel_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS blocks (
  id         TEXT PRIMARY KEY,
  date       TEXT NOT NULL,
  time       TEXT,
  note       TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS blocks_date_time_uniq ON blocks (date, COALESCE(time, ''));

CREATE TABLE IF NOT EXISTS app_state (
  key        TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

// cancel_token_hash сюда сознательно не входит — он не нужен ни админке, ни клиенту.
const BOOKING_COLUMNS = `id, name, phone, date, time, service_id, service_name,
  duration_minutes, slots_count, price, lang, created_at`;

function rowToBooking(r) {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    date: r.date,
    time: r.time,
    serviceId: r.service_id,
    serviceName: r.service_name,
    durationMinutes: r.duration_minutes,
    slotsCount: r.slots_count,
    price: r.price,
    lang: r.lang || null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at
  };
}

function rowToBlock(r) {
  return {
    id: r.id,
    date: r.date,
    time: r.time,
    note: r.note,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at
  };
}

async function insertBookingRow(client, b) {
  await client.query(
    `INSERT INTO bookings (id, name, phone, phone_key, date, time, service_id, service_name,
       duration_minutes, slots_count, price, lang, cancel_token_hash, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (id) DO NOTHING`,
    [
      b.id, b.name, b.phone, normalizePhone(b.phone), b.date, b.time,
      b.serviceId || null, b.serviceName || null, b.durationMinutes || null,
      b.slotsCount || 1, b.price || null, b.lang || null, b.cancelTokenHash || null,
      b.createdAt || new Date().toISOString()
    ]
  );
}

function createPgStore(databaseUrl) {
  // pg подключаем только когда он действительно нужен — без базы данных
  // сайт продолжит работать даже если пакет не установлен.
  // eslint-disable-next-line global-require
  const { Pool } = require('pg');

  const pool = new Pool({
    connectionString: databaseUrl,
    // Neon в строке подключения требует channel_binding=require — это защита
    // от подмены сервера базы «посредником». Включаем её, если она запрошена.
    enableChannelBinding: /[?&]channel_binding=require/.test(databaseUrl),
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000
  });

  // Neon «усыпляет» базу при простое и закрывает соединения. Без этого
  // обработчика закрытое простаивающее соединение уронило бы весь сервер.
  pool.on('error', (err) => {
    console.error('База данных: соединение закрыто —', err.message);
  });

  async function inTransaction(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (e) { /* соединение уже закрыто */ }
      throw err;
    } finally {
      client.release();
    }
  }

  // Однократный перенос старых записей из JSON-файлов в пустую базу.
  async function migrateFromFiles() {
    const fileBookings = readJsonArray(BOOKINGS_FILE);
    const fileBlocks = readJsonArray(BLOCKS_FILE);
    if (fileBookings.length === 0 && fileBlocks.length === 0) return;

    await inTransaction(async (client) => {
      const { rows } = await client.query(
        'SELECT (SELECT count(*) FROM bookings) + (SELECT count(*) FROM blocks) AS n'
      );
      if (Number(rows[0].n) > 0) return; // база уже используется — ничего не трогаем

      for (const b of fileBookings) {
        if (b && b.id && b.date && b.time && b.name && b.phone) await insertBookingRow(client, b);
      }
      for (const bl of fileBlocks) {
        if (!bl || !bl.id || !bl.date) continue;
        await client.query(
          `INSERT INTO blocks (id, date, time, note, created_at) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT DO NOTHING`,
          [bl.id, bl.date, bl.time || null, bl.note || '', bl.createdAt || new Date().toISOString()]
        );
      }
      console.log(`База данных: перенесено из файлов ${fileBookings.length} записей и ${fileBlocks.length} блокировок.`);
    });
  }

  return {
    kind: 'postgres',

    async init() {
      await pool.query(SCHEMA_SQL);
      await migrateFromFiles();
    },

    async bookingsForDate(date) {
      const { rows } = await pool.query(`SELECT ${BOOKING_COLUMNS} FROM bookings WHERE date = $1`, [date]);
      return rows.map(rowToBooking);
    },

    async blocksForDate(date) {
      const { rows } = await pool.query('SELECT * FROM blocks WHERE date = $1', [date]);
      return rows.map(rowToBlock);
    },

    async allBookings() {
      const { rows } = await pool.query(`SELECT ${BOOKING_COLUMNS} FROM bookings ORDER BY date, time`);
      return rows.map(rowToBooking);
    },

    async allBlocks() {
      const { rows } = await pool.query('SELECT * FROM blocks');
      return sortBlocks(rows.map(rowToBlock));
    },

    // Защита от двойной записи: внутри транзакции берём «замок» на дату
    // (и на номер телефона). Пока одна запись на эту дату проверяется и
    // сохраняется, вторая ждёт — даже если сервер запущен в нескольких копиях.
    withBookingLock(date, phone, fn) {
      const phoneKey = normalizePhone(phone);
      return inTransaction(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`date:${date}`]);
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`phone:${phoneKey}`]);
        const tx = {
          bookingsForDate: async () => {
            const { rows } = await client.query(`SELECT ${BOOKING_COLUMNS} FROM bookings WHERE date = $1`, [date]);
            return rows.map(rowToBooking);
          },
          blocksForDate: async () => {
            const { rows } = await client.query('SELECT * FROM blocks WHERE date = $1', [date]);
            return rows.map(rowToBlock);
          },
          countActiveForPhone: async (fromDate) => {
            const { rows } = await client.query(
              'SELECT count(*) AS n FROM bookings WHERE phone_key = $1 AND date >= $2',
              [phoneKey, fromDate]
            );
            return Number(rows[0].n);
          },
          insertBooking: (booking) => insertBookingRow(client, booking)
        };
        return fn(tx);
      });
    },

    async findBookingByTokenHash(hash) {
      const { rows } = await pool.query(
        `SELECT ${BOOKING_COLUMNS} FROM bookings WHERE cancel_token_hash = $1`,
        [hash]
      );
      return rows.length ? rowToBooking(rows[0]) : null;
    },

    async deleteBookingByToken(id, hash) {
      const { rows } = await pool.query(
        `DELETE FROM bookings WHERE id = $1 AND cancel_token_hash = $2 RETURNING ${BOOKING_COLUMNS}`,
        [id, hash]
      );
      return rows.length ? rowToBooking(rows[0]) : null;
    },

    async deleteBooking(id) {
      const { rowCount } = await pool.query('DELETE FROM bookings WHERE id = $1', [id]);
      return rowCount > 0;
    },

    async createBlock(block) {
      const { rows } = await pool.query(
        `INSERT INTO blocks (id, date, time, note, created_at) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING RETURNING *`,
        [block.id, block.date, block.time, block.note, block.createdAt]
      );
      return rows.length ? rowToBlock(rows[0]) : null;
    },

    async deleteBlock(id) {
      const { rowCount } = await pool.query('DELETE FROM blocks WHERE id = $1', [id]);
      return rowCount > 0;
    },

    async claimState(key) {
      const { rowCount } = await pool.query(
        'INSERT INTO app_state (key) VALUES ($1) ON CONFLICT (key) DO NOTHING',
        [key]
      );
      return rowCount > 0;
    },

    async releaseState(key) {
      await pool.query('DELETE FROM app_state WHERE key = $1', [key]);
    },

    close() {
      return pool.end();
    }
  };
}

function createStore(databaseUrl) {
  return databaseUrl ? createPgStore(databaseUrl) : createFileStore();
}

module.exports = { createStore, normalizePhone };
