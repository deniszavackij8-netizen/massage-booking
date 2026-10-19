// 3D-предметы массажного кабинета — всё построено прямо в коде (без чужих
// моделей и картинок): базальтовые камни, гималайская соль, свеча, полотенце,
// флакон масла, бамбук, орхидея, капли масла.
//
// Каждый «вид» — маленькая сцена со своей камерой и светом:
//   hero     — натюрморт первого экрана (парящая пирамидка камней и всё остальное)
//   stones, salt, candle, candles, towel, bottle, bamboo, orchid, ritual — предмет услуги
//   roller   — камень, который катится вдоль страницы
//   stack    — камни складываются в пирамидку («вы записаны»)
import * as THREE from '../vendor/three-r185/three.module.min.js';
import { RoomEnvironment } from '../vendor/three-r185/RoomEnvironment.js';

export { THREE };

// ---------------------------------------------------------------------------
// Шум (для формы камней и текстур): классический 3D-шум Перлина
// ---------------------------------------------------------------------------
const PERM = new Uint8Array(512);
(function () {
  const p = [];
  for (let i = 0; i < 256; i += 1) p.push(i);
  let s = 1337;
  for (let i = 255; i > 0; i -= 1) {
    s = (s * 16807) % 2147483647;
    const j = s % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i += 1) PERM[i] = p[i & 255];
})();
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;
function grad(h, x, y, z) {
  const u = (h & 15) < 8 ? x : y;
  const v = (h & 15) < 4 ? y : ((h & 15) === 12 || (h & 15) === 14 ? x : z);
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
}
export function noise3(x, y, z) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
  const u = fade(x), v = fade(y), w = fade(z);
  const A = PERM[X] + Y, AA = PERM[A] + Z, AB = PERM[A + 1] + Z;
  const B = PERM[X + 1] + Y, BA = PERM[B] + Z, BB = PERM[B + 1] + Z;
  return lerp(
    lerp(lerp(grad(PERM[AA], x, y, z), grad(PERM[BA], x - 1, y, z), u),
      lerp(grad(PERM[AB], x, y - 1, z), grad(PERM[BB], x - 1, y - 1, z), u), v),
    lerp(lerp(grad(PERM[AA + 1], x, y, z - 1), grad(PERM[BA + 1], x - 1, y, z - 1), u),
      lerp(grad(PERM[AB + 1], x, y - 1, z - 1), grad(PERM[BB + 1], x - 1, y - 1, z - 1), u), v),
    w);
}

// Детерминированный «случайный» генератор — у каждого предмета своя форма,
// одинаковая при каждом открытии сайта.
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

