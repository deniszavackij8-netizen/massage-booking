require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const net = require('net');

const app = express();
const PORT = process.env.PORT || 3000;

// Не показываем в заголовках, что сервер на Express — чуть усложняет
// автоматический сбор отпечатка стека для атакующего.
app.disable('x-powered-by');

// ---------------------------------------------------------------------------
// Настоящий IP посетителя (на нём держатся блокировка админки и все лимиты)
// ---------------------------------------------------------------------------
//
// На Render запрос идёт так: посетитель → Cloudflare → балансировщик Render →
// внутренний прокси → наш сервер. Каждое звено дописывает адрес в заголовок
// X-Forwarded-For. Посетитель тоже может дописать туда что угодно — но ЛЕВЕЕ
// своего настоящего адреса. Поэтому читаем заголовок справа налево и
// пропускаем только «свои» звенья: внутреннюю сеть и официальные адреса
// Cloudflare. Первый «чужой» адрес — это и есть посетитель.
//
// Это надёжнее, чем «доверять N последним звеньям»: если Render поменяет
// цепочку прокси, подделать IP всё равно не получится.
// Включается переменной TRUST_PROXY (любое число больше 0, на Render стоит 3).
// Проверка: /api/admin/whoami должен показать ваш настоящий IP.
const TRUSTED_PROXY_NETS = new net.BlockList();
[
  ['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['127.0.0.0', 8],
  ['100.64.0.0', 10], ['169.254.0.0', 16],
  // Cloudflare: https://www.cloudflare.com/ips/
  ['173.245.48.0', 20], ['103.21.244.0', 22], ['103.22.200.0', 22], ['103.31.4.0', 22],
  ['141.101.64.0', 18], ['108.162.192.0', 18], ['190.93.240.0', 20], ['188.114.96.0', 20],
  ['197.234.240.0', 22], ['198.41.128.0', 17], ['162.158.0.0', 15], ['104.16.0.0', 13],
  ['104.24.0.0', 14], ['172.64.0.0', 13], ['131.0.72.0', 22]
].forEach(([addr, prefix]) => TRUSTED_PROXY_NETS.addSubnet(addr, prefix, 'ipv4'));
[
  ['::1', 128], ['fc00::', 7], ['fe80::', 10],
  ['2400:cb00::', 32], ['2606:4700::', 32], ['2803:f800::', 32], ['2405:b500::', 32],
  ['2405:8100::', 32], ['2a06:98c0::', 29], ['2c0f:f248::', 32]
].forEach(([addr, prefix]) => TRUSTED_PROXY_NETS.addSubnet(addr, prefix, 'ipv6'));

function unmapIpv4(addr) {
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(String(addr || ''));
  return m ? m[1] : String(addr || '');
}

function isTrustedProxy(addr) {
  const a = unmapIpv4(addr);
  const family = net.isIP(a);
  if (!family) return false;
  return TRUSTED_PROXY_NETS.check(a, family === 6 ? 'ipv6' : 'ipv4');
}

const TRUST_PROXY_ENABLED = Number.parseInt(process.env.TRUST_PROXY || '0', 10) > 0;
if (TRUST_PROXY_ENABLED) {
  app.set('trust proxy', (addr) => isTrustedProxy(addr));
}

function clientIp(req) {
  return unmapIpv4(req.ip || (req.socket && req.socket.remoteAddress) || 'unknown');
}

// Полный адрес IPv6 → 8 групп (для ключа лимитов).
function expandIpv6(addr) {
  const clean = addr.split('%')[0];
  const [head, tail] = clean.split('::');
  const toGroups = (part) => (part ? part.split(':') : []).flatMap((g) => {
    if (g.includes('.')) { // встроенный IPv4 занимает 2 группы
      const o = g.split('.').map(Number);
      return [((o[0] << 8) | o[1]).toString(16), ((o[2] << 8) | o[3]).toString(16)];
    }
    return [g];
  });
  const h = toGroups(head);
  const t = toGroups(tail);
  const zeros = clean.includes('::') ? new Array(Math.max(0, 8 - h.length - t.length)).fill('0') : [];
  return [...h, ...zeros, ...t].map((g) => g.toLowerCase().replace(/^0+(?=.)/, ''));
}

// Ключ для лимитов и блокировки входа. Обычному абоненту с IPv6 провайдер
// выдаёт целую подсеть /64 (это миллиарды адресов) — если считать попытки по
// отдельным адресам, злоумышленник просто менял бы адрес на каждой попытке.
// Поэтому для IPv6 считаем по подсети /64, для IPv4 — по адресу.
function rateKey(req) {
  const ip = clientIp(req);
  if (net.isIPv6(ip)) return `${expandIpv6(ip).slice(0, 4).join(':')}::/64`;
  return ip;
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

// Секрет для утренней сводки (её вызывает внешний сервис cron-job.org).
// Без него (или если он короче 20 символов) сводка просто выключена.
const CRON_SECRET = (process.env.CRON_SECRET || '').trim();

// Адрес сайта для ссылок в календаре (необязательно — по умолчанию
// берётся из запроса). Пример: https://massage-booking-1.onrender.com
const PUBLIC_URL = (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');

// Хранилище: база данных (если задан DATABASE_URL) или JSON-файлы.
const { createStore, normalizePhone } = require('./storage');
const DATABASE_URL = (process.env.DATABASE_URL || '').trim();
const store = createStore(DATABASE_URL);

// Express 4 не ловит ошибки из async-обработчиков сам — без этой обёртки
// упавший запрос к базе повис бы без ответа. Передаём ошибку дальше,
// в общий обработчик ошибок внизу файла.
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// Ответ с ошибкой: code — для сайта (он покажет текст на языке посетителя),
// error — понятный текст по-русски (для логов и на всякий случай).
function fail(res, status, code, message) {
  return res.status(status).json({ error: message, code });
}

// ---------------------------------------------------------------------------
// Салон: часы работы, услуги, адрес
// ---------------------------------------------------------------------------

const SALON_ADDRESS = '103 Gorgasali Street, Flamingo Salon, Batumi';

// Салон работает каждый день с 10:00 до 20:00. Сетка — по часу, поэтому
// последний часовой сеанс начинается в 19:00 и заканчивается в 20:00.
const OPEN_TIME = '10:00';
const CLOSE_TIME = '20:00';
const SLOTS = [
  '10:00', '11:00', '12:00', '13:00', '14:00',
  '15:00', '16:00', '17:00', '18:00', '19:00'
];

const SUPPORTED_LANGS = ['ru', 'en', 'ka'];
function normalizeLang(value) {
  return SUPPORTED_LANGS.includes(value) ? value : 'ru';
}

// Услуги и варианты длительности. Сетка времени — часовая, поэтому
// длительность указывается в «слотах» (1 слот = 1 час). Для сеанса
// 90 минут (массаж в 4 руки) резервируем 2 часовых слота.
// name — по-русски (для Telegram и админки), names — для сайта на 3 языках.
const SERVICES = [
  {
    id: 'combo',
    name: 'Общий массаж (комбинированный)',
    names: { ru: 'Общий массаж (комбинированный)', en: 'General massage (combined)', ka: 'ზოგადი მასაჟი (კომბინირებული)' },
    durations: [
      { minutes: 60, slots: 1, price: 100 },
      { minutes: 120, slots: 2, price: 160 }
    ]
  },
  {
    id: 'full-body',
    name: 'Массаж всего тела',
    names: { ru: 'Массаж всего тела', en: 'Full body massage', ka: 'მთელი სხეულის მასაჟი' },
    durations: [{ minutes: 60, slots: 1, price: 100 }]
  },
  {
    id: 'anticellulite',
    name: 'Антицеллюлитный массаж',
    names: { ru: 'Антицеллюлитный массаж', en: 'Anti-cellulite massage', ka: 'ანტიცელულიტური მასაჟი' },
    durations: [{ minutes: 60, slots: 1, price: 80 }]
  },
  {
    id: 'sport',
    name: 'Спортивный массаж',
    names: { ru: 'Спортивный массаж', en: 'Sports massage', ka: 'სპორტული მასაჟი' },
    durations: [{ minutes: 60, slots: 1, price: 130 }]
  },
  {
    id: 'lymph',
    name: 'Лимфодренажный массаж',
    names: { ru: 'Лимфодренажный массаж', en: 'Lymphatic drainage massage', ka: 'ლიმფოდრენაჟული მასაჟი' },
    durations: [{ minutes: 60, slots: 1, price: 90 }]
  },
  {
    id: 'four-hands',
    name: 'Массаж в 4 руки',
    names: { ru: 'Массаж в 4 руки', en: 'Four-hand massage', ka: 'მასაჟი ოთხი ხელით' },
    durations: [
      { minutes: 60, slots: 1, price: 160 },
      { minutes: 90, slots: 2, price: 200 }
    ]
  },
  {
    id: 'neck',
    name: 'Массаж ШВЗ',
    names: { ru: 'Массаж ШВЗ (шея и плечи)', en: 'Neck & shoulder massage', ka: 'კისრისა და მხრების მასაჟი' },
    durations: [{ minutes: 30, slots: 1, price: 30 }]
  },
  {
    id: 'back',
    name: 'Массаж спины',
    names: { ru: 'Массаж спины', en: 'Back massage', ka: 'ზურგის მასაჟი' },
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

function serviceNameFor(serviceId, lang, fallback) {
  const s = findService(serviceId);
  if (!s) return fallback || '';
  return s.names[lang] || s.name;
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

// ---------------------------------------------------------------------------
// Время салона (Батуми)
// ---------------------------------------------------------------------------

// Считаем «сейчас» по времени Грузии (Asia/Tbilisi), а не по часовому поясу
// сервера, чтобы отсечение прошедших слотов не зависело от того, где сервер.
const SALON_TIMEZONE = 'Asia/Tbilisi';

// Минимальное время до начала сеанса, на которое ещё разрешена запись.
const MIN_LEAD_MINUTES = 60;

// До какого момента клиент может сам отменить запись по ссылке.
const CANCEL_DEADLINE_HOURS = 3;

const salonPartsFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: SALON_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
});

function salonParts(date) {
  const parts = {};
  salonPartsFmt.formatToParts(date).forEach((p) => { parts[p.type] = p.value; });
  // В некоторых версиях ICU полночь приходит как "24".
  if (parts.hour === '24') parts.hour = '00';
  return parts;
}

function getSalonNow() {
  const parts = salonParts(new Date());
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute)
  };
}

function timeToMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(total) {
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Дата и время по часам салона → момент времени (мс с 1970 года, UTC).
function salonLocalToEpoch(date, time) {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const p = salonParts(new Date(guess));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  const offsetMs = asUtc - guess; // смещение пояса салона от UTC в этот момент
  return guess - offsetMs;
}

// Слот считается «слишком поздним для записи», если дата уже прошла,
// либо это сегодняшний день и до начала слота осталось меньше часа.
function isSlotTooSoon(date, time, salonNow) {
  if (date < salonNow.date) return true;
  if (date > salonNow.date) return false;
  return timeToMinutes(time) < salonNow.minutes + MIN_LEAD_MINUTES;
}

// Запись не дальше чем на 60 дней вперёд — иначе бот мог бы забивать
// записями 2030-й, 2040-й год... и раздувать базу до бесконечности.
const MAX_DAYS_AHEAD = 60;

function isDateTooFar(date, salonNow) {
  const [y, m, d] = salonNow.date.split('-').map(Number);
  const limit = new Date(Date.UTC(y, m - 1, d + MAX_DAYS_AHEAD)).toISOString().slice(0, 10);
  return date > limit;
}

// «суббота, 18 октября» — для сообщений в Telegram.
function formatDateRu(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long'
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

function bookingEndTime(b) {
  return minutesToTime(timeToMinutes(b.time) + (Number(b.durationMinutes) || 60));
}

// ---------------------------------------------------------------------------
// Защита от спама в записи
// ---------------------------------------------------------------------------

// Номер телефона сравниваем только по цифрам (normalizePhone из storage.js),
// чтобы "+995 555 12 34 56" и "995555123456" считались одним номером.
const MAX_ACTIVE_BOOKINGS_PER_PHONE = 3;

// Предохранитель на весь сайт: не больше 20 новых записей в час от всех
// посетителей вместе. Для одного салона это с большим запасом, а ботнет
// с тысячами IP больше не сможет за минуту занять всё расписание.
const GLOBAL_BOOKINGS_PER_HOUR = 20;
let globalBookingTimestamps = [];
let lastBookingFloodAlertAt = 0;

function globalBookingGuardAllows() {
  const now = Date.now();
  globalBookingTimestamps = globalBookingTimestamps.filter((t) => t > now - 60 * 60 * 1000);
  if (globalBookingTimestamps.length < GLOBAL_BOOKINGS_PER_HOUR) return true;

  if (now - lastBookingFloodAlertAt > 30 * 60 * 1000) {
    lastBookingFloodAlertAt = now;
    sendTelegramText(
      `⚠️ За последний час пришло ${globalBookingTimestamps.length} онлайн-записей — похоже на атаку ботов. ` +
      'Новые онлайн-записи временно приостановлены, проверьте список в админке.'
    ).catch((err) => console.error('Telegram alert:', err.message));
  }
  return false;
}

function registerGlobalBooking() {
  globalBookingTimestamps.push(Date.now());
}

// ---------------------------------------------------------------------------
// Общие middleware: размер запроса, защитные заголовки
// ---------------------------------------------------------------------------

// Ограничиваем размер тела запроса — защита от примитивного DoS.
app.use(express.json({ limit: '15kb' }));

// Политика безопасности контента (CSP): браузеру разрешено выполнять только
// скрипты с нашего же сайта. Даже если кто-то сумеет вставить на страницу
// чужой <script> или onclick=…, браузер его просто не запустит.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "media-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join('; ');

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  // Файлы сайта (в т.ч. видео) нельзя встраивать на чужие сайты — чужие
  // страницы не будут тратить наш трафик.
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  // Браузер будет открывать сайт только по HTTPS (на localhost по http игнорируется).
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // Ответы API и админки (имена и телефоны клиентов) не кешируем —
  // чтобы они не оставались в кеше браузера на чужом/общем компьютере.
  if (req.path.startsWith('/api/') || req.path.startsWith('/admin')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});

// Некорректный JSON в теле запроса не должен приводить к утечке
// внутреннего стека ошибок express — отвечаем аккуратным 400.
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')) {
    return fail(res, 400, 'bad_request', 'Некорректный формат запроса');
  }
  return next(err);
});

