// Логика главной страницы: услуги и цены, онлайн-запись, экран «Вы записаны»,
// «Ваши записи на этом устройстве», копирование адреса, кнопки WhatsApp.
// Тексты берутся из i18n.js (window.I18N), поэтому всё работает на 3 языках.
(function () {
  'use strict';

  var I18N = window.I18N;
  var t = I18N.t;

  var SALON_TZ = 'Asia/Tbilisi';
  var MAX_DAYS_AHEAD = 60;
  var WA_NUMBER = '995593370862';
  var SALON_ADDRESS_FULL = '103 Gorgasali Street, Flamingo Salon, Batumi';
  var MY_BOOKINGS_KEY = 'ss_my_bookings';

  // ---------- элементы страницы ----------
  var $ = function (id) { return document.getElementById(id); };
  var dateInput = $('bookDate');
  var slotsGrid = $('slotsGrid');
  var form = $('bookingForm');
  var statusEl = $('bookingStatus');
  var serviceSelect = $('bookService');
  var durationField = $('durationField');
  var durationOptions = $('durationOptions');
  var summaryEl = $('bookingSummary');
  var confirmBtn = $('confirmBtn');
  var servicesGrid = $('servicesGrid');
  var successEl = $('bookingSuccess');

  // ---------- состояние ----------
  var services = [];
  var servicesFailed = false;
  var selectedService = null;
  var selectedDuration = null;
  var selectedTime = null;
  var submitting = false;
  var lastBooking = null;       // { booking, token } — для экрана «Вы записаны»
  var statusRenderer = null;    // функция, которая пишет текущее сообщение статуса
  var slotsRequestId = 0;

  // ---------- маленькие помощники ----------
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function storageGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* приватный режим */ }
  }

  // Сегодняшняя дата по часам салона (Батуми), а не по часам телефона —
  // у туриста телефон может жить в другом часовом поясе.
  function salonToday() {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: SALON_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
        .format(new Date());
    } catch (e) {
      var d = new Date();
      return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    }
  }

  function addDays(isoDate, days) {
    var p = isoDate.split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2] + days)).toISOString().slice(0, 10);
  }

  function timeToMinutes(time) {
    var p = time.split(':').map(Number);
    return p[0] * 60 + p[1];
  }

  function minutesToTime(total) {
    var h = Math.floor(total / 60) % 24;
    var m = total % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  function findService(id) {
    for (var i = 0; i < services.length; i++) if (services[i].id === id) return services[i];
    return null;
  }

  function setStatus(kind, renderer) {
    statusRenderer = renderer;
    statusEl.className = 'booking-status' + (kind ? ' ' + kind : '');
    statusEl.textContent = renderer ? renderer() : '';
  }

  // ---------- мобильное меню ----------
  var burger = $('burgerBtn');
  var links = $('navLinks');
  burger.addEventListener('click', function () {
    var open = links.classList.toggle('open');
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  links.querySelectorAll('a').forEach(function (a) {
    a.addEventListener('click', function () {
      links.classList.remove('open');
      burger.setAttribute('aria-expanded', 'false');
    });
  });

  // ---------- WhatsApp: ссылка с готовым текстом на языке посетителя ----------
  function updateWhatsAppLinks() {
    var href = 'https://wa.me/' + WA_NUMBER + '?text=' + encodeURIComponent(t('wa_text'));
    document.querySelectorAll('.js-wa-link').forEach(function (a) { a.href = href; });
  }

  // ---------- видео в верхнем блоке ----------
  // Видео запускается само (без звука) у всех, кроме тех, кто включил
  // экономию трафика, — им показываем постер и кнопку «включить», видео
  // не скачивается, пока не нажмут. Кнопка пауза/воспроизвести есть всегда
  // (кто не любит движение на экране — может остановить). Если браузер
  // запретил автозапуск, кнопка показывает «включить» — видео запустится
  // по нажатию. Когда блок ушёл с экрана — видео на паузе (бережём батарею).
  var heroVideo = (function () {
    var video = $('heroVideo');
    var btn = $('heroVideoToggle');
    if (!video || !btn) return { refreshLabel: function () {} };

    var saveData = !!(navigator.connection && navigator.connection.saveData);
    var userPaused = saveData; // при экономии трафика ждём нажатия
    var onScreen = true;

    video.muted = true; // без звука браузеры разрешают автозапуск (в т.ч. iPhone)

    // Ролик начинается с плавного проявления из темноты (это нужно для
    // бесшовного повтора). Но при первом показе это выглядело бы как
    // «светлая картинка → темнота → снова светло», поэтому первый запуск
    // начинаем сразу с проявившегося кадра.
    var FIRST_START = 0.9;
    video.addEventListener('loadedmetadata', function () {
      if (video.currentTime < FIRST_START && video.duration > FIRST_START * 2) {
        try { video.currentTime = FIRST_START; } catch (e) { /* не страшно */ }
      }
    }, { once: true });

    function refreshLabel() {
      var paused = video.paused;
      btn.classList.toggle('is-paused', paused);
      btn.setAttribute('aria-pressed', paused ? 'true' : 'false');
      var label = t(paused ? 'video_play' : 'video_pause');
      btn.setAttribute('aria-label', label);
      btn.title = label;
    }

    function play() {
      var p = video.play();
      if (p && typeof p.catch === 'function') {
        p.catch(function () { refreshLabel(); }); // автозапуск запрещён — покажем «включить»
      }
    }

    video.addEventListener('play', refreshLabel);
    video.addEventListener('pause', refreshLabel);

    btn.addEventListener('click', function () {
      if (video.paused) {
        userPaused = false;
        play();
      } else {
        userPaused = true;
        video.pause();
      }
    });

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          onScreen = entry.isIntersecting;
          if (onScreen && !userPaused) play();
          else if (!onScreen) video.pause();
        });
      }, { threshold: 0.1 }).observe(video);
    } else if (!userPaused) {
      play();
    }

    btn.hidden = false;
    refreshLabel();
    return { refreshLabel: refreshLabel };
  })();

  // ---------- копирование адреса ----------
  (function () {
    var btn = $('copyAddressBtn');
    var label = $('copyAddressLabel');
    var address = $('salonAddress').textContent.trim();
    var resetTimer = null;

    // Запасной способ для старых и встроенных браузеров (Instagram, Facebook),
    // где navigator.clipboard недоступен.
    function fallbackCopy(text) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      return ok;
    }

    function showResult(ok) {
      clearTimeout(resetTimer);
      btn.classList.toggle('copied', ok);
      label.setAttribute('data-i18n', ok ? 'copied' : 'copy_manual');
      label.textContent = t(ok ? 'copied' : 'copy_manual');
      resetTimer = setTimeout(function () {
        btn.classList.remove('copied');
        label.setAttribute('data-i18n', 'copy');
        label.textContent = t('copy');
      }, 2000);
    }

    btn.addEventListener('click', function () {
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(address)
          .then(function () { showResult(true); })
          .catch(function () { showResult(fallbackCopy(address)); });
      } else {
        showResult(fallbackCopy(address));
      }
    });
  })();

  // ---------- дата ----------
  var today = salonToday();
  dateInput.min = today;
  dateInput.max = addDays(today, MAX_DAYS_AHEAD);
  dateInput.value = today;

  // ---------- услуги: выпадающий список и блок «Услуги и цены» ----------
  function renderServiceSelect() {
    var current = serviceSelect.value;
    // Первая опция «Выберите услугу» остаётся, остальные пересоздаём.
    while (serviceSelect.options.length > 1) serviceSelect.remove(1);
    services.forEach(function (s) {
      var opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = I18N.serviceName(s);
      serviceSelect.appendChild(opt);
    });
    if (current && findService(current)) serviceSelect.value = current;
  }

  // Какой предмет «живёт» в карточке услуги.
  var SERVICE_OBJECTS = {
    back: 'stones',
    anticellulite: 'bottle',
    neck: 'towel',
    'four-hands': 'candles',
    sport: 'bamboo',
    lymph: 'orchid',
    'full-body': 'salt',
    combo: 'ritual'
  };

  function renderServiceCards() {
    servicesGrid.textContent = '';
    if (servicesFailed) {
      var err = el('p', 'services-msg', t('services_error'));
      err.setAttribute('data-i18n', 'services_error');
      servicesGrid.appendChild(err);
      return;
    }
    if (!services.length) {
      var loading = el('p', 'services-msg', t('services_loading'));
      loading.setAttribute('data-i18n', 'services_loading');
      servicesGrid.appendChild(loading);
      return;
    }
    services.forEach(function (s) {
      var card = el('article', 'service-card');
      // У каждой услуги свой предмет (3D, а пока он не загрузился — картинка).
      var kind = SERVICE_OBJECTS[s.id] || 'stones';
      var obj = el('div', 'obj');
      obj.setAttribute('data-3d', kind);
      obj.setAttribute('aria-hidden', 'true');
      var img = el('img', 'obj-fallback');
      img.src = '/media/3d/' + kind + '.webp';
      img.alt = '';
      img.width = 360;
      img.height = 360;
      img.loading = 'lazy';
      img.decoding = 'async';
      obj.appendChild(img);
      card.appendChild(obj);
      var info = el('div', 'service-info');
      info.appendChild(el('h3', null, I18N.serviceName(s)));
      var list = el('ul', 'service-prices');
      s.durations.forEach(function (d) {
        var li = el('li');
        li.appendChild(el('span', null, d.minutes + ' ' + t('min')));
        li.appendChild(el('b', null, d.price + '₾'));
        list.appendChild(li);
      });
      info.appendChild(list);
      var btn = el('button', 'btn btn-primary', t('services_book'));
      btn.type = 'button';
      btn.addEventListener('click', function () { chooseServiceFromCard(s); });
      info.appendChild(btn);
      card.appendChild(info);
      servicesGrid.appendChild(card);
    });
  }

  function chooseServiceFromCard(service) {
    if (!successEl.hidden) resetToForm();
    serviceSelect.value = service.id;
    selectService(service);
    var booking = $('booking');
    booking.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Фокус на имени — сразу можно печатать (без повторной прокрутки).
    setTimeout(function () {
      try { $('bookName').focus({ preventScroll: true }); } catch (e) { $('bookName').focus(); }
    }, 400);
  }

  function selectService(service) {
    selectedService = service;
    selectedDuration = null; // у новой услуги своя длительность
    renderDurationOptions();
    loadSlots();
    updateSummary();
  }

  function renderDurationOptions() {
    durationOptions.textContent = '';
    var keep = selectedDuration;
    selectedDuration = null;

    if (!selectedService || !selectedService.durations.length) {
      durationField.hidden = true;
      return;
    }
    durationField.hidden = false;

    selectedService.durations.forEach(function (d) {
      var btn = el('button', 'duration-opt', d.minutes + ' ' + t('min') + ' — ' + d.price + '₾');
      btn.type = 'button';
      btn.setAttribute('aria-pressed', 'false');
      btn.addEventListener('click', function () {
        durationOptions.querySelectorAll('.duration-opt').forEach(function (b) {
          b.classList.remove('duration-selected');
          b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('duration-selected');
        btn.setAttribute('aria-pressed', 'true');
        selectedDuration = d;
        loadSlots();
        updateSummary();
      });
      durationOptions.appendChild(btn);
      // Один вариант — выбираем сразу; при перерисовке (смена языка) — сохраняем выбор.
      if (selectedService.durations.length === 1 || (keep && keep.minutes === d.minutes)) {
        btn.classList.add('duration-selected');
        btn.setAttribute('aria-pressed', 'true');
        selectedDuration = d;
      }
    });
  }

  function loadServices() {
    fetch('/api/services')
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        services = Array.isArray(data.services) ? data.services : [];
        servicesFailed = services.length === 0;
        renderServiceSelect();
        renderServiceCards();
        renderMyBookings();
      })
      .catch(function () {
        servicesFailed = true;
        renderServiceCards();
      });
  }

  serviceSelect.addEventListener('change', function () {
    selectService(findService(serviceSelect.value));
  });

  // ---------- свободное время ----------
  function slotsMessage(className, key) {
    slotsGrid.textContent = '';
    var p = el('p', className, t(key));
    p.setAttribute('data-i18n', key);
    slotsGrid.appendChild(p);
  }

  // При первом открытии: если на сегодня всё время уже прошло (например,
  // вечером), сразу показываем завтрашний день, а не «свободного времени нет».
  var autoAdvanceAllowed = true;

  function renderSlots(slots) {
    slotsGrid.textContent = '';
    selectedTime = null;
    var anyFree = slots.some(function (s) { return !s.booked; });
    if (!anyFree && autoAdvanceAllowed && dateInput.value === today) {
      autoAdvanceAllowed = false;
      dateInput.value = addDays(today, 1);
      loadSlots();
      return;
    }
    autoAdvanceAllowed = false;
    if (!anyFree) {
      slotsMessage('slots-none', 'slots_none');
      return;
    }
    slots.forEach(function (slot) {
      var btn = el('button', 'slot-btn', slot.time);
      btn.type = 'button';
      btn.disabled = !!slot.booked;
      btn.setAttribute('aria-pressed', 'false');
      btn.addEventListener('click', function () {
        slotsGrid.querySelectorAll('.slot-btn').forEach(function (b) {
          b.classList.remove('slot-selected');
          b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('slot-selected');
        btn.setAttribute('aria-pressed', 'true');
        selectedTime = slot.time;
        updateSummary();
      });
      slotsGrid.appendChild(btn);
    });
  }

  function loadSlots() {
    var date = dateInput.value;
    selectedTime = null;
    updateSummary();
    if (!date) {
      slotsGrid.textContent = '';
      return;
    }
    slotsMessage('slots-loading', 'slots_loading');
    var slotsNeeded = selectedDuration ? selectedDuration.slots : 1;
    var requestId = ++slotsRequestId;
    fetch('/api/slots?date=' + encodeURIComponent(date) + '&slots=' + slotsNeeded)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        // Пока шёл ответ, посетитель мог сменить дату — старый ответ не нужен.
        if (requestId !== slotsRequestId) return;
        renderSlots(data.slots || []);
      })
      .catch(function () {
        if (requestId !== slotsRequestId) return;
        slotsMessage('slots-error', 'slots_error');
      });
  }

  dateInput.addEventListener('change', function () {
    autoAdvanceAllowed = false; // человек выбрал дату сам — ничего за него не меняем
    // Не даём выбрать дату вне разрешённого диапазона вручную.
    if (dateInput.value && dateInput.value < dateInput.min) dateInput.value = dateInput.min;
    if (dateInput.value && dateInput.value > dateInput.max) dateInput.value = dateInput.max;
    loadSlots();
  });

  // ---------- «Проверьте запись» и кнопка подтверждения ----------
  function summaryRow(label, value) {
    var row = el('div', 'summary-row');
    row.appendChild(el('span', null, label));
    row.appendChild(el('b', null, value));
    return row;
  }

  function updateSummary() {
    var date = dateInput.value;
    var ready = selectedService && selectedDuration && date && selectedTime;

    if (submitting) return;

    if (!ready) {
      summaryEl.hidden = true;
      confirmBtn.disabled = true;
      confirmBtn.textContent = t('btn_choose');
      return;
    }

    summaryEl.textContent = '';
    summaryEl.appendChild(el('div', 'summary-title', t('summary_title')));
    summaryEl.appendChild(summaryRow(t('summary_service'), I18N.serviceName(selectedService)));
    summaryEl.appendChild(summaryRow(t('summary_duration'), selectedDuration.minutes + ' ' + t('min')));
    summaryEl.appendChild(summaryRow(t('summary_date'), I18N.formatDate(date)));
    summaryEl.appendChild(summaryRow(t('summary_time'), selectedTime + '–' + minutesToTime(timeToMinutes(selectedTime) + selectedDuration.minutes)));
    summaryEl.appendChild(summaryRow(t('summary_price'), selectedDuration.price + '₾'));
    summaryEl.hidden = false;

    confirmBtn.disabled = false;
    confirmBtn.textContent = t('btn_confirm', { price: selectedDuration.price });
  }

  // ---------- ссылки для календаря и отмены ----------
  function cancelUrl(token) {
    return window.location.origin + '/cancel.html#' + token;
  }

  function icsUrl(token) {
    return '/api/booking/calendar.ics?token=' + encodeURIComponent(token) + '&lang=' + I18N.lang;
  }

  // Google Календарь сам переведёт время из часового пояса салона в часовой пояс человека.
  function googleCalendarUrl(b, token) {
    var service = findService(b.serviceId);
    var startMin = timeToMinutes(b.time);
    var endMin = startMin + (Number(b.durationMinutes) || 60);
    var day = b.date.replace(/-/g, '');
    var fmt = function (mins) { return day + 'T' + minutesToTime(mins).replace(':', '') + '00'; };
    var details = (service ? I18N.serviceName(service) + ', ' : '') + b.durationMinutes + ' ' + t('min') + ', ' + b.price + '₾\n' +
      t('cal_cancel') + ': ' + cancelUrl(token);
    var params = [
      'action=TEMPLATE',
      'text=' + encodeURIComponent(t('cal_title')),
      'dates=' + fmt(startMin) + '/' + fmt(endMin),
      'ctz=' + encodeURIComponent(SALON_TZ),
      'location=' + encodeURIComponent(SALON_ADDRESS_FULL),
      'details=' + encodeURIComponent(details)
    ];
    return 'https://calendar.google.com/calendar/render?' + params.join('&');
  }

  // ---------- «Ваши записи на этом устройстве» ----------
  function readMyBookings() {
    var list;
    try { list = JSON.parse(storageGet(MY_BOOKINGS_KEY) || '[]'); } catch (e) { list = []; }
    if (!Array.isArray(list)) list = [];
    var todayNow = salonToday();
    // Прошедшие записи и мусор убираем.
    return list.filter(function (b) {
      return b && typeof b.token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(b.token) &&
        typeof b.date === 'string' && b.date >= todayNow && typeof b.time === 'string';
    });
  }

  function writeMyBookings(list) {
    storageSet(MY_BOOKINGS_KEY, JSON.stringify(list.slice(-10)));
  }

  function rememberBooking(b, token) {
    var list = readMyBookings();
    list.push({ token: token, date: b.date, time: b.time, serviceId: b.serviceId, durationMinutes: b.durationMinutes, price: b.price });
    list.sort(function (a, c) { return (a.date + a.time).localeCompare(c.date + c.time); });
    writeMyBookings(list);
  }

  function renderMyBookings() {
    var list = readMyBookings();
    writeMyBookings(list); // заодно чистим прошедшие
    var box = $('myBookings');
    var holder = $('myBookingsList');
    holder.textContent = '';
    if (!list.length) {
      box.hidden = true;
      return;
    }
    list.forEach(function (b) {
      var row = el('div', 'my-booking');
      var service = findService(b.serviceId);
      var text = I18N.formatDate(b.date) + ' · ' + b.time + (service ? ' · ' + I18N.serviceName(service) : '');
      row.appendChild(el('span', null, text));
      var actions = el('span', 'my-booking-actions');
      var cal = el('a', null, t('my_calendar'));
      cal.href = icsUrl(b.token);
      var cancel = el('a', 'danger', t('my_cancel'));
      cancel.href = '/cancel.html#' + b.token;
      actions.appendChild(cal);
      actions.appendChild(cancel);
      row.appendChild(actions);
      holder.appendChild(row);
    });
    box.hidden = false;
  }

  // ---------- экран «Вы записаны» ----------
  function renderSuccess() {
    if (!lastBooking) return;
    var b = lastBooking.booking;
    var token = lastBooking.token;
    var service = findService(b.serviceId);
    $('successText').textContent = t('success_text', {
      date: I18N.formatDate(b.date),
      time: b.time,
      service: service ? I18N.serviceName(service) : '',
      min: b.durationMinutes
    });
    $('successIcs').href = icsUrl(token);
    $('successGoogle').href = googleCalendarUrl(b, token);
    $('successCancel').href = '/cancel.html#' + token;
  }

  function showSuccess(booking, token) {
    lastBooking = { booking: booking, token: token };
    renderSuccess();
    form.hidden = true;
    successEl.hidden = false;
    successEl.focus({ preventScroll: true });
    successEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function resetToForm() {
    lastBooking = null;
    successEl.hidden = true;
    form.hidden = false;
    var keepDate = dateInput.value;
    form.reset();
    dateInput.value = keepDate;
    serviceSelect.value = '';
    selectedService = null;
    selectedDuration = null;
    durationField.hidden = true;
    durationOptions.textContent = '';
    setStatus('', null);
    loadSlots();
  }

  $('bookAgainBtn').addEventListener('click', resetToForm);

  // ---------- телефон: «+» стоит отдельно и не стирается ----------
  // В само поле вводятся только цифры (пробелы, «-» и скобки тоже можно).
  // Если человек вставил номер с «+» или «00» в начале — убираем их, плюс
  // и так стоит. Грузинский мобильный без кода (9 цифр на 5) дополняем 995.
  var phoneInput = $('bookPhone');
  function cleanPhone(v) {
    v = String(v || '').replace(/[^0-9()\-\s]/g, '').replace(/^\s+/, '');
    if (/^00/.test(v)) v = v.replace(/^00\s*/, '');
    return v.slice(0, 24);
  }
  function phoneDigits() { return phoneInput.value.replace(/\D/g, ''); }
  phoneInput.addEventListener('input', function () {
    var cleaned = cleanPhone(phoneInput.value);
    if (cleaned !== phoneInput.value) phoneInput.value = cleaned;
  });
  phoneInput.addEventListener('blur', function () {
    var d = phoneDigits();
    if (d.length === 9 && d.charAt(0) === '5') phoneInput.value = '995 ' + phoneInput.value.trim();
    else phoneInput.value = phoneInput.value.trim();
  });
  $('bookPhoneWrap').addEventListener('click', function (e) {
    if (e.target !== phoneInput) phoneInput.focus();
  });

  // ---------- отправка записи ----------
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (submitting) return;
    setStatus('', null);

    var name = $('bookName').value.trim();
    var phoneRaw = cleanPhone(phoneInput.value).trim();
    var phoneLen = phoneRaw.replace(/\D/g, '').length;
    if (phoneLen === 9 && /^5/.test(phoneRaw.replace(/\D/g, ''))) { phoneRaw = '995 ' + phoneRaw; phoneLen = 12; }
    phoneInput.value = phoneRaw;
    var phone = '+' + phoneRaw;
    var date = dateInput.value;

    if (!name || !phoneRaw) { setStatus('error', function () { return t('val_name_phone'); }); return; }
    if (phoneLen < 7 || phoneLen > 15) { setStatus('error', function () { return t('val_phone'); }); phoneInput.focus(); return; }
    if (!selectedService) { setStatus('error', function () { return t('val_service'); }); return; }
    if (!selectedDuration) { setStatus('error', function () { return t('val_duration'); }); return; }
    if (!selectedTime) { setStatus('error', function () { return t('val_time'); }); return; }

    submitting = true;
    confirmBtn.disabled = true;
    confirmBtn.textContent = t('btn_sending');

    fetch('/api/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name,
        phone: phone,
        date: date,
        time: selectedTime,
        serviceId: selectedService.id,
        durationMinutes: selectedDuration.minutes,
        lang: I18N.lang,
        website: $('bookWebsite').value
      })
    })
      .then(function (res) {
        return res.json()
          .catch(function () { return {}; })
          .then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (result) {
        submitting = false;
        if (!result.ok) {
          var errData = result.data;
          setStatus('error', function () { return I18N.errorMessage(errData); });
          loadSlots();
          return;
        }
        if (result.data.booking && result.data.cancelToken) {
          rememberBooking(result.data.booking, result.data.cancelToken);
          renderMyBookings();
          showSuccess(result.data.booking, result.data.cancelToken);
        } else {
          resetToForm();
        }
      })
      .catch(function () {
        submitting = false;
        setStatus('error', function () { return t('err_connection'); });
        updateSummary();
      });
  });

  // ---------- смена языка ----------
  function updateMeta() {
    document.title = t('meta_title');
    var meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', t('meta_description'));
  }

  I18N.onChange(function () {
    updateMeta();
    heroVideo.refreshLabel();
    updateWhatsAppLinks();
    renderServiceSelect();
    renderServiceCards();
    if (selectedService) renderDurationOptions();
    updateSummary();
    renderMyBookings();
    renderSuccess();
    if (statusRenderer) statusEl.textContent = statusRenderer();
  });

  // ---------- старт ----------
  I18N.apply();
  updateMeta();
  updateWhatsAppLinks();
  renderMyBookings();
  loadServices();
  loadSlots();
})();
