// Живые 3D-предметы на странице.
//
// Как это устроено:
//  • Сначала у каждого предмета стоит обычная картинка (её видно сразу).
//  • Когда страница полностью показана и браузер свободен, подгружается
//    библиотека Three.js и картинки незаметно сменяются живыми сценами.
//  • Рисует всё один-единственный WebGL-«художник»: по очереди рисует каждый
//    видимый предмет и копирует кадр в canvas этого предмета. Так на странице
//    один WebGL-контекст, а предметы прокручиваются вместе со страницей без
//    отставания.
//  • Предметы вне экрана не рисуются; на скрытой вкладке не рисуется ничего.
//  • Если устройство не тянет — качество снижается, а если совсем тяжело,
//    сцены замирают (остаётся красивая статичная картинка).
//  • Без 3D (старый браузер, «уменьшить движение», экономия трафика,
//    программная графика без видеокарты) — остаются картинки.
const root = document.documentElement;
const params = new URLSearchParams(location.search);
const FORCE = params.get('force3d') === '1';         // для автотестов
const GOVERNOR = !FORCE || params.get('gov') === '1';
const state = window.SS3D = {
  calm: false,
  status: 'waiting', tier: null, reason: null, frames: 0, renders: {}, live: 0, scale: 1, static: false, lastFrameMs: 0
};

function off(reason) {
  state.status = 'off';
  state.reason = reason;
  root.classList.add('no-3d');
}

function webglInfo() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return { name };
  } catch (e) {
    return null;
  }
}

const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const saveData = !!(navigator.connection && navigator.connection.saveData);

// «Уменьшить движение» (в Windows это выключенные «Эффекты анимации»):
// 3D показываем, но в спокойном режиме — предметы сами не двигаются,
// а только откликаются на мышь/наведение (движение по действию человека).
const CALM = reduce && params.get('calm') !== '0';
state.calm = CALM;
if (saveData && !FORCE) {
  off('save-data');
} else {
  const info = webglInfo();
  if (!info) off('no-webgl2');
  else if (/swiftshader|llvmpipe|software|basic render/i.test(info.name) && !FORCE) off('software-gpu');
  else {
    const go = () => {
      const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 200));
      idle(() => start(info).catch((err) => { console.warn('3D отключено:', err && err.message); off('error'); }), { timeout: 2500 });
    };
    if (document.readyState === 'complete') go();
    else window.addEventListener('load', go, { once: true });
  }
}