// Видео и постер кешируются в браузере на сутки — повторный заход на сайт
// не скачивает ролик заново. (Express сам умеет отдавать видео «кусками»
// по запросу Range — это нужно iPhone, без этого Safari видео не покажет.)
app.use('/media', express.static(path.join(__dirname, 'public', 'media'), { maxAge: '1d' }));

app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Проверка входных данных
// ---------------------------------------------------------------------------

function isValidDate(value) {
  if (typeof value !== 'string') return false; // ?date=a&date=b приходит массивом
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
  // Невидимые символы и символы смены направления текста — ими можно
  // подделать то, как имя выглядит в админке и в Telegram.
  if (/[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufeff\uffa0]/.test(trimmed)) return false;
  // Ссылки в имени — типичный спам/фишинг через уведомления в Telegram.
  if (/(https?:|www\.|t\.me\/|@\w{3,}|\.(com|ru|net|org|io|me|ge|xyz|top|info|link|site|online|shop|click)\b)/i.test(trimmed)) return false;
  // В имени должна быть хотя бы одна буква.
  if (!/\p{L}/u.test(trimmed)) return false;
  return true;
}

// Телефон в международном формате: необязательный «+» в начале, дальше
// цифры, пробелы, «-» и скобки; 7–15 цифр (максимум по стандарту E.164).
function isValidPhone(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length > 40) return false;
  if (!/^\+?[0-9()\-\s]+$/.test(trimmed)) return false;
  const digitsOnly = trimmed.replace(/\D/g, '');
  return digitsOnly.length >= 7 && digitsOnly.length <= 15;
}

