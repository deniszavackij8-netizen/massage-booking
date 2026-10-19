// Вход в админку: пароль → код из Telegram → переход в админку.
(function () {
  'use strict';
  var passForm = document.getElementById('passForm');
  var codeForm = document.getElementById('codeForm');
  var msg = document.getElementById('msg');
  var challenge = null;

  function show(text, kind) {
    msg.textContent = text || '';
    msg.className = 'msg' + (kind ? ' ' + kind : '');
  }

  function post(url, body) {
    return fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ss-admin' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { ok: res.ok, status: res.status, data: data };
      });
    });
  }

  function toPassword() {
    challenge = null;
    codeForm.hidden = true;
    passForm.hidden = false;
    document.getElementById('code').value = '';
    document.getElementById('password').focus();
  }

  passForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var input = document.getElementById('password');
    var btn = document.getElementById('passBtn');
    if (!input.value) { show('Введите пароль.', 'error'); return; }
    btn.disabled = true;
    show('');
    post('/api/admin/login', { password: input.value })
      .then(function (r) {
        btn.disabled = false;
        input.value = '';
        if (r.ok && r.data.step === 'code') {
          challenge = r.data.challenge;
          passForm.hidden = true;
          codeForm.hidden = false;
          document.getElementById('code').focus();
          show('Код отправлен в Telegram.', 'ok');
        } else if (r.ok && r.data.success) {
          location.replace('/admin/');
        } else {
          show((r.data && r.data.error) || 'Не удалось войти.', 'error');
        }
      })
      .catch(function () { btn.disabled = false; show('Нет связи с сервером. Попробуйте ещё раз.', 'error'); });
  });

  document.getElementById('code').addEventListener('input', function () {
    this.value = this.value.replace(/\D/g, '').slice(0, 6);
  });

  codeForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var input = document.getElementById('code');
    var btn = document.getElementById('codeBtn');
    if (!/^\d{6}$/.test(input.value)) { show('Введите 6 цифр из Telegram.', 'error'); return; }
    btn.disabled = true;
    post('/api/admin/verify', { challenge: challenge, code: input.value })
      .then(function (r) {
        btn.disabled = false;
        if (r.ok && r.data.success) {
          show('Готово!', 'ok');
          location.replace('/admin/');
          return;
        }
        input.value = '';
        show((r.data && r.data.error) || 'Неверный код.', 'error');
        if (r.status === 410 || r.status === 429) toPassword();
      })
      .catch(function () { btn.disabled = false; show('Нет связи с сервером. Попробуйте ещё раз.', 'error'); });
  });

  document.getElementById('backBtn').addEventListener('click', function () { show(''); toPassword(); });
})();