// Сглаженные нормали для геометрии без индексов (вершины на швах склеиваются
// по позиции) — поверхность камня получается гладкой, без граней.
function smoothNormals(geometry) {
  const pos = geometry.attributes.position;
  const acc = new Map();
  const key = (i) => `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));
    for (let k = 0; k < 3; k += 1) {
      const id = key(i + k);
      const v = acc.get(id) || new THREE.Vector3();
      v.add(n);
      acc.set(id, v);
    }
  }
  const normals = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i += 1) {
    const v = acc.get(key(i)).clone().normalize();
    normals[i * 3] = v.x; normals[i * 3 + 1] = v.y; normals[i * 3 + 2] = v.z;
  }
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return geometry;
}

// ---------------------------------------------------------------------------
// Текстуры, нарисованные в canvas
// ---------------------------------------------------------------------------
function canvasTexture(size, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  draw(ctx, size);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// Базальт: тёмный, с мелкими светлыми и тёплыми вкраплениями.
function basaltTexture() {
  return canvasTexture(256, (ctx, s) => {
    const img = ctx.createImageData(s, s);
    const r = rng(7);
    for (let y = 0; y < s; y += 1) {
      for (let x = 0; x < s; x += 1) {
        const n = noise3(x / 22, y / 22, 0.5) * 0.5 + noise3(x / 6, y / 6, 3.1) * 0.25;
        let v = 44 + n * 26;
        const speck = r();
        if (speck > 0.985) v += 40;
        else if (speck < 0.004) v -= 18;
        const i = (y * s + x) * 4;
        img.data[i] = v + 3; img.data[i + 1] = v; img.data[i + 2] = v - 2; img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

// Махровая ткань: мелкая рябь петелек (как карта рельефа).
function terryTexture() {
  const t = canvasTexture(256, (ctx, s) => {
    const img = ctx.createImageData(s, s);
    const r = rng(21);
    for (let i = 0; i < s * s; i += 1) {
      const x = i % s, y = Math.floor(i / s);
      const v = 128 + (r() - 0.5) * 120 + noise3(x / 3, y / 3, 9) * 60;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, false);
  t.repeat.set(6, 6);
  return t;
}

// Мягкое световое пятно (пламя, свечение, тень).
function radialTexture(stops) {
  return canvasTexture(128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    stops.forEach(([o, c]) => g.addColorStop(o, c));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

// ---------------------------------------------------------------------------
// Набор общих ресурсов (окружение, материалы, текстуры) — создаётся один раз
// ---------------------------------------------------------------------------
export function createKit(renderer, quality) {
  const high = quality === 'high';
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const tex = {
    basalt: basaltTexture(),
    terry: terryTexture(),
    shadow: radialTexture([[0, 'rgba(0,0,0,0.62)'], [0.45, 'rgba(0,0,0,0.28)'], [1, 'rgba(0,0,0,0)']]),
    flameCore: radialTexture([[0, 'rgba(255,252,236,1)'], [0.35, 'rgba(255,214,140,0.95)'], [0.7, 'rgba(255,150,60,0.35)'], [1, 'rgba(255,120,40,0)']]),
    flameGlow: radialTexture([[0, 'rgba(255,170,80,0.55)'], [0.4, 'rgba(255,140,60,0.18)'], [1, 'rgba(255,120,40,0)']])
  };

  const mat = {
    basalt: new THREE.MeshPhysicalMaterial({
      color: 0xb3aaa2, map: tex.basalt, roughness: 0.62, metalness: 0,
      clearcoat: 0.55, clearcoatRoughness: 0.32, envMapIntensity: 0.9
    }),
    salt: new THREE.MeshPhysicalMaterial({
      color: 0xf2a68c, roughness: 0.36, clearcoat: 0.4, clearcoatRoughness: 0.4, sheen: 0.5, sheenColor: 0xffc4ad,
      emissive: 0xff7b52, emissiveIntensity: 0.28, flatShading: true
    }),
    wax: new THREE.MeshPhysicalMaterial({ color: 0xf1e3cb, roughness: 0.55, sheen: 0.4, sheenColor: 0xfff1d8, emissive: 0xffa860, emissiveIntensity: 0.05 }),
    waxPool: new THREE.MeshStandardMaterial({ color: 0xf8dcae, roughness: 0.2, emissive: 0xffb36b, emissiveIntensity: 0.35 }),
    wick: new THREE.MeshStandardMaterial({ color: 0x1b1310, roughness: 0.9 }),
    towel: new THREE.MeshStandardMaterial({ color: 0xebe0cf, roughness: 1, bumpMap: tex.terry, bumpScale: 2.2 }),
    towelSage: new THREE.MeshStandardMaterial({ color: 0x9cae97, roughness: 1, bumpMap: tex.terry, bumpScale: 2.2 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x7a3f12, roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04,
      emissive: 0x3a1704, emissiveIntensity: 0.35, envMapIntensity: 1.6, specularIntensity: 1
    }),
    oil: new THREE.MeshStandardMaterial({ color: 0xc9781e, roughness: 0.15 }),
    drop: new THREE.MeshPhysicalMaterial({ color: 0xf0a63e, roughness: 0.04, clearcoat: 1, transparent: true, opacity: 0.92, emissive: 0x7a3a00, emissiveIntensity: 0.2 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x5b3b25, roughness: 0.7 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x1d1715, roughness: 0.55 }),
    label: new THREE.MeshStandardMaterial({ color: 0xefe4d2, roughness: 0.85 }),
    twine: new THREE.MeshStandardMaterial({ color: 0x9b7a52, roughness: 0.9 }),
    bamboo: new THREE.MeshPhysicalMaterial({ color: 0xc2ac64, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.3 }),
    bambooDark: new THREE.MeshPhysicalMaterial({ color: 0xa69048, roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.3 }),
    leaf: new THREE.MeshStandardMaterial({ color: 0x6f8c4b, roughness: 0.55, side: THREE.DoubleSide }),
    petal: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.5, sheen: 1, sheenColor: 0xffd9e8, sheenRoughness: 0.5, side: THREE.DoubleSide }),
    lip: new THREE.MeshPhysicalMaterial({ color: 0xb0305f, roughness: 0.45, sheen: 0.6, sheenColor: 0xff8fb8, side: THREE.DoubleSide }),
    column: new THREE.MeshStandardMaterial({ color: 0xf4d27a, roughness: 0.5 }),
    shadow: new THREE.MeshBasicMaterial({ map: tex.shadow, transparent: true, depthWrite: false })
  };

  return { THREE, envMap, tex, mat, high, renderer };
}

// ---------------------------------------------------------------------------
// Отдельные предметы
// ---------------------------------------------------------------------------
const stoneGeoCache = new Map();
function stoneGeometry(kit, seed) {
  const k = `${seed}-${kit.high}`;
  if (stoneGeoCache.has(k)) return stoneGeoCache.get(k);
  const g = new THREE.IcosahedronGeometry(1, kit.high ? 6 : 4);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const o = seed * 7.13;
  for (let i = 0; i < pos.count; i += 1) {
    v.fromBufferAttribute(pos, i).normalize();
    const n = noise3(v.x * 1.3 + o, v.y * 1.3, v.z * 1.3 - o) * 0.11 + noise3(v.x * 3.4 - o, v.y * 3.4, v.z * 3.4 + o) * 0.025 + noise3(v.x * 9 + o, v.y * 9, v.z * 9) * 0.006;
    v.multiplyScalar(1 + n);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.scale(1, 0.42, 0.8);
  smoothNormals(g);
  stoneGeoCache.set(k, g);
  return g;
}

function stone(kit, radius, seed) {
  const m = new THREE.Mesh(stoneGeometry(kit, seed), kit.mat.basalt);
  m.scale.setScalar(radius);
  m.userData.halfHeight = radius * 0.42;
  return m;
}

function contactShadow(kit, w, d, opacity = 0.75) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), kit.mat.shadow.clone());
  m.material.opacity = opacity;
  m.rotation.x = -Math.PI / 2;
  m.scale.set(w, d, 1);
  m.renderOrder = -1;
  return m;
}

// Пирамидка камней. Возвращает группу + список камней с их «опорными» высотами.
function stoneStack(kit, radii, seed = 3) {
  const g = new THREE.Group();
  const r = rng(seed);
  let y = 0;
  const stones = radii.map((rad, i) => {
    const s = stone(kit, rad, seed + i * 3);
    y += s.userData.halfHeight;
    s.position.set((r() - 0.5) * 0.12 * rad, y, (r() - 0.5) * 0.1 * rad);
    s.rotation.y = r() * Math.PI;
    s.rotation.z = (r() - 0.5) * 0.08;
    s.userData.baseY = y;
    y += s.userData.halfHeight - rad * 0.06;
    g.add(s);
    return s;
  });
  g.userData.stones = stones;
  g.userData.height = y;
  return g;
}

function saltCrystal(kit, size = 1, seed = 11) {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const pos = g.attributes.position;
  const r = rng(seed);
  const jit = new Map();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    v.fromBufferAttribute(pos, i);
    const k = `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
    if (!jit.has(k)) jit.set(k, 0.82 + r() * 0.3 + (r() > 0.85 ? 0.12 : 0));
    v.multiplyScalar(jit.get(k));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.scale(1, 1.15, 0.85);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, kit.mat.salt);
  m.scale.setScalar(size);
  m.rotation.set(0.3, 0.6, -0.2);
  return m;
}

