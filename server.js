require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Не показываем в заголовках, что сервер на Express — чуть усложняет
// автоматический сбор отпечатка стека для атакующего.
app.disable('x-powered-by');

// Если сервер стоит за реверс-прокси (nginx и т.п.), который сам
// терминирует TLS, включите TRUST_PROXY=1 в .env, чтобы req.ip брал
// настоящий IP клиента из X-Forwarded-For, а не IP самого прокси —
// иначе блокировка по IP будет блокировать всех разом (или никого).
if (process.env.TRUST_PROXY === '1') {
  app.set('trust proxy', 1);
}

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

const BOT_TOKEN = process.env.BOT_TOKEN || '';

// Можно указать несколько получателей через запятую, например:
// CHAT_ID=5682114269,111222333
const CHAT_IDS = (process.env.CHAT_ID || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

const DATA_FILE = path.join(__dirname, 'data', 'bookings.json');
const BLOCKS_FILE = path.join(__dirname, 'data', 'blocks.json');

// Рабочие часы салона — слоты с шагом в 1 час.
// Поменяйте список, если часы работы другие.
const SLOTS = [
  '10:00', '11:00', '12:00', '13:00', '14:00',
  '15:00', '16:00', '17:00', '18:00', '19:00', '20:00'
];

// Услуги и варианты длительности. Сетка времени — часовая, поэтому
// длительность указывается в «слотах» (1 слот = 1 час). Для сеанса
// 90 минут (массаж в 4 руки) резервируем 2 часовых слота — это проще
// и надёжнее, чем дробить сетку на получасовые интервалы.
const SERVICES = [
  {
    id: 'combo',
    name: 'Общий массаж (комбинированный)',
    durations: [
      { minutes: 60, slots: 1, price: 100 },
      { minutes: 120, slots: 2, price: 160 }
    ]
  },
  {
    id: 'full-body',
    name: 'Массаж всего тела',
    durations: [{ minutes: 60, slots: 1, price: 100 }]
  },
  {
    id: 'anticellulite',
    name: 'Антицеллюлитный массаж',
    durations: [{ minutes: 60, slots: 1, price: 80 }]
  },
  {
    id: 'sport',
    name: 'Спортивный массаж',
    durations: [{ minutes: 60, slots: 1, price: 130 }]
  },
  {
    id: 'lymph',
    name: 'Лимфодренажный массаж',
    durations: [{ minutes: 60, slots: 1, price: 90 }]
  },
  {
    id: 'four-hands',
    name: 'Массаж в 4 руки',
    durations: [
      { minutes: 60, slots: 1, price: 160 },
      { minutes: 90, slots: 2, price: 200 }
    ]
  },
  {
    id: 'neck',
    name: 'Массаж ШВЗ',
    durations: [{ minutes: 30, slots: 1, price: 30 }]
  },
  {
    id: 'back',
    name: 'Массаж спины',
    durations: [{ minutes: 60, slots: 1, price: 70 }]
  }
];

function findService(serviceId) {
  return SERVICES.find((s) => s.id === serviceId) || null;
}

function findDuration(service, minutes) {
  if (!service) return null;
  return service.durations.find((d) => d.minutes === Number(minutes)) || null;
}

// Множество занятых индексов слотов для конкретной даты — с учётом того,
// что одна запись может занимать несколько часовых слотов подряд.
function occupiedSlotIndexes(dateBookings) {
  const occupied = new Set();
  dateBookings.forEach((b) => {
    const startIndex = SLOTS.indexOf(b.time);
    if (startIndex === -1) return;
    const span = b.slotsCount || 1;
    for (let i = startIndex; i < startIndex + span; i += 1) {
      occupied.add(i);
    }
  });
  return occupied;
}

// Блокировки от администратора: либо весь день (time === null),
// либо конкретные часы (time — строка из SLOTS).
function blocksForDate(allBlocks, date) {
  return allBlocks.filter((b) => b.date === date);
}

function isDayBlocked(dateBlocks) {
  return dateBlocks.some((b) => b.time === null);
}

function blockedSlotIndexes(dateBlocks) {
  const blocked = new Set();
  dateBlocks.forEach((b) => {
    if (b.time === null) return; // весь день обрабатывается отдельно
    const idx = SLOTS.indexOf(b.time);
    if (idx !== -1) blocked.add(idx);
  });
  return blocked;
}

// Салон физически находится в Батуми — считаем «сейчас» по времени
// Грузии (Asia/Tbilisi), а не по часовому поясу сервера, чтобы
// отсечение прошедших слотов не зависело от того, где задеплоен сервер.
const SALON_TIMEZONE = 'Asia/Tbilisi';

// Минимальное время до начала сеанса, на которое ещё разрешена запись.
const MIN_LEAD_MINUTES = 60;

function getSalonNow() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: SALON_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts = {};
  fmt.formatToParts(new Date()).forEach((p) => { parts[p.type] = p.value; });
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute)
  };
}

function timeToMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

// Слот считается «слишком поздним для записи», если дата уже прошла,
// либо это сегодняшний день и до начала слота осталось меньше часа.
function isSlotTooSoon(date, time, salonNow) {
  if (date < salonNow.date) return true;
  if (date > salonNow.date) return false;
  return timeToMinutes(time) < salonNow.minutes + MIN_LEAD_MINUTES;
}

// Ограничиваем размер тела запроса — защита от примитивного DoS
// большими телами запроса и от переполнения диска логами/ошибками.
app.use(express.json({ limit: '15kb' }));

// Базовые защитные HTTP-заголовки (без установки отдельного пакета helmet,
// чтобы не плодить лишние зависимости для небольшого проекта).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
});

// Некорректный JSON в теле запроса не должен приводить к утечке
// внутреннего стека ошибок express — отвечаем аккуратным 400.
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Некорректный формат запроса' });
  }
  return next(err);
});

app.use(express.static(path.join(__dirname, 'public')));

// ---------- работа с «базой» (JSON-файл) ----------

function readBookings() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    return [];
  }
}

function writeBookings(bookings) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(bookings, null, 2), 'utf8');
}

function readBlocks() {
  try {
    const raw = fs.readFileSync(BLOCKS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    return [];
  }
}

function writeBlocks(blocks) {
  fs.writeFileSync(BLOCKS_FILE, JSON.stringify(blocks, null, 2), 'utf8');
}

function isValidDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;

  // Date.parse принимает несуществующие даты (например, 31 февраля)
  // и молча «перекатывает» их на следующий месяц, поэтому даты
  // проверяем вручную по реальному количеству дней в месяце.
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const daysInMonth = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  return day >= 1 && day <= daysInMonth[month - 1];
}

// Имя: после обрезки пробелов — не пустое, разумная длина, без управляющих
// символов (которые можно было бы вставить, чтобы сломать отображение/логи).
function isValidName(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length < 2 || trimmed.length > 120) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(trimmed)) return false;
  return true;
}

// Телефон: разрешаем цифры, пробелы, +, -, (), не меньше 6 и не больше 20
// значащих цифр — достаточно гибко для международных номеров и при этом
// отсекает явный мусор/скрипты в этом поле.
function isValidPhone(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length > 40) return false;
  if (!/^[0-9+()\-\s]+$/.test(trimmed)) return false;
  const digitsOnly = trimmed.replace(/\D/g, '');
  return digitsOnly.length >= 6 && digitsOnly.length <= 20;
}

// ---------- простая защита от спама: лимит запросов по IP ----------

// Фабрика лимитера: скользящее окно на N запросов за M миллисекунд,
// отдельный счётчик на каждый IP. Этого достаточно, чтобы бот не мог
// в одну секунду занять спамом все слоты на месяц вперёд; для защиты
// от действительно распределённых атак (много разных IP) нужен уже
// внешний сервис (Cloudflare и т.п.), но это закрывает типовой случай.
function createRateLimiter({ windowMs, max, message }) {
  const hits = new Map(); // ip -> массив таймстампов запросов в текущем окне

  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [ip, timestamps] of hits.entries()) {
      const fresh = timestamps.filter((t) => t > cutoff);
      if (fresh.length === 0) hits.delete(ip);
      else hits.set(ip, fresh);
    }
  }, Math.min(windowMs, 5 * 60 * 1000)).unref();

  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const cutoff = now - windowMs;
    const timestamps = (hits.get(ip) || []).filter((t) => t > cutoff);

    if (timestamps.length >= max) {
      res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: message });
    }

    timestamps.push(now);
    hits.set(ip, timestamps);
    return next();
  };
}

// Бронирование: не больше 6 попыток записи за 15 минут с одного IP.
const bookLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 6,
  message: 'Слишком много попыток записи подряд. Подождите немного и попробуйте снова.'
});

// Общий лимит на чтение расписания — защита от массового сканирования
// всех дат подряд ботом (не мешает обычному человеку листать календарь).
const slotsLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  message: 'Слишком много запросов. Подождите немного.'
});

// ---------- защита админ-панели (HTTP Basic Auth + защита от перебора) ----------

