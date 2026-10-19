// CSS cubic-bezier(x1, y1, x2, y2)와 같은 곡선을 GSAP ease 함수로 (progress 0~1 → 값 0~1)
export function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t) => (3 * ax * t + 2 * bx) * t + cx;

  // x(t) = p 인 t를 뉴턴법으로 찾고, 안 되면 이분법
  function solve(p) {
    let t = p;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - p;
      if (Math.abs(err) < 1e-6) return t;
      const d = slopeX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = p;
    while (hi - lo > 1e-6) {
      if (sampleX(t) < p) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  }

  return (p) => (p <= 0 ? 0 : p >= 1 ? 1 : sampleY(solve(p)));
}

// CHAIR DNA 버블 등장·퇴장에 쓰는 감속 곡선
export const easeExhibit = cubicBezier(0.22, 1, 0.36, 1);

// 메인 ↔ CHAIR DNA 화면 슬라이드 (1.5초). 위 곡선은 처음 0.3초에 67%를 움직여 1.5초로 늘려도 빠르게 느껴지므로,
// 입력 즉시 움직이기 시작하되(0.08초에 3%) 부드럽게 가속하고 1.5초 전체에 걸쳐 감속하는 곡선
export const easeSlide = cubicBezier(0.3, 0.15, 0.2, 1);
