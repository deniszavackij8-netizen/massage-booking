// Админ-панель: список записей, отмена, блокировка времени.
// Все данные клиентов выводятся через textContent — даже если в имени
// окажется HTML-код, он покажется как обычный текст и не выполнится.
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var tableEl = $('bookingsTable');
  var bodyEl = $('bookingsBody');
  var loadingEl = $('loadingMsg');
  var statRow = $('statRow');
  var filterDate = $('filterDate');
  var allBookings = [];

  var LANG_LABEL = { ru: 'RU', en: 'EN', ka: 'KA' };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  // «Сегодня» — по времени салона (Батуми), а не по UTC.
  function salonToday() {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tbilisi', year: 'numeric', month: '2-digit', day: '2-digit' })
        .format(new Date());
    } catch (e) {
      return new Date().toISOString().slice(0, 10);
    }
  }

  function fmtCreated(iso) {
    try {
      return new Date(iso).toLocaleString('ru-RU', {
        timeZone: 'Asia/Tbilisi', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
      });
    } catch (e) {
      return iso;
    }
  }

  function stat(value, label) {
    var box = el('div', 'stat');
    box.appendChild(el('b', null, String(value)));
    box.appendChild(el('span', null, label));
    return box;
  }

  function renderStats(list) {
    var today = salonToday();
    var todayCount = list.filter(function (b) { return b.date === today; }).length;
    var upcoming = list.filter(function (b) { return b.date >= today; }).length;
    statRow.textContent = '';
    statRow.appendChild(stat(todayCount, 'Сегодня (' + today + ')'));
    statRow.appendChild(stat(upcoming, 'Предстоящих'));
    statRow.appendChild(stat(list.length, 'Всего записей'));
  }

  function renderTable() {
    var date = filterDate.value;
    var list = date ? allBookings.filter(function (b) { return b.date === date; }) : allBookings;

    if (!list.length) {
      tableEl.hidden = true;
      loadingEl.hidden = false;
      loadingEl.textContent = 'Записей нет.';
      loadingEl.className = 'empty';
      return;
    }

    bodyEl.textContent = '';
    list.forEach(function (b) {
      var tr = document.createElement('tr');

      tr.appendChild(el('td', null, b.date));
      tr.appendChild(el('td', null, b.time));

      var serviceTd = el('td');
      if (b.serviceName) {
        serviceTd.appendChild(document.createTextNode(b.serviceName));
        serviceTd.appendChild(document.createElement('br'));
        var meta = el('span', 'muted-small', (b.durationMinutes || '') + ' мин' + (b.price ? ', ' + b.price + '₾' : ''));
        serviceTd.appendChild(meta);
      } else {
        serviceTd.appendChild(el('span', 'muted-small', '—'));
      }
      tr.appendChild(serviceTd);

      tr.appendChild(el('td', null, b.name));

      var phoneTd = el('td');
      var phoneLink = el('a', 'phone-link', b.phone);
      phoneLink.href = 'tel:' + String(b.phone || '').replace(/[^\d+]/g, '');
      phoneTd.appendChild(phoneLink);
      tr.appendChild(phoneTd);

      tr.appendChild(el('td', null, LANG_LABEL[b.lang] || 'RU'));
      tr.appendChild(el('td', null, fmtCreated(b.createdAt)));

      var actionTd = el('td');
      var del = el('button', 'del-btn', 'Отменить');
      del.type = 'button';
      del.addEventListener('click', function () { deleteBooking(b.id); });
      actionTd.appendChild(del);
      tr.appendChild(actionTd);

      bodyEl.appendChild(tr);
    });

    tableEl.hidden = false;
    loadingEl.hidden = true;
  }

  function loadBookings() {
    loadingEl.hidden = false;
    loadingEl.className = 'loading';
    loadingEl.textContent = 'Загрузка записей…';
    tableEl.hidden = true;

    fetch('/api/admin/bookings')
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        allBookings = data.bookings || [];
        renderStats(allBookings);
        renderTable();
      })
      .catch(function (err) {
        loadingEl.className = 'error';
        loadingEl.textContent = 'Не удалось загрузить записи: ' + err.message;
      });
  }

  function deleteBooking(id) {
    if (!window.confirm('Отменить эту запись? Время снова станет свободным.')) return;

    fetch('/api/admin/bookings/' + encodeURIComponent(id), { method: 'DELETE' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function () { loadBookings(); })
      .catch(function (err) { window.alert('Не удалось отменить запись: ' + err.message); });
  }

  $('refreshBtn').addEventListener('click', loadBookings);
  $('clearFilter').addEventListener('click', function () {
    filterDate.value = '';
    renderTable();
  });
  filterDate.addEventListener('change', renderTable);

  loadBookings();

  // ---------- блокировка времени ----------
  var blockDate = $('blockDate');
  var blockTime = $('blockTime');
  var blockWholeDay = $('blockWholeDay');
  var blockNote = $('blockNote');
  var addBlockBtn = $('addBlockBtn');
  var blockMsg = $('blockMsg');
  var blockList = $('blockList');

  blockDate.value = salonToday();

  // Часы берём с сервера — так список всегда совпадает с расписанием сайта.
  fetch('/api/services')
    .then(function (res) { return res.json(); })
    .then(function (data) {
      (data.slots || []).forEach(function (time) {
        var opt = document.createElement('option');
        opt.value = time;
        opt.textContent = time;
        blockTime.appendChild(opt);
      });
    })
    .catch(function () {
      blockMsg.textContent = 'Не удалось загрузить список часов — обновите страницу.';
      blockMsg.className = 'block-msg error';
    });

  blockWholeDay.addEventListener('change', function () {
    blockTime.disabled = blockWholeDay.checked;
  });

  function blockRow(b) {
    var row = el('div', 'block-row');
    var info = el('div', 'block-info');
    info.appendChild(el('b', null, b.date));
    info.appendChild(document.createTextNode(b.time === null ? ' — весь день' : ' в ' + b.time));
    if (b.note) info.appendChild(el('div', 'block-note', b.note));
    row.appendChild(info);
    var btn = el('button', 'del-btn', 'Снять');
    btn.type = 'button';
    btn.addEventListener('click', function () { deleteBlock(b.id); });
    row.appendChild(btn);
    return row;
  }

  function loadBlocks() {
    fetch('/api/admin/blocks')
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var blocks = data.blocks || [];
        blockList.textContent = '';
        if (!blocks.length) {
          blockList.appendChild(el('p', 'empty block-empty', 'Активных блокировок нет.'));
          return;
        }
        blocks.forEach(function (b) { blockList.appendChild(blockRow(b)); });
      })
      .catch(function (err) {
        blockList.textContent = '';
        blockList.appendChild(el('p', 'error block-empty', 'Не удалось загрузить блокировки: ' + err.message));
      });
  }

  function deleteBlock(id) {
    if (!window.confirm('Снять эту блокировку?')) return;
    fetch('/api/admin/blocks/' + encodeURIComponent(id), { method: 'DELETE' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function () { loadBlocks(); })
      .catch(function (err) { window.alert('Не удалось снять блокировку: ' + err.message); });
  }

  addBlockBtn.addEventListener('click', function () {
    blockMsg.textContent = '';
    blockMsg.className = 'block-msg';

    if (!blockDate.value) {
      blockMsg.textContent = 'Укажите дату.';
      blockMsg.classList.add('error');
      return;
    }

    var payload = {
      date: blockDate.value,
      time: blockWholeDay.checked ? null : blockTime.value,
      note: blockNote.value.trim()
    };

    addBlockBtn.disabled = true;
    addBlockBtn.textContent = 'Блокируем…';

    fetch('/api/admin/blocks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        return res.json()
          .catch(function () { return {}; })
          .then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (result) {
        if (!result.ok) {
          blockMsg.textContent = result.data.error || 'Не удалось заблокировать.';
          blockMsg.classList.add('error');
        } else {
          blockMsg.textContent = 'Готово.';
          blockMsg.classList.add('success');
          blockNote.value = '';
          loadBlocks();
        }
      })
      .catch(function () {
        blockMsg.textContent = 'Ошибка соединения с сервером.';
        blockMsg.classList.add('error');
      })
      .finally(function () {
        addBlockBtn.disabled = false;
        addBlockBtn.textContent = 'Заблокировать';
      });
  });

  loadBlocks();
})();
