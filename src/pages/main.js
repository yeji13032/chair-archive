import { gsap } from 'gsap';
import { mountSiteNav } from '../components/site-nav.js';
import { chairs, detailHref } from '../data/chairs.js';
import { mountChairDna } from './main-dna.js';
import { mountSectionTransition } from './main-sections.js';
import '../styles/main.css';

mountSiteNav();
const chairDnaSection = mountChairDna(); // 메인 화면 다음 CHAIR DNA 화면 (main-dna.js)
// 메인 ↔ CHAIR DNA 풀스크린 전환 (main-sections.js)
const sectionTransition = mountSectionTransition({
  main: document.querySelector('.main-stage'),
  dna: document.querySelector('[data-dna]'),
  dnaApi: chairDnaSection,
});
if (import.meta.env.DEV) Object.assign(window, { __chairDna: chairDnaSection, __sections: sectionTransition });

const field = document.querySelector('[data-chair-field]');
const ALPHA_HIT = 24; // 이 값보다 불투명한 픽셀만 의자로 본다

// ---------- 렌더 ----------

const items = chairs.map((chair) => {
  const { box, alpha, size, labelAt } = chair;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const [w, h] = size;

  const link = document.createElement('a');
  link.className = 'chair';
  link.href = detailHref(chair.id);
  link.dataset.id = chair.id;
  link.setAttribute('aria-label', `${chair.label.join(' ')} 상세 보기`);
  link.style.cssText = `--cx:${cx};--cy:${cy};--w:${box.w};--h:${box.h};`;
  link.innerHTML = `
    <div class="chair__hover">
      <div class="chair__shadow" style="
        --shadow-x:${(((alpha[0] + alpha[2]) / 2 / w) * 100).toFixed(2)}%;
        --shadow-y:${((alpha[3] / h) * 100).toFixed(2)}%;
        --shadow-w:${(((alpha[2] - alpha[0]) / w) * 70).toFixed(2)}%;"></div>
      <div class="chair__float">
        <img class="chair__img" src="${chair.image}" alt="" draggable="false" />
      </div>
    </div>
  `;

  const label = document.createElement('p');
  label.className = 'chair-label';
  label.setAttribute('aria-hidden', 'true');
  label.style.cssText = `--cx:${cx};--cy:${cy};--lx:${labelAt.x - cx};--ly:${labelAt.y - cy};`;
  label.textContent = chair.label.join('\n');

  field.append(link, label);

  return {
    chair,
    link,
    img: link.querySelector('.chair__img'),
    hover: link.querySelector('.chair__hover'),
    float: link.querySelector('.chair__float'),
    shadow: link.querySelector('.chair__shadow'),
    alphaMap: null,
  };
});

// ---------- Floating (무중력 부유) ----------
// 의자마다 주기가 서로 다른 사인파 여러 개를 더해 위아래·좌우·기울기·미세한 3D 회전을 만든다.
// 주기들이 서로 맞아떨어지지 않아 같은 왕복이 반복되지 않고, 사인파라 갑자기 멈추거나 방향이 꺾이지 않는다.
// - 위아래: 11 ~ 23px 범위 (이전 6 ~ 12px의 약 1.9배), 좌우: 7 ~ 14px, 기울기: ±3 ~ 5°, 3D 회전: ±6° 이하
// - 크기는 화면 크기(디자인 단위)에 맞춰 줄어들고 늘어난다 (1440 × 900 화면 기준이 위 값)
// - 마우스를 올린 의자는 움직임을 25%로 줄여 확대 인터랙션과 부딪히지 않게
// - CHAIR DNA 화면이 떠 있는 동안에는 계산을 쉰다

const FLOAT_REF_U = Math.min(1440 / 2000, 900 / 1293); // 위 값들의 기준 화면
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// 의자마다 같은 값이 나오는 0~1 난수 (새로고침해도 같은 움직임)
const seeded = (i, n) => {
  const s = Math.sin((i + 1) * 12.9898 + n * 78.233) * 43758.5453;
  return s - Math.floor(s);
};
const between = (i, n, min, max) => min + (max - min) * seeded(i, n);
const TAU = Math.PI * 2;