async function start(info) {
  state.status = 'loading';
  const { THREE, createKit, buildScene } = await import('./js3d/objects.js');

  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 8;
  const tier = (coarse || cores <= 4 || memory <= 4 || /mali|adreno [1-5]|powervr|intel.*hd/i.test(info.name)) ? 'low' : 'high';
  state.tier = tier;
  const maxDpr = tier === 'high' ? 2 : 1.5;

  const glCanvas = document.createElement('canvas');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, alpha: true, powerPreference: 'default', preserveDrawingBuffer: false });
  } catch (e) {
    off('renderer-failed');
    return;
  }
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false;
  const kit = createKit(renderer, tier);
  let raf = 0;
  let glW = 0, glH = 0;
  let workSamples = [];
  let verySlow = 0;
  let qualityScale = 1;

  let lost = false;
  glCanvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    lost = true;
    slots.forEach((s) => s.el.classList.remove('is-live'));
    off('context-lost');
  });

  // ---------------------------------------------------------------------
  // «Места» для предметов: элементы с атрибутом data-3d
  // ---------------------------------------------------------------------
  const slots = new Map();
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      const s = slots.get(e.target);
      if (!s) return;
      s.visible = e.isIntersecting;
      if (s.visible) { s.dirty = true; wake(); }
    });
  }, { rootMargin: '40px 0px' });
  const ro = new ResizeObserver((entries) => {
    entries.forEach((e) => {
      const s = slots.get(e.target);
      if (!s) return;
      s.cssW = e.contentRect.width;
      s.cssH = e.contentRect.height;
      s.dirty = true;
    });
    wake();
  });

  function addSlot(el) {
    if (slots.has(el) || !el.isConnected) return;
    const kind = el.getAttribute('data-3d');
    const canvas = document.createElement('canvas');
    canvas.className = 'obj-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    el.appendChild(canvas);
    const s = {
      el, kind, canvas, ctx: canvas.getContext('2d'), scene: null, visible: false, hover: false,
      cssW: el.clientWidth, cssH: el.clientHeight, dirty: true, lastT: null, lastDraw: 0, rendered: false
    };
    slots.set(el, s);
    io.observe(el);
    ro.observe(el);
    const card = el.closest('.service-card');
    if (card) {
      const on = () => { s.hover = true; wake(); };
      const offH = () => { s.hover = false; wake(); };
      card.addEventListener('pointerenter', on);
      card.addEventListener('pointerleave', offH);
      card.addEventListener('focusin', on);
      card.addEventListener('focusout', offH);
    }
    if (kind === 'stack') s.restart = true;
  }

  function removeSlot(el) {
    const s = slots.get(el);
    if (!s) return;
    io.unobserve(el);
    ro.unobserve(el);
    slots.delete(el);
  }

  document.querySelectorAll('[data-3d]').forEach(addSlot);
  // Карточки услуг рисует app.js (и перерисовывает при смене языка).
  new MutationObserver((muts) => {
    muts.forEach((m) => {
      m.addedNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        if (n.hasAttribute('data-3d')) addSlot(n);
        n.querySelectorAll && n.querySelectorAll('[data-3d]').forEach(addSlot);
      });
      m.removedNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        if (n.hasAttribute('data-3d')) removeSlot(n);
        n.querySelectorAll && n.querySelectorAll('[data-3d]').forEach(removeSlot);
      });
    });
  }).observe(document.body, { childList: true, subtree: true });

  // «Вы записаны»: пирамидка собирается заново при каждом показе.
  const success = document.getElementById('bookingSuccess');
  if (success) {
    new MutationObserver(() => {
      if (!success.hidden) {
        const s = [...slots.values()].find((x) => x.kind === 'stack');
        if (s) { s.restart = true; s.dirty = true; wake(); }
      }
    }).observe(success, { attributes: true, attributeFilter: ['hidden'] });
  }

  // ---------------------------------------------------------------------
  // Курсор и наклон телефона (для натюрморта на первом экране)
  // ---------------------------------------------------------------------
  let pointer = null;
  let lastPointerAt = 0;
  const heroEl = document.querySelector('[data-3d="hero"]');
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || !heroEl) return;
    const r = heroEl.getBoundingClientRect();
    pointer = {
      x: Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2))),
      y: Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (window.innerHeight / 2)))
    };
    lastPointerAt = performance.now();
    if (CALM) wake();
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => { pointer = null; lastPointerAt = performance.now(); if (CALM) wake(); });

  const tiltBtn = document.getElementById('tiltBtn');
  if (tiltBtn && coarse && 'DeviceOrientationEvent' in window) {
    tiltBtn.hidden = false;
    tiltBtn.addEventListener('click', async () => {
      try {
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
          const res = await DeviceOrientationEvent.requestPermission();
          if (res !== 'granted') { tiltBtn.hidden = true; return; }
        }
      } catch (e) { tiltBtn.hidden = true; return; }
      tiltBtn.hidden = true;
      window.addEventListener('deviceorientation', (ev) => {
        if (ev.gamma == null) return;
        pointer = { x: Math.max(-1, Math.min(1, ev.gamma / 28)), y: Math.max(-1, Math.min(1, ((ev.beta || 45) - 45) / 30)) };
        lastPointerAt = performance.now();
        if (CALM) wake();
      });
    });
  }

  // ---------------------------------------------------------------------
  // Камень, катящийся вдоль страницы (широкий экран)
  // ---------------------------------------------------------------------
  let roller = null;
  const servicesSec = document.getElementById('services');
  const bookingSec = document.getElementById('booking');
  function setupRoller() {
    const wide = window.innerWidth >= 1400 && !coarse && !CALM;
    if (wide && !roller && servicesSec && bookingSec) {
      const el = document.createElement('div');
      el.className = 'roller obj';
      el.setAttribute('data-3d', 'roller');
      el.setAttribute('aria-hidden', 'true');
      document.body.appendChild(el);
      roller = el;
    } else if (!wide && roller) {
      roller.remove();
      roller = null;
    }
    placeRoller();
  }
  function placeRoller() {
    if (!roller) return;
    const s = slots.get(roller);
    const a = servicesSec.getBoundingClientRect();
    const b = bookingSec.getBoundingClientRect();
    const vh = window.innerHeight;
    const startY = a.top + window.scrollY, endY = b.bottom + window.scrollY;
    const span = Math.max(1, endY - startY - vh * 0.6);
    const p = (window.scrollY + vh * 0.3 - startY) / span;
    const on = p > -0.05 && p < 1.05;
    roller.classList.toggle('on', on);
    const size = 86;
    const y = vh * 0.16 + Math.max(0, Math.min(1, p)) * (vh * 0.68 - size);
    const gutter = (window.innerWidth - 1180) / 2;
    const x = window.innerWidth - gutter / 2 - size / 2;
    roller.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    if (s) {
      s.roll = (Math.max(0, Math.min(1, p)) * (vh * 0.68 - size)) / (size / 2) + window.scrollY / 400;
      s.dirty = true;
    }
    wake();
  }
  setupRoller();
  window.addEventListener('scroll', placeRoller, { passive: true });
  window.addEventListener('resize', setupRoller);

  // ---------------------------------------------------------------------
  // Отрисовка
  // ---------------------------------------------------------------------
  function wake() {
    if (!raf && !lost && !document.hidden) raf = requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { slots.forEach((s) => { s.lastT = null; }); wake(); } });

  function pixelSize(s) {
    let dpr = Math.min(window.devicePixelRatio || 1, maxDpr) * qualityScale;
    const cap = s.kind === 'hero' ? 1500 : 640;
    let w = Math.round(s.cssW * dpr), h = Math.round(s.cssH * dpr);
    const k = Math.min(1, cap / Math.max(w, h, 1));
    return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
  }

  // Какие предметы должны двигаться прямо сейчас
  function animated(s) {
    if (state.static) return false;
    switch (s.kind) {
      case 'hero': return !CALM || performance.now() - lastPointerAt < 2500;
      case 'roller': return false;
      case 'stack': return !(s.scene && s.scene.done) || s.restart;
      default: return tier === 'high' || s.hover;
    }
  }

  function frame(nowMs) {
    raf = 0;
    if (lost || document.hidden) return;
    const work0 = performance.now();
    const now = nowMs / 1000;
    let keepGoing = false;
    let renderedHero = false;

    // размер общего холста под самый большой видимый предмет
    let needW = 0, needH = 0;
    const todo = [];
    slots.forEach((s) => {
      if (!s.visible || !s.cssW || !s.cssH) return;
      const anim = animated(s);
      if (anim) keepGoing = true;
      if (!anim && !s.dirty && s.rendered) return;
      // не-главные предметы обновляются 30 раз в секунду — экономим батарею
      if (anim && s.kind !== 'hero' && s.kind !== 'stack' && s.rendered && nowMs - s.lastDraw < 31) return;
      const [w, h] = pixelSize(s);
      needW = Math.max(needW, w); needH = Math.max(needH, h);
      todo.push([s, w, h]);
    });
    if (todo.length) {
      if (needW > glW || needH > glH) {
        glW = Math.max(glW, needW); glH = Math.max(glH, needH);
        renderer.setSize(glW, glH, false);
      }
      todo.forEach(([s, w, h]) => {
        if (!s.scene) s.scene = buildScene(kit, s.kind);
        const dt = s.lastT == null ? 1 / 60 : Math.min(0.1, now - s.lastT);
        s.lastT = now;
        const input = { pointer: s.kind === 'hero' ? pointer : null, hover: s.hover, roll: s.roll || 0, restart: !!s.restart, calm: CALM };
        s.restart = false;
        const cam = s.scene.camera;
        if (cam.aspect !== w / h) { cam.aspect = w / h; cam.updateProjectionMatrix(); }
        s.scene.update(now, dt, input);
        renderer.setViewport(0, 0, w, h);
        renderer.setScissor(0, 0, w, h);
        renderer.setScissorTest(true);
        renderer.clear();
        renderer.render(s.scene.scene, cam);
        if (s.canvas.width !== w || s.canvas.height !== h) { s.canvas.width = w; s.canvas.height = h; }
        s.ctx.clearRect(0, 0, w, h);
        s.ctx.drawImage(glCanvas, 0, glH - h, w, h, 0, 0, w, h);
        s.dirty = false;
        s.lastDraw = nowMs;
        if (!s.rendered) {
          s.rendered = true;
          s.el.classList.add('is-live');
          state.live += 1;
        }
        state.renders[s.kind] = (state.renders[s.kind] || 0) + 1;
        if (s.kind === 'hero') renderedHero = true;
      });
      state.frames += 1;
    }
    const work = performance.now() - work0;
    state.lastFrameMs = work;
    state.status = 'running';

    // Следим, тянет ли устройство: если кадр стабильно дорогой — снижаем
    // качество, а если и это не помогло — останавливаем движение.
    if (renderedHero && GOVERNOR) {
      workSamples.push(work);
      // совсем медленное устройство: несколько кадров подряд дольше 80 мс —
      // сразу останавливаем движение, оставляя последний красивый кадр
      verySlow = work > 80 ? verySlow + 1 : 0;
      if (verySlow >= 5) {
        state.static = true;
        root.classList.add('static-3d');
        workSamples = [];
      }
      if (workSamples.length >= 24) {
        const avg = workSamples.reduce((a, b) => a + b, 0) / workSamples.length;
        workSamples = [];
        if (avg > 22) {
          if (qualityScale > 0.6) {
            qualityScale = Math.max(0.55, qualityScale * 0.75);
            state.scale = qualityScale;
            slots.forEach((s) => { s.dirty = true; });
          } else if (avg > 30) {
            state.static = true;
            root.classList.add('static-3d');
          }
        }
      }
    }
    if (keepGoing && !state.static) wake();
  }

  state.status = 'running';
  wake();
}
