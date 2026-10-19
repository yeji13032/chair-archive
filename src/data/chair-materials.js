// 의자별 재질 규칙. 위에서부터 처음 맞는 규칙 하나가 적용된다 (프리셋: src/lib/chair-materials.js의 PRESETS).
// 근거: 각 GLB의 부품 이름·사양(extras)과 원본 재질 값. 소재가 불분명한 부품은 원본 값을 유지하는 프리셋을 쓴다.
// overrides로 프리셋 값을 의자별로 덮어쓸 수 있다.
// 텍스처 세트(재질 팩)는 프리셋의 detail.set에서 정한다. 재질 팩의 material_manifest.json 'chairs' 항목은
// 실제 GLB를 보지 않고 다른 제품을 가정해 작성된 것이라(예: 001 노란 쉘, 002 POÄNG) 사용하지 않고,
// GLB 부품 이름·사양으로 확인한 실제 소재에 맞춰 연결했다.
export const chairMaterials = {
  // PS LOUNGE CHAIR — Ø25 크롬 파이프 프레임, 버튼·접시머리 볼트, 패브릭 쿠션
  // GLB: chair-001-fabric-realism-v2.glb (패브릭 색·노멀·거칠기 맵 + KHR_materials_sheen 포함)
  '001': [
    { match: { map: true }, preset: 'authored' }, // 등받이·좌판 쿠션: GLB 패브릭 색·노멀·거칠기 맵·Sheen 그대로
    { match: { part: '볼트', metalness: [0.5, 1] }, preset: 'steel' },
    // 다리·뒤 프레임·링: 유광 크롬 + 스튜디오 HDRI 반사. 거칠기는 GLB 값(0.07) 유지
    { match: { metalness: [0.95, 1] }, preset: 'chrome', overrides: { keepRoughness: true } },
    { match: { roughness: [0.6, 1] }, preset: 'rubber' }, // 파이프 끝 발 캡
  ],

  // 001 KeyShot 재질 통합본 (chair-001-keyshot-all-materials-merged.glb): 패브릭·크롬 모두 KeyShot 재질 그대로
  '001:chair-001-keyshot-all-materials-merged.glb': [
    // 패브릭: KeyShot 굽기 텍스처 그대로 + 실제 제품 사진(public/design/chair-001-photo-reference.webp) 색에 맞춘 비파괴 색 보정
    //   사진과 같은 조명 조건의 영역(좌판 앞면·윗면, 등받이 앞면)을 선형 공간에서 비교해 정한 값:
    //   exposure +1.7 EV (기존 +0.2 포함), 청록 쪽 색상 이동 gain [R 0.8, G 0.98, B 2.3] (1차 측정 후 색상 +4°·채도 −0.05 미세 조정)
    {
      match: { map: true },
      preset: 'authored',
      overrides: {
        baseColorGrade: {
          exposure: 1.7,
          gain: [0.8, 0.98, 2.3],
          contrast: 0.6, // 직물 명암 완화 (0.85 → 0.6): 좌판 앞면 밝기 변동 CV 0.28 → 약 0.2 목표 (사진 0.14), 무늬는 유지
          sheen: { amount: 1, roughness: 0.8, lighten: 0.3 }, // 부드러운 원단 광택 (KeyShot GLB에는 시인 없음)
          amount: 1,
        },
      },
    },
    // 크롬 등 나머지: KeyShot 재질 그대로
    { match: {}, preset: 'authored' },
  ],

  // 005 KeyShot 재질 통합본 (시험 중): KeyShot 재질 그대로
  '005:chair-005-keyshot-materials-merged.glb': [{ match: {}, preset: 'authored' }],
  '005:chair-005-keyshot-materials-merged-fixed.glb': [{ match: {}, preset: 'authored' }], // 텍스처 없는 normalTexture 항목 2개만 제거한 사본
  // 005 KeyShot 재베이크 + 웹 최적화본 (적용 중): 목재 거칠기 0.6·텍스처 축소는 파일에 반영됨 → 코드에서는 재질을 바꾸지 않는다
  '005:chair-005-keyshot-optimized.glb': [{ match: {}, preset: 'authored' }],

  // 005 KeyShot 최종본 (이전 내보내기, 시험용) — 재질만 보정, GLB 파일·형상·부품은 그대로
  //   진단: 이 GLB의 텍스처 24장은 모두 빈 검은 이미지(KeyShot 굽기 실패). 그래서
  //   - 텍스처 목재(좌판·등받이 한 면, 쐐기 블록): 검은 색 맵 + 검은 거칠기 맵(거칠기 0) → 검은 거울처럼 보임
  //   - 나머지 목재 "Oak Wood Rough": 텍스처·UV 없이 단색, 거칠기 0.19 → 유광 플라스틱처럼 보임
  //   - 볼트: 검은 노멀 맵 → 음영 왜곡, 뒤 오른쪽 발: 다른 발과 달리 목재 재질이 연결됨
  //   보정: 빈 텍스처는 연결 해제, 목재는 KeyShot 오크 색 유지 + 무광(거칠기 0.62) + 사이트 자작나무 결(트라이플래너, UV 불필요)을 약하게
  '005:chair-005 keyshot final.glb': [
    // 발 4개: 다른 발과 같은 무광 검정 (뒤 오른쪽 발에 잘못 연결된 목재 재질 교정)
    {
      match: { part: '^발' },
      preset: 'authored',
      overrides: {
        color: '#1c1c1c',
        keepRoughness: false,
        keepMetalness: false,
        set: { map: null, roughnessMap: null, metalnessMap: null, normalMap: null, metalness: 0, roughness: 1 },
      },
    },
    // 볼트 알루미늄: KeyShot 값 유지, 빈(검은) 노멀 맵만 해제
    { match: { name: '^Aluminum Brushed' }, preset: 'authored', overrides: { set: { normalMap: null } } },
    // 빈 텍스처만 있던 목재(좌판·등받이 한 면, 쐐기 블록): KeyShot 오크 색(#13)으로
    {
      match: { name: '^(Oak Wood Rough|Material_2[6-9]$)', map: true },
      preset: 'stainedWood',
      overrides: {
        color: '#ffd5a7',
        keepRoughness: false,
        set: { map: null, roughnessMap: null, metalnessMap: null, normalMap: null, metalness: 0, roughness: 0.62, clearcoat: 0.06, clearcoatRoughness: 0.6, envMapIntensity: 0.85 },
        detail: { set: 'birch_clear_lacquer', tile: 3.0, normal: 0.15, rough: 0.35, color: 1 }, // tile: 0.25m × 12.01 (KeyShot 루트 축척이 기존의 12.01배)
      },
    },
    // 단색 목재 "Oak Wood Rough": KeyShot 색 그대로 + 무광 + 자작나무 결
    {
      match: { name: '^Oak Wood Rough' },
      preset: 'stainedWood',
      overrides: {
        keepRoughness: false,
        set: { metalness: 0, roughness: 0.62, clearcoat: 0.06, clearcoatRoughness: 0.6, envMapIntensity: 0.85 },
        detail: { set: 'birch_clear_lacquer', tile: 3.0, normal: 0.15, rough: 0.35, color: 1 }, // tile: 0.25m × 12.01 (KeyShot 루트 축척이 기존의 12.01배)
      },
    },
    // 그 밖의 재질(합판 마구리 갈색, 볼트 홈·머리 등): KeyShot 재질 그대로
    { match: {}, preset: 'authored' },
  ],

  // 007 KeyShot 재출력본: 나무·도장·흑색 재질 모두 KeyShot 재질 그대로
  '007:chair-007 new.glb': [{ match: {}, preset: 'authored' }],
  '007:chair-007-seat-fixed.glb': [{ match: {}, preset: 'authored' }], // 좌판 위치만 수정한 본
  '007:chair-007-seat-angled.glb': [{ match: {}, preset: 'authored' }], // 좌판 위치 + 뒷면 각도 수정한 적용본

  // DALFRED — 흑색 착색 원목 다리·원판, 흑색 스틸 발받침 링·나사 기둥
  '002': [
    { match: { color: '#2f3032' }, preset: 'stainedWood' }, // 다리·원판 (각재·원판)
    { match: { metalness: [0.75, 1] }, preset: 'darkSteel' }, // 긴 나사
    { match: { metalness: [0.4, 0.75] }, preset: 'darkSteel' }, // 발받침 링·슬리브·장착판·나사 기둥
    { match: { color: '#1e1f20' }, preset: 'plastic' }, // 끝캡·나사 기둥 표면 (원본 반광)
    { match: { roughness: [0.9, 1] }, preset: 'matte' }, // 구멍·모서리의 무광 검정 (소재 불명 → 원본 유지)
  ],

  // PS Knäbäck CHAIR — 도장 목재 다리·판(클리어코트), 니트 패브릭 좌판·롤(텍스처 포함), 스틸 X판·볼트
  '003': [
    { match: { name: '^fabric' }, preset: 'fabric' },
    { match: { name: '^paint' }, preset: 'paintedWood' },
    { match: { name: '^steel' }, preset: 'steel' },
    { match: { name: '^matte' }, preset: 'matte' }, // 쿠션 속·마감재 (소재 불명 → 원본 유지)
  ],

  // SKÅLBODA — 분체도장 강관·철망, 폴리아미드 발·칼라, 교차부 볼트
  '004': [
    { match: { part: '폴리아미드' }, preset: 'plastic' },
    { match: { metalness: [0.5, 1] }, preset: 'steel' },
    { match: { color: '#df4f1b' }, preset: 'powderCoat' },
    { match: { roughness: [0.9, 1] }, preset: 'matte' }, // 관 끝 안쪽 (소재 불명)
  ],

  // PS LOUNGE CHAIR (자작나무) — 자작나무 합판(텍스처 포함), 발, 볼트
  '005': [
    { match: { map: true }, preset: 'lacqueredWood', overrides: { set: { metalness: 0, clearcoat: 0.12, clearcoatRoughness: 0.5, envMapIntensity: 0.85 } } },
    { match: { metalness: [0.5, 1] }, preset: 'steel' },
    { match: { part: '발' }, preset: 'rubber' },
    { match: { roughness: [0.9, 1] }, preset: 'matte' }, // 볼트 머리 홈 등
  ],

  // POÄNG — 붉은 착색 휜 합판(텍스처), 검정 폴리에스테르 쿠션(텍스처), PP 지지 천, 미끄럼 방지 띠, 글라이드
  '006': [
    // 쿠션 (검정 폴리에스테르): GLB 텍스처 유지 + fabric_anthracite 짜임 요철
    { match: { map: true, roughness: [0.9, 1] }, preset: 'fabric', overrides: { detail: { set: 'fabric_anthracite', normal: 0.4, rough: 0.5, color: 0 } } },
    { match: { map: true }, preset: 'lacqueredWood' }, // 측면 프레임·가로대·띠
    { match: { part: '폴리프로필렌' }, preset: 'wovenFabric' }, // 좌판 지지 천
    { match: { part: '미끄럼' }, preset: 'rubber' }, // 등받이 살 미끄럼 방지 띠
    { match: { part: '글라이드' }, preset: 'plastic' },
    { match: { metalness: [0.3, 1] }, preset: 'darkSteel' }, // 볼트
    { match: { roughness: [0.9, 1] }, preset: 'matte' },
  ],

  // PS FOLDING CHAIR — 자작나무 프레임(텍스처), 빨강·파랑 도장 패널, 검정 스틸
  '007': [
    // GLB 나뭇결이 옅어 대비·노멀 강도를 높인다 (기존 설정 유지)
    { match: { kind: 'wood' }, preset: 'lacqueredWood', overrides: { mapContrast: 6, normalStrength: 2.5 } },
    { match: { kind: 'red' }, preset: 'paintedPanel' },
    { match: { kind: 'blue' }, preset: 'paintedPanel' },
    { match: { kind: 'black' }, preset: 'darkSteel' },
  ],
};
