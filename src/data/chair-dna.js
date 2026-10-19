// CHAIR DNA: 의자마다 FORM / MATERIAL / STRUCTURE 세 가지 기준의 특징 키워드.
// 두 의자가 같은 기준에서 키워드를 하나라도 공유하면 그 기준이 "공통점"이 된다 (0~3개).
//   0개 → 가까이 가도 결합하지 않고 튕겨 나감
//   1~2개 → blob으로 결합, 공통 키워드 표시
//   3개 → 결합 + 두 의자의 실루엣 겹침 (강한 연결)
// 키워드 근거: 상세 페이지 설명(src/data/chair-details.js의 materials·composition)과 의자 형태.
// home: 기본 배치(레퍼런스 public/design/dna-02-default.webp, 2000 × 1292 프레임의 원 중심)
export const DNA_FRAME = { w: 2000, h: 1292 };
export const DNA_RADIUS = 137; // 의자 이미지 크기의 기준 반지름 (프레임 단위). 원 크기는 의자마다 radius
// radius: 원 반지름 (레퍼런스 이미지의 라임 원을 측정, 프레임 단위)

export const chairDna = {
  '001': {
    // PS LOUNGE CHAIR — 둥근 쿠션 + 크롬 파이프 프레임
    home: [1681, 586],
    radius: 150,
    form: ['CURVED FORM'],
    material: ['UPHOLSTERED', 'METAL'],
    structure: ['EXPOSED FRAME'],
  },
  '002': {
    // DALFRED — 원목 다리 + 나사 기둥(높이 조절)
    home: [1199, 509],
    radius: 154,
    form: ['LINEAR'],
    material: ['SOLID WOOD', 'METAL'],
    structure: ['EXPOSED FRAME', 'TRANSFORMABLE'],
  },
  '003': {
    // PS Knäbäck — 원형 좌판·원통 등받이(패브릭) + 도장 원목 다리
    home: [317, 422],
    radius: 143.4,
    form: ['CURVED FORM'],
    material: ['UPHOLSTERED', 'SOLID WOOD'],
    structure: ['EXPOSED FRAME'],
  },
  '004': {
    // SKÅLBODA — 곡면 철망 셸 + 강관 프레임
    home: [972, 1068],
    radius: 147.8,
    form: ['CURVED FORM'],
    material: ['METAL'],
    structure: ['EXPOSED FRAME'],
  },
  '005': {
    // PS LOUNGE CHAIR (자작나무) — 평판 합판을 끼워 맞춘 구조
    home: [1603, 1045],
    radius: 140.1,
    form: ['PLANAR'],
    material: ['PLYWOOD'],
    structure: ['SLOTTED PANELS'],
  },
  '006': {
    // POÄNG — 휜 합판 캔틸레버 + 쿠션
    home: [295, 964],
    radius: 165.5,
    form: ['CURVED FORM'],
    material: ['UPHOLSTERED', 'PLYWOOD'],
    structure: ['CANTILEVER'],
  },
  '007': {
    // PS FOLDING CHAIR — 평판 좌판·등판 + 원목 프레임, 접이식
    home: [731, 723],
    radius: 136.1,
    form: ['PLANAR', 'LINEAR'],
    material: ['SOLID WOOD', 'PLYWOOD'],
    structure: ['EXPOSED FRAME', 'TRANSFORMABLE'],
  },
};

const CATEGORIES = ['form', 'material', 'structure'];

// 두 의자의 공통점: { count(공유한 기준 수 0~3), keywords(공유 키워드), categories }
export function sharedDna(a, b) {
  const A = chairDna[a];
  const B = chairDna[b];
  const keywords = [];
  const categories = [];
  for (const category of CATEGORIES) {
    const shared = A[category].filter((k) => B[category].includes(k));
    if (shared.length) {
      categories.push(category);
      keywords.push(...shared);
    }
  }
  return { count: categories.length, keywords, categories };
}