// Приводим номер к виду «+995 599 12 34 56»: один «+» в начале, лишние
// пробелы схлопнуты.
function normalizePhoneForDisplay(value) {
  const body = String(value).trim().replace(/^\+/, '').replace(/\s+/g, ' ').trim();
  return ('+' + body).slice(0, 40);
}

// Токен отмены: 32 случайных байта в base64url — 43 символа [A-Za-z0-9_-].
function isValidToken(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ---------------------------------------------------------------------------
// Лимиты запросов по IP
// ---------------------------------------------------------------------------

// Скользящее окно на N запросов за M миллисекунд, отдельный счётчик на IP.
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
    const ip = rateKey(req);
    const now = Date.now();
    const cutoff = now - windowMs;
    const timestamps = (hits.get(ip) || []).filter((t) => t > cutoff);

    if (timestamps.length >= max) {
      res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
      return fail(res, 429, 'rate_limited', message);
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

// Чтение расписания — защита от массового сканирования всех дат ботом.
const slotsLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  message: 'Слишком много запросов. Подождите немного.'
});

// Отмена записи / календарь по секретной ссылке.
const tokenLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: 'Слишком много запросов. Подождите немного.'
});

// Утренняя сводка: её вызывает только cron-job.org, пару раз в день.
const cronLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: 'Слишком много запросов.'
});