// Свеча с живым пламенем: два «спрайта» (ядро и ореол) + тёплый точечный свет.
function candle(kit, { height = 0.62, radius = 0.34, light = true } = {}) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.02, height, 56, 1), kit.mat.wax);
  body.position.y = height / 2;
  const pool = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.86, 48), kit.mat.waxPool);
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = height - 0.012;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.93, radius * 0.07, 12, 56), kit.mat.wax);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = height - 0.01;
  const wick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.12, 8), kit.mat.wick);
  wick.position.y = height + 0.05;
  wick.rotation.z = 0.12;
  const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: kit.tex.flameCore, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  core.scale.set(0.11, 0.3, 1);
  core.position.y = height + 0.2;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: kit.tex.flameGlow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  glow.scale.set(0.9, 0.9, 1);
  glow.position.y = height + 0.2;
  g.add(body, pool, rim, wick, glow, core);
  let pl = null;
  if (light) {
    pl = new THREE.PointLight(0xffa24a, 2.4, 0, 2);
    pl.position.y = height + 0.28;
    g.add(pl);
  }
  const phase = Math.random() * 10;
  g.userData.update = (t) => {
    const f = noise3(t * 3.1 + phase, 0.3, 0) * 0.5 + noise3(t * 9.7 + phase, 1.7, 0) * 0.25;
    core.scale.set(0.11 + f * 0.015, 0.3 + f * 0.07, 1);
    core.position.x = noise3(t * 1.7 + phase, 5, 0) * 0.025;
    core.material.rotation = noise3(t * 1.3 + phase, 8, 0) * 0.12;
    glow.material.opacity = 0.85 + f * 0.3;
    if (pl) pl.intensity = 2.4 + f * 1.1;
  };
  return g;
}

