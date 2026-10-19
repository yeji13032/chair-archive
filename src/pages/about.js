import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { mountSiteNav } from '../components/site-nav.js';
import { chairs } from '../data/chairs.js';
import '../styles/about.css';

gsap.registerPlugin(ScrollTrigger);

const nav = mountSiteNav(undefined, { archiveLabel: 'CHAIR ARCHIVE / 000' });

// ABOUT에서 INDEX / ABOUT을 누르면 새로고침 대신 첫 번째 화면으로 스크롤
nav?.querySelector('.site-nav__item--right')?.addEventListener('click', (event) => {
  event.preventDefault();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ---------- SCATTER & REVEAL ----------
// 진행도 0 → 1 (스크롤 약 2.5 화면 높이)
//   0.00 ~ 0.50  about-01 프레임이 위로 흘러 아래쪽 단어까지 지나간다
//   0.04 ~ 0.72  단어마다 시간차를 두고 서로 다른 방향으로 흩어지며 사라진다
//   0.66 ~ 1.00  about-02 텍스트가 순서대로 아래에서 올라오며 나타난다

const stage = document.querySelector('[data-about-stage]');
const frame = stage.querySelector('.about-words');
const words = [...frame.querySelectorAll('.about-word')];
const infoItems = [...stage.querySelectorAll('.about-info > *')];

const FRAME_H = 2129.4; // about-01 프레임 높이

// ---------- 괄호 ( ) 사이 의자 001 → 007 순환 ----------
// 이미지는 ABOUT 전용 public/images/about/chair-00N.png (똑바로 선 의자)를 쓴다.
// MAIN 페이지의 public/images/chair-00N.png와 src/data/chairs.js는 건드리지 않는다.
// ABOUT 전용 파일이 아직 없으면 MAIN과 같은 이미지(chair.image)로 대신 표시한다.
// 모든 의자를 같은 영역(120 × 144, 작은 화면 80 × 96) 안에 넣되,
//   - 투명 여백을 뺀 실제 모양(alpha)을 기준으로 크기를 맞춰 작아 보이지 않게 하고 (원본 비율 유지)
//   - 모양의 가운데를 영역 가운데에, 모양의 바닥을 영역 바닥선에 맞춰 같은 축·같은 바닥에 서게 한다.
// ABOUT 전용 이미지는 크기·여백이 정해져 있지 않으므로 불러온 뒤 alpha 영역을 직접 잰다.
// 위치·크기는 영역에 대한 %로 지정해 화면 크기가 바뀌어도 흔들리지 않는다.
const CYCLE_BOX = { w: 120, h: 144 };
const CYCLE_INTERVAL = 1200; // ms (페이드는 CSS transition 0.3초)
const aboutChairImage = (chair) => `/images/about/chair-${chair.id}.png`;

// 이미지에서 불투명한 부분의 범위 [x0, y0, x1, y1]를 잰다
function measureAlpha(img) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h).data;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? [0, 0, w, h] : [x0, y0, x1 + 1, y1 + 1];
}

// 모든 의자의 실제 모양 높이를 같게 맞춘다 (가장 넓은 001도 괄호에 닿지 않는 높이)
const CHAIR_H = 128;

function placeChairImage(img, size, alpha) {
  const [ax0, ay0, ax1, ay1] = alpha;
  const scale = CHAIR_H / (ay1 - ay0);
  const left = CYCLE_BOX.w / 2 - ((ax0 + ax1) / 2) * scale; // 모양의 가운데 = 영역 가운데
  const top = CYCLE_BOX.h - ay1 * scale; // 모양의 바닥 = 영역 바닥
  img.style.setProperty('--img-w', `${((size[0] * scale) / CYCLE_BOX.w) * 100}%`);
  img.style.setProperty('--img-x', `${(left / CYCLE_BOX.w) * 100}%`);
  img.style.setProperty('--img-y', `${(top / CYCLE_BOX.h) * 100}%`);
  img.style.visibility = '';
}

const chairCycle = document.createElement('div');
chairCycle.className = 'about-chair-cycle';
chairCycle.setAttribute('aria-hidden', 'true');
const cycleImages = chairs.map((chair) => {
  const img = document.createElement('img');
  img.className = 'about-chair-cycle__img';
  img.alt = '';
  img.draggable = false;
  img.style.visibility = 'hidden'; // 위치를 정하기 전에는 숨긴다
  img.addEventListener('load', () => {
    if (img.src.endsWith(chair.image)) placeChairImage(img, chair.size, chair.alpha);
    else placeChairImage(img, [img.naturalWidth, img.naturalHeight], measureAlpha(img));
  });
  img.addEventListener('error', () => {
    if (!img.src.endsWith(chair.image)) img.src = chair.image; // ABOUT 전용 파일이 없으면 MAIN 이미지로 대신
  });
  img.src = aboutChairImage(chair);
  chairCycle.append(img);
  return img;
});
frame.append(chairCycle);