// ---------------------------------------------------------------------------
// Защита админ-панели (HTTP Basic Auth + защита от перебора)
// ---------------------------------------------------------------------------

// Сравнение строк постоянного времени — обычное `===` теоретически позволяет
// подбирать пароль по одному символу через замеры времени ответа.
function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// 5 неудачных попыток подряд с одного IP — блокировка на 20 минут.
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 20 * 60 * 1000;

const loginAttemptsByIp = new Map(); // ip -> { count, lockedUntil }

function getLoginState(ip) {
  return loginAttemptsByIp.get(ip) || { count: 0, lockedUntil: 0 };
}

// Атака ботнетом (тысячи разных IP по 4 попытки) обходит блокировку по IP.
// Блокировать вход для всех нельзя — тогда бот запрёт админку и владельцу.
// Поэтому при всплеске неудачных входов просто шлём предупреждение в Telegram.
const GLOBAL_FAIL_WINDOW_MS = 10 * 60 * 1000;
const GLOBAL_FAIL_ALERT_THRESHOLD = 30;
const GLOBAL_ALERT_COOLDOWN_MS = 30 * 60 * 1000;
let globalFailTimestamps = [];
let lastGlobalAlertAt = 0;

function trackGlobalFailedLogin() {
  const now = Date.now();
  globalFailTimestamps = globalFailTimestamps.filter((t) => t > now - GLOBAL_FAIL_WINDOW_MS);
  globalFailTimestamps.push(now);
  if (
    globalFailTimestamps.length >= GLOBAL_FAIL_ALERT_THRESHOLD &&
    now - lastGlobalAlertAt > GLOBAL_ALERT_COOLDOWN_MS
  ) {
    lastGlobalAlertAt = now;
    sendTelegramText(
      `⚠️ Подозрительная активность: ${globalFailTimestamps.length} неудачных попыток входа в админку за 10 минут. ` +
      'Если это не вы — пароль надёжный, но стоит проверить логи на Render.'
    ).catch((err) => console.error('Telegram alert:', err.message));
  }
}

function registerFailedLogin(ip) {
  const state = getLoginState(ip);
  state.count += 1;
  if (state.count >= MAX_LOGIN_ATTEMPTS) {
    state.lockedUntil = Date.now() + LOGIN_LOCKOUT_MS;
    state.count = 0;
    console.warn(`Админка: IP ${ip} заблокирован на 20 минут после ${MAX_LOGIN_ATTEMPTS} неудачных попыток`);
  }
  loginAttemptsByIp.set(ip, state);
  trackGlobalFailedLogin();
}

function clearLoginAttempts(ip) {
  loginAttemptsByIp.delete(ip);
}

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

  const ip = rateKey(req);
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

  // Первый заход без пароля (браузер ещё не показал окно входа) — это не
  // неудачная попытка, просто просим представиться.
  if (header) registerFailedLogin(ip);
  res.set('WWW-Authenticate', 'Basic realm="Admin panel"');
  return res.status(401).send('Требуется авторизация');
}

// ---------------------------------------------------------------------------
// Публичное API
// ---------------------------------------------------------------------------

// GET /api/health — лёгкая проверка «сервер жив» (без обращения к базе).
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// GET /api/services — услуги, цены, сетка времени и часы работы.
app.get('/api/services', (req, res) => {
  res.json({
    services: SERVICES,
    slots: SLOTS,
    hours: { open: OPEN_TIME, close: CLOSE_TIME },
    cancelDeadlineHours: CANCEL_DEADLINE_HOURS
  });
});

