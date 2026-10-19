// 개발 서버에서만 쓰는 비교 도구: http://localhost:5173/?compare
// 원본 디자인(public/design/main.webp)을 화면 위에 반투명하게 겹친다.
// 키보드 C: 켜기/끄기, [ / ]: 투명도 조절
export function showCompareOverlay(src = '/design/main.webp') {
  const overlay = document.createElement('img');
  overlay.src = src;
  overlay.alt = '';
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    width: '100vw',
    height: '100vh',
    objectFit: 'fill',
    opacity: '0.5',
    pointerEvents: 'none',
    zIndex: '9999',
    mixBlendMode: 'multiply',
  });
  document.body.append(overlay);

  window.addEventListener('keydown', (event) => {
    if (event.key === 'c' || event.key === 'C') {
      overlay.hidden = !overlay.hidden;
    } else if (event.key === '[' || event.key === ']') {
      const step = event.key === ']' ? 0.1 : -0.1;
      overlay.style.opacity = String(Math.min(1, Math.max(0, Number(overlay.style.opacity) + step)));
    }
  });
}
