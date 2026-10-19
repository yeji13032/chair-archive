import { gsap } from 'gsap';
import { chairs } from '../data/chairs.js';
import { chairDna, DNA_FRAME, DNA_RADIUS, sharedDna } from '../data/chair-dna.js';
import { easeExhibit } from '../lib/ease.js';
import '../styles/main-dna.css';

/**
 * CHAIR DNA 인터랙션 (메인 페이지 아래 섹션)
 * - idle: 원 버블이 제자리 주변을 천천히 떠다닌다
 * - hover: 외곽선이 굵어진다
 * - drag: 버블을 잡아 옮긴다 (잡은 버블이 맨 위)
 * - near match: 공통점이 있는 버블에 가까이 가면 서로 끌리고, 외곽선이 물방울처럼 이어지기 시작한다
 * - merge: 충분히 가까워지면 두 원이 하나의 blob으로 합쳐지고 공통 키워드가 나타난다
 * - reject: 공통점이 없으면 부딪힌 뒤 부드럽게 튕겨 나간다 (외곽선이 잠깐 회색)
 * - strong match: 3가지 기준이 모두 같으면 blob 안에 두 의자의 실루엣이 겹쳐 보인다
 * 물리 계산은 화면 픽셀 기준, 크기는 디자인 단위 u(메인 화면과 같은 min(너비/2000, 높이/1293))
 */
const SVG_NS = 'http://www.w3.org/2000/svg';
const LIME = '#b5e61d';
const REJECT_GREY = '#c4c4c4';

// 디자인 단위(2000 × 1292 프레임) 기준 값
const STROKE = 2.5; // 외곽선 두께
const STROKE_HOVER = 4;
const GOO_BLUR = 15; // blob 연결부의 부드러움 (원끼리 이어지는 목 부분)
const REST_RATIO = 0.87; // 결합 상태의 중심 거리 = 지름 × 0.87 (레퍼런스 이미지 1)
const MERGE_RATIO = 0.98; // 중심 거리가 지름 × 0.98보다 가까워지면 결합
const BREAK_RATIO = 1.45; // 결합된 짝을 이 거리 이상 끌어당기면 분리
const ATTRACT_GAP = 150; // 공통점이 있는 버블이 끌리기 시작하는 외곽선 사이 거리
const COLLIDE_GAP = 8; // 공통점이 없는 버블 사이 최소 간격
const FLOAT_AMP = 12; // 부유 진폭
const BREATH = 0.025; // 원 크기의 미세한 숨쉬기(±2.5%)
const APPEAR_SCALE = 0.95; // 등장·퇴장 시 버블(무리) 크기 0.95 ↔ 1

