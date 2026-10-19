import * as THREE from 'three';
import { SET_INFO } from './texture-sets.js';

/**
 * 실사형 PBR 재질 시스템 (MeshPhysicalMaterial).
 *
 * - GLB의 원래 색(baseColor)과 텍스처(map·normalMap·roughness 맵)는 그대로 유지하고,
 *   소재별 물리 속성(굴절률·반사율·클리어코트·시인·이방성·거칠기·금속성·환경 반사 강도)과
 *   PBR 텍스처 세트(재질 팩 public/textures/chair_material_pack 또는 절차적 세트)의 질감을 더한다.
 * - 색은 바꾸지 않는다: 텍스처 세트의 색 맵은 밝기 변화(얼룩·결 음영)로만 쓰고,
 *   거칠기 맵은 원본 거칠기를 중심으로 한 변화로만 쓴다. 노멀 맵은 표면 요철로 그대로 쓴다.
 * - 텍스처는 UV 대신 메시 좌표계 기준 트라이플래너(3방향 투영)로 입힌다.
 *   → UV가 없거나 불규칙한 모델에서도 늘어나거나 뒤틀리지 않고, 부품이 분해·이동해도 표면에 붙어 움직인다.
 *   나뭇결·헤어라인처럼 방향이 있는 텍스처는 부품의 긴 축을 따라 놓는다.
 * - 멀리서 미세 요철이 밉맵으로 평균되면 그만큼 거칠기를 넓혀(Toksvig) 반짝임·모아레 없이 자연스럽게 이어진다.
 * - 같은 원본 재질 + 같은 프리셋 + 같은 결 방향은 하나의 재질로 공유해 GPU 메모리와 셰이더 수를 줄인다.
 *
 * 의자별 규칙: src/data/chair-materials.js
 */