// Полоски у краёв полотенца: текстура вдоль длины рулона.
const stripeCache = new Map();
function towelStripes(length) {
  if (stripeCache.has(length)) return stripeCache.get(length);
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 4, 256);
  // в координатах «длины»: полосы на 9–13% и 87–91% от края
  [[0.09, 0.115], [0.13, 0.14], [0.86, 0.87], [0.885, 0.91]].forEach(([a, b]) => {
    ctx.fillStyle = 'rgba(150,128,104,0.55)';
    ctx.fillRect(0, Math.round(a * 256), 4, Math.max(2, Math.round((b - a) * 256)));
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  // UV боковой поверхности: v = 1 - z, z ∈ [0, length]
  t.repeat.set(0.001, 1 / length);
  t.offset.set(0, -(1 - length) / length);
  t.flipY = false;
  stripeCache.set(length, t);
  return t;
}

// Полотенце, свёрнутое рулоном: сечение — спираль, вытянутая в длину.
function towelRoll(kit, { length = 1.5, material, tie = false } = {}) {
  const t = 0.105, r0 = 0.05, turns = 2.55, steps = 220;
  const outer = [], inner = [];
  for (let i = 0; i <= steps; i += 1) {
    const a = (i / steps) * turns * Math.PI * 2;
    const r = r0 + (t * 1.04) * (a / (Math.PI * 2));
    outer.push(new THREE.Vector2(Math.cos(a) * (r + t / 2), Math.sin(a) * (r + t / 2)));
    inner.push(new THREE.Vector2(Math.cos(a) * Math.max(0.01, r - t / 2), Math.sin(a) * Math.max(0.01, r - t / 2)));
  }
  const shape = new THREE.Shape([...outer, ...inner.reverse()]);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: length, bevelEnabled: true, bevelThickness: 0.045, bevelSize: 0.035, bevelSegments: 4, curveSegments: 1, steps: 1
  });
  geo.translate(0, 0, -length / 2);
  geo.computeVertexNormals();
  const base = material || kit.mat.towel;
  const side = base.clone();
  side.map = towelStripes(length);
  const m = new THREE.Mesh(geo, [base, side]);
  const outerR = r0 + t * 1.04 * turns + t / 2;
  const g = new THREE.Group();
  m.position.y = outerR;
  g.add(m);
  if (tie) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(outerR + 0.012, 0.018, 8, 48), kit.mat.twine);
    band.position.y = outerR;
    g.add(band);
  }
  g.userData.radius = outerR;
  return g;
}

// Стеклянный флакон с маслом и пипеткой.
function oilBottle(kit) {
  const g = new THREE.Group();
  const prof = [
    [0.0, 0.0], [0.27, 0.0], [0.31, 0.03], [0.32, 0.1], [0.32, 0.62], [0.3, 0.7], [0.22, 0.78],
    [0.13, 0.84], [0.11, 0.9], [0.11, 1.0], [0.125, 1.02], [0.125, 1.06]
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const glass = new THREE.Mesh(new THREE.LatheGeometry(prof, 64), kit.mat.glass);
  const oilProf = [[0, 0.03], [0.27, 0.03], [0.29, 0.07], [0.293, 0.5], [0, 0.5]].map(([x, y]) => new THREE.Vector2(x, y));
  const oil = new THREE.Mesh(new THREE.LatheGeometry(oilProf, 64), kit.mat.oil);
  const label = new THREE.Mesh(new THREE.CylinderGeometry(0.323, 0.323, 0.26, 64, 1, true), kit.mat.label);
  label.position.y = 0.36;
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.12, 40), kit.mat.wood);
  collar.position.y = 1.1;
  const bulbProf = [[0, 0], [0.09, 0], [0.1, 0.06], [0.1, 0.16], [0.085, 0.22], [0.05, 0.26], [0, 0.27]].map(([x, y]) => new THREE.Vector2(x, y));
  const bulb = new THREE.Mesh(new THREE.LatheGeometry(bulbProf, 40), kit.mat.rubber);
  bulb.position.y = 1.16;
  void oil;
  g.add(label, glass, collar, bulb);
  return g;
}

function bambooStalk(kit, length, seed) {
  const g = new THREE.Group();
  const r = rng(seed);
  const rad = 0.065 + r() * 0.015;
  const seg = 0.42 + r() * 0.08;
  const n = Math.max(1, Math.round(length / seg));
  const segGeo = new THREE.CylinderGeometry(rad, rad * 1.04, seg, 28, 1, true);
  const nodeGeo = new THREE.TorusGeometry(rad * 1.04, rad * 0.16, 10, 28);
  for (let i = 0; i < n; i += 1) {
    const s = new THREE.Mesh(segGeo, i % 2 ? kit.mat.bamboo : kit.mat.bambooDark);
    s.position.y = seg * i + seg / 2;
    g.add(s);
    const node = new THREE.Mesh(nodeGeo, kit.mat.bambooDark);
    node.rotation.x = Math.PI / 2;
    node.position.y = seg * i;
    g.add(node);
  }
  const cap = new THREE.Mesh(new THREE.CircleGeometry(rad, 28), kit.mat.bambooDark);
  cap.rotation.x = -Math.PI / 2;
  cap.position.y = seg * n;
  const cap0 = cap.clone();
  cap0.rotation.x = Math.PI / 2;
  cap0.position.y = 0;
  g.add(cap, cap0);
  g.userData.length = seg * n;
  return g;
}

