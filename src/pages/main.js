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

// ---------- Floating ----------

items.forEach((item, i) => {
  const amplitude = 6 + ((i * 5) % 7); // 6 ~ 12px
  const duration = 2.4 + ((i * 0.7) % 1.6); // 2.4 ~ 4.0s

  const tl = gsap.timeline({ repeat: -1, yoyo: true, defaults: { duration, ease: 'sine.inOut' } });
  tl.fromTo(item.float, { y: 0 }, { y: -amplitude }, 0);
  tl.fromTo(item.shadow, { scale: 1, opacity: 1 }, { scale: 0.88, opacity: 0.7 }, 0);
  tl.progress((i * 0.37) % 1); // 의자마다 시작 위상을 다르게
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
  const hit = hitTest(event.clientX, event.clientY);
  if (hit) window.location.href = hit.link.href;
});

// ---------- 개발용: 원본 디자인 비교 (?compare) ----------

if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('compare')) {
  import('../dev/compare-overlay.js').then(({ showCompareOverlay }) => showCompareOverlay());
}
