// Страница отмены записи по секретной ссылке вида /cancel.html#ТОКЕН.
// Токен стоит после «#» — эта часть адреса не отправляется на сервер при
// открытии страницы и не попадает в логи; на сервер он уходит только
// в теле POST-запроса.
(function () {
  'use strict';

  var I18N = window.I18N;
  var t = I18N.t;
  var MY_BOOKINGS_KEY = 'ss_my_bookings';
  var WA_NUMBER = '995593370862';

  var $ = function (id) { return document.getElementById(id); };
  var loadingMsg = $('loadingMsg');
  var bookingBox = $('bookingBox');
  var details = $('details');
  var deadlineNote = $('deadlineNote');
  var message = $('message');
  var confirmBtn = $('confirmBtn');
  var waBtn = $('waBtn');
  var againBtn = $('againBtn');

  var token = '';
  try {
    token = decodeURIComponent((window.location.hash || '').replace(/^#/, '')).trim();
  } catch (e) {
    token = ''; // испорченная ссылка — покажем «ссылка недействительна»
  }
  var services = [];
  var view = null;          // ответ сервера: { booking, canCancel, cancelDeadline }
  var messageState = null;  // { kind, key } или { kind, errData }
  var cancelling = false;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function serviceById(id) {
    for (var i = 0; i < services.length; i++) if (services[i].id === id) return services[i];
    return null;
  }

  function minutesToTime(total) {
    var h = Math.floor(total / 60) % 24;
    var m = total % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  function setMessage(state) {
    messageState = state;
    renderMessage();
  }

  function renderMessage() {
    if (!messageState) {
      message.textContent = '';
      message.className = 'msg';
      return;
    }
    message.className = 'msg ' + (messageState.kind || '');
    message.textContent = messageState.errData
      ? I18N.errorMessage(messageState.errData)
      : t(messageState.key);
  }

  function row(label, value) {
    var r = el('div', 'row');
    r.appendChild(el('span', null, label));
    r.appendChild(el('b', null, value));
    return r;
  }

  function renderBooking() {
    if (!view) return;
    var b = view.booking;
    var service = serviceById(b.serviceId);
    var start = b.time.split(':').map(Number);
    var end = minutesToTime(start[0] * 60 + start[1] + (Number(b.durationMinutes) || 60));
    details.textContent = '';
    details.appendChild(row(t('summary_date'), I18N.formatDate(b.date)));
    details.appendChild(row(t('summary_time'), b.time + '–' + end));
    if (service) details.appendChild(row(t('summary_service'), I18N.serviceName(service)));
    details.appendChild(row(t('summary_duration'), b.durationMinutes + ' ' + t('min')));
    details.appendChild(row(t('summary_price'), b.price + '₾'));
    deadlineNote.textContent = view.canCancel ? t('cancel_deadline', { deadline: I18N.formatDateTime(view.cancelDeadline) }) : '';
    bookingBox.hidden = false;
  }

  function updateWhatsApp() {
    var href = 'https://wa.me/' + WA_NUMBER + '?text=' + encodeURIComponent(t('wa_text'));
    document.querySelectorAll('.js-wa-link').forEach(function (a) { a.href = href; });
  }

  function forgetBooking() {
    try {
      var list = JSON.parse(window.localStorage.getItem(MY_BOOKINGS_KEY) || '[]');
      if (Array.isArray(list)) {
        window.localStorage.setItem(MY_BOOKINGS_KEY, JSON.stringify(list.filter(function (b) { return b && b.token !== token; })));
      }
    } catch (e) { /* приватный режим — не страшно */ }
  }

  function postJson(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json()
        .catch(function () { return {}; })
        .then(function (data) { return { ok: res.ok, status: res.status, data: data }; });
    });
  }

  function showInvalid() {
    loadingMsg.hidden = true;
    bookingBox.hidden = true;
    confirmBtn.hidden = true;
    setMessage({ kind: 'error', key: 'cancel_invalid' });
    againBtn.hidden = false;
  }

  function load() {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      showInvalid();
      return;
    }
    var servicesReq = fetch('/api/services')
      .then(function (res) { return res.ok ? res.json() : {}; })
      .then(function (data) { services = Array.isArray(data.services) ? data.services : []; })
      .catch(function () { services = []; });

    var lookupReq = postJson('/api/booking/lookup', { token: token });

    Promise.all([servicesReq, lookupReq])
      .then(function (results) {
        var result = results[1];
        loadingMsg.hidden = true;
        if (!result.ok) {
          if (result.status === 404) {
            forgetBooking();
            showInvalid();
          } else {
            setMessage({ kind: 'error', errData: result.data });
          }
          return;
        }
        view = result.data;
        renderBooking();
        if (view.canCancel) {
          confirmBtn.hidden = false;
        } else {
          setMessage({ kind: 'error', key: 'cancel_too_late' });
          waBtn.hidden = false;
        }
      })
      .catch(function () {
        loadingMsg.hidden = true;
        setMessage({ kind: 'error', key: 'err_connection' });
      });
  }

  confirmBtn.addEventListener('click', function () {
    if (cancelling) return;
    cancelling = true;
    confirmBtn.disabled = true;
    confirmBtn.textContent = t('cancel_cancelling');

    postJson('/api/booking/cancel', { token: token })
      .then(function (result) {
        cancelling = false;
        confirmBtn.disabled = false;
        confirmBtn.textContent = t('cancel_confirm');
        if (result.ok) {
          forgetBooking();
          confirmBtn.hidden = true;
          bookingBox.hidden = true;
          setMessage({ kind: 'success', key: 'cancel_done' });
          againBtn.hidden = false;
          return;
        }
        if (result.data && result.data.code === 'too_late') {
          confirmBtn.hidden = true;
          waBtn.hidden = false;
          setMessage({ kind: 'error', key: 'cancel_too_late' });
        } else if (result.status === 404) {
          forgetBooking();
          showInvalid();
        } else {
          setMessage({ kind: 'error', errData: result.data });
        }
      })
      .catch(function () {
        cancelling = false;
        confirmBtn.disabled = false;
        confirmBtn.textContent = t('cancel_confirm');
        setMessage({ kind: 'error', key: 'err_connection' });
      });
  });

  function updateTitle() {
    document.title = t('cancel_meta_title');
  }

  I18N.onChange(function () {
    updateTitle();
    updateWhatsApp();
    renderBooking();
    renderMessage();
    if (cancelling) confirmBtn.textContent = t('cancel_cancelling');
  });

  // Если в этой же вкладке открыли другую ссылку отмены (поменялась только
  // часть после «#»), браузер страницу не перезагружает — делаем это сами,
  // иначе на экране осталась бы прежняя запись.
  window.addEventListener('hashchange', function () { window.location.reload(); });

  I18N.apply();
  updateTitle();
  updateWhatsApp();
  load();
})();