// ---------- 소재 프리셋 ----------
// set: MeshPhysicalMaterial 속성 (keepRoughness/keepMetalness = 원본 값 유지)
//   ior 굴절률(유전체의 정반사 세기), specularIntensity, clearcoat, sheen, anisotropy(이방성 반사) …
// detail: 텍스처 세트 적용 { set(세트 이름), tile(m, 생략 시 세트 기본값), stretch(결 방향 늘이기),
//   normal(노멀 세기), rough(거칠기 맵 변화량), color(색 맵 밝기 변화량, 0 = 사용 안 함) }
export const PRESETS = {
  // 유광 크롬 도금 파이프: 재질 팩 안내대로 이미지 맵 없이 물리 값 + 환경 반사, 아주 약한 연마 자국만
  chrome: {
    set: { metalness: 1, roughness: 0.08, anisotropy: 0.15, envMapIntensity: 1 },
    detail: { set: 'noise', tile: 0.06, stretch: 6, normal: 0.02, rough: 0.04, color: 0 },
  },
  // 헤어라인 스틸 (볼트, X자 철판): metal_brushed_silver
  steel: {
    keepRoughness: true,
    set: { metalness: 0.9, anisotropy: 0.45, envMapIntensity: 0.9 },
    detail: { set: 'metal_brushed_silver', normal: 0.18, rough: 0.5, color: 0.3 },
  },
  // 흑색 아연·흑색 도장 스틸 (원본 금속성 유지): metal_powder_black
  darkSteel: {
    keepRoughness: true,
    keepMetalness: true,
    set: { anisotropy: 0.2, ior: 1.5, envMapIntensity: 0.8 },
    detail: { set: 'metal_powder_black', normal: 0.13, rough: 0.4, color: 0.3 },
  },
  // 분체도장 강관·철망 (도막은 비금속): metal_powder_black의 오렌지필 요철, 색은 원본
  powderCoat: {
    keepRoughness: true,
    set: { metalness: 0, ior: 1.5, clearcoat: 0.15, clearcoatRoughness: 0.35, envMapIntensity: 0.9 },
    detail: { set: 'metal_powder_black', normal: 0.13, rough: 0.3, color: 0.2 },
  },
  // 사출 플라스틱(폴리아미드 등): plastic_gloss_white의 표면, 색은 원본
  plastic: {
    keepRoughness: true,
    set: { metalness: 0, ior: 1.46, specularIntensity: 1, clearcoat: 0.1, clearcoatRoughness: 0.25, envMapIntensity: 0.85 },
    detail: { set: 'plastic_gloss_white', normal: 0.04, rough: 0.3, color: 0.2 },
  },
  // 고무·무광 플라스틱 발, 캡: plastic_matte_black
  rubber: {
    keepRoughness: true,
    set: { metalness: 0, ior: 1.52, specularIntensity: 0.5, envMapIntensity: 0.6 },
    detail: { set: 'plastic_matte_black', normal: 0.08, rough: 0.3, color: 0.3 },
  },
  // 정체가 불분명한 무광 부품 (원본 값 유지 + 아주 약한 질감만)
  matte: {
    keepRoughness: true,
    keepMetalness: true,
    set: { envMapIntensity: 0.7 },
    detail: { set: 'plastic_matte_black', normal: 0.05, rough: 0.2, color: 0.2 },
  },
  // 텍스처가 있는 직물: GLB 원본 텍스처 유지 + 시인(sheen), 낮은 정반사, 아주 약한 섬유 노이즈
  fabric: {
    set: { metalness: 0, roughness: 1, ior: 1.45, specularIntensity: 0.5, sheen: 0.35, sheenRoughness: 0.8, sheenFromBase: 1.2, envMapIntensity: 0.7 },
    detail: { set: 'noise', tile: 0.004, stretch: 1, normal: 0.15, rough: 0.08, color: 0.06 },
  },
  // GLB에 재질(색·노멀·거칠기·금속성·시인 등)이 완성되어 있는 경우: 원본 값을 그대로 쓴다.
  // 강제 값과 추가 질감(노이즈)을 더하지 않는다. 환경 반사만 스튜디오 HDRI로 받는다.
  authored: {
    keepRoughness: true,
    keepMetalness: true,
    set: { envMapIntensity: 1 },
  },
  // 텍스처가 없는 직물: fabric_anthracite (짜임 노멀·밝기 변화)
  wovenFabric: {
    set: { metalness: 0, roughness: 0.95, ior: 1.45, specularIntensity: 0.5, sheen: 0.35, sheenRoughness: 0.8, sheenFromBase: 1.2, envMapIntensity: 0.65 },
    detail: { set: 'fabric_anthracite', normal: 0.4, rough: 0.5, color: 1 },
  },
  // 착색 원목(텍스처 없음): birch_clear_lacquer 나뭇결을 결 음영으로 + 얇은 래커
  stainedWood: {
    keepRoughness: true,
    set: { metalness: 0, ior: 1.5, clearcoat: 0.2, clearcoatRoughness: 0.45, envMapIntensity: 0.8 },
    detail: { set: 'birch_clear_lacquer', normal: 0.13, rough: 0.4, color: 0.6 },
  },
  // 도장 목재: wood_painted_red의 도막 요철·거칠기 (색은 원본)
  paintedWood: {
    keepRoughness: true,
    set: { metalness: 0, ior: 1.5, clearcoat: 0.3, clearcoatRoughness: 0.4, envMapIntensity: 0.85 },
    detail: { set: 'wood_painted_red', normal: 0.05, rough: 0.4, color: 0 },
  },
  // 텍스처가 있는 원목·합판: GLB 나뭇결 색 유지 + birch_clear_lacquer 결 요철·거칠기 + 무광 래커
  lacqueredWood: {
    keepRoughness: true,
    set: { metalness: 0, ior: 1.5, clearcoat: 0.25, clearcoatRoughness: 0.4, envMapIntensity: 0.85 },
    detail: { set: 'birch_clear_lacquer', normal: 0.13, rough: 0.4, color: 0 },
  },
  // 도장 합판 패널 (반광): wood_painted_red의 도막 요철·거칠기 (색은 원본)
  paintedPanel: {
    keepRoughness: true,
    set: { metalness: 0, ior: 1.5, clearcoat: 0.35, clearcoatRoughness: 0.3, envMapIntensity: 0.85 },
    detail: { set: 'wood_painted_red', normal: 0.05, rough: 0.4, color: 0 },
  },
};

