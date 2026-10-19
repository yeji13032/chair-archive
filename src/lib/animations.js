import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

// 모든 페이지 공통 등장 모션
export function introHeader() {
  gsap.from('.site-header > *', {
    y: -20,
    opacity: 0,
    duration: 0.8,
    stagger: 0.1,
    ease: 'power3.out',
  });
}

export { gsap, ScrollTrigger };