function leaf(kit, len = 0.7, width = 0.13) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(width, len * 0.35, 0, len);
  s.quadraticCurveTo(-width, len * 0.35, 0, 0);
  const geo = new THREE.ShapeGeometry(s, 16);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i += 1) {
    const y = pos.getY(i), x = pos.getX(i);
    pos.setZ(i, -Math.pow(y / len, 2) * 0.18 + Math.abs(x) * 0.25);
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, kit.mat.leaf);
}

function bambooBundle(kit) {
  const g = new THREE.Group();
  [[2.0, 0, 0], [1.7, 0.15, 0.12], [1.45, -0.13, 0.15]].forEach(([len, x, z], i) => {
    const st = bambooStalk(kit, len, 31 + i * 5);
    st.rotation.z = Math.PI / 2;
    st.position.set(len / 2 + x, 0.075 + (i ? 0.0 : 0), z);
    g.add(st);
  });
  const l1 = leaf(kit, 0.75, 0.14);
  l1.rotation.set(-Math.PI / 2 + 0.18, 0, -1.1);
  l1.position.set(0.35, 0.16, 0.02);
  const l2 = leaf(kit, 0.6, 0.12);
  l2.rotation.set(-Math.PI / 2 + 0.25, 0, -2.2);
  l2.position.set(0.35, 0.165, 0.02);
  g.add(l1, l2);
  return g;
}

// Орхидея: три чашелистика, два широких лепестка, губа и колонка.
function petalGeometry(len, width, cup, colorIn, colorOut) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(width * 0.9, len * 0.1, width * 1.05, len * 0.75, 0, len);
  s.bezierCurveTo(-width * 1.05, len * 0.75, -width * 0.9, len * 0.1, 0, 0);
  const geo = new THREE.ShapeGeometry(s, 24);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const ci = new THREE.Color(colorIn), co = new THREE.Color(colorOut), c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i), y = pos.getY(i);
    const d = Math.min(1, Math.hypot(x, y) / len);
    pos.setZ(i, -(d * d) * cup + Math.abs(x) * cup * 0.4);
    c.copy(ci).lerp(co, Math.min(1, d * 1.6));
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

function orchid(kit) {
  const g = new THREE.Group();
  const sepal = petalGeometry(0.42, 0.11, 0.12, 0xf3c6d8, 0xfdf6f8);
  const petal = petalGeometry(0.4, 0.21, 0.1, 0xefb3cb, 0xfefafb);
  [Math.PI / 2, Math.PI / 2 + 2.15, Math.PI / 2 - 2.15].forEach((a) => {
    const m = new THREE.Mesh(sepal, kit.mat.petal);
    m.rotation.z = a - Math.PI / 2;
    g.add(m);
  });
  [0.55, -0.55].forEach((a) => {
    const m = new THREE.Mesh(petal, kit.mat.petal);
    m.rotation.z = a * 1.75;
    m.position.z = 0.01;
    g.add(m);
  });
  const lipGeo = petalGeometry(0.2, 0.1, 0.14, 0x8d1f4a, 0xd04b80);
  const lip = new THREE.Mesh(lipGeo, kit.mat.lip);
  lip.rotation.z = Math.PI;
  lip.position.set(0, -0.02, 0.04);
  const col = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), kit.mat.column);
  col.position.set(0, 0.02, 0.05);
  g.add(lip, col);
  // цветок «смотрит» вверх и чуть к зрителю
  const holder = new THREE.Group();
  g.rotation.x = -0.78;
  holder.add(g);
  return holder;
}

// Капля масла, стекающая по поверхности камня (эллипсоида).
function oilDrops(kit, targetStone, count = 2) {
  const g = new THREE.Group();
  const geo = new THREE.SphereGeometry(1, 20, 14);
  const drops = [];
  for (let i = 0; i < count; i += 1) {
    const d = new THREE.Mesh(geo, kit.mat.drop.clone());
    d.scale.setScalar(0.001);
    g.add(d);
    drops.push({ mesh: d, phase: i / count, angle: 0.6 + i * 2.1 });
  }
  const rx = targetStone.scale.x, ry = targetStone.scale.y * 0.42, rz = targetStone.scale.z * 0.8;
  g.userData.update = (t) => {
    drops.forEach((d) => {
      const p = ((t / 6) + d.phase) % 1;              // 6 секунд на путь
      const phi = 0.62 + p * 0.85;                    // по склону камня к краю
      const x = Math.sin(phi) * Math.cos(d.angle) * rx;
      const z = Math.sin(phi) * Math.sin(d.angle) * rz;
      const y = Math.cos(phi) * ry + 0.035;
      d.mesh.position.set(x, y, z);
      const size = 0.045 * Math.min(1, p * 6) * (1 - Math.max(0, p - 0.8) * 5);
      d.mesh.scale.set(size, size * 0.62, size * (1 + p * 0.8));
      d.mesh.lookAt(x * 2, y - 0.3, z * 2);
      d.mesh.material.opacity = Math.max(0, Math.min(0.92, (1 - p) * 4));
    });
  };
  return g;
}