// 의자 규칙에서 쓰는 텍스처 세트 이름 (해당 의자에 필요한 텍스처만 불러오기 위해)
export function textureSetNames(rules = []) {
  return rules.map((rule) => ({ ...PRESETS[rule.preset], ...rule.overrides }).detail?.set).filter(Boolean);
}

// ---------- 규칙 매칭 ----------
// match 조건 (모두 만족해야 함): name(재질 이름 정규식), part(부품 이름·사양 정규식), kind(부품 kind),
//   metalness / roughness: [min, max], map: true/false, color: '#rrggbb' (sRGB 근사 비교)
function matches(rule, material, part) {
  const m = rule.match ?? {};
  if (m.name && !new RegExp(m.name).test(material.name ?? '')) return false;
  if (m.kind && part?.kind !== m.kind) return false;
  if (m.part && !new RegExp(m.part).test(`${part?.name ?? ''} ${part?.spec ?? ''}`)) return false;
  if (m.metalness && !(material.metalness >= m.metalness[0] && material.metalness <= m.metalness[1])) return false;
  if (m.roughness && !(material.roughness >= m.roughness[0] && material.roughness <= m.roughness[1])) return false;
  if (m.map !== undefined && !!material.map !== m.map) return false;
  if (m.color) {
    const target = new THREE.Color(m.color);
    const c = material.color;
    if (Math.abs(c.r - target.r) + Math.abs(c.g - target.g) + Math.abs(c.b - target.b) > 0.03) return false;
  }
  return true;
}

function partOf(mesh) {
  for (let n = mesh; n; n = n.parent) if (n.userData?.partId) return n.userData;
  return null;
}

// 메시 좌표계에서 가장 긴 축 = 결(나뭇결·헤어라인) 방향
function longAxis(geometry) {
  geometry.computeBoundingBox();
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  if (size.x >= size.y && size.x >= size.z) return 0;
  return size.y >= size.z ? 1 : 2;
}

// 결 방향 축을 x로 보내는 회전(축 순환) 행렬. 트라이플래너의 두 면에서 텍스처 가로(u)가 결 방향이 된다
function grainBasis(axis) {
  const m = new THREE.Matrix3();
  if (axis === 1) m.set(0, 1, 0, 0, 0, 1, 1, 0, 0); // (x,y,z) → (y,z,x)
  else if (axis === 2) m.set(0, 0, 1, 1, 0, 0, 0, 1, 0); // (x,y,z) → (z,x,y)
  return m; // axis 0 또는 결 없음: 단위 행렬
}

/**
 * 모델 전체에 의자별 재질 규칙을 적용한다. 메시·계층·형상은 그대로이고 material만 교체한다.
 * @param sets loadTextureSets()로 불러온 텍스처 세트
 * @returns {{ applied: Array, materials: Set<THREE.Material>, missing: string[] }}
 */