// Сравнение строк постоянного времени — обычное `===` даёт мизерную, но
// измеримую разницу во времени в зависимости от того, на каком символе
// нашлось несовпадение, и теоретически позволяет подбирать пароль по
// одному символу через замеры времени ответа. crypto.timingSafeEqual
// работает только для буферов одинаковой длины, поэтому для буферов
// разной длины сравниваем против самого себя (чтобы не выдавать длину
// таймингом) и честно возвращаем false.
function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// Защита от перебора пароля: 5 неудачных попыток подряд с одного IP —
// и дальнейшие попытки блокируются на 20 минут. Храним счётчики в памяти
// процесса (этого достаточно для одного небольшого сайта; при перезапуске
// сервера счётчики сбрасываются — это осознанный компромисс простоты).
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 20 * 60 * 1000; // 20 минут

const loginAttemptsByIp = new Map(); // ip -> { count, lockedUntil }

function getLoginState(ip) {
  return loginAttemptsByIp.get(ip) || { count: 0, lockedUntil: 0 };
}

function registerFailedLogin(ip) {
  const state = getLoginState(ip);
  state.count += 1;
  if (state.count >= MAX_LOGIN_ATTEMPTS) {
    state.lockedUntil = Date.now() + LOGIN_LOCKOUT_MS;
    state.count = 0; // следующий отсчёт из 5 попыток начнётся после разблокировки
  }
  loginAttemptsByIp.set(ip, state);
}

function clearLoginAttempts(ip) {
  loginAttemptsByIp.delete(ip);
}

// Периодически подчищаем карту, чтобы она не росла бесконечно от
// случайных/разовых IP (боты, сканеры), у которых не было успешного входа.
setInterval(() => {
  const now = Date.now();
  for (const [ip, state] of loginAttemptsByIp.entries()) {
    if (state.lockedUntil && state.lockedUntil < now && state.count === 0) {
      loginAttemptsByIp.delete(ip);
    }
  }
}, 10 * 60 * 1000).unref();

function basicAuth(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return res
      .status(503)
      .send('Админ-панель не настроена: задайте ADMIN_PASSWORD в файле .env и перезапустите сервер.');
  }

  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const state = getLoginState(ip);

  if (state.lockedUntil && state.lockedUntil > Date.now()) {
    const waitMinutes = Math.ceil((state.lockedUntil - Date.now()) / 60000);
    res.set('Retry-After', String(Math.ceil((state.lockedUntil - Date.now()) / 1000)));
    return res
      .status(429)
      .send(`Слишком много неудачных попыток входа. Попробуйте снова через ${waitMinutes} мин.`);
  }

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');

  if (scheme === 'Basic' && encoded) {
    let decoded = '';
    try {
      decoded = Buffer.from(encoded, 'base64').toString('utf8');
    } catch (err) {
      decoded = '';
    }
    const sepIndex = decoded.indexOf(':');
    const user = sepIndex === -1 ? decoded : decoded.slice(0, sepIndex);
    const pass = sepIndex === -1 ? '' : decoded.slice(sepIndex + 1);

    const userOk = timingSafeStringEqual(user, ADMIN_USER);
    const passOk = timingSafeStringEqual(pass, ADMIN_PASSWORD);

    if (userOk && passOk) {
      clearLoginAttempts(ip);
      return next();
    }
  }

  registerFailedLogin(ip);
  res.set('WWW-Authenticate', 'Basic realm="Admin panel"');
  return res.status(401).send('Требуется авторизация');
}

// ---------- публичное API ----------

// GET /api/services — список услуг с вариантами длительности и цен.
app.get('/api/services', (req, res) => {
  res.json({ services: SERVICES });
});

// GET /api/slots?date=YYYY-MM-DD&slots=1|2
// Возвращает список слотов на указанную дату с пометкой, какие уже заняты
// (с учётом того, сколько часовых слотов подряд нужно выбранной услуге).
app.get('/api/slots', slotsLimiter, (req, res) => {
  const { date } = req.query;
  const slotsNeeded = Math.max(1, Number(req.query.slots) || 1);

  if (!date || !isValidDate(date)) {
    return res.status(400).json({ error: 'Укажите корректную дату в формате YYYY-MM-DD' });
  }

  const bookings = readBookings();
  const dateBookings = bookings.filter((b) => b.date === date);
  const occupied = occupiedSlotIndexes(dateBookings);

  const allBlocks = readBlocks();
  const dateBlocks = blocksForDate(allBlocks, date);
  const dayBlocked = isDayBlocked(dateBlocks);
  const blockedByAdmin = blockedSlotIndexes(dateBlocks);
  const salonNow = getSalonNow();

  const slots = SLOTS.map((time, index) => {
    // Слот недоступен, если: весь день заблокирован администратором,
    // дата/время уже прошли (или до начала осталось меньше часа),
    // он сам (или любой из следующих slotsNeeded-1) занят записью или
    // заблокирован вручную, либо слотов просто не хватает до конца дня.
    let booked = false;
    if (dayBlocked) {
      booked = true;
    } else if (isSlotTooSoon(date, time, salonNow)) {
      booked = true;
    } else if (index + slotsNeeded > SLOTS.length) {
      booked = true;
    } else {
      for (let i = index; i < index + slotsNeeded; i += 1) {
        if (occupied.has(i) || blockedByAdmin.has(i)) {
          booked = true;
          break;
        }
      }
    }
    return { time, booked };
  });

  res.json({ date, slots, dayBlocked });
});

