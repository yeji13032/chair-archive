import * as THREE from 'three';

/**
 * 표면 미세 질감용 절차적(코드 생성) 텍스처. 외부 이미지 없이 페이지에서 한 번만 만들고 모든 재질이 공유한다.
 * 패턴마다 PBR 텍스처 세 장(public/textures의 재질 팩과 같은 형식)을 만든다.
 *   - color: 색 얼룩(회색조, 밝기 변화만 사용)
 *   - roughness: 거칠기 변화(회색조)
 *   - normal: 높이에서 계산한 탄젠트 공간 노멀 (OpenGL 방식, RG = 기울기, B = z)
 * 모두 이음매 없이 반복(tileable)되며, 반복 무늬가 드러나지 않도록 주기가 다른 노이즈를 섞는다.
 *
 *   noise : 등방성 미세 노이즈 → 분체도장 오렌지필, 사출 플라스틱, 무광 금속.
 *           한 방향으로 늘이면 나뭇결(wood)·헤어라인(brushed metal)이 된다 (chair-materials.js의 stretch).
 *   weave : 평직(plain weave) 직물 조직 + 섬유 노이즈 → 텍스처 없는 직물.
 */
const cache = new Map();

// 재질 팩 텍스처 세트와 같은 형식: { color, roughness, normal, colorMean, roughMean, procedural }
// 페이지당 패턴별로 한 번만 만든다.
export function getProceduralSet(kind) {
  if (!cache.has(kind)) {
    const field = kind === 'weave' ? makeWeave(256) : makeNoise(512);
    const mean = (a) => a.reduce((sum, v) => sum + v, 0) / a.length;
    cache.set(kind, {
      color: toTexture(field.size, field.albedo, field.albedo, field.albedo),
      roughness: toTexture(field.size, field.rough, field.rough, field.rough),
      normal: toNormalTexture(field.size, field.height, field.depth),
      colorMean: mean(field.albedo),
      roughMean: mean(field.rough),
      procedural: true,
    });
  }
  return cache.get(kind);
}

export function disposeProceduralSets() {
  cache.forEach((set) => ['color', 'roughness', 'normal'].forEach((k) => set[k].dispose()));
  cache.clear();
}

// ---------- 주기적(tileable) 값 노이즈 ----------
function makeRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function periodicValueNoise(size, period, seed) {
  const rand = makeRandom(seed);
  const lattice = new Float32Array(period * period).map(() => rand());
  const out = new Float32Array(size * size);
  const fade = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * period;
    const y0 = Math.floor(fy);
    const ty = fade(fy - y0);
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * period;
      const x0 = Math.floor(fx);
      const tx = fade(fx - x0);
      const a = lattice[(y0 % period) * period + (x0 % period)];
      const b = lattice[(y0 % period) * period + ((x0 + 1) % period)];
      const c = lattice[((y0 + 1) % period) * period + (x0 % period)];
      const d = lattice[((y0 + 1) % period) * period + ((x0 + 1) % period)];
      out[y * size + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    }
  }
  return out;
}

function fbm(size, basePeriod, octaves, seed) {
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const layer = periodicValueNoise(size, basePeriod << o, seed + o * 101);
    for (let i = 0; i < out.length; i++) out[i] += layer[i] * amp;
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function toTexture(size, r, g, b) {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = Math.round(THREE.MathUtils.clamp(r[i], 0, 1) * 255);
    data[i * 4 + 1] = Math.round(THREE.MathUtils.clamp(g[i], 0, 1) * 255);
    data[i * 4 + 2] = Math.round(THREE.MathUtils.clamp(b[i], 0, 1) * 255);
    data[i * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.NoColorSpace; // 데이터 텍스처 (색이 아님)
  texture.needsUpdate = true;
  return texture;
}

// 높이 → 탄젠트 공간 노멀 (이음매 없이 감싸는 중앙 차분). depth = 높이 1이 픽셀 몇 개 높이인지
function toNormalTexture(size, height, depth) {
  const data = new Uint8Array(size * size * 4);
  const h = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * 0.5 * depth;
      const dy = (h(x, y + 1) - h(x, y - 1)) * 0.5 * depth;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      data[i] = Math.round((-dx / len * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((-dy / len * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((1 / len) * 255);
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; // 멀리서는 밉맵 평균으로 요철이 자연스럽게 줄어든다
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function makeNoise(size) {
  const height = fbm(size, 8, 5, 11);
  const albedo = fbm(size, 4, 4, 37);
  const rough = fbm(size, 16, 3, 73);
  return { size, height, albedo, rough, depth: 8 };
}

function makeWeave(size) {
  const cells = 16; // 텍스처 한 장에 들어가는 실 교차 수
  const fiber = fbm(size, 32, 3, 5);
  const slub = fbm(size, 4, 3, 19); // 실 굵기의 불균일
  const height = new Float32Array(size * size);
  const albedo = new Float32Array(size * size);
  const rough = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * cells;
      const v = (y / size) * cells;
      const cu = Math.floor(u);
      const cv = Math.floor(v);
      const warpOnTop = (cu + cv) % 2 === 0; // 평직: 날실·씨실이 한 칸씩 번갈아 위로
      const fu = u - cu - 0.5;
      const fv = v - cv - 0.5;
      const warp = Math.cos(fu * Math.PI) ** 0.6; // 세로 실 단면
      const weft = Math.cos(fv * Math.PI) ** 0.6; // 가로 실 단면
      const top = warpOnTop ? warp * (0.6 + 0.4 * Math.cos(fv * Math.PI)) : weft * (0.6 + 0.4 * Math.cos(fu * Math.PI));
      const i = y * size + x;
      height[i] = 0.15 + 0.7 * top + (fiber[i] - 0.5) * 0.25;
      albedo[i] = 0.5 + (top - 0.5) * 0.35 + (slub[i] - 0.5) * 0.4;
      rough[i] = 0.5 + (fiber[i] - 0.5) * 0.6;
    }
  }
  return { size, height, albedo, rough, depth: 10 };
}