items.forEach((item, i) => {
  item.drift = {
    span: between(i, 1, 11, 23), // 위아래 이동 범위 (px)
    sway: between(i, 2, 7, 14), // 좌우 이동 범위 (px)
    tilt: between(i, 3, 3, 5) * (seeded(i, 4) < 0.5 ? -1 : 1), // 기울기 (°), 방향도 의자마다 다르게
    turn: between(i, 5, 3.5, 6), // 3D 좌우 회전 (°): 정면을 알아볼 수 있을 만큼만
    // 주기 (초): 큰 흐름 + 작은 흔들림. 이동과 회전의 주기를 서로 다르게
    py: [between(i, 6, 5.6, 8.4), between(i, 7, 3.1, 4.4)],
    px: [between(i, 8, 7.2, 11), between(i, 9, 4.6, 6.2)],
    pr: [between(i, 10, 6.4, 9.6), between(i, 11, 3.6, 5.1)],
    pt: between(i, 12, 9, 13.5),
    phase: Array.from({ length: 7 }, (_, n) => seeded(i, 20 + n) * TAU),
    energy: 1, // 움직임 세기 (hover 중 0.25로 부드럽게)
  };
});

const wave = (t, period, phase) => Math.sin((TAU * t) / period + phase);

gsap.ticker.add((time, deltaMs) => {
  // CHAIR DNA 화면만 보이는 동안에는 쉰다 (전환 중에는 계속 움직여 자연스럽게)
  if (sectionTransition && sectionTransition.current === 1 && !sectionTransition.busy) return;
  const u = Math.min(window.innerWidth / 2000, window.innerHeight / 1293);
  const k = Math.min(1.4, Math.max(0.5, u / FLOAT_REF_U)) * (reducedMotion.matches ? 0.35 : 1);
  const settle = 1 - Math.exp(-Math.min(deltaMs, 100) / 350);

  for (const item of items) {
    const d = item.drift;
    d.energy += ((item === hovered ? 0.25 : 1) - d.energy) * settle;
    const e = d.energy * k;
    const { phase: p } = d;
    // -1 ~ 1: 큰 흐름 65~70% + 작은 흔들림 30~35%
    const fy = 0.65 * wave(time, d.py[0], p[0]) + 0.35 * wave(time, d.py[1], p[1]);
    const fx = 0.7 * wave(time, d.px[0], p[2]) + 0.3 * wave(time, d.px[1], p[3]);
    const fr = 0.75 * wave(time, d.pr[0], p[4]) + 0.25 * wave(time, d.pr[1], p[5]);
    const ft = wave(time, d.pt, p[6]);

    const y = (-d.span / 2 + (d.span / 2) * fy) * e; // 이전처럼 기본 위치에서 위쪽으로 떠오르는 범위
    const x = (d.sway / 2) * fx * e;
    const rot = d.tilt * fr * d.energy * (reducedMotion.matches ? 0.35 : 1);
    const rotY = reducedMotion.matches ? 0 : d.turn * ft * d.energy;
    item.float.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) perspective(900px) rotateY(${rotY.toFixed(2)}deg) rotate(${rot.toFixed(2)}deg)`;

    // 그림자: 높이 떠오를수록 작고 옅게 (이전과 같은 범위: 가장 높을 때 크기 0.88, 투명도 0.7), 좌우는 의자를 조금 따라감
    const height = ((1 - fy) / 2) * d.energy; // 0(기본 위치) ~ 1(가장 높음)
    item.shadow.style.transform = `translateX(${(x * 0.6).toFixed(2)}px) scale(${(1 - 0.12 * height).toFixed(3)})`;
    item.shadow.style.opacity = (1 - 0.3 * height).toFixed(3);
  }
});

// ---------- Hover / Click (투명 PNG 영역 기준) ----------

function buildAlphaMap(item) {
  const { img } = item;
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const map = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < map.length; i++) map[i] = data[i * 4 + 3];
  item.alphaMap = { map, width: canvas.width, height: canvas.height };
  item.reachMap = buildReachMap(item, map, canvas.width, canvas.height);
}

// 클릭 영역: 의자 모양을 CLICK_REACH(디자인 단위)만큼 부풀린 마스크.
// 의자 다리·프레임 사이 같은 가까운 빈 틈을 눌러도 상세 페이지로 넘어가게 한다 (hover 판정은 그대로 의자 모양)
const CLICK_REACH = 24; // 디자인 단위 (1440 × 900 화면에서 약 17px)

function buildReachMap(item, map, width, height) {
  const r = Math.max(1, Math.round((CLICK_REACH * width) / item.chair.box.w)); // 이미지 픽셀 단위
  const solid = (i) => (map[i] > ALPHA_HIT ? 1 : 0);
  // 가로 → 세로 두 번의 구간 검사(누적 합)로 사각형 모양으로 부풀린다
  const rowPass = new Uint8Array(width * height);
  const sums = new Int32Array(Math.max(width, height) + 1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) sums[x + 1] = sums[x] + solid(y * width + x);
    for (let x = 0; x < width; x++) {
      rowPass[y * width + x] = sums[Math.min(width, x + r + 1)] - sums[Math.max(0, x - r)] > 0 ? 1 : 0;
    }
  }
  const reach = new Uint8Array(width * height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) sums[y + 1] = sums[y] + rowPass[y * width + x];
    for (let y = 0; y < height; y++) {
      reach[y * width + x] = sums[Math.min(height, y + r + 1)] - sums[Math.max(0, y - r)] > 0 ? 1 : 0;
    }
  }
  return reach;
}

function isNearAt(item, clientX, clientY) {
  if (!item.reachMap) return false;
  const rect = item.img.getBoundingClientRect();
  if (clientX < rect.left || clientX >= rect.right || clientY < rect.top || clientY >= rect.bottom) return false;
  const { width, height } = item.alphaMap;
  const px = Math.floor(((clientX - rect.left) / rect.width) * width);
  const py = Math.floor(((clientY - rect.top) / rect.height) * height);
  return item.reachMap[py * width + px] === 1;
}

// 클릭: 의자 모양을 정확히 누르면 기존과 같고, 아니면 가까운 빈 틈까지 (확대된 의자 우선)
function clickTest(clientX, clientY) {
  const exact = hitTest(clientX, clientY);
  if (exact) return exact;
  if (hovered && isNearAt(hovered, clientX, clientY)) return hovered;
  return items.find((item) => isNearAt(item, clientX, clientY)) ?? null;
}

items.forEach((item) => {
  if (item.img.complete && item.img.naturalWidth) buildAlphaMap(item);
  else item.img.addEventListener('load', () => buildAlphaMap(item), { once: true });
});

function isOpaqueAt(item, clientX, clientY, tolerance = 0) {
  if (!item.alphaMap) return false;
  const rect = item.img.getBoundingClientRect(); // floating·hover 변형이 반영된 실제 위치
  const { map, width, height } = item.alphaMap;
  // tolerance(px) > 0이면 주변 8방향도 검사해 의자 가장자리에서 hover가 흔들리지 않게 한다
  const offsets = tolerance
    ? [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]
    : [[0, 0]];
  return offsets.some(([dx, dy]) => {
    const x = clientX + dx * tolerance;
    const y = clientY + dy * tolerance;
    if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) return false;
    const px = Math.floor(((x - rect.left) / rect.width) * width);
    const py = Math.floor(((y - rect.top) / rect.height) * height);
    return map[py * width + px] > ALPHA_HIT;
  });
}

function hitTest(clientX, clientY) {
  // 현재 확대된 의자를 먼저(여유 범위 포함) 검사해 위로 올라온 의자가 우선되게 한다
  if (hovered && isOpaqueAt(hovered, clientX, clientY, HOVER_TOLERANCE)) return hovered;
  return items.find((item) => item !== hovered && isOpaqueAt(item, clientX, clientY)) ?? null;
}

// ---------- Hover 확대 (GSAP 바운스) ----------
// 계층: .chair__hover(확대) > .chair__float(floating) — 서로 다른 요소라 transform이 충돌하지 않는다

const HOVER_SCALE = 2;
const HOVER_TOLERANCE = 6; // px
const LEAVE_DELAY = 80; // ms, 가장자리에서 잠깐 벗어난 것은 무시
const EDGE_MARGIN = 12; // px, 확대된 의자가 화면 가장자리에서 띄울 최소 여백
const MAX_OVERSHOOT = 1.05; // back.out(1.5)의 최대 초과량 ≈ 8% → 최대 약 2.08배

let hovered = null;
let leaveTimer = null;

// 확대된 의자(초과 크기 포함)가 화면 밖으로 잘리지 않도록 transform-origin을 의자마다 계산한다
function updateOrigin(item) {
  if (gsap.getProperty(item.hover, 'scale') > 1.01) return; // 축소 중에는 기준점을 바꾸지 않는다

  const rect = item.link.getBoundingClientRect(); // .chair 자체에는 transform이 없어 기본 위치 그대로
  const [aw, ah] = item.chair.size;
  const [ax0, ay0, ax1, ay1] = item.chair.alpha;
  const box = {
    x0: rect.left + (ax0 / aw) * rect.width,
    x1: rect.left + (ax1 / aw) * rect.width,
    y0: rect.top + (ay0 / ah) * rect.height,
    y1: rect.top + (ay1 / ah) * rect.height,
  };
  const s = HOVER_SCALE * MAX_OVERSHOOT;

  // 기준점 o로 s배 확대했을 때 o + s(b - o)가 [margin, 화면 끝 - margin] 안에 들어오는 o의 범위
  const axis = (b0, b1, size) => {
    const lo = (s * b1 - (size - EDGE_MARGIN)) / (s - 1);
    const hi = (s * b0 - EDGE_MARGIN) / (s - 1);
    const center = (b0 + b1) / 2;
    return lo > hi ? (lo + hi) / 2 : Math.min(Math.max(center, lo), hi);
  };
  const ox = axis(box.x0, box.x1, window.innerWidth) - rect.left;
  const oy = axis(box.y0, box.y1, window.innerHeight) - rect.top;
  gsap.set(item.hover, { transformOrigin: `${ox}px ${oy}px` });
}

function grow(item) {
  updateOrigin(item);
  item.link.classList.add('is-hovered');
  gsap.to(item.hover, {
    scale: HOVER_SCALE,
    duration: 0.6,
    ease: 'back.out(1.5)',
    overwrite: true, // 진행 중이던 축소 tween을 끊고 현재 크기에서 이어서 확대
  });
}

function shrink(item) {
  gsap.to(item.hover, {
    scale: 1,
    duration: 0.5,
    ease: 'back.out(0.6)', // 약 1%만 살짝 지나쳤다 돌아오는 약한 탄성
    overwrite: true,
  });
  // 축소 중에도 다른 의자보다 위에 있되, 새로 hover된 의자보다는 아래
  item.link.classList.add('is-leaving');
  item.leaveCall?.kill();
  item.leaveCall = gsap.delayedCall(0.5, () => item.link.classList.remove('is-leaving'));
}

function setHovered(next) {
  if (next === hovered) {
    clearTimeout(leaveTimer);
    leaveTimer = null;
    return;
  }

  // 의자에서 빈 곳으로 나갈 때만 잠시 기다린다 (다른 의자로 옮겨갈 때는 바로 전환)
  if (!next && hovered) {
    if (leaveTimer) return;
    leaveTimer = setTimeout(() => {
      leaveTimer = null;
      applyHovered(null);
    }, LEAVE_DELAY);
    return;
  }

  clearTimeout(leaveTimer);
  leaveTimer = null;
  applyHovered(next);
}

function applyHovered(next) {
  if (next === hovered) return;
  const prev = hovered;
  hovered = next;
  if (prev) {
    prev.link.classList.remove('is-hovered');
    shrink(prev);
  }
  if (next) grow(next);
  document.body.style.cursor = next ? 'pointer' : '';
}

let pending = null;
// 아래 CHAIR DNA 섹션 안에서 일어난 포인터·클릭은 첫 화면 의자 hover/click 판정에서 제외
// CHAIR DNA 화면이 떠 있는 동안에도 제외
const inDnaSection = (event) =>
  document.body.dataset.section === 'dna' || (event.target instanceof Element && event.target.closest('[data-dna]'));

window.addEventListener('pointermove', (event) => {
  if (event.pointerType === 'touch') return;
  if (inDnaSection(event)) {
    setHovered(null);
    return;
  }
  if (!pending) {
    requestAnimationFrame(() => {
      setHovered(hitTest(pending.clientX, pending.clientY));
      pending = null;
    });
  }
  pending = { clientX: event.clientX, clientY: event.clientY };
});

document.documentElement.addEventListener('pointerleave', () => applyHovered(null));

window.addEventListener('click', (event) => {
  if (event.target instanceof Element && event.target.closest('a')) return; // 네비게이션 링크 등은 기본 동작
  if (inDnaSection(event)) return;
  const hit = clickTest(event.clientX, event.clientY);
  if (hit) window.location.href = hit.link.href;
});

// ---------- 개발용: 원본 디자인 비교 (?compare) ----------

if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('compare')) {
  import('../dev/compare-overlay.js').then(({ showCompareOverlay }) => showCompareOverlay());
}