// ---------------------------------------------------------------------------
// Свет: тёплый «вечерний» ключевой свет + мягкая заливка + контровой
// ---------------------------------------------------------------------------
function addLights(scene, kit, { key = 2.2, warm = true } = {}) {
  scene.environment = kit.envMap;
  scene.environmentIntensity = 0.38;
  const hemi = new THREE.HemisphereLight(0xffe3c4, 0x2b2420, 0.55);
  const keyL = new THREE.DirectionalLight(warm ? 0xffd2a1 : 0xffffff, key);
  keyL.position.set(3.5, 5, 4);
  const rim = new THREE.DirectionalLight(0xb9c7ff, 0.65);
  rim.position.set(-4, 3, -4);
  scene.add(hemi, keyL, rim);
}

function camera(fov, pos, target) {
  const c = new THREE.PerspectiveCamera(fov, 1, 0.1, 60);
  c.position.set(...pos);
  c.lookAt(new THREE.Vector3(...target));
  c.userData.target = new THREE.Vector3(...target);
  return c;
}

// ---------------------------------------------------------------------------
// Сцены
// ---------------------------------------------------------------------------
const easeOutBack = (x) => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const easeOutBounce = (x) => {
  const n1 = 7.5625, d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
};

// Предмет услуги: объект в центре, тень, медленный поворот «на подставке».
function turntable(kit, build, { cam = [0, 1.15, 3.7], target = [0, 0.45, 0], shadow = [1.6, 1.2], fov = 30, fit = 1.0 } = {}) {
  const scene = new THREE.Scene();
  addLights(scene, kit);
  const spin = new THREE.Group();
  const obj = build();
  spin.add(obj);
  scene.add(spin);
  const sh = contactShadow(kit, shadow[0], shadow[1], 0.7);
  sh.position.y = 0.002;
  scene.add(sh);
  const cameraObj = camera(fov, cam, target);
  // Камера сама подбирает расстояние так, чтобы предмет (в любом повороте)
  // занимал место крупно и одинаково во всех карточках.
  if (fit) {
    obj.traverse((o) => { if (o.userData.update) o.userData.update(0); });
    const sphere = new THREE.Box3().setFromObject(obj).getBoundingSphere(new THREE.Sphere());
    const dir = new THREE.Vector3(...cam).sub(new THREE.Vector3(...target)).normalize();
    const dist = (sphere.radius * fit) / Math.sin(THREE.MathUtils.degToRad(fov / 2));
    const center = sphere.center.clone();
    cameraObj.position.copy(center).addScaledVector(dir, dist);
    cameraObj.lookAt(center);
    sh.scale.set(sphere.radius * 1.7, sphere.radius * 1.3, 1);
    sh.material.opacity = 0.55;
  }
  let angle = 0.65;
  let lift = 0;
  const speedK = 0.85 + (build.toString().length % 7) * 0.05;
  return {
    scene, camera: cameraObj,
    update(t, dt, input) {
      const speed = input.hover ? 1.6 : (input.calm ? 0 : 0.22 * speedK);
      angle += dt * speed;
      spin.rotation.y = angle;
      lift += ((input.hover ? 0.12 : 0) - lift) * Math.min(1, dt * 6);
      spin.position.y = lift + (input.calm ? 0 : Math.sin(t * 1.1) * 0.015);
      sh.material.opacity = 0.55 - lift * 1.6;
      obj.traverse((o) => { if (o.userData.update) o.userData.update(t); });
    }
  };
}