export function mountChairDna(section = document.querySelector('[data-dna]')) {
  if (!section) return null;
  const svg = section.querySelector('[data-dna-svg]');
  const bubbleLayer = section.querySelector('[data-dna-bubbles]');
  const overlayLayer = section.querySelector('[data-dna-overlays]');
  const labelLayer = section.querySelector('[data-dna-labels]');

  const defs = document.createElementNS(SVG_NS, 'defs');
  svg.append(defs);

  // ---------- 화면 단위 ----------
  let W = 0;
  let H = 0;
  let u = 1;
  const toPx = ([x, y]) => ({ x: (x / DNA_FRAME.w) * W, y: (y / DNA_FRAME.h) * H });

  // ---------- 버블 ----------
  const bubbles = chairs.map((chair, i) => {
    const dna = chairDna[chair.id];
    const el = document.createElement('div');
    el.className = 'dna-bubble';
    el.dataset.id = chair.id;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', `${chair.label[0]} ${chair.id}: ${[...dna.form, ...dna.material, ...dna.structure].join(', ')}`);
    const img = document.createElement('img');
    img.className = 'dna-bubble__img';
    img.alt = '';
    img.draggable = false;
    el.append(img);
    bubbleLayer.append(el);
    const bubble = {
      id: chair.id,
      chair,
      el,
      img,
      // 레퍼런스처럼 정면으로 똑바로 선 의자 이미지 (ABOUT 페이지와 같은 public/images/about/chair-00N.png)
      src: `/images/about/chair-${chair.id}.png`,
      shape: null, // { size: [w, h], alpha: [x0, y0, x1, y1] } 불러온 뒤 측정
      homeDesign: dna.home,
      radiusDesign: dna.radius ?? DNA_RADIUS, // 원 반지름 (프레임 단위)
      r: 0, // 원 반지름 (px, layout에서 계산)
      home: { x: 0, y: 0 },
      pos: { x: 0, y: 0 },
      vel: { x: 0, y: 0 },
      kick: { x: 0, y: 0 }, // 튕김·끌림을 보여 주는 시각적 오프셋 (드래그 중에도 적용)
      phase: i * 1.37,
      breathPhase: i * 0.91,
      dragging: false,
      hover: false,
      rejectUntil: 0,
      z: i,
      show: 0, // 등장 정도 0~1 (enter/leave가 GSAP으로 조절). 0이면 보이지 않는다
      render: { x: 0, y: 0, k: 1, o: 0 }, // 마지막으로 그린 위치·크기·투명도
    };
    img.addEventListener('load', () => {
      bubble.shape = measureShape(img);
      placeImage(bubble);
    });
    img.src = bubble.src;
    return bubble;
  });
  const byId = new Map(bubbles.map((b) => [b.id, b]));

  // 투명 PNG에서 실제 의자가 차지하는 영역 [x0, y0, x1, y1]
  function measureShape(image) {
    const w = image.naturalWidth;
    const h = image.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    const { data } = ctx.getImageData(0, 0, w, h);
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
    return { size: [w, h], alpha: x1 < 0 ? [0, 0, w, h] : [x0, y0, x1 + 1, y1 + 1] };
  }

  // 의자 이미지: 투명 여백을 뺀 실제 모양(alpha)을 원 안 가운데에, 원 지름의 약 65% × 70% 안에 맞춘다
  function placeImage(b) {
    if (!b.shape) return;
    const r = DNA_RADIUS * u; // 이미지 크기 기준 (원 크기가 달라도 의자 크기는 그대로)
    const c = b.r; // 원의 중심 (버블 요소 안 좌표)
    const { size, alpha } = b.shape;
    const aw = alpha[2] - alpha[0];
    const ah = alpha[3] - alpha[1];
    const s = Math.min((1.3 * r) / aw, (1.4 * r) / ah);
    Object.assign(b.img.style, {
      width: `${size[0] * s}px`,
      height: `${size[1] * s}px`,
      left: `${c - ((alpha[0] + alpha[2]) / 2) * s}px`,
      top: `${c - ((alpha[1] + alpha[3]) / 2) * s}px`,
    });
    // 키워드 배치에서 피할 의자 영역 (원 중심 기준 반 너비·반 높이, px)
    b.chairHalf = { w: (aw * s) / 2, h: (ah * s) / 2 };
  }

  // ---------- 연결(결합) ----------
  const links = new Map(); // 'a|b' → { a, b, shared, label, overlay }
  const linkKey = (a, b) => (a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`);
  const shareCache = new Map();
  const share = (a, b) => {
    const k = linkKey(a, b);
    if (!shareCache.has(k)) shareCache.set(k, sharedDna(a.id, b.id));
    return shareCache.get(k);
  };

  function addLink(a, b) {
    const shared = share(a, b);
    const label = document.createElement('p');
    label.className = 'dna-label';
    label.innerHTML = `<span class="dna-label__count">${shared.count} / 3 SHARED${shared.count === 3 ? ' — STRONG MATCH' : ''}</span>${keywordHtml(shared.keywords)}`;
    labelLayer.append(label);
    let overlay = null;
    if (shared.count === 3) {
      overlay = document.createElement('div');
      overlay.className = 'dna-overlay';
      for (const c of [a, b]) {
        const im = document.createElement('img');
        im.className = 'dna-overlay__img';
        im.src = c.src;
        im.alt = '';
        im.dataset.id = c.id;
        overlay.append(im);
      }
      overlayLayer.append(overlay);
    }
    // x·y·alpha: 화면에 그려진 키워드 위치·투명도 (목표를 부드럽게 따라감), compact: 키워드를 세로로 쌓은 모양
    const link = { a, b, shared, label, overlay, born: performance.now(), x: 0, y: 0, alpha: 0, compact: false, cand: -1 };
    links.set(linkKey(a, b), link);
    // 결합되면 같은 위상으로 함께 떠다닌다
    b.phase = a.phase;
    requestAnimationFrame(() => {
      label.classList.add('is-visible');
      overlay?.classList.add('is-visible');
    });
  }

  function removeLink(key) {
    const link = links.get(key);
    if (!link) return;
    link.label.remove();
    link.overlay?.remove();
    links.delete(key);
  }

  const linked = (a, b) => links.has(linkKey(a, b));

  // 연결된 무리(cluster): 같은 blob으로 그린다
  function clusters(extraPairs) {
    const parent = new Map(bubbles.map((b) => [b.id, b.id]));
    const find = (x) => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x))), parent.get(x)));
    const join = (a, b) => parent.set(find(a.id), find(b.id));
    for (const { a, b } of links.values()) join(a, b);
    for (const [a, b] of extraPairs) join(a, b);
    const groups = new Map();
    for (const b of bubbles) {
      const root = find(b.id);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(b);
    }
    return [...groups.values()];
  }

  // ---------- SVG: 무리마다 gooey 외곽선 필터 ----------
  // 채운 원들을 흐리게 → 투명도 임계값으로 하나의 덩어리 → 안쪽을 깎아 외곽선만 라임색으로
  const groupPool = [];
  function groupAt(i) {
    while (groupPool.length <= i) {
      const id = `dna-goo-${groupPool.length}`;
      const filter = document.createElementNS(SVG_NS, 'filter');
      filter.id = id;
      filter.setAttribute('x', '-30%');
      filter.setAttribute('y', '-30%');
      filter.setAttribute('width', '160%');
      filter.setAttribute('height', '160%');
      filter.setAttribute('color-interpolation-filters', 'sRGB');
      filter.innerHTML = `
        <feGaussianBlur in="SourceAlpha" stdDeviation="10" result="blur" />
        <feColorMatrix in="blur" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 26 -12" result="goo" />
        <feMorphology in="goo" operator="erode" radius="2" result="inner" />
        <feComposite in="goo" in2="inner" operator="out" result="ring" />
        <feFlood flood-color="${LIME}" result="color" />
        <feComposite in="color" in2="ring" operator="in" />`;
      defs.append(filter);
      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('filter', `url(#${id})`);
      svg.append(g);
      groupPool.push({
        g,
        blur: filter.querySelector('feGaussianBlur'),
        erode: filter.querySelector('feMorphology'),
        flood: filter.querySelector('feFlood'),
        circles: [],
      });
    }
    return groupPool[i];
  }

  function circleIn(group, i) {
    while (group.circles.length <= i) {
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('fill', '#000');
      group.g.append(c);
      group.circles.push(c);
    }
    return group.circles[i];
  }

  // ---------- 크기 변화 ----------
  function layout() {
    const prevW = W;
    const prevH = H;
    W = section.clientWidth;
    H = section.clientHeight;
    u = Math.min(W / 2000, H / 1293);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    for (const b of bubbles) {
      if (!prevW) {
        b.home = toPx(b.homeDesign);
        b.pos = { ...b.home };
      } else {
        // 화면 크기가 바뀌면 현재 배치를 같은 비율로 옮긴다
        for (const p of [b.home, b.pos]) {
          p.x *= W / prevW;
          p.y *= H / prevH;
        }
      }
      b.r = b.radiusDesign * u;
      b.el.style.width = `${2 * b.r}px`;
      b.el.style.height = `${2 * b.r}px`;
      placeImage(b);
    }
  }

  // ---------- 포인터 ----------
  let drag = null; // { b, dx, dy, x, y, id }

  function pointerPos(event) {
    const rect = section.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  let zTop = bubbles.length;
  for (const b of bubbles) {
    b.el.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const p = pointerPos(event);
      drag = { b, dx: b.pos.x - p.x, dy: b.pos.y - p.y, x: p.x, y: p.y, id: event.pointerId };
      b.dragging = true;
      b.z = ++zTop;
      b.el.classList.add('is-dragging');
      try {
        b.el.setPointerCapture(event.pointerId);
      } catch {
        // 합성 포인터 등: 캡처 없이도 window 이벤트로 드래그는 이어진다
      }
    });
    b.el.addEventListener('pointerenter', () => (b.hover = true));
    b.el.addEventListener('pointerleave', () => (b.hover = false));
  }

  window.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const p = pointerPos(event);
    drag.x = p.x;
    drag.y = p.y;
  });

  function endDrag(event) {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    const { b } = drag;
    b.dragging = false;
    b.el.classList.remove('is-dragging');
    // 놓은 자리를 새 기준 위치로 (연결된 무리 전체)
    for (const group of clusters([])) {
      if (!group.includes(b)) continue;
      for (const m of group) m.home = { ...m.pos };
    }
    drag = null;
  }
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  // ---------- 물리 ----------
  let last = performance.now();
  let raf = 0;
  let running = false;
  let simT = 0; // 물리 시계: 화면이 보이는 동안만 흐른다 (다시 보일 때 부유가 튀지 않게)
  const motion = { float: 0 }; // 부유 세기 0~1: 첫 등장 후 서서히 시작

  function step(now) {
    const dt = Math.min(1 / 30, (now - last) / 1000);
    last = now;
    simT += dt;
    const t = simT;

    // 1) 드래그한 버블은 포인터를 부드럽게 따라간다
    if (drag) {
      const { b } = drag;
      const tx = drag.x + drag.dx;
      const ty = drag.y + drag.dy;
      const k = 1 - Math.exp(-dt * 22);
      const nx = b.pos.x + (tx - b.pos.x) * k;
      const ny = b.pos.y + (ty - b.pos.y) * k;
      b.vel = { x: (nx - b.pos.x) / dt, y: (ny - b.pos.y) / dt };
      b.pos = { x: nx, y: ny };
    }

    // 2) 부유: 기준 위치 주변의 느린 원 운동으로 끌어당김 (드래그 중이 아닌 버블)
    for (const b of bubbles) {
      if (b.dragging) continue;
      const fx = b.home.x + Math.sin(t * 0.55 + b.phase) * FLOAT_AMP * u * motion.float;
      const fy = b.home.y + Math.cos(t * 0.43 + b.phase * 1.3) * FLOAT_AMP * u * motion.float;
      b.vel.x += (fx - b.pos.x) * 7 * dt;
      b.vel.y += (fy - b.pos.y) * 7 * dt;
    }

    // 3) 쌍별 상호작용
    const nearPairs = [];
    for (let i = 0; i < bubbles.length; i++) {
      for (let j = i + 1; j < bubbles.length; j++) {
        const a = bubbles[i];
        const b = bubbles[j];
        const dx = b.pos.x - a.pos.x;
        const dy = b.pos.y - a.pos.y;
        const dist = Math.hypot(dx, dy) || 0.001;
        const nx = dx / dist;
        const ny = dy / dist;
        const key = linkKey(a, b);
        const d0 = a.r + b.r; // 두 원이 맞닿는 중심 거리

        if (links.has(key)) {
          // 결합: 정해진 간격을 유지하는 스프링. 한쪽을 멀리 끌면 분리
          if ((a.dragging || b.dragging) && dist > d0 * BREAK_RATIO) {
            removeLink(key);
            continue;
          }
          const f = (dist - d0 * REST_RATIO) * 26 * dt;
          if (!a.dragging) {
            a.vel.x += nx * f;
            a.vel.y += ny * f;
          }
          if (!b.dragging) {
            b.vel.x -= nx * f;
            b.vel.y -= ny * f;
          }
          continue;
        }

        const shared = share(a, b);
        const gap = dist - d0;
        const dragged = a.dragging ? a : b.dragging ? b : null;

        if (shared.count > 0 && dragged && gap < ATTRACT_GAP * u) {
          // near match: 공통점이 있으면 자석처럼 끌어당긴다
          const other = dragged === a ? b : a;
          const pull = Math.max(0, 1 - gap / (ATTRACT_GAP * u));
          const s = (other === b ? -1 : 1) * 900 * u * pull * pull * dt;
          other.vel.x += nx * s;
          other.vel.y += ny * s;
          // 잡은 버블도 살짝 끌려가 보이게 (시각적 오프셋)
          const sk = (dragged === a ? 1 : -1) * 18 * u * pull;
          dragged.kick.x += (nx * sk - dragged.kick.x) * 0.2;
          dragged.kick.y += (ny * sk - dragged.kick.y) * 0.2;
          nearPairs.push([a, b]);
          if (dist < d0 * MERGE_RATIO) addLink(a, b);
          continue;
        }

        // 그 밖: 겹치지 않게 밀어낸다. 공통점이 없으면 튕겨 나감(reject)
        const minDist = d0 + COLLIDE_GAP * u;
        if (dist < minDist) {
          const overlap = minDist - dist;
          // 공통점 없는 의자에 들이밀면 잡은 버블도 같이 밀려나 겹치지 않는다 (가장자리에 막힌 경우 포함)
          const movers = dragged && shared.count === 0 ? [a, b] : [a, b].filter((m) => !m.dragging);
          for (const m of movers) {
            const sign = m === a ? -1 : 1;
            const share2 = overlap / movers.length;
            m.pos.x += nx * sign * share2;
            m.pos.y += ny * sign * share2;
            const bounce = 260 * u * (overlap / (d0 * 0.2) + 0.4);
            m.vel.x += nx * sign * bounce * dt * 6;
            m.vel.y += ny * sign * bounce * dt * 6;
          }
          if (dragged && shared.count === 0) {
            a.rejectUntil = b.rejectUntil = t + 0.45;
            // 잡은 버블은 반대쪽으로 살짝 밀렸다가 돌아오는 느낌
            const sign = dragged === a ? -1 : 1;
            dragged.kick.x = nx * sign * 22 * u;
            dragged.kick.y = ny * sign * 22 * u;
          }
        }
      }
    }

    // 4) 적분 + 감쇠 + 화면 경계
    for (const b of bubbles) {
      b.kick.x *= Math.exp(-dt * 7);
      b.kick.y *= Math.exp(-dt * 7);
      if (b.dragging) continue;
      const damp = Math.exp(-dt * 4.2);
      b.vel.x *= damp;
      b.vel.y *= damp;
      b.pos.x += b.vel.x * dt;
      b.pos.y += b.vel.y * dt;
      const { r } = b;
      const m = r + 6 * u;
      const bottom = H - 60 * u; // 하단 문구 위
      const top = 70 * u; // 상단 메뉴 아래
      if (b.pos.x < m) (b.pos.x = m), (b.vel.x = Math.abs(b.vel.x) * 0.4);
      if (b.pos.x > W - m) (b.pos.x = W - m), (b.vel.x = -Math.abs(b.vel.x) * 0.4);
      if (b.pos.y < top + r) (b.pos.y = top + r), (b.vel.y = Math.abs(b.vel.y) * 0.4);
      if (b.pos.y > bottom - r) (b.pos.y = bottom - r), (b.vel.y = -Math.abs(b.vel.y) * 0.4);
    }
    if (drag) {
      const { b } = drag;
      b.pos.x = Math.min(Math.max(b.pos.x, b.r), W - b.r);
      b.pos.y = Math.min(Math.max(b.pos.y, b.r), H - b.r);
    }

    render(t, nearPairs);
    if (running) raf = requestAnimationFrame(step);
  }

  // ---------- 그리기 ----------
  function render(t, nearPairs) {
    const groups = clusters(nearPairs).sort((g1, g2) => Math.max(...g1.map((b) => b.z)) - Math.max(...g2.map((b) => b.z)));
    const nearSet = new Set(nearPairs.flat());

    groups.forEach((group, gi) => {
      const pool = groupAt(gi);
      const merged = group.length > 1;
      const hot = group.some((b) => b.hover || b.dragging) || group.some((b) => nearSet.has(b));
      const rejected = group.some((b) => b.rejectUntil > t);
      // 등장·퇴장: 무리 전체가 무게중심을 기준으로 함께 0.95 ↔ 1 크기, 0 ↔ 1 투명도 (blob 모양 유지)
      const show = group.reduce((sum, b) => sum + b.show, 0) / group.length;
      const k = APPEAR_SCALE + (1 - APPEAR_SCALE) * show;
      let gx = 0;
      let gy = 0;
      for (const b of group) {
        gx += b.pos.x + b.kick.x;
        gy += b.pos.y + b.kick.y;
      }
      gx /= group.length;
      gy /= group.length;
      for (const b of group) {
        b.render.x = gx + (b.pos.x + b.kick.x - gx) * k;
        b.render.y = gy + (b.pos.y + b.kick.y - gy) * k;
        b.render.k = k;
        b.render.o = show;
      }

      pool.blur.setAttribute('stdDeviation', String((merged ? GOO_BLUR : 2) * u * k));
      pool.erode.setAttribute('radius', String((hot ? STROKE_HOVER : STROKE) * u));
      pool.flood.setAttribute('flood-color', rejected ? REJECT_GREY : LIME);
      pool.g.style.display = show > 0.001 ? '' : 'none';
      pool.g.style.opacity = show.toFixed(3);
      // 맨 위 무리가 SVG에서도 마지막에 그려지도록
      svg.append(pool.g);
      group.forEach((b, ci) => {
        const breath = 1 + Math.sin(t * 0.8 + b.breathPhase) * BREATH;
        const c = circleIn(pool, ci);
        c.style.display = '';
        c.setAttribute('cx', b.render.x.toFixed(1));
        c.setAttribute('cy', b.render.y.toFixed(1));
        c.setAttribute('r', (b.r * breath * k).toFixed(1));
      });
      for (let ci = group.length; ci < pool.circles.length; ci++) pool.circles[ci].style.display = 'none';
    });
    for (let gi = groups.length; gi < groupPool.length; gi++) groupPool[gi].g.style.display = 'none';

    for (const b of bubbles) {
      const { x, y, k, o } = b.render;
      const { r } = b;
      b.el.style.transform = `translate3d(${(x - r).toFixed(1)}px, ${(y - r).toFixed(1)}px, 0) scale(${k.toFixed(4)})`;
      b.el.style.opacity = o.toFixed(3);
      b.el.style.visibility = o > 0.01 ? '' : 'hidden'; // 보이지 않는 버블은 잡히지 않게
      b.el.style.zIndex = String(b.z);
    }

    // 실루엣: 결합한 두 원의 가운데. 생길 때 서서히 나타나고, 무리와 함께 퇴장
    const now = performance.now();
    for (const link of links.values()) {
      const { a, b, overlay } = link;
      const ra = a.render;
      const rb = b.render;
      const k = Math.min(ra.k, rb.k);
      const show = Math.min(ra.o, rb.o);
      const mx = (ra.x + rb.x) / 2;
      const my = (ra.y + rb.y) / 2;
      if (overlay) {
        const size = DNA_RADIUS * u * 1.1 * k; // 실루엣 크기는 의자 이미지 기준 (원 크기와 무관)
        overlay.style.width = overlay.style.height = `${size}px`;
        overlay.style.transform = `translate3d(${(mx - size / 2).toFixed(1)}px, ${(my - size / 2).toFixed(1)}px, 0)`;
        overlay.style.opacity = (show * Math.min(1, (now - link.born) / 600)).toFixed(3);
        overlay.style.zIndex = String(Math.max(a.z, b.z) + 1);
        for (const im of overlay.children) {
          const c = byId.get(im.dataset.id).shape;
          if (!c) continue;
          const aw = c.alpha[2] - c.alpha[0];
          const ah = c.alpha[3] - c.alpha[1];
          const s = Math.min(size / aw, size / ah);
          Object.assign(im.style, {
            width: `${c.size[0] * s}px`,
            height: `${c.size[1] * s}px`,
            left: `${size / 2 - ((c.alpha[0] + c.alpha[2]) / 2) * s}px`,
            top: `${size / 2 - ((c.alpha[1] + c.alpha[3]) / 2) * s}px`,
          });
        }
      }
    }

    layoutLabels(now);
  }

  // ---------- 공통 키워드 배치 ----------
  // 두 의자 무리: 결합한 두 원의 가운데 아래 (기존 그대로)
  // 세 의자 이상 무리: 연결마다 키워드를 blob 안 빈 곳(두 원이 이어지는 목 부분 주변)에 한 줄에 하나씩 쌓아 배치.
  //   다른 키워드와 겹치거나, 의자 이미지·실루엣을 20% 넘게 가리거나, blob 밖으로 나가면 그 자리는 쓰지 않는다.
  //   한 연결이라도 자리가 없으면 무리의 키워드를 하나의 텍스트 그룹으로 모아 blob 안 빈 곳(없으면 무리 아래)에 둔다.
  const MAX_CHAIR_COVER = 0.2;
  const MODE_HOLD = 18; // 프레임: 배치 방식이 이만큼 계속 바뀌어야 전환 (떠다니는 중에 깜빡이지 않게)
  const groupLabels = new Map(); // 무리 키(의자 id들) → 텍스트 그룹
  const clusterModes = new Map(); // 무리 키 → { mode, pending }

  function keywordHtml(keywords, perLine = 0) {
    const items = keywords.map((k, i) => {
      const sep = i === 0 ? '' : perLine && i % perLine === 0 ? '<br>' : '<span class="dna-label__sep"> · </span>';
      return `${sep}<span class="dna-label__kw">${k}</span>`;
    });
    return `<span class="dna-label__kws">${items.join('')}</span>`;
  }

  // 키워드 요소 크기 [너비, 높이] (글자 크기가 u에 따라 바뀌므로 u나 내용이 바뀌면 다시 잰다)
  function labelSize(el, compact) {
    if (!el._sizes || el._sizes.u !== u || el._sizes.html !== el.innerHTML) {
      const had = el.classList.contains('is-compact');
      el.classList.remove('is-compact');
      const normal = [el.offsetWidth, el.offsetHeight];
      el.classList.add('is-compact');
      const comp = [el.offsetWidth, el.offsetHeight];
      el.classList.toggle('is-compact', had);
      el._sizes = { u, html: el.innerHTML, normal, compact: comp };
    }
    return compact ? el._sizes.compact : el._sizes.normal;
  }

  const rectAt = (x, y, w, h) => ({ x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2 });
  const overlapArea = (p, q) =>
    Math.max(0, Math.min(p.x1, q.x1) - Math.max(p.x0, q.x0)) * Math.max(0, Math.min(p.y1, q.y1) - Math.max(p.y0, q.y0));

  // 사각형 네 귀퉁이가 모두 무리의 원(외곽선 안쪽 여백 포함) 안에 있는지
  function insideBlob(rect, members) {
    const pad = 8 * u;
    const corners = [[rect.x0, rect.y0], [rect.x1, rect.y0], [rect.x0, rect.y1], [rect.x1, rect.y1]];
    return corners.every(([x, y]) => members.some((b) => Math.hypot(x - b.render.x, y - b.render.y) < b.r * b.render.k - pad));
  }

  // 후보 자리 평가: 놓을 수 없으면 Infinity, 아니면 의자 이미지·실루엣을 가리는 비율
  function coverScore(rect, members, placed, obstacles) {
    if (!insideBlob(rect, members)) return Infinity;
    const gap = 6 * u;
    for (const p of placed) {
      if (overlapArea(rect, { x0: p.x0 - gap, y0: p.y0 - gap, x1: p.x1 + gap, y1: p.y1 + gap }) > 0) return Infinity;
    }
    const area = (rect.x1 - rect.x0) * (rect.y1 - rect.y0) || 1;
    let covered = 0;
    for (const o of obstacles) covered += overlapArea(rect, o);
    return covered / area;
  }

  // 연결 하나의 후보 자리: 두 원 중심을 잇는 선의 가운데에서 수직·수평으로 조금씩 옮긴 점들
  function linkCandidates(link) {
    const ra = link.a.render;
    const rb = link.b.render;
    const dx = rb.x - ra.x;
    const dy = rb.y - ra.y;
    const d = Math.hypot(dx, dy) || 1;
    const nx = -dy / d;
    const ny = dx / d;
    const s = Math.min(link.a.r * ra.k, link.b.r * rb.k);
    const out = [];
    for (const along of [0, 0.12, -0.12]) {
      for (const across of [0, 0.3, -0.3, 0.55, -0.55, 0.8, -0.8]) {
        out.push([(ra.x + rb.x) / 2 + dx * along + nx * across * s, (ra.y + rb.y) / 2 + dy * along + ny * across * s]);
      }
    }
    return out;
  }

  // 후보 중 가장 덜 가리는 자리 (이전 자리도 충분히 좋으면 그대로 유지해 떨리지 않게)
  function pickSpot(candidates, size, members, placed, obstacles, prev) {
    let index = -1;
    let score = Infinity;
    candidates.forEach(([x, y], i) => {
      const s = coverScore(rectAt(x, y, size[0], size[1]), members, placed, obstacles);
      if (s < score - 1e-6) {
        index = i;
        score = s;
      }
    });
    if (prev >= 0 && prev < candidates.length) {
      const [x, y] = candidates[prev];
      const s = coverScore(rectAt(x, y, size[0], size[1]), members, placed, obstacles);
      if (s <= MAX_CHAIR_COVER && s <= score + 0.05) return { index: prev, score: s };
    }
    return { index, score };
  }

  function groupLabelFor(key) {
    let g = groupLabels.get(key);
    if (!g) {
      const el = document.createElement('p');
      el.className = 'dna-label dna-label--group';
      labelLayer.append(el);
      g = { el, x: 0, y: 0, tx: 0, ty: 0, alpha: 0, target: 0, cand: -1, side: -1, sig: '', show: 0, z: 0 };
      groupLabels.set(key, g);
    }
    return g;
  }

  // 무리 전체의 공통 키워드를 하나의 텍스트로: 여러 연결에서 겹치는 키워드부터, 한 줄에 2개씩
  function fillGroupLabel(g, members, clusterLinks) {
    const freq = new Map();
    for (const l of clusterLinks) for (const kw of l.shared.keywords) freq.set(kw, (freq.get(kw) ?? 0) + 1);
    const keywords = [...freq.keys()].sort((p, q) => freq.get(q) - freq.get(p));
    const strong = clusterLinks.some((l) => l.shared.count === 3);
    const sig = `${members.length}|${strong}|${keywords.join(',')}`;
    if (sig === g.sig) return;
    g.sig = sig;
    g.el.innerHTML = `<span class="dna-label__count">${members.length} CHAIRS CONNECTED${strong ? ' — STRONG MATCH' : ''}</span>${keywordHtml(keywords, 2)}`;
  }

  // blob 안에 자리가 없을 때: 무리의 아래·위·왼쪽·오른쪽 바깥 중 다른 버블·키워드와 가장 덜 겹치는 곳
  function outsideSpot(members, size, placed, g) {
    const gap = 18 * u;
    const margin = 12 * u;
    const [w, h] = size;
    const x0 = Math.min(...members.map((b) => b.render.x - b.r * b.render.k));
    const x1 = Math.max(...members.map((b) => b.render.x + b.r * b.render.k));
    const y0 = Math.min(...members.map((b) => b.render.y - b.r * b.render.k));
    const y1 = Math.max(...members.map((b) => b.render.y + b.r * b.render.k));
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const candidates = [
      [cx, y1 + gap + h / 2], // 아래 (두 의자 결합과 같은 방향)
      [cx, y0 - gap - h / 2], // 위
      [x0 - gap - w / 2, cy], // 왼쪽
      [x1 + gap + w / 2, cy], // 오른쪽
    ];
    const others = bubbles
      .filter((b) => !members.includes(b) && b.render.o > 0.01)
      .map((b) => rectAt(b.render.x, b.render.y, b.r * 2 * b.render.k, b.r * 2 * b.render.k));
    const scoreAt = ([x, y]) => {
      const rect = rectAt(x, y, w, h);
      // 화면 밖·상단 메뉴·하단 문구와 겹치면 쓰지 않는다
      if (rect.x0 < margin || rect.x1 > W - margin || rect.y0 < 70 * u || rect.y1 > H - 60 * u) return Infinity;
      let s = 0;
      for (const o of others) s += overlapArea(rect, o);
      for (const p of placed) s += overlapArea(rect, p) * 4;
      return s / (w * h);
    };
    const scores = candidates.map(scoreAt);
    let best = scores.indexOf(Math.min(...scores));
    // 이전 방향이 크게 나쁘지 않으면 유지 (떠다니는 중에 위아래로 오가지 않게)
    if (g.side >= 0 && scores[g.side] <= scores[best] + 0.1) best = g.side;
    if (!Number.isFinite(scores[best])) best = 0;
    g.side = best;
    const [x, y] = candidates[best];
    return [Math.min(Math.max(x, w / 2 + margin), W - w / 2 - margin), Math.min(Math.max(y, h / 2 + 70 * u), H - 60 * u - h / 2)];
  }

  function layoutLabels(now) {
    // 가리지 말아야 할 것: 의자 이미지(투명 여백 제외)와 강한 결합의 실루엣
    const obstacles = [];
    for (const b of bubbles) {
      if (b.render.o < 0.01 || !b.chairHalf) continue;
      const { x, y, k } = b.render;
      obstacles.push(rectAt(x, y, b.chairHalf.w * 2 * k, b.chairHalf.h * 2 * k));
    }
    for (const l of links.values()) {
      if (!l.overlay) continue;
      const size = DNA_RADIUS * u * 1.1 * Math.min(l.a.render.k, l.b.render.k);
      obstacles.push(rectAt((l.a.render.x + l.b.render.x) / 2, (l.a.render.y + l.b.render.y) / 2, size, size));
    }

    const placed = [];
    const targets = new Map(); // 연결 → { x, y, compact, visible }
    const liveKeys = new Set();

    for (const members of clusters([])) {
      if (members.length < 2) continue;
      const set = new Set(members);
      const clusterLinks = [...links.values()].filter((l) => set.has(l.a)).sort((p, q) => p.born - q.born);
      const key = members.map((b) => b.id).sort().join('|');
      liveKeys.add(key);

      if (members.length === 2) {
        // 두 의자: 기존과 같은 자리 (두 원 가운데 아래)
        for (const l of clusterLinks) {
          const ra = l.a.render;
          const rb = l.b.render;
          const k = Math.min(ra.k, rb.k);
          const [, h] = labelSize(l.label, false);
          const below = Math.max(ra.y + l.a.r * k, rb.y + l.b.r * k) + 18 * u;
          targets.set(l, { x: (ra.x + rb.x) / 2, y: below + h / 2, compact: false, visible: true });
        }
        continue;
      }

      // 세 의자 이상: 연결마다 blob 안 빈 곳에
      const tried = [];
      let fits = true;
      for (const l of clusterLinks) {
        const size = labelSize(l.label, true);
        const candidates = linkCandidates(l);
        const { index, score } = pickSpot(candidates, size, members, [...placed, ...tried], obstacles, l.compact ? l.cand : -1);
        if (index < 0 || score > MAX_CHAIR_COVER) fits = false;
        const [x, y] = index >= 0 ? candidates[index] : [(l.a.render.x + l.b.render.x) / 2, (l.a.render.y + l.b.render.y) / 2];
        l.nextCand = index;
        tried.push(rectAt(x, y, size[0], size[1]));
        targets.set(l, { x, y, compact: true, visible: true });
      }

      // 배치 방식은 같은 결과가 몇 프레임 이어질 때만 바꾼다
      const want = fits ? 'inside' : 'group';
      const state = clusterModes.get(key) ?? { mode: want, pending: 0 };
      if (want !== state.mode) {
        state.pending += 1;
        if (state.pending >= MODE_HOLD) {
          state.mode = want;
          state.pending = 0;
        }
      } else state.pending = 0;
      clusterModes.set(key, state);

      if (state.mode === 'inside') {
        placed.push(...tried);
        for (const l of clusterLinks) l.cand = l.nextCand;
        continue;
      }

      // 텍스트 그룹: blob 안 빈 곳 → 없으면 무리 아래 (화면 아래 문구에 닿으면 무리 위)
      for (const l of clusterLinks) targets.get(l).visible = false;
      const g = groupLabelFor(key);
      fillGroupLabel(g, members, clusterLinks);
      const size = labelSize(g.el, false);
      const cx = members.reduce((s, b) => s + b.render.x, 0) / members.length;
      const cy = members.reduce((s, b) => s + b.render.y, 0) / members.length;
      const candidates = [[cx, cy], ...clusterLinks.flatMap(linkCandidates)];
      const spot = pickSpot(candidates, size, members, placed, obstacles, g.cand);
      if (spot.index >= 0 && spot.score <= MAX_CHAIR_COVER) {
        [g.tx, g.ty] = candidates[spot.index];
        g.cand = spot.index;
      } else {
        g.cand = -1;
        [g.tx, g.ty] = outsideSpot(members, size, placed, g);
      }
      placed.push(rectAt(g.tx, g.ty, size[0], size[1]));
      g.target = 1;
      g.show = Math.min(...members.map((b) => b.render.o));
      g.z = Math.max(...members.map((b) => b.z));
    }

    // 그리기: 자리는 부드럽게 따라가고, 모양(가로·세로 쌓기)이 바뀔 때는 사라졌다가 새 자리에서 나타난다
    const follow = 0.25;
    for (const l of links.values()) {
      const t = targets.get(l);
      if (!t) continue;
      let want = t.visible ? 1 : 0;
      if (t.compact !== l.compact) {
        want = 0;
        if (l.alpha < 0.05) {
          l.compact = t.compact;
          l.label.classList.toggle('is-compact', t.compact);
        }
      }
      if (l.alpha < 0.05) {
        l.x = t.x;
        l.y = t.y;
      } else {
        l.x += (t.x - l.x) * follow;
        l.y += (t.y - l.y) * follow;
      }
      l.alpha += (want - l.alpha) * 0.2;
      const show = Math.min(l.a.render.o, l.b.render.o);
      l.label.style.transform = `translate3d(${l.x.toFixed(1)}px, ${l.y.toFixed(1)}px, 0) translate(-50%, -50%)`;
      l.label.style.opacity = (show * Math.min(1, (now - l.born) / 400) * l.alpha).toFixed(3);
      l.label.style.zIndex = String(Math.max(l.a.z, l.b.z));
    }
    for (const [key, g] of groupLabels) {
      if (!liveKeys.has(key) || clusterModes.get(key)?.mode !== 'group') g.target = 0;
      if (g.alpha < 0.05 && g.target) {
        g.x = g.tx;
        g.y = g.ty;
      } else if (g.target) {
        g.x += (g.tx - g.x) * follow;
        g.y += (g.ty - g.y) * follow;
      }
      g.alpha += (g.target - g.alpha) * 0.2;
      if (!g.target && g.alpha < 0.01) {
        g.el.remove();
        groupLabels.delete(key);
        continue;
      }
      g.el.style.transform = `translate3d(${g.x.toFixed(1)}px, ${g.y.toFixed(1)}px, 0) translate(-50%, -50%)`;
      g.el.style.opacity = (g.show * g.alpha).toFixed(3);
      g.el.style.zIndex = String(g.z);
    }
    for (const key of clusterModes.keys()) if (!liveKeys.has(key)) clusterModes.delete(key);
  }

  // ---------- 시작 / 일시 정지 ----------
  // 물리·그리기는 이 화면이 보이는 동안(전환 포함)만 돈다. 숨겨지면 멈추고 상태(위치·결합)는 그대로 둔다
  function resume() {
    if (running) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(step);
  }

  function pause() {
    running = false;
    cancelAnimationFrame(raf);
  }

  // 왼쪽부터 무리 단위로 (결합한 버블은 한 덩어리로 함께)
  const orderedGroups = () =>
    clusters([]).sort((g1, g2) => Math.min(...g1.map((b) => b.pos.x)) - Math.min(...g2.map((b) => b.pos.x)));

  // 등장: 무리마다 0.12초 간격으로 opacity 0 → 1, scale 0.95 → 1. 모두 나타나면 부유 시작
  function enter({ reduced = false } = {}) {
    resume();
    gsap.killTweensOf(bubbles);
    gsap.killTweensOf(motion);
    const tl = gsap.timeline();
    if (reduced) {
      tl.to(bubbles, { show: 1, duration: 0.3, ease: 'none' });
      tl.set(motion, { float: 1 });
      return tl;
    }
    orderedGroups().forEach((group, i) => {
      tl.to(group, { show: 1, duration: 0.7, ease: easeExhibit }, i * 0.12);
    });
    tl.to(motion, { float: 1, duration: 1.2, ease: 'sine.inOut' }); // 이미 떠다니던 중이면 그대로
    return tl;
  }

  // 퇴장: 제자리에서 무리마다 조금씩 시간차를 두고 scale 1 → 0.95, opacity 1 → 0
  function leave({ reduced = false } = {}) {
    gsap.killTweensOf(bubbles);
    gsap.killTweensOf(motion);
    if (drag) endDrag();
    const tl = gsap.timeline();
    if (reduced) {
      tl.to(bubbles, { show: 0, duration: 0.25, ease: 'none' });
      return tl;
    }
    orderedGroups().forEach((group, i) => {
      tl.to(group, { show: 0, duration: 0.5, ease: easeExhibit }, i * 0.05);
    });
    return tl;
  }

  layout();
  render(0, []);
  window.addEventListener('resize', () => {
    layout();
    if (!running) render(simT, []);
  });

  return { bubbles, links, share, enter, leave, pause, resume, isDragging: () => !!drag };
}
