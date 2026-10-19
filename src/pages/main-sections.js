import { gsap } from 'gsap';
import { easeSlide } from '../lib/ease.js';

/**
 * 메인 화면(SECTION 01) ↔ CHAIR DNA 화면(SECTION 02) 풀스크린 전환
 * - 두 화면은 같은 자리에 겹쳐 있고(position: fixed), DNA가 위층
 * - 아래로: 메인이 위로 밀려나며 미세하게 축소, DNA가 아래에서 올라오며 등장 → 버블 순차 등장
 * - 위로: DNA 버블이 제자리에서 사라지며 DNA 화면이 아래로 퇴장, 메인이 위에서 다시 내려옴
 * - 입력: 휠·트랙패드(관성 스크롤 무시), 터치 스와이프, 키보드. 전환 중이거나 버블을 끄는 중에는 무시
 * - 숨겨진 화면은 inert(포커스·클릭 불가) + visibility hidden. DOM은 그대로라 상태가 유지된다
 */
const DURATION = 1.5; // 초 (화면 슬라이드. 버블 등장·퇴장 시간은 main-dna.js에서 따로)
const SHIFT = 0.08; // 화면 이동 거리 = viewport 높이 × 8%
const WHEEL_THRESHOLD = 30; // px, 이만큼 모이면 한 번 전환
const WHEEL_IDLE = 200; // ms, 이 시간 동안 휠이 없으면 모은 값을 비운다
const WHEEL_QUIET = 180; // ms, 전환 후 트랙패드 관성이 이 시간 멈춰야 다음 전환을 받는다
const SWIPE_MIN = 50; // px