// POST /api/book  { name, phone, date, time, serviceId, durationMinutes }
// Создаёт запись, если нужные слоты свободны, сохраняет её в JSON и шлёт уведомление в Telegram.
app.post('/api/book', bookLimiter, async (req, res) => {
  const { name, phone, date, time, serviceId, durationMinutes } = req.body || {};

  if (!name || !phone || !date || !time || !serviceId || !durationMinutes) {
    return res.status(400).json({ error: 'Заполните имя, телефон, дату, время и выберите услугу' });
  }
  if (!isValidName(name)) {
    return res.status(400).json({ error: 'Укажите корректное имя (от 2 до 120 символов)' });
  }
  if (!isValidPhone(phone)) {
    return res.status(400).json({ error: 'Укажите корректный номер телефона' });
  }
  if (!isValidDate(date)) {
    return res.status(400).json({ error: 'Некорректная дата' });
  }

  const startIndex = SLOTS.indexOf(time);
  if (startIndex === -1) {
    return res.status(400).json({ error: 'Некорректное время сеанса' });
  }

  const service = findService(serviceId);
  const duration = findService(serviceId) && findDuration(service, durationMinutes);
  if (!service || !duration) {
    return res.status(400).json({ error: 'Некорректная услуга или длительность' });
  }

  if (startIndex + duration.slots > SLOTS.length) {
    return res.status(400).json({ error: 'Для такой длительности не хватает времени до конца рабочего дня. Выберите время пораньше.' });
  }

  const allBlocks = readBlocks();
  const dateBlocks = blocksForDate(allBlocks, date);
  if (isDayBlocked(dateBlocks)) {
    return res.status(409).json({ error: 'В этот день запись закрыта. Выберите другую дату.' });
  }
  if (isSlotTooSoon(date, time, getSalonNow())) {
    return res.status(409).json({ error: 'Это время уже прошло или наступает меньше чем через час. Выберите другое время.' });
  }
  const blockedByAdmin = blockedSlotIndexes(dateBlocks);

  const bookings = readBookings();
  const dateBookings = bookings.filter((b) => b.date === date);
  const occupied = occupiedSlotIndexes(dateBookings);

  // Повторная проверка на сервере — главная защита от двойной записи
  // и от записи на заблокированное администратором время.
  let alreadyTaken = false;
  for (let i = startIndex; i < startIndex + duration.slots; i += 1) {
    if (occupied.has(i) || blockedByAdmin.has(i)) {
      alreadyTaken = true;
      break;
    }
  }
  if (alreadyTaken) {
    return res.status(409).json({ error: 'Это время (или часть выбранной длительности) уже занято или заблокировано. Выберите другое.' });
  }

  const booking = {
    id: Date.now().toString(),
    name: String(name).trim().slice(0, 120),
    phone: String(phone).trim().slice(0, 40),
    date,
    time,
    serviceId: service.id,
    serviceName: service.name,
    durationMinutes: duration.minutes,
    slotsCount: duration.slots,
    price: duration.price,
    createdAt: new Date().toISOString()
  };

  bookings.push(booking);
  writeBookings(bookings);

  try {
    await sendTelegramNotification(booking);
  } catch (err) {
    // Запись уже сохранена и слот занят — ошибка Telegram не должна
    // мешать клиенту увидеть успешную запись. Логируем для отладки.
    console.error('Telegram: не удалось отправить уведомление —', err.message);
  }

  res.json({ success: true, booking });
});

