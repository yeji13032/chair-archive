import '../styles/tokens.css';
import '../styles/site-nav.css';

// 모든 페이지에서 쓰는 상단 네비게이션.
// 페이지 HTML에 <header data-site-nav></header>를 두고 mountSiteNav()를 호출한다.
// archiveLabel: 왼쪽 문구 (기본 'CHAIR ARCHIVE / 001', ABOUT은 '000')
export function mountSiteNav(target = document.querySelector('[data-site-nav]'), { archiveLabel = 'CHAIR ARCHIVE / 001' } = {}) {
  if (!target) return null;

  target.classList.add('site-nav');
  target.innerHTML = `
    <p class="site-nav__item site-nav__item--left">${archiveLabel}</p>
    <a class="site-nav__item site-nav__item--center" href="/">AN INTERACTIVE COLLECTION</a>
    <a class="site-nav__item site-nav__item--right" href="/about.html">INDEX / ABOUT</a>
  `;
  return target;
}