export function mountSectionTransition({ main, dna, dnaApi }) {
  if (!main || !dna || !dnaApi) return null;
  const sections = [main, dna];
  const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

  let current = 0; // 0: 메인, 1: CHAIR DNA
  let busy = false;
  let timeline = null;

  function setInteractive(section, on) {
    section.inert = !on; // 포커스·클릭·보조기기에서 제외
  }

  setInteractive(main, true);
  setInteractive(dna, false);
  document.body.dataset.section = 'main';

  function go(index) {
    if (busy || index === current || index < 0 || index > 1 || dnaApi.isDragging()) return false;
    busy = true;
    const forward = index > current;
    current = index;
    document.body.dataset.section = forward ? 'dna' : 'main';

    const reduced = reducedQuery.matches;
    const shift = window.innerHeight * SHIFT;
    // 움직임 감소: 이동·축소 없이 짧은 crossfade만
    const from = (y, scale, opacity) => (reduced ? { opacity } : { y, scale, opacity });
    const duration = reduced ? 0.3 : DURATION;
    const ease = reduced ? 'none' : easeSlide;

    timeline?.kill();
    timeline = gsap.timeline({
      defaults: { duration, ease },
      onComplete() {
        const leaving = forward ? main : dna;
        leaving.style.visibility = 'hidden';
        if (!forward) dnaApi.pause(); // 보이지 않는 동안 물리 정지 (위치·결합은 유지)
        // 끝난 화면은 transform 없이 viewport에 정확히 맞춘다 (창 크기가 바뀌어도 어긋나지 않게)
        gsap.set(sections, { clearProps: 'transform' });
        gsap.set(forward ? dna : main, { opacity: 1 });
        busy = false;
        afterTransition();
      },
    });

    if (forward) {
      dna.style.visibility = 'visible';
      setInteractive(main, false);
      timeline
        .fromTo(main, from(0, 1, 1), from(-shift, 0.98, 0.9), 0)
        .fromTo(dna, from(shift, 0.99, 0), from(0, 1, 1), 0)
        // 화면이 거의 자리를 잡은 뒤 버블이 순차적으로 나타난다 (1.125초에 화면 이동 95%). 버블 자체의 속도는 그대로
        .add(() => dnaApi.enter({ reduced }), reduced ? 0 : DURATION * 0.75)
        .add(() => setInteractive(dna, true), 0);
      dnaApi.resume();
    } else {
      main.style.visibility = 'visible';
      setInteractive(dna, false);
      // 버블 퇴장과 화면 이동이 동시에 시작해 하나의 움직임처럼 겹친다
      dnaApi.leave({ reduced });
      // DNA 화면의 투명도만 약간 늦게 시작해 버블이 사라지는 모습이 보이게 한다 (끝나는 시점은 같다)
      const fadeDelay = reduced ? 0 : 0.12;
      timeline
        .fromTo(dna, reduced ? {} : { y: 0, scale: 1 }, reduced ? {} : { y: shift, scale: 0.99 }, 0)
        .fromTo(dna, { opacity: 1 }, { opacity: 0, duration: duration - fadeDelay }, fadeDelay)
        .fromTo(main, from(-shift, 0.98, 0.9), from(0, 1, 1), 0)
        .add(() => setInteractive(main, true), 0);
    }
    return true;
  }

  // ---------- 휠 · 트랙패드 ----------
  let acc = 0;
  let accTimer = 0;
  let lastWheel = 0;
  let lastAbs = 0;
  let locked = false; // 전환 직후, 같은 제스처(트랙패드 관성)가 끝날 때까지 잠금
  let quietTimer = 0;

  function afterTransition() {
    // 전환이 끝났을 때 휠이 이미 멈춰 있었다면 바로 다음 입력을 받는다
    const since = performance.now() - lastWheel;
    if (since >= WHEEL_QUIET) {
      locked = false;
      return;
    }
    locked = true;
    clearTimeout(quietTimer);
    quietTimer = setTimeout(() => (locked = false), WHEEL_QUIET - since);
  }

  window.addEventListener(
    'wheel',
    (event) => {
      if (event.ctrlKey) return; // 트랙패드 핀치 줌
      const dy = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * window.innerHeight : event.deltaY;
      if (Math.abs(dy) < Math.abs(event.deltaX)) return; // 가로 스크롤
      const abs = Math.abs(dy);
      const now = performance.now();
      const rising = abs > Math.max(lastAbs * 2, 12) && now - lastWheel < WHEEL_QUIET; // 관성 중 새로 쓸어 넘김
      lastWheel = now;
      lastAbs = abs;

      if (busy) return;
      if (locked) {
        if (!rising) {
          clearTimeout(quietTimer);
          quietTimer = setTimeout(() => (locked = false), WHEEL_QUIET);
          return;
        }
        locked = false;
        acc = 0;
      }
      if (dnaApi.isDragging()) return;

      acc += dy;
      clearTimeout(accTimer);
      accTimer = setTimeout(() => (acc = 0), WHEEL_IDLE);
      if (Math.abs(acc) >= WHEEL_THRESHOLD) {
        const dir = Math.sign(acc);
        acc = 0;
        if (go(current + dir)) locked = true; // 전환이 실제로 일어났을 때만 관성 잠금
      }
    },
    { passive: true },
  );

  // ---------- 터치 스와이프 ----------
  let touch = null;
  window.addEventListener(
    'touchstart',
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      // 버블을 끄는 터치는 화면 전환으로 보지 않는다
      if (event.touches.length !== 1 || target?.closest('.dna-bubble')) {
        touch = null;
        return;
      }
      touch = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    },
    { passive: true },
  );
  window.addEventListener(
    'touchend',
    (event) => {
      if (!touch) return;
      const t = event.changedTouches[0];
      const dx = t.clientX - touch.x;
      const dy = t.clientY - touch.y;
      touch = null;
      if (Math.abs(dy) < SWIPE_MIN || Math.abs(dy) < Math.abs(dx) * 1.2) return;
      go(current + (dy < 0 ? 1 : -1)); // 위로 쓸면 다음 화면
    },
    { passive: true },
  );
  window.addEventListener('touchcancel', () => (touch = null), { passive: true });

  // ---------- 키보드 ----------
  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (target instanceof Element && target.closest('input, textarea, select, [contenteditable]')) return;
    const next = { ArrowDown: 1, PageDown: 1, End: 1, ArrowUp: -1, PageUp: -1, Home: -1 }[event.key]
      ?? (event.key === ' ' && !(target instanceof Element && target.closest('a, button, [role="button"]')) ? (event.shiftKey ? -1 : 1) : 0);
    if (!next) return;
    event.preventDefault();
    const index = event.key === 'End' ? 1 : event.key === 'Home' ? 0 : current + next;
    go(index);
  });

  return {
    go,
    get current() {
      return current;
    },
    get busy() {
      return busy;
    },
  };
}