// ---------- 괄호 ( ) 공통 Hover 영역 ----------
// 왼쪽 괄호 ~ 의자 ~ 오른쪽 괄호를 덮는 하나의 영역. 이 영역 위에 커서가 있으면 두 괄호가 동시에 같은 Hover 상태가 된다.
// (괄호 사이·의자 위로 커서를 옮겨도 해제되지 않는다. 의자 이미지에는 효과를 주지 않는다.)
const parens = words.filter((word) => word.dataset.word === '(' || word.dataset.word === ')');
const parenZone = document.createElement('div');
parenZone.className = 'about-paren-zone';
parenZone.setAttribute('aria-hidden', 'true');
frame.append(parenZone);

function placeParenZone() {
  // offset 값은 스크롤 애니메이션의 transform 영향을 받지 않는 원래 배치 기준
  const boxes = [...parens, chairCycle].map((el) => ({
    left: el.offsetLeft,
    top: el.offsetTop,
    right: el.offsetLeft + el.offsetWidth,
    bottom: el.offsetTop + el.offsetHeight,
  }));
  const left = Math.min(...boxes.map((b) => b.left));
  const top = Math.min(...boxes.map((b) => b.top));
  Object.assign(parenZone.style, {
    left: `${left}px`,
    top: `${top}px`,
    width: `${Math.max(...boxes.map((b) => b.right)) - left}px`,
    height: `${Math.max(...boxes.map((b) => b.bottom)) - top}px`,
  });
}
placeParenZone();
window.addEventListener('resize', placeParenZone);
document.fonts?.ready.then(placeParenZone);

let cycleIndex = 0;
let cycleTimer = null;
cycleImages[0].classList.add('is-active');

function nextChair() {
  // 이전 의자는 0.3초 동안 사라지고 다음 의자가 0.3초 동안 나타난다
  cycleImages[cycleIndex].classList.remove('is-active');
  cycleIndex = (cycleIndex + 1) % cycleImages.length;
  cycleImages[cycleIndex].classList.add('is-active');
}

// ABOUT 페이지가 보이는 동안만 반복한다 (다른 탭으로 가면 멈췄다가 돌아오면 이어서)
function startCycle() {
  if (!cycleTimer) cycleTimer = setInterval(nextChair, CYCLE_INTERVAL);
}
function stopCycle() {
  clearInterval(cycleTimer);
  cycleTimer = null;
}
document.addEventListener('visibilitychange', () => (document.hidden ? stopCycle() : startCycle()));
if (!document.hidden) startCycle();

// 단어별 흩어지는 방향(화면 너비·높이 비율)과 깊이감용 크기 변화. 순서는 about.html과 같다.
const SCATTER = {
  The: { x: 0.3, y: -0.55, scale: 1.15, duration: 0.3 },
  Beyond: { x: -0.65, y: -0.1, scale: 0.9, duration: 0.34 },
  Visible: { x: -0.35, y: 0.45, scale: 1.1, duration: 0.3 },
  '(': { x: -0.55, y: -0.15, scale: 1, duration: 0.32 },
  ')': { x: 0.55, y: -0.15, scale: 1, duration: 0.32 },
  Form: { x: -0.7, y: 0.2, scale: 1.2, duration: 0.28 },
  Structure: { x: 0.7, y: 0.05, scale: 0.85, duration: 0.33 },
  Explore: { x: -0.15, y: 0.7, scale: 1.15, duration: 0.3 },
  More: { x: 0.45, y: 0.6, scale: 0.9, duration: 0.3 },
};

const tl = gsap.timeline({
  defaults: { ease: 'none' },
  scrollTrigger: {
    trigger: stage,
    start: 'top top',
    end: '+=250%',
    pin: true,
    scrub: 0.8, // 스크롤을 부드럽게 따라가되 멈추면 그 진행도에서 멈춘다
    invalidateOnRefresh: true, // 창 크기가 바뀌면 이동 거리를 다시 계산
  },
});

// 긴 about-01 프레임을 위로 흘려 아래쪽 단어(Structure, Explore, More)도 화면을 지나가게 한다
tl.to(frame, { y: () => -Math.max(0, frame.offsetHeight - window.innerHeight), duration: 0.5 }, 0);

words.forEach((word) => {
  const cfg = SCATTER[word.textContent.trim()];
  const base = parseFloat(word.style.getPropertyValue('--base'));
  const start = 0.04 + 0.42 * (base / FRAME_H); // 위쪽 단어부터 먼저 흩어진다

  tl.to(
    word,
    {
      x: () => cfg.x * window.innerWidth,
      y: () => cfg.y * window.innerHeight,
      scale: cfg.scale,
      duration: cfg.duration,
      ease: 'power2.in',
    },
    start,
  );
  tl.to(word, { opacity: 0, duration: cfg.duration, ease: 'power1.in' }, start);
});

// 괄호 사이 의자도 괄호와 같은 시점에 흩어지며 사라진다 (괄호는 좌우로, 의자는 위로)
{
  const start = 0.04 + 0.42 * (798.5 / FRAME_H);
  tl.to(chairCycle, { y: () => -0.2 * window.innerHeight, scale: 0.9, duration: 0.32, ease: 'power2.in' }, start);
  tl.to(chairCycle, { opacity: 0, duration: 0.32, ease: 'power1.in' }, start);
}

tl.fromTo(
  infoItems,
  { opacity: 0, y: 30 },
  { opacity: 1, y: 0, duration: 0.12, stagger: 0.035, ease: 'power2.out' },
  0.66,
);