export function applyChairMaterials(model, rules = [], renderer, sets = new Map()) {
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
  const shared = new Map(); // 원본 재질 값 + 규칙 + 결 방향 + UV 유무 → 새 재질
  const applied = [];
  const unmatched = new Set();

  model.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const original = mesh.material;
    const part = partOf(mesh);
    const ruleIndex = rules.findIndex((r) => matches(r, original, part));
    const rule = rules[ruleIndex];
    for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) {
      if (original[key]) original[key].anisotropy = maxAnisotropy;
    }
    if (!rule) {
      unmatched.add(part?.partId ?? mesh.name ?? '-');
      return;
    }

    const preset = { ...PRESETS[rule.preset], ...rule.overrides };
    const set = sets.get(preset.detail?.set);
    const directional = preset.detail && (preset.detail.stretch > 1 || set?.grain);
    const axis = directional ? longAxis(mesh.geometry) : -1;
    const hasUV = !!mesh.geometry.attributes.uv; // 이방성 반사는 UV로 만든 접선 방향이 필요
    const key = `${materialSignature(original)}|${ruleIndex}|${axis}|${hasUV}`;
    if (!shared.has(key)) shared.set(key, buildMaterial(original, { name: rule.preset, ...preset }, set, axis, hasUV));
    mesh.material = shared.get(key);
    applied.push({ part: part?.partId ?? '-', preset: rule.preset, textureSet: set?.fallback ? `${set.fallback}(대체)` : preset.detail?.set });
  });

  return { applied, materials: new Set(shared.values()), unmatched: [...unmatched] };
}

// 값이 같은 원본 재질은 하나로 공유한다 (GLB가 부품마다 같은 재질을 따로 저장한 경우가 많다)
function materialSignature(m) {
  const tex = (t) => (t ? `${t.source?.uuid}:${t.repeat.x.toFixed(4)},${t.repeat.y.toFixed(4)}:${t.offset.x.toFixed(4)},${t.offset.y.toFixed(4)}:${t.rotation.toFixed(4)}` : '-');
  return [
    m.type,
    m.color.getHexString(),
    m.roughness.toFixed(3),
    m.metalness.toFixed(3),
    m.side,
    m.transparent,
    m.opacity,
    m.clearcoat ?? '-',
    tex(m.map),
    tex(m.normalMap),
    m.normalScale?.x.toFixed(3),
    tex(m.roughnessMap),
    tex(m.metalnessMap),
    tex(m.aoMap),
    m.emissive?.getHexString(),
  ].join('|');
}

function buildMaterial(original, preset, set, axis, hasUV) {
  // 모든 소재를 MeshPhysicalMaterial로 (굴절률·반사율·클리어코트·시인·이방성을 소재별로 쓰기 위해)
  let material;
  if (original.isMeshPhysicalMaterial) {
    material = original.clone(); // 색·텍스처·노멀·클리어코트 등 원본 값 그대로
  } else {
    material = new THREE.MeshPhysicalMaterial();
    THREE.MeshStandardMaterial.prototype.copy.call(material, original); // 색·텍스처·노멀 등 원본 값 복사
    material.defines = { STANDARD: '', PHYSICAL: '' }; // Standard copy가 덮어쓴 physical 정의 복원
  }
  material.name = `${original.name || 'material'}·${preset.name ?? ''}`;

  const props = { ...preset.set };
  if (preset.keepRoughness) delete props.roughness;
  if (preset.keepMetalness) delete props.metalness;
  if (original.isMeshPhysicalMaterial && original.clearcoat > 0) {
    delete props.clearcoat; // 원본에 클리어코트가 있으면 원본 값 우선
    delete props.clearcoatRoughness;
  }
  if (!hasUV) delete props.anisotropy;
  const { sheenFromBase, ...rest } = props;
  for (const [k, v] of Object.entries(rest)) if (k in material) material[k] = v;
  if (sheenFromBase && material.sheenColor) {
    // 직물의 시인 색 = 실제 보이는 색(기본색 × 텍스처 평균색)을 살짝 밝힌 색 (흰 광택이 아닌 같은 색의 부드러운 광)
    material.sheenColor.copy(original.color).multiplyScalar(sheenFromBase);
    if (original.map) {
      const mean = textureMean(original.map);
      material.sheenColor.multiply(new THREE.Color(mean.x, mean.y, mean.z));
    }
  }
  if (preset.normalStrength && material.normalMap) material.normalScale.multiplyScalar(preset.normalStrength);
  // 색 지정 (sRGB hex): 원본 색이 비어 있는 텍스처에만 있던 경우 등, 규칙에서 명시할 때만
  if (preset.color) material.color.set(preset.color);
  // 기본색(Base Color)만 노출 보정 (EV). 셰이더에서 색 텍스처는 sRGB → 선형으로 풀린 뒤 color 계수와 곱해지므로,
  // 선형 계수에 2^EV를 곱하면 R·G·B가 같은 비율로 밝아진다 → 색상(Hue)·채도·직물 명암 대비는 그대로, 밝기만 변한다.
  // 노멀·거칠기·시인·장면 노출에는 영향이 없다.
  if (preset.baseColorExposure) material.color.multiplyScalar(2 ** preset.baseColorExposure);
  if (preset.baseColorGrade) addBaseColorGrade(material, preset.baseColorGrade);

  addSurfaceDetail(material, preset, set, axis);
  return material;
}

