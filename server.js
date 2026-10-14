require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

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

// Рабочие часы салона — слоты с шагом в 1 час.
// Поменяйте список, если часы работы другие.
const SLOTS = [
  '10:00', '11:00', '12:00', '13:00', '14:00',
  '15:00', '16:00', '17:00', '18:00', '19:00', '20:00'
];

app.use(express.json());
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

// ---------- защита админ-панели (HTTP Basic Auth) ----------

function basicAuth(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return res
      .status(503)
      .send('Админ-панель не настроена: задайте ADMIN_PASSWORD в файле .env и перезапустите сервер.');
  }

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');

  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const sepIndex = decoded.indexOf(':');
    const user = decoded.slice(0, sepIndex);
    const pass = decoded.slice(sepIndex + 1);

    if (user === ADMIN_USER && pass === ADMIN_PASSWORD) {
      return next();
    }
  }

  res.set('WWW-Authenticate', 'Basic realm="Admin panel"');
  return res.status(401).send('Требуется авторизация');
}

// ---------- публичное API ----------

// GET /api/slots?date=YYYY-MM-DD
// Возвращает список слотов на указанную дату с пометкой, какие уже заняты.
app.get('/api/slots', (req, res) => {
  const { date } = req.query;

  if (!date || !isValidDate(date)) {
    return res.status(400).json({ error: 'Укажите корректную дату в формате YYYY-MM-DD' });
  }

  const bookings = readBookings();
  const bookedTimes = new Set(
    bookings.filter((b) => b.date === date).map((b) => b.time)
  );

  const slots = SLOTS.map((time) => ({
    time,
    booked: bookedTimes.has(time)
  }));

  res.json({ date, slots });
});

// POST /api/book  { name, phone, date, time }
// Создаёт запись, если слот свободен, сохраняет её в JSON и шлёт уведомление в Telegram.
app.post('/api/book', async (req, res) => {
  const { name, phone, date, time } = req.body || {};

  if (!name || !phone || !date || !time) {
    return res.status(400).json({ error: 'Заполните имя, телефон, дату и время' });
  }
  if (!isValidDate(date)) {
    return res.status(400).json({ error: 'Некорректная дата' });
  }
  if (!SLOTS.includes(time)) {
    return res.status(400).json({ error: 'Некорректное время сеанса' });
  }

  const bookings = readBookings();

  // Повторная проверка на сервере — главная защита от двойной записи.
  // Проверки на фронтенде можно обойти, поэтому финальное решение всегда здесь.
  const alreadyTaken = bookings.some((b) => b.date === date && b.time === time);
  if (alreadyTaken) {
    return res.status(409).json({ error: 'Это время уже занято. Выберите другое.' });
  }

  const booking = {
    id: Date.now().toString(),
    name: String(name).trim().slice(0, 120),
    phone: String(phone).trim().slice(0, 40),
    date,
    time,
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

  const text =
    `Новая запись! Имя: ${booking.name}, Телефон: ${booking.phone}, ` +
    `Время: ${booking.date} ${booking.time}`;

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
