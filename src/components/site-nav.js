import '../styles/tokens.css';
import '../styles/site-nav.css';

// 모든 페이지에서 쓰는 상단 네비게이션.
// 페이지 HTML에 <header data-site-nav></header>를 두고 mountSiteNav()를 호출한다.
// archiveLabel: 왼쪽 문구. 일반 페이지(메인 · CHAIR DNA · ABOUT)는 '000',
// 의자 상세 페이지는 detail.js가 현재 의자 번호('CHAIR ARCHIVE / 003' 등)를 넘긴다
export function mountSiteNav(target = document.querySelector('[data-site-nav]'), { archiveLabel = 'CHAIR ARCHIVE / 000' } = {}) {
  if (!target) return null;

  target.classList.add('site-nav');
  target.innerHTML = `
    <p class="site-nav__item site-nav__item--left">${archiveLabel}</p>
    <a class="site-nav__item site-nav__item--center" href="/">AN INTERACTIVE COLLECTION</a>
    <a class="site-nav__item site-nav__item--right" href="/about.html">INDEX / ABOUT</a>
  `;
  return target;
}