// ---------- 기본색 색 보정 (비파괴: 텍스처는 그대로, 셰이더에서 보정) ----------
// 기본색(색 계수 × 색 텍스처, 선형 공간)에만 적용한다. 노멀·거칠기·시인·장면 노출에는 영향이 없다.
//   contrast: 직물 명암 대비 (1 = 그대로, <1 = 완화). 텍스처 평균 밝기를 중심으로 밝기만 압축 → 무늬는 유지.
//   gain:     [R, G, B] 색상 이동. 텍스처 평균색의 밝기가 그대로 유지되도록 정규화해서 쓴다 → 색상(Hue)만 이동.
//   exposure: 밝기 (EV). R·G·B를 같은 비율로 → 색상·채도 유지.
//   sheen:    { amount, roughness, lighten } 부드러운 원단 광택(시인). 색은 보정 후 평균색을 밝기 쪽으로 조금 풀어 쓴다.
//   amount:   0 = 보정 없음, 1 = 전부 (중간값은 각 보정을 같은 비율로 줄임: 비교·단계 적용용)
function addBaseColorGrade(material, grade) {
  const amount = grade.amount ?? 1;
  const LUM = new THREE.Vector3(0.2126, 0.7152, 0.0722);
  const mean = material.map ? textureMean(material.map) : new THREE.Vector3(1, 1, 1);
  mean.multiply(new THREE.Vector3(material.color.r, material.color.g, material.color.b)); // 실제 기본색 평균 (선형)
  const meanY = Math.max(1e-4, mean.dot(LUM));
  const raw = new THREE.Vector3(...(grade.gain ?? [1, 1, 1])).set(
    (grade.gain?.[0] ?? 1) ** amount,
    (grade.gain?.[1] ?? 1) ** amount,
    (grade.gain?.[2] ?? 1) ** amount,
  );
  // 평균색의 밝기가 변하지 않도록 정규화 (색상 이동이 밝기 변화를 만들지 않게)
  const gain = raw.multiplyScalar(meanY / Math.max(1e-6, mean.clone().multiply(raw).dot(LUM)));
  gain.multiplyScalar(2 ** ((grade.exposure ?? 0) * amount));
  if (grade.sheen && 'sheen' in material) {
    // 시인 색 = 보정 후 평균색(선형)을 그 밝기의 회색 쪽으로 lighten만큼 섞어 살짝 밝고 부드럽게
    const graded = mean.clone().multiply(gain);
    const gy = graded.dot(LUM);
    const tint = graded.lerp(new THREE.Vector3(gy, gy, gy), grade.sheen.lighten ?? 0.3).multiplyScalar(grade.sheen.brightness ?? 1);
    material.sheen = (grade.sheen.amount ?? 1) * amount;
    material.sheenRoughness = grade.sheen.roughness ?? 0.8;
    material.sheenColor.setRGB(tint.x, tint.y, tint.z);
  }
  const uniforms = {
    uGradeGain: { value: gain },
    uGradeContrast: { value: 1 + ((grade.contrast ?? 1) - 1) * amount },
    uGradeMeanY: { value: meanY },
  };
  material.userData.gradeUniforms = uniforms;
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uGradeGain;
        uniform float uGradeContrast;
        uniform float uGradeMeanY;`,
      )
      .replace(
        '#include <color_fragment>',
        `{
          vec3 gc = diffuseColor.rgb;
          float gy = max( dot( gc, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-6 );
          gc *= uGradeMeanY * pow( gy / uGradeMeanY, uGradeContrast ) / gy; // 명암 대비 완화 (밝기만)
          diffuseColor.rgb = gc * uGradeGain; // 색상 이동 + 노출
        }
        #include <color_fragment>`,
      );
  };
  material.customProgramCacheKey = () => 'chair-base-grade-v1';
  material.needsUpdate = true;
}