// GET /api/slots?date=YYYY-MM-DD&slots=1|2
// Список слотов на дату с пометкой, какие недоступны.
app.get('/api/slots', slotsLimiter, asyncHandler(async (req, res) => {
  const { date } = req.query;
  const slotsNeeded = Math.min(4, Math.max(1, Math.floor(Number(req.query.slots)) || 1));

  if (!date || !isValidDate(date)) {
    return fail(res, 400, 'bad_date', 'Укажите корректную дату в формате YYYY-MM-DD');
  }

  const [dateBookings, dateBlocks] = await Promise.all([
    store.bookingsForDate(date),
    store.blocksForDate(date)
  ]);
  const occupied = occupiedSlotIndexes(dateBookings);
  const dayBlocked = isDayBlocked(dateBlocks);
  const blockedByAdmin = blockedSlotIndexes(dateBlocks);
  const salonNow = getSalonNow();

  const slots = SLOTS.map((time, index) => {
    let booked = false;
    if (dayBlocked) {
      booked = true;
    } else if (isSlotTooSoon(date, time, salonNow) || isDateTooFar(date, salonNow)) {
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

  return res.json({ date, slots, dayBlocked });
}));

// POST /api/book  { name, phone, date, time, serviceId, durationMinutes, lang }
// Создаёт запись, если нужные слоты свободны, и шлёт уведомление в Telegram.
// В ответе — секретный токен для отмены записи (выдаётся один раз,
// в базе хранится только его хеш).
app.post('/api/book', bookLimiter, asyncHandler(async (req, res) => {
  const { name, phone, date, time, serviceId, durationMinutes, website } = req.body || {};
  const lang = normalizeLang((req.body || {}).lang);

  // «Ловушка для ботов» (honeypot): поле website спрятано от людей на
  // странице, но простые боты заполняют все поля подряд. Отвечаем боту
  // «успехом», чтобы он не понял, что его раскусили, но ничего не сохраняем.
  if (website) {
    console.warn(`Бот попал в ловушку (honeypot), IP ${clientIp(req)}`);
    return res.json({ success: true });
  }

  if (!name || !phone || !date || !time || !serviceId || !durationMinutes) {
    return fail(res, 400, 'bad_fields', 'Заполните имя, телефон, дату, время и выберите услугу');
  }
  if (!isValidName(name)) {
    return fail(res, 400, 'bad_name', 'Укажите корректное имя (от 2 до 120 символов)');
  }
  if (!isValidPhone(phone)) {
    return fail(res, 400, 'bad_phone', 'Укажите корректный номер телефона');
  }
  if (!isValidDate(date)) {
    return fail(res, 400, 'bad_date', 'Некорректная дата');
  }
  if (isDateTooFar(date, getSalonNow())) {
    return fail(res, 400, 'too_far', `Запись открыта не больше чем на ${MAX_DAYS_AHEAD} дней вперёд`);
  }

  const startIndex = typeof time === 'string' ? SLOTS.indexOf(time) : -1;
  if (startIndex === -1) {
    return fail(res, 400, 'bad_time', 'Некорректное время сеанса');
  }

  const service = typeof serviceId === 'string' ? findService(serviceId) : null;
  const duration = service && findDuration(service, durationMinutes);
  if (!service || !duration) {
    return fail(res, 400, 'bad_service', 'Некорректная услуга или длительность');
  }

  if (startIndex + duration.slots > SLOTS.length) {
    return fail(res, 400, 'not_enough_time', 'Для такой длительности не хватает времени до конца рабочего дня. Выберите время пораньше.');
  }

  if (isSlotTooSoon(date, time, getSalonNow())) {
    return fail(res, 409, 'too_soon', 'Это время уже прошло или наступает меньше чем через час. Выберите другое время.');
  }

  const cancelToken = crypto.randomBytes(32).toString('base64url');

  // Проверка свободного времени и сохранение — внутри «замка» на дату:
  // пока идёт эта запись, вторая запись на тот же день ждёт своей очереди,
  // поэтому два человека физически не могут занять одно и то же время.
  const result = await store.withBookingLock(date, phone, async (tx) => {
    const [dateBlocks, dateBookings] = await Promise.all([tx.blocksForDate(), tx.bookingsForDate()]);

    if (isDayBlocked(dateBlocks)) {
      return { status: 409, code: 'day_closed', error: 'В этот день запись закрыта. Выберите другую дату.' };
    }

    const blockedByAdmin = blockedSlotIndexes(dateBlocks);
    const occupied = occupiedSlotIndexes(dateBookings);
    for (let i = startIndex; i < startIndex + duration.slots; i += 1) {
      if (occupied.has(i) || blockedByAdmin.has(i)) {
        return { status: 409, code: 'slot_taken', error: 'Это время (или часть выбранной длительности) уже занято или заблокировано. Выберите другое.' };
      }
    }

    // Не больше MAX_ACTIVE_BOOKINGS_PER_PHONE будущих записей на один номер.
    const activeForPhone = await tx.countActiveForPhone(getSalonNow().date);
    if (activeForPhone >= MAX_ACTIVE_BOOKINGS_PER_PHONE) {
      return {
        status: 409,
        code: 'phone_limit',
        error: 'На этот номер уже есть несколько активных записей. Для новой записи свяжитесь с нами в WhatsApp или Telegram.'
      };
    }

    // Общий «предохранитель» от ботнета.
    if (!globalBookingGuardAllows()) {
      return {
        status: 429,
        code: 'busy',
        error: 'Онлайн-запись временно перегружена. Пожалуйста, напишите нам в WhatsApp или Telegram.'
      };
    }

    const newBooking = {
      id: crypto.randomUUID(),
      name: String(name).trim().slice(0, 120),
      phone: normalizePhoneForDisplay(phone),
      date,
      time,
      serviceId: service.id,
      serviceName: service.name,
      durationMinutes: duration.minutes,
      slotsCount: duration.slots,
      price: duration.price,
      lang,
      cancelTokenHash: hashToken(cancelToken),
      createdAt: new Date().toISOString()
    };
    await tx.insertBooking(newBooking);
    return { booking: newBooking };
  });

  if (result.error) {
    return fail(res, result.status, result.code, result.error);
  }

  const { booking } = result;
  registerGlobalBooking();

  try {
    await sendTelegramText(formatNewBookingMessage(booking));
  } catch (err) {
    // Запись уже сохранена и слот занят — ошибка Telegram не должна
    // мешать клиенту увидеть успешную запись. Логируем для отладки.
    console.error('Telegram: не удалось отправить уведомление —', err.message);
  }

  // Клиенту — только то, что нужно для экрана «Вы записаны» и календаря.
  return res.json({
    success: true,
    booking: {
      date: booking.date,
      time: booking.time,
      serviceId: booking.serviceId,
      durationMinutes: booking.durationMinutes,
      price: booking.price
    },
    cancelToken
  });
}));

// ---------- отмена записи клиентом по секретной ссылке ----------

function cancelDeadlineEpoch(booking) {
  return salonLocalToEpoch(booking.date, booking.time) - CANCEL_DEADLINE_HOURS * 60 * 60 * 1000;
}

function publicBookingView(booking) {
  const deadline = cancelDeadlineEpoch(booking);
  return {
    booking: {
      date: booking.date,
      time: booking.time,
      serviceId: booking.serviceId,
      durationMinutes: booking.durationMinutes,
      price: booking.price
    },
    canCancel: Date.now() <= deadline,
    cancelDeadline: new Date(deadline).toISOString()
  };
}

// POST /api/booking/lookup { token } — показать запись по ссылке отмены.
// Токен передаём в теле POST-запроса, а не в адресе, чтобы он не оседал
// в логах серверов и истории браузера.
app.post('/api/booking/lookup', tokenLimiter, asyncHandler(async (req, res) => {
  const token = (req.body || {}).token;
  if (!isValidToken(token)) {
    return fail(res, 404, 'not_found', 'Запись не найдена');
  }
  const booking = await store.findBookingByTokenHash(hashToken(token));
  if (!booking) {
    return fail(res, 404, 'not_found', 'Запись не найдена');
  }
  return res.json(publicBookingView(booking));
}));

// POST /api/booking/cancel { token } — клиент отменяет свою запись.
app.post('/api/booking/cancel', tokenLimiter, asyncHandler(async (req, res) => {
  const token = (req.body || {}).token;
  if (!isValidToken(token)) {
    return fail(res, 404, 'not_found', 'Запись не найдена');
  }
  const hash = hashToken(token);
  const booking = await store.findBookingByTokenHash(hash);
  if (!booking) {
    return fail(res, 404, 'not_found', 'Запись не найдена');
  }
  if (Date.now() > cancelDeadlineEpoch(booking)) {
    return fail(res, 409, 'too_late', `Отменить онлайн можно не позже чем за ${CANCEL_DEADLINE_HOURS} часа до сеанса.`);
  }

  const deleted = await store.deleteBookingByToken(booking.id, hash);
  if (!deleted) {
    return fail(res, 404, 'not_found', 'Запись не найдена');
  }

  try {
    await sendTelegramText(formatCancelledMessage(deleted));
  } catch (err) {
    console.error('Telegram: не удалось отправить уведомление об отмене —', err.message);
  }

  return res.json({ success: true });
}));

// ---------- «Добавить в календарь» (.ics) ----------

// Экранирование текста по стандарту iCalendar (RFC 5545).
function icsEscape(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Строки длиннее 75 байт по стандарту переносятся. Режем по байтам UTF-8,
// не разрывая многобайтовые буквы (кириллица, грузинский).
function icsFold(line) {
  const out = [];
  let current = '';
  let currentBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const bytes = Buffer.byteLength(ch, 'utf8');
    if (currentBytes + bytes > limit) {
      out.push(current);
      current = ' ';
      currentBytes = 1;
      limit = 75;
    }
    current += ch;
    currentBytes += bytes;
  }
  out.push(current);
  return out.join('\r\n');
}

function icsDate(epochMs) {
  return new Date(epochMs).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

const ICS_TEXT = {
  ru: { title: 'Массаж — Salt & Stone', min: 'мин', address: 'Адрес', cancel: 'Отменить запись (не позже чем за 3 часа)', reminder: 'Скоро массаж в Salt & Stone' },
  en: { title: 'Massage — Salt & Stone', min: 'min', address: 'Address', cancel: 'Cancel booking (at least 3 hours before)', reminder: 'Your massage at Salt & Stone is coming up' },
  ka: { title: 'მასაჟი — Salt & Stone', min: 'წთ', address: 'მისამართი', cancel: 'ჩაწერის გაუქმება (სეანსამდე არაუგვიანეს 3 საათისა)', reminder: 'მალე მასაჟი Salt & Stone-ში' }
};

// Адрес сайта для ссылки отмены. Берём из PUBLIC_URL или из самого
// запроса (с проверкой, что заголовок Host выглядит как обычный домен).
function siteOrigin(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const host = String(req.get('host') || '');
  if (!/^[A-Za-z0-9.-]+(:\d+)?$/.test(host)) return '';
  const proto = req.protocol === 'http' ? 'http' : 'https';
  return `${proto}://${host}`;
}

// GET /api/booking/calendar.ics?token=…&lang=ru
app.get('/api/booking/calendar.ics', tokenLimiter, asyncHandler(async (req, res) => {
  const { token } = req.query;
  if (!isValidToken(token)) {
    return res.status(404).type('text/plain').send('Not found');
  }
  const booking = await store.findBookingByTokenHash(hashToken(token));
  if (!booking) {
    return res.status(404).type('text/plain').send('Not found');
  }

  const lang = SUPPORTED_LANGS.includes(req.query.lang) ? req.query.lang : normalizeLang(booking.lang);
  const T = ICS_TEXT[lang];
  const start = salonLocalToEpoch(booking.date, booking.time);
  const end = start + (Number(booking.durationMinutes) || 60) * 60 * 1000;
  const origin = siteOrigin(req);
  const serviceName = serviceNameFor(booking.serviceId, lang, booking.serviceName);

  const descriptionLines = [
    `${serviceName}, ${booking.durationMinutes} ${T.min}, ${booking.price}₾`,
    `${T.address}: ${SALON_ADDRESS}`
  ];
  if (origin) descriptionLines.push(`${T.cancel}: ${origin}/cancel.html#${token}`);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Salt & Stone//Booking//RU',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${booking.id}@salt-and-stone`,
    `DTSTAMP:${icsDate(Date.now())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsEscape(T.title)}`,
    `LOCATION:${icsEscape(SALON_ADDRESS)}`,
    `DESCRIPTION:${icsEscape(descriptionLines.join('\n'))}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT2H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsEscape(T.reminder)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ];

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="salt-and-stone-massage.ics"');
  return res.send(`${lines.map(icsFold).join('\r\n')}\r\n`);
}));

// ---------------------------------------------------------------------------
// Сообщения в Telegram
// ---------------------------------------------------------------------------

const LANG_LABEL = { ru: 'русский', en: 'английский', ka: 'грузинский' };

function bookingLines(b) {
  return [
    `👤 ${b.name}`,
    `📞 ${b.phone}`,
    `📅 ${formatDateRu(b.date)}, ${b.time}–${bookingEndTime(b)}`,
    `💆 ${b.serviceName} (${b.durationMinutes} мин, ${b.price}₾)`
  ];
}

function formatNewBookingMessage(b) {
  const lines = ['🆕 Новая запись!', ...bookingLines(b)];
  if (b.lang && b.lang !== 'ru') lines.push(`🌐 Сайт на языке: ${LANG_LABEL[b.lang]} — клиенту удобнее писать на нём`);
  return lines.join('\n');
}

function formatCancelledMessage(b) {
  return ['❌ Клиент сам отменил запись — время снова свободно', ...bookingLines(b)].join('\n');
}

function pluralRu(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function formatDailySummary(date, bookings, blocks) {
  const header = `☀️ Доброе утро! Записи на сегодня, ${formatDateRu(date)}:`;
  const dayBlock = blocks.find((b) => b.time === null);
  if (dayBlock) {
    return `${header}\n\n⛔ Весь день закрыт${dayBlock.note ? ` (${dayBlock.note})` : ''}.`;
  }

  const lines = [header, ''];
  const sorted = [...bookings].sort((a, b) => a.time.localeCompare(b.time));
  if (sorted.length === 0) {
    lines.push('На сегодня записей нет.');
  } else {
    sorted.forEach((b) => {
      lines.push(`🕐 ${b.time}–${bookingEndTime(b)} · ${b.serviceName} (${b.durationMinutes} мин, ${b.price}₾)`);
      const langNote = b.lang && b.lang !== 'ru' ? ` · ${b.lang.toUpperCase()}` : '';
      lines.push(`     ${b.name}, ${b.phone}${langNote}`);
    });
    const total = sorted.reduce((sum, b) => sum + (Number(b.price) || 0), 0);
    lines.push('');
    lines.push(`Всего: ${sorted.length} ${pluralRu(sorted.length, 'запись', 'записи', 'записей')} на ${total}₾`);
  }

  const closedHours = blocks.filter((b) => b.time !== null).map((b) => b.time).sort();
  if (closedHours.length) {
    lines.push(`Закрытые часы: ${closedHours.join(', ')}`);
  }
  return lines.join('\n');
}

// Текст отправляется без parse_mode, поэтому имя клиента вроде
// "<b>..." или "*...*" не может сломать разметку сообщения.
async function sendTelegramText(text) {
  if (!BOT_TOKEN || CHAT_IDS.length === 0) {
    console.warn('BOT_TOKEN/CHAT_ID не настроены — уведомление в Telegram пропущено.');
    return;
  }

  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const errors = [];

  for (const chatId of CHAT_IDS) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
        signal: AbortSignal.timeout(10000)
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

// ---------------------------------------------------------------------------
// Утренняя сводка (вызывается сервисом cron-job.org)
// ---------------------------------------------------------------------------

// GET /api/cron/daily-summary?key=СЕКРЕТ
// Отправляет в Telegram список записей на сегодня — не больше одного раза
// в день, сколько бы раз её ни вызвали (поэтому в cron-job.org можно
// поставить несколько попыток подряд на случай, если сервер «спит»).
app.get('/api/cron/daily-summary', cronLimiter, asyncHandler(async (req, res) => {
  if (CRON_SECRET.length < 20) {
    return fail(res, 503, 'disabled', 'Утренняя сводка не настроена: задайте CRON_SECRET');
  }
  const key = typeof req.query.key === 'string' ? req.query.key : String(req.get('x-cron-key') || '');
  if (!timingSafeStringEqual(key, CRON_SECRET)) {
    return fail(res, 403, 'forbidden', 'Неверный ключ');
  }

  const today = getSalonNow().date;
  const stateKey = `daily-summary:${today}`;
  const claimed = await store.claimState(stateKey);
  if (!claimed) {
    return res.json({ ok: true, sent: false, reason: 'already_sent_today' });
  }

  try {
    const [bookings, blocks] = await Promise.all([store.bookingsForDate(today), store.blocksForDate(today)]);
    await sendTelegramText(formatDailySummary(today, bookings, blocks));
  } catch (err) {
    // Не получилось — снимаем отметку, чтобы следующая попытка отправила сводку.
    await store.releaseState(stateKey).catch(() => {});
    throw err;
  }

  return res.json({ ok: true, sent: true });
}));

// ---------------------------------------------------------------------------
// Защищённое API админ-панели
// ---------------------------------------------------------------------------

app.get('/api/admin/bookings', basicAuth, asyncHandler(async (req, res) => {
  res.json({ bookings: await store.allBookings() });
}));

app.delete('/api/admin/bookings/:id', basicAuth, asyncHandler(async (req, res) => {
  const deleted = await store.deleteBooking(String(req.params.id));
  if (!deleted) {
    return fail(res, 404, 'not_found', 'Запись не найдена');
  }
  return res.json({ success: true });
}));

app.get('/api/admin/blocks', basicAuth, asyncHandler(async (req, res) => {
  res.json({ blocks: await store.allBlocks() });
}));

// POST /api/admin/blocks  { date, time, note }
// time: конкретный час из SLOTS, или null/отсутствует — заблокировать весь день.
app.post('/api/admin/blocks', basicAuth, asyncHandler(async (req, res) => {
  const { date, time, note } = req.body || {};

  if (!date || !isValidDate(date)) {
    return fail(res, 400, 'bad_date', 'Укажите корректную дату');
  }
  if (note !== undefined && note !== null && typeof note !== 'string') {
    return fail(res, 400, 'bad_note', 'Некорректный комментарий');
  }
  const normalizedTime = time ? String(time) : null;
  if (normalizedTime !== null && !SLOTS.includes(normalizedTime)) {
    return fail(res, 400, 'bad_time', 'Некорректное время. Оставьте поле пустым, чтобы заблокировать весь день.');
  }

  const block = await store.createBlock({
    id: crypto.randomUUID(),
    date,
    time: normalizedTime,
    note: note ? String(note).trim().slice(0, 200) : '',
    createdAt: new Date().toISOString()
  });
  if (!block) {
    return fail(res, 409, 'duplicate', 'Такая блокировка уже существует.');
  }

  return res.json({ success: true, block });
}));

app.delete('/api/admin/blocks/:id', basicAuth, asyncHandler(async (req, res) => {
  const deleted = await store.deleteBlock(String(req.params.id));
  if (!deleted) {
    return fail(res, 404, 'not_found', 'Блокировка не найдена');
  }
  return res.json({ success: true });
}));

// GET /api/admin/whoami — какой IP сервер видит у вас (проверка TRUST_PROXY).
app.get('/api/admin/whoami', basicAuth, (req, res) => {
  res.json({
    ipSeenByServer: clientIp(req),
    trustProxy: TRUST_PROXY_ENABLED ? 'trusted networks (private + Cloudflare)' : 'off',
    xForwardedFor: req.headers['x-forwarded-for'] || null
  });
});

// Неизвестные адреса /api/... — аккуратный JSON вместо стандартной страницы express.
app.use('/api', (req, res) => fail(res, 404, 'not_found', 'Не найдено'));

// Страница админ-панели (защищена тем же Basic Auth).
app.use('/admin', basicAuth, express.static(path.join(__dirname, 'admin')));

// Последний обработчик ошибок: любая непредвиденная ошибка — аккуратный
// ответ 500 без технических подробностей (стек, пути к файлам) наружу.
app.use((err, req, res, next) => {
  console.error('Необработанная ошибка:', err);
  if (res.headersSent) return next(err);
  return fail(res, 500, 'server_error', 'Внутренняя ошибка сервера. Попробуйте позже.');
});

// Сначала готовим хранилище (создаём таблицы в базе, если их ещё нет),
// и только потом принимаем посетителей. Если база недоступна — сервер
// не запускается: на Render тогда останется работать предыдущая версия.
store.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Сервер запущен: http://localhost:${PORT}`);
      console.log(`Админ-панель: http://localhost:${PORT}/admin`);
      if (store.kind === 'postgres') {
        console.log('Хранилище: база данных PostgreSQL (записи сохраняются надёжно).');
      } else {
        console.warn(
          'Хранилище: JSON-файлы в папке data/. ВНИМАНИЕ: на бесплатном Render эти файлы ' +
          'стираются при каждом обновлении и засыпании сервиса — задайте DATABASE_URL.'
        );
      }
      if (!ADMIN_PASSWORD) {
        console.warn('Внимание: ADMIN_PASSWORD не задан в .env — админ-панель будет недоступна (503).');
      }
      if (!BOT_TOKEN || CHAT_IDS.length === 0) {
        console.warn('Внимание: BOT_TOKEN/CHAT_ID не заданы в .env — уведомления в Telegram работать не будут.');
      }
      if (CRON_SECRET.length < 20) {
        console.warn('Утренняя сводка выключена: задайте CRON_SECRET (не короче 20 символов).');
      }
    });
  })
  .catch((err) => {
    console.error('Не удалось подключиться к базе данных:', err.message);
    console.error('Проверьте переменную DATABASE_URL в настройках (Environment) на Render.');
    process.exit(1);
  });
