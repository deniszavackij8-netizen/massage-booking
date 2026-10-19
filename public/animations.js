// Анимации сайта на Anime.js v4 (библиотека: /vendor/anime-4.5.0.min.js).
//
// Всё здесь — только «украшение»: если библиотека не загрузилась или в
// браузере что-то не поддерживается, сайт работает как обычно, просто без
// движения. Анимации спокойные, под настроение массажного салона.
// Тем, у кого в системе включено «уменьшить движение», показываем только
// мягкое появление (без сдвигов, пружин и повторяющихся эффектов).
(function () {
  'use strict';

  var root = document.documentElement;
  var A = window.anime;

  function showEverything() {
    root.classList.remove('motion');
  }

  if (!A || typeof A.animate !== 'function' || typeof A.stagger !== 'function') {
    showEverything();
    return;
  }
  window.SS_MOTION = true;

  var animate = A.animate;
  var stagger = A.stagger;
  // motion-init.js мог уже снять класс (анимации загрузились слишком поздно) —
  // тогда страница уже видна и «входную» анимацию не показываем.
  var introAllowed = root.classList.contains('motion');
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function $(id) { return document.getElementById(id); }
  function toArray(list) { return Array.prototype.slice.call(list || []).filter(Boolean); }
  function dist(px) { return reduce ? 0 : px; }

  // Плавное появление группы элементов: снизу вверх, по очереди.
  // Перед стартом выключаем CSS-переходы (иначе они «тормозят» анимацию),
  // после окончания убираем все временные стили — элемент снова такой,
  // каким его описывает CSS (наведение мышью и т.п. работают как раньше).
  function reveal(elements, opts) {
    var els = toArray(elements);
    if (!els.length) return null;
    opts = opts || {};
    els.forEach(function (el) {
      el.classList.remove('m-in', 'm-reveal');
      el.style.opacity = '0';
      el.style.transition = 'none';
    });
    var params = {
      opacity: [0, 1],
      duration: opts.duration || 900,
      delay: stagger(opts.stagger == null ? 90 : opts.stagger, { start: opts.delay || 0 }),
      ease: opts.ease || 'outQuart',
      onComplete: function () {
        els.forEach(function (el) {
          el.style.opacity = '';
          el.style.transform = '';
          el.style.transition = '';
        });
        if (opts.onComplete) opts.onComplete();
      }
    };
    var y = dist(opts.y == null ? 24 : opts.y);
    if (y) params.translateY = [y, 0];
    if (opts.scale && !reduce) params.scale = [opts.scale, 1];
    return animate(els, params);
  }

  // Короткий «отклик» на нажатие — кнопка чуть пружинит.
  function pop(el, from) {
    if (reduce || !el) return;
    el.style.transition = 'none';
    animate(el, {
      scale: [from || 0.9, 1],
      duration: 600,
      ease: A.spring ? A.spring({ bounce: 0.55, duration: 450 }) : 'outBack(2)',
      onComplete: function () { el.style.transform = ''; el.style.transition = ''; }
    });
  }

  // ---------------------------------------------------------------------
  // 1. Первый экран: заголовок, текст, кнопки и видео появляются по очереди
  // ---------------------------------------------------------------------
  var hero = document.querySelector('.hero');
  if (introAllowed && hero) {
    reveal(hero.querySelectorAll('.eyebrow.m-in, h1.m-in, .lead.m-in'), { y: 26, stagger: 140, delay: 80, duration: 1000 });
    reveal(hero.querySelectorAll('.hero-ctas .m-in'), { y: 18, stagger: 110, delay: 480, duration: 900 });

    var art = hero.querySelector('.hero-art.m-in');
    if (art) {
      art.classList.remove('m-in');
      var artParams = {
        opacity: [0, 1],
        duration: 1600,
        ease: 'outCubic',
        onComplete: function () { art.style.opacity = ''; art.style.clipPath = ''; art.style.transform = ''; }
      };
      if (!reduce) {
        // Видео «раскрывается» из скруглённого окна чуть меньшего размера.
        artParams.clipPath = ['inset(7% 7% 7% 7% round 26px)', 'inset(0% 0% 0% 0% round 26px)'];
        artParams.scale = [0.97, 1];
      }
      animate(art, artParams);
    }

    // Курсив в заголовке («онлайн за минуту») мягко «проявляется» чуть позже.
    var em = hero.querySelector('h1 em');
    if (em && !reduce) {
      animate(em, { opacity: [0.15, 1], duration: 1400, delay: 520, ease: 'outSine', onComplete: function () { em.style.opacity = ''; } });
    }
  }

  // Лёгкий параллакс видео при прокрутке: картинка движется чуть медленнее страницы.
  var video = $('heroVideo');
  if (video && hero && !reduce && typeof A.onScroll === 'function') {
    animate(video, {
      translateY: ['-3%', '6%'],
      scale: [1.09, 1.09],
      ease: 'linear',
      autoplay: A.onScroll({ target: hero, enter: 'top top', leave: 'top bottom', sync: true })
    });
  }

  // Логотип «дышит» — медленно, как спокойное дыхание.
  if (!reduce) {
    animate('.logo-mark', { scale: [1, 1.12], duration: 2800, ease: 'inOutSine', alternate: true, loop: true });
  }

  // ---------------------------------------------------------------------
  // 2. Заголовки разделов и форма появляются, когда до них докрутили
  // ---------------------------------------------------------------------
  var revealObserver = null;
  if ('IntersectionObserver' in window) {
    revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        revealObserver.unobserve(entry.target);
        var el = entry.target;
        if (el._ssReveal) { el._ssReveal(); return; }
        if (el.classList.contains('section-head')) {
          el.classList.remove('m-reveal');
          reveal(el.children, { y: 22, stagger: 110 });
        } else {
          reveal([el], { y: 30, duration: 1000 });
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
  }

  var toReveal = toArray(document.querySelectorAll('.m-reveal'));
  if (!introAllowed || !revealObserver) {
    toReveal.forEach(function (el) { el.classList.remove('m-reveal'); });
  } else {
    toReveal.forEach(function (el) { revealObserver.observe(el); });
  }

  // ---------------------------------------------------------------------
  // 3. Карточки услуг (их рисует app.js после загрузки списка)
  // ---------------------------------------------------------------------
  var grid = $('servicesGrid');
  var cardsShownOnce = false;

  function inViewport(el) {
    var r = el.getBoundingClientRect();
    return r.top < (window.innerHeight || 800) * 0.92 && r.bottom > 0;
  }

  function animateCards() {
    var cards = toArray(grid.querySelectorAll('.service-card'));
    if (!cards.length) return;

    if (cardsShownOnce) {
      // Перерисовка (например, смена языка) — только короткое мягкое появление.
      reveal(cards, { y: 0, stagger: 25, duration: 450 });
      return;
    }
    cardsShownOnce = true;
    var run = function () { reveal(cards, { y: 40, scale: 0.96, stagger: 85, duration: 1000 }); };

    if (!introAllowed || !revealObserver || inViewport(grid)) {
      run();
    } else {
      // Прячем сразу (до отрисовки кадра), покажем при прокрутке к услугам.
      cards.forEach(function (c) { c.style.opacity = '0'; });
      grid._ssReveal = run;
      revealObserver.observe(grid);
    }
  }

  if (grid && 'MutationObserver' in window) {
    new MutationObserver(function (mutations) {
      var added = mutations.some(function (m) {
        return toArray(m.addedNodes).some(function (n) { return n.classList && n.classList.contains('service-card'); });
      });
      if (added) animateCards();
    }).observe(grid, { childList: true });
    animateCards(); // если карточки уже успели появиться
  }

  // ---------------------------------------------------------------------
  // 4. Форма записи: длительность, свободное время, итог, ошибки
  // ---------------------------------------------------------------------
  function onAdded(container, selector, handler) {
    if (!container || !('MutationObserver' in window)) return;
    new MutationObserver(function (mutations) {
      var added = [];
      mutations.forEach(function (m) {
        toArray(m.addedNodes).forEach(function (n) {
          if (n.nodeType === 1 && n.matches(selector)) added.push(n);
        });
      });
      if (added.length) handler(added);
    }).observe(container, { childList: true });
  }

  // Свободное время «высыпается» по очереди.
  onAdded($('slotsGrid'), '.slot-btn', function (btns) {
    reveal(btns, { y: 10, scale: 0.88, stagger: 28, duration: 520, ease: 'outBack(1.3)' });
  });
  onAdded($('durationOptions'), '.duration-opt', function (btns) {
    reveal(btns, { y: 8, scale: 0.92, stagger: 70, duration: 500, ease: 'outBack(1.3)' });
  });

  // Выбор времени и длительности — кнопка мягко пружинит.
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var btn = t.closest('.slot-btn:not(:disabled), .duration-opt, #copyAddressBtn, .lang-switch button');
    if (btn) pop(btn, 0.9);
  });

  // Блок «Проверьте запись» выезжает, когда всё выбрано.
  function onShown(el, handler) {
    if (!el || !('MutationObserver' in window)) return;
    var wasHidden = el.hidden;
    new MutationObserver(function () {
      if (wasHidden && !el.hidden) handler(el);
      wasHidden = el.hidden;
    }).observe(el, { attributes: true, attributeFilter: ['hidden'] });
  }

  onShown($('bookingSummary'), function (el) { reveal([el], { y: 12, duration: 550 }); });
  onShown($('durationField'), function (el) { reveal([el], { y: 10, duration: 500 }); });

  // Ошибка — сообщение коротко «встряхивается», чтобы его заметили.
  var statusEl = $('bookingStatus');
  if (statusEl && 'MutationObserver' in window) {
    new MutationObserver(function () {
      if (!statusEl.classList.contains('error') || !statusEl.textContent) return;
      if (reduce) { reveal([statusEl], { y: 0, duration: 400 }); return; }
      animate(statusEl, {
        translateX: [0, -8, 7, -5, 3, 0],
        duration: 520,
        ease: 'outSine',
        onComplete: function () { statusEl.style.transform = ''; }
      });
    }).observe(statusEl, { childList: true, characterData: true, subtree: true });
  }

  // ---------------------------------------------------------------------
  // 5. «Вы записаны!»: галочка рисуется, значок пружинит, вокруг — волна
  // ---------------------------------------------------------------------
  onShown($('bookingSuccess'), function (panel) {
    var badge = panel.querySelector('.success-badge');
    var path = badge && badge.querySelector('path');
    var rest = toArray(panel.children).filter(function (c) { return c !== badge; });

    if (badge) {
      badge.style.transition = 'none';
      animate(badge, {
        scale: reduce ? [1, 1] : [0, 1],
        opacity: [0, 1],
        duration: 900,
        ease: reduce ? 'outQuad' : (A.spring ? A.spring({ bounce: 0.5, duration: 700 }) : 'outBack(2)'),
        onComplete: function () { badge.style.transform = ''; badge.style.opacity = ''; badge.style.transition = ''; }
      });
      if (!reduce) {
        animate(badge, {
          boxShadow: ['0 0 0 0px rgba(79,138,92,0.45)', '0 0 0 22px rgba(79,138,92,0)'],
          duration: 1400,
          delay: 350,
          ease: 'outQuad',
          onComplete: function () { badge.style.boxShadow = ''; }
        });
      }
    }
    if (path && !reduce && A.svg && typeof A.svg.createDrawable === 'function') {
      animate(A.svg.createDrawable(path), { draw: ['0 0', '0 1'], duration: 650, delay: 300, ease: 'inOutQuad' });
    }
    reveal(rest, { y: 16, stagger: 80, delay: 250, duration: 800 });
  });

  // «Мои записи» (если на устройстве уже есть записи)
  onShown($('myBookings'), function (el) { reveal([el], { y: 14, duration: 700 }); });

  // ---------------------------------------------------------------------
  // 6. Кнопка WhatsApp: появляется «пружинкой» и изредка тихо машет
  // ---------------------------------------------------------------------
  var wa = document.querySelector('.wa-float');
  if (wa) {
    wa.classList.remove('m-in');
    if (!introAllowed) {
      // страница уже показана без анимаций
    } else if (reduce) {
      reveal([wa], { y: 0, delay: 600, duration: 600 });
    } else {
      wa.style.transition = 'none';
      animate(wa, {
        opacity: [0, 1],
        scale: [0, 1],
        rotate: [-35, 0],
        delay: 1100,
        duration: 1000,
        ease: A.spring ? A.spring({ bounce: 0.5, duration: 800 }) : 'outBack(2)',
        onComplete: function () { wa.style.transform = ''; wa.style.opacity = ''; wa.style.transition = ''; }
      });
      // Три раза за визит, с паузами, чтобы не раздражать.
      var nudges = 0;
      var nudgeTimer = setInterval(function () {
        if (nudges >= 3) { clearInterval(nudgeTimer); return; }
        if (document.hidden || wa.matches(':hover')) return;
        nudges += 1;
        wa.style.transition = 'none';
        animate(wa, {
          rotate: [0, -14, 11, -7, 4, 0],
          scale: [1, 1.08, 1],
          duration: 1100,
          ease: 'inOutSine',
          onComplete: function () { wa.style.transform = ''; wa.style.transition = ''; }
        });
      }, 14000);
    }
  }
})();