// ---------- 텍스처 세트 셰이더 (트라이플래너 색 밝기 · 거칠기 · 노멀) ----------
function addSurfaceDetail(material, preset, set, axis) {
  const detail = preset.detail;
  const mapContrast = preset.mapContrast ?? 1;
  if (!(detail && set) && mapContrast === 1) return;

  const uniforms = {
    uDetailColorMap: { value: set?.color ?? null },
    uDetailRoughMap: { value: set?.roughness ?? null },
    uDetailNormalMap: { value: set?.normal ?? null },
    uDetailBasis: { value: grainBasis(axis) },
    uDetailTile: { value: detail?.tile ?? set?.tile ?? 0.1 },
    uGrainStretch: { value: axis >= 0 ? (detail?.stretch ?? 1) : 1 },
    uDetailNormal: { value: set ? (detail?.normal ?? 0) : 0 },
    uDetailRough: { value: set ? (detail?.rough ?? 0) : 0 },
    uDetailColor: { value: set ? (detail?.color ?? 0) : 0 },
    uColorMean: { value: set?.colorMean ?? 0.5 },
    uRoughMean: { value: set?.roughMean ?? 0.5 },
    uMapContrast: { value: mapContrast },
    uMapMean: { value: material.map ? textureMean(material.map) : new THREE.Vector3(0.5, 0.5, 0.5) },
  };
  material.userData.detailUniforms = uniforms;
  material.userData.textureSet = set?.name ?? (set?.procedural ? detail.set : null);

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vDetailPos;
        varying vec3 vDetailNormal;
        varying float vDetailScale;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vDetailPos = position;
        vDetailNormal = normal;
        vDetailScale = length( modelMatrix[ 0 ].xyz ); // 메시 단위(mm·m) → 월드(m) 환산`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform mat3 normalMatrix;
        uniform sampler2D uDetailColorMap;
        uniform sampler2D uDetailRoughMap;
        uniform sampler2D uDetailNormalMap;
        uniform mat3 uDetailBasis;
        uniform float uDetailTile;
        uniform float uGrainStretch;
        uniform float uDetailNormal;
        uniform float uDetailRough;
        uniform float uDetailColor;
        uniform float uColorMean;
        uniform float uRoughMean;
        uniform float uMapContrast;
        uniform vec3 uMapMean;
        varying vec3 vDetailPos;
        varying vec3 vDetailNormal;
        varying float vDetailScale;

        float detailLum;        // 색 맵 밝기 (선형)
        float detailRoughTex;   // 거칠기 맵 값
        vec3 detailTilt;        // 노멀 맵 기울기 (메시 좌표계)
        float detailCoherence;  // 밉맵 평균된 노멀 길이 (1 = 선명)

        // 메시 좌표계 3방향 투영. 결 방향 축을 x로 돌려 두 면에서 텍스처 가로(u)가 결을 따르게 한다.
        void sampleDetail() {
          vec3 p = uDetailBasis * ( vDetailPos * vDetailScale ) / uDetailTile;
          p.x /= uGrainStretch;
          vec3 nB = uDetailBasis * normalize( vDetailNormal );
          vec3 w = pow( abs( nB ), vec3( 4.0 ) );
          w /= ( w.x + w.y + w.z );
          vec2 uvX = p.yz + 0.13;
          vec2 uvY = p.xz + 0.37;
          vec2 uvZ = p.xy + 0.71;
          const vec3 LUM = vec3( 0.2126, 0.7152, 0.0722 );
          detailLum = dot( texture2D( uDetailColorMap, uvX ).rgb, LUM ) * w.x
            + dot( texture2D( uDetailColorMap, uvY ).rgb, LUM ) * w.y
            + dot( texture2D( uDetailColorMap, uvZ ).rgb, LUM ) * w.z;
          detailRoughTex = texture2D( uDetailRoughMap, uvX ).r * w.x
            + texture2D( uDetailRoughMap, uvY ).r * w.y
            + texture2D( uDetailRoughMap, uvZ ).r * w.z;
          vec3 nX = texture2D( uDetailNormalMap, uvX ).xyz * 2.0 - 1.0;
          vec3 nY = texture2D( uDetailNormalMap, uvY ).xyz * 2.0 - 1.0;
          vec3 nZ = texture2D( uDetailNormalMap, uvZ ).xyz * 2.0 - 1.0;
          // 각 투영면의 접선 기울기를 축으로 되돌려 합친 뒤(UDN), 메시 좌표계로 되돌린다
          vec3 tiltB = vec3( 0.0, nX.x, nX.y ) * w.x + vec3( nY.x, 0.0, nY.y ) * w.y + vec3( nZ.x, nZ.y, 0.0 ) * w.z;
          detailTilt = transpose( uDetailBasis ) * tiltB;
          detailCoherence = clamp( length( nX ) * w.x + length( nY ) * w.y + length( nZ ) * w.z, 0.0, 1.0 );
        }`,
      )
      .replace('void main() {', 'void main() {\n  sampleDetail();')
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D( map, vMapUv );
          sampledDiffuseColor.rgb = max( ( sampledDiffuseColor.rgb - uMapMean ) * uMapContrast + uMapMean, 0.0 );
          diffuseColor *= sampledDiffuseColor;
        #endif
        // 색 맵은 밝기 변화로만 (원래 색상 유지)
        diffuseColor.rgb *= mix( 1.0, detailLum / max( uColorMean, 1e-3 ), uDetailColor );`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        // 거칠기 맵은 원본 거칠기를 중심으로 한 변화로만
        roughnessFactor = clamp( roughnessFactor + ( detailRoughTex - uRoughMean ) * uDetailRough, 0.03, 1.0 );
        // Toksvig: 멀리서 평균된 미세 요철만큼 반사를 넓혀 반짝임 없이 자연스럽게
        float detailVariance = ( 1.0 - detailCoherence ) / max( detailCoherence, 0.05 ) * uDetailNormal;
        roughnessFactor = min( 1.0, sqrt( roughnessFactor * roughnessFactor + detailVariance ) );`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        // 메시 단위(mm·m)에 따라 normalMatrix의 크기가 달라지므로, 기울기 전·후 노멀을 각각 정규화한 차이만 더한다
        vec3 detailN0 = normalize( vDetailNormal );
        vec3 detailView0 = normalize( normalMatrix * detailN0 );
        vec3 detailView1 = normalize( normalMatrix * normalize( detailN0 + detailTilt * uDetailNormal ) );
        normal = normalize( normal + faceDirection * ( detailView1 - detailView0 ) );`,
      );
  };
  material.customProgramCacheKey = () => 'chair-surface-detail-v4';
  material.needsUpdate = true;
}

// 텍스처 평균색(선형). 대비 조정의 기준점으로만 쓰고 텍스처는 바꾸지 않는다.
function textureMean(texture) {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(texture.image, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const sum = [0, 0, 0];
  for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += toLinear(data[i + c] / 255);
  const n = data.length / 4;
  return new THREE.Vector3(sum[0] / n, sum[1] / n, sum[2] / n);
}