async function sendTelegramNotification(booking) {
  if (!BOT_TOKEN || CHAT_IDS.length === 0) {
    console.warn('BOT_TOKEN/CHAT_ID не настроены — уведомление в Telegram пропущено.');
    return;
  }

  const serviceLine = booking.serviceName
    ? `, Услуга: ${booking.serviceName} (${booking.durationMinutes} мин, ${booking.price}₾)`
    : '';

  const text =
    `Новая запись! Имя: ${booking.name}, Телефон: ${booking.phone}, ` +
    `Время: ${booking.date} ${booking.time}${serviceLine}`;

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

  // Отправляем каждому получателю отдельно. Если один из адресов
  // ошибётся (например, человек ещё не написал боту), это не должно
  // помешать отправке остальным — поэтому ошибки собираем, а не прерываем цикл.
  const errors = [];

  for (const chatId of CHAT_IDS) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text })
      });

      if (!response.ok) {
        const errText = await response.text();
        errors.push(`chat_id ${chatId}: ${errText}`);
      }
    } catch (err) {
      errors.push(`chat_id ${chatId}: ${err.message}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Telegram API ответил ошибкой для части получателей — ${errors.join(' | ')}`);
  }
}

// ---------- защищённое API админ-панели ----------

// GET /api/admin/bookings — список всех записей, новые сверху.
app.get('/api/admin/bookings', basicAuth, (req, res) => {
  const bookings = readBookings();
  const sorted = [...bookings].sort((a, b) => {
    if (a.date === b.date) return a.time.localeCompare(b.time);
    return a.date.localeCompare(b.date);
  });
  res.json({ bookings: sorted });
});

// DELETE /api/admin/bookings/:id — отменить запись и освободить слот.
app.delete('/api/admin/bookings/:id', basicAuth, (req, res) => {
  const bookings = readBookings();
  const next = bookings.filter((b) => b.id !== req.params.id);

  if (next.length === bookings.length) {
    return res.status(404).json({ error: 'Запись не найдена' });
  }

  writeBookings(next);
  res.json({ success: true });
});

// GET /api/admin/blocks — список всех блокировок (весь день или отдельные часы).
app.get('/api/admin/blocks', basicAuth, (req, res) => {
  const blocks = readBlocks();
  const sorted = [...blocks].sort((a, b) => {
    if (a.date === b.date) {
      // Блокировка всего дня (time === null) показывается первой.
      if (a.time === b.time) return 0;
      if (a.time === null) return -1;
      if (b.time === null) return 1;
      return a.time.localeCompare(b.time);
    }
    return a.date.localeCompare(b.date);
  });
  res.json({ blocks: sorted });
});

// POST /api/admin/blocks  { date, time, note }
// time: конкретный час из SLOTS, или null/отсутствует — заблокировать весь день.
app.post('/api/admin/blocks', basicAuth, (req, res) => {
  const { date, time, note } = req.body || {};

  if (!date || !isValidDate(date)) {
    return res.status(400).json({ error: 'Укажите корректную дату' });
  }

  const normalizedTime = time ? String(time) : null;
  if (normalizedTime !== null && !SLOTS.includes(normalizedTime)) {
    return res.status(400).json({ error: 'Некорректное время. Оставьте поле пустым, чтобы заблокировать весь день.' });
  }

  const blocks = readBlocks();

  // Не даём создать точный дубликат (та же дата + то же время/весь день).
  const duplicate = blocks.some((b) => b.date === date && b.time === normalizedTime);
  if (duplicate) {
    return res.status(409).json({ error: 'Такая блокировка уже существует.' });
  }

  const block = {
    id: Date.now().toString(),
    date,
    time: normalizedTime,
    note: note ? String(note).trim().slice(0, 200) : '',
    createdAt: new Date().toISOString()
  };

  blocks.push(block);
  writeBlocks(blocks);

  res.json({ success: true, block });
});

// DELETE /api/admin/blocks/:id — снять блокировку.
app.delete('/api/admin/blocks/:id', basicAuth, (req, res) => {
  const blocks = readBlocks();
  const next = blocks.filter((b) => b.id !== req.params.id);

  if (next.length === blocks.length) {
    return res.status(404).json({ error: 'Блокировка не найдена' });
  }

  writeBlocks(next);
  res.json({ success: true });
});

// Страница админ-панели (защищена тем же Basic Auth).
app.use('/admin', basicAuth, express.static(path.join(__dirname, 'admin')));

app.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
  console.log(`Админ-панель: http://localhost:${PORT}/admin`);
  if (!ADMIN_PASSWORD) {
    console.warn('Внимание: ADMIN_PASSWORD не задан в .env — админ-панель будет недоступна (503).');
  }
  if (!BOT_TOKEN || CHAT_IDS.length === 0) {
    console.warn('Внимание: BOT_TOKEN/CHAT_ID не заданы в .env — уведомления в Telegram работать не будут.');
  }
});
