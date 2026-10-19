import { mountSiteNav } from '../components/site-nav.js';
import { chairDetails } from '../data/chair-details.js';
import { chairMaterials } from '../data/chair-materials.js';
import { createChairViewer } from '../lib/chair-viewer.js';
import { createExplodeController } from '../lib/chair-explode.js';
import '../styles/detail.css';

// /detail/001 형식의 주소에서 의자 번호를 읽는다 (/detail.html?id=001도 허용)
const fromPath = window.location.pathname.match(/\/detail\/(\d{3})/)?.[1];
const fromQuery = new URLSearchParams(window.location.search).get('id');
const id = chairDetails[fromPath] ? fromPath : chairDetails[fromQuery] ? fromQuery : '001';
const chair = chairDetails[id];

mountSiteNav(undefined, { archiveLabel: `CHAIR ARCHIVE / ${id}` }); // 왼쪽 번호 = 현재 의자

document.title = `${chair.name} — CHAIR ARCHIVE`;
document.body.dataset.chair = id;

// ---------- 정보 텍스트 ----------

const field = (key) => document.querySelector(`[data-field="${key}"]`);

field('name').textContent = chair.name;
field('credit').textContent = `${chair.designer} / ${chair.year}`;
field('composition').textContent = chair.composition.join('\n'); // 줄바꿈 위치는 레퍼런스와 같게

// MATERIAL 제목 + 항목명 / 소재
field('materials').innerHTML = '<dt class="detail-materials__title">MATERIAL</dt>';
chair.materials.forEach(([label, value]) => {
  const group = document.createElement('div');
  group.className = 'detail-materials__group';
  group.append(Object.assign(document.createElement('dt'), { textContent: label }));
  group.append(Object.assign(document.createElement('dd'), { textContent: value }));
  field('materials').append(group);
});

// 레퍼런스의 원형 컬러 (등록된 개수만큼)
chair.swatches.forEach((color) => {
  const swatch = document.createElement('li');
  swatch.className = 'detail-swatch';
  swatch.style.setProperty('--swatch', color);
  field('swatches').append(swatch);
});

// ---------- 3D 모델 ----------

// 레퍼런스(1728 × 1117) 좌표 → 캔버스 픽셀.
//   데스크톱: 화면 전체를 1728 × 1117 프레임으로 보고(가로·세로 중 작은 쪽 기준) 캔버스(오른쪽 정보 영역 336을 뺀 1392 폭)의
//            가운데를 프레임 x 696, y 558.5에 맞춘다 → 레퍼런스와 같은 위치·크기.
//   모바일: 의자 영역(view.box)을 위쪽 캔버스 안에 여백을 두고 꽉 차게 맞춘다.
const MOBILE = window.matchMedia('(max-width: 768px)');
function designFrame(width, height) {
  if (MOBILE.matches) {
    const pad = { left: 20, right: 20, top: 56, bottom: 12 };
    const [bx0, by0, bx1, by1] = chair.view.box;
    const availW = width - pad.left - pad.right;
    const availH = height - pad.top - pad.bottom;
    const unit = Math.min(availW / (bx1 - bx0), availH / (by1 - by0)) * 0.86;
    const cx = pad.left + availW / 2;
    const cy = pad.top + availH / 2;
    return {
      toX: (x) => cx + (x - (bx0 + bx1) / 2) * unit,
      toY: (y) => cy + (y - (by0 + by1) / 2) * unit,
      safe: { left: pad.left / 2, right: width - pad.right / 2, top: pad.top, bottom: height - pad.bottom / 2 },
    };
  }
  const unit = Math.min(window.innerWidth / 1728, window.innerHeight / 1117);
  const toX = (x) => width / 2 + (x - 696) * unit;
  const toY = (y) => height / 2 + (y - 558.5) * unit;
  return { toX, toY, safe: { left: toX(24), right: toX(1368), top: toY(70), bottom: toY(1093) } };
}

// 개발 중 새 GLB 시험용: /detail/001?glb=파일이름.glb (public/models 안의 파일, 개발 서버에서만)
//   재질 규칙은 chairMaterials['001:파일이름.glb']가 있으면 그것을, 없으면 의자 기본 규칙을 쓴다.
const testGlb = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('glb') : null;
const modelUrl = testGlb && /^[\w .-]+\.glb$/.test(testGlb) ? `/models/${encodeURIComponent(testGlb)}` : chair.model;
const modelFile = decodeURIComponent(modelUrl.split('/').pop());
const baseRules = chairMaterials[`${id}:${modelFile}`] || chairMaterials[id];

// 개발 중 비교용 (개발 서버에서만): 기본색 보정이 있는 규칙만 바꿔 본다
//   ?ev=0.2   → 노출 보정(baseColorExposure) 값
//   ?grade=0  → 색 보정(baseColorGrade) 적용 정도 (0 = 보정 전, 0.5 = 절반, 1 = 전부)
const testParams = new URLSearchParams(window.location.search);
const testEv = import.meta.env.DEV ? testParams.get('ev') : null;
const testGrade = import.meta.env.DEV ? testParams.get('grade') : null;
const materialRules = baseRules.map((rule) => {
  const overrides = { ...rule.overrides };
  if (testEv !== null && Number.isFinite(Number(testEv)) && overrides.baseColorExposure !== undefined) overrides.baseColorExposure = Number(testEv);
  if (testGrade !== null && Number.isFinite(Number(testGrade)) && overrides.baseColorGrade) overrides.baseColorGrade = { ...overrides.baseColorGrade, amount: Number(testGrade) };
  return rule.overrides ? { ...rule, overrides } : rule;
});

const viewerReady = createChairViewer({
  canvas: document.querySelector('[data-detail-canvas]'),
  container: document.querySelector('[data-detail-view]'),
  modelUrl,
  view: chair.view,
  render: chair.render,
  materials: materialRules, // 의자별 실사형 재질 규칙 (모델 파일별 규칙이 있으면 우선)
  designFrame,
  // 부품 정보(partId·분해 위치)가 없는 GLB(KeyShot 재출력 등)는 이 GLB에서 이름으로 옮겨 온다.
  // 의자에 partSource가 지정돼 있으면 그것을, 시험 GLB면 현재 의자 GLB를 쓴다. (모델에 부품 정보가 있으면 아무것도 하지 않음)
  partSource: chair.partSource ?? (modelUrl !== chair.model ? chair.model : null),
});

// ---------- SHOW STRUCTURE / RETURN TO FORM ----------
// GLB 부품을 분해·재조립한다. 애니메이션 중 중복 클릭은 컨트롤러가 무시한다.
const explodeReady = viewerReady.then((viewer) => createExplodeController(viewer, chair.explode));

const actions = {
  'show-structure': (explode) => explode.show(),
  'return-to-form': (explode) => explode.hide(),
};
document.querySelectorAll('[data-action]').forEach((button) => {
  button.addEventListener('click', async () => {
    const explode = await explodeReady;
    actions[button.dataset.action]?.(explode);
  });
});

if (import.meta.env.DEV) {
  // 개발 중 확인용
  viewerReady.then((viewer) => (window.__chairViewer = viewer));
  explodeReady.then((explode) => (window.__chairExplode = explode));
}