const BUILDERS = {
  stones: (kit) => turntable(kit, () => stoneStack(kit, [0.62, 0.48, 0.34], 5), { target: [0, 0.42, 0] }),
  salt: (kit) => turntable(kit, () => { const s = saltCrystal(kit, 0.5, 13); s.position.y = 0.52; return s; }, { target: [0, 0.5, 0], shadow: [1.2, 1.0], fit: 0.8 }),
  candle: (kit) => turntable(kit, () => candle(kit), { target: [0, 0.45, 0], shadow: [1.0, 1.0] }),
  candles: (kit) => turntable(kit, () => {
    const g = new THREE.Group();
    const a = candle(kit, { height: 0.72, radius: 0.27 });
    a.position.set(-0.3, 0, 0.05);
    const b = candle(kit, { height: 0.46, radius: 0.24 });
    b.position.set(0.32, 0, -0.06);
    g.add(a, b);
    return g;
  }, { target: [0, 0.48, 0], shadow: [1.6, 1.0] }),
  towel: (kit) => turntable(kit, () => {
    // три рулона пирамидкой, как их выкладывают в массажном кабинете
    const g = new THREE.Group();
    const mk = (mat, x, y, z) => {
      const t = towelRoll(kit, { length: 1.25, material: mat });
      t.rotation.y = Math.PI / 2;
      t.position.set(x, y, z);
      g.add(t);
      return t;
    };
    const R = towelRoll(kit, { length: 0.1, tie: false }).userData.radius;
    mk(kit.mat.towel, 0, 0, R * 1.02);
    mk(kit.mat.towelSage, 0, 0, -R * 1.02);
    mk(kit.mat.towel, 0.04, R * 1.72, 0);
    return g;
  }, { cam: [0, 1.3, 4.6], target: [0, 0.5, 0], shadow: [1.9, 1.5] }),
  bottle: (kit) => turntable(kit, () => { const b = oilBottle(kit); b.scale.setScalar(0.82); return b; }, { target: [0, 0.5, 0], shadow: [1.0, 1.0] }),
  bamboo: (kit) => turntable(kit, () => { const b = bambooBundle(kit); b.scale.setScalar(0.92); return b; }, { cam: [0, 1.9, 3.6], target: [0, 0.05, 0], shadow: [1.6, 1.6] }),
  orchid: (kit) => turntable(kit, () => {
    const g = new THREE.Group();
    const s = stone(kit, 0.6, 17);
    s.position.y = s.userData.halfHeight;
    const o = orchid(kit);
    o.scale.setScalar(1.25);
    o.position.set(0.05, s.userData.halfHeight * 2 + 0.05, 0.05);
    g.add(s, o);
    return g;
  }, { target: [0, 0.4, 0], shadow: [1.4, 1.1] }),
  ritual: (kit) => turntable(kit, () => {
    const g = new THREE.Group();
    const st = stoneStack(kit, [0.5, 0.36], 9);
    st.position.set(-0.32, 0, 0.0);
    const c = candle(kit, { height: 0.56, radius: 0.22 });
    c.position.set(0.42, 0, 0.22);
    g.add(st, c);
    return g;
  }, { target: [0, 0.4, 0], shadow: [1.7, 1.1] }),

  // Камень, который катится вдоль страницы (вращение задаётся снаружи).
  roller: (kit) => {
    const scene = new THREE.Scene();
    addLights(scene, kit);
    const s = stone(kit, 0.9, 23);
    s.scale.set(0.9, 2.0, 0.9);       // почти круглая «галька», чтобы катилась
    scene.add(s);
    const cam = camera(30, [0, 0, 6], [0, 0, 0]);
    return {
      scene, camera: cam,
      update(t, dt, input) {
        s.rotation.z = -(input.roll || 0);
        s.rotation.y = 0.4;
      }
    };
  },

  // «Вы записаны»: камни падают и складываются в пирамидку.
  stack: (kit) => {
    const scene = new THREE.Scene();
    addLights(scene, kit);
    const st = stoneStack(kit, [0.72, 0.58, 0.45, 0.32], 41);
    scene.add(st);
    const sh = contactShadow(kit, 2.0, 1.5, 0.7);
    scene.add(sh);
    const o = orchid(kit);
    o.scale.setScalar(0.9);
    o.position.set(0.02, st.userData.height + 0.02, 0.02);
    o.visible = false;
    scene.add(o);
    const cam = camera(30, [0, 1.5, 5.4], [0, 0.75, 0]);
    let start = null;
    return {
      scene, camera: cam,
      done: false,
      update(t, dt, input) {
        if (input.restart || start === null) { start = t; this.done = false; }
        const e = t - start;
        st.userData.stones.forEach((s, i) => {
          const t0 = 0.15 + i * 0.32;
          const p = Math.min(1, Math.max(0, (e - t0) / 0.55));
          s.visible = e > t0 - 0.05;
          s.position.y = s.userData.baseY + (1 - easeOutBounce(p)) * 2.4;
          s.rotation.x = (1 - p) * 0.6;
        });
        const po = Math.min(1, Math.max(0, (e - 1.65) / 0.5));
        o.visible = po > 0;
        o.scale.setScalar(0.9 * easeOutBack(po));
        if (e > 2.4) this.done = true;
      }
    };
  },

  // Натюрморт первого экрана.
  hero: (kit) => {
    const scene = new THREE.Scene();
    addLights(scene, kit, { key: 1.6 });
    const world = new THREE.Group();
    scene.add(world);

    const items = [];
    const add = (obj, x, y, z, bob = 0.05, shadowSize = null) => {
      const holder = new THREE.Group();
      holder.position.set(x, y, z);
      holder.add(obj);
      world.add(holder);
      let sh = null;
      if (shadowSize) {
        sh = contactShadow(kit, shadowSize[0], shadowSize[1], 0.6);
        sh.position.set(x, 0.003, z);
        world.add(sh);
      }
      items.push({ holder, base: y, bob, phase: Math.random() * 6, sh, shBase: shadowSize });
      return holder;
    };

    // Пирамидка: камни парят с небольшими зазорами.
    const stack = stoneStack(kit, [1.0, 0.82, 0.64, 0.46], 3);
    const stackHolder = add(stack, -0.15, 0.12, 0, 0, [2.6, 2.0]);
    const base = stack.userData.stones[0];
    const drops = oilDrops(kit, base, 2);
    base.add(drops);
    drops.scale.set(1 / base.scale.x, 1 / base.scale.y, 1 / base.scale.z);
    const fl = orchid(kit);
    fl.scale.setScalar(1.05);
    stack.add(fl);

    const salt = saltCrystal(kit, 0.4, 11);
    add(salt, 1.55, 0.5, 0.75, 0.07, [1.0, 0.8]);
    let saltLight = null;
    if (kit.high) {
      saltLight = new THREE.PointLight(0xff8a5c, 0.9, 2.2, 2);
      saltLight.position.set(1.55, 0.5, 0.75);
      world.add(saltLight);
    }

    const cdl = candle(kit, { height: 0.7, radius: 0.3 });
    add(cdl, 1.25, 0.0, -0.55, 0, [1.0, 1.0]);
    const cdl2 = candle(kit, { height: 0.42, radius: 0.24, light: false });
    add(cdl2, -0.85, 0.0, -1.45, 0, [0.8, 0.8]);

    const towel = towelRoll(kit, { length: 1.1 });
    towel.rotation.y = 0.95;
    add(towel, -1.6, 0.06, 1.15, 0.04, [1.9, 1.1]);

    const bottle = oilBottle(kit);
    bottle.scale.setScalar(0.95);
    add(bottle, -1.75, 0.06, -0.35, 0.035, [0.9, 0.9]);

    const cam = camera(28, [0, 2.6, 9.2], [0, 1.25, 0]);
    let yaw = 0, pitch = 0;
    return {
      scene, camera: cam,
      update(t, dt, input) {
        // поворот за курсором / наклоном телефона, иначе медленное покачивание
        const calm = !!input.calm;
        const tx = input.pointer ? input.pointer.x * 0.42 : (calm ? 0 : Math.sin(t * 0.16) * 0.28);
        const ty = input.pointer ? input.pointer.y * 0.1 : (calm ? 0 : Math.sin(t * 0.11) * 0.03);
        const k = Math.min(1, dt * 2.2);
        yaw += (tx - yaw) * k;
        pitch += (ty - pitch) * k;
        world.rotation.y = yaw;
        world.rotation.x = pitch;
        // парение
        items.forEach((it) => {
          const off = calm ? 0 : Math.sin(t * 0.9 + it.phase) * it.bob;
          it.holder.position.y = it.base + off;
          if (it.sh) {
            const h = Math.max(0, it.holder.position.y);
            it.sh.material.opacity = Math.max(0.2, 0.62 - h * 0.35);
            it.sh.scale.set(it.shBase[0] * (1 + h * 0.15), it.shBase[1] * (1 + h * 0.15), 1);
          }
        });
        stack.userData.stones.forEach((s, i) => {
          s.position.y = s.userData.baseY + i * 0.07 + (calm ? 0 : Math.sin(t * 0.8 + i * 0.9) * 0.028 * i);
          if (!calm) s.rotation.y += dt * 0.02 * (i % 2 ? 1 : -1);
        });
        const top = stack.userData.stones[3];
        fl.position.set(top.position.x + 0.1, top.position.y + top.userData.halfHeight + 0.02, top.position.z + 0.05);
        drops.userData.update(t);
        cdl.userData.update(t);
        cdl2.userData.update(t + 3.3);
        if (saltLight) saltLight.intensity = 0.8 + noise3(t * 0.7, 2, 2) * 0.3;
        stackHolder.position.y = 0.12;
      }
    };
  }
};

export const KINDS = Object.keys(BUILDERS);

export function buildScene(kit, kind) {
  const b = BUILDERS[kind] || BUILDERS.stones;
  return b(kit);
}
