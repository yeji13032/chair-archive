import * as THREE from 'three';
import { getProceduralSet } from './procedural-textures.js';

/**
 * PBR 텍스처 세트 로더.
 *
 * - 재질 팩: public/textures/chair_material_pack (material_manifest.json의 materials 항목)
 *   각 세트 = baseColor(sRGB) · normalGL(선형, OpenGL 방식) · roughness(선형)
 * - 'noise' · 'weave'는 코드로 만드는 절차적 세트 (procedural-textures.js)
 *
 * 텍스처 세트의 실제 크기(한 장이 몇 m인지)와 결 방향은 재질 팩에 정보가 없어 여기서 정한다.
 *   tile: 텍스처 한 장이 덮는 길이(m), grain: 결이 텍스처 가로(u) 방향인지 (나뭇결·헤어라인)
 */
export const PACK_BASE = '/textures/chair_material_pack/';

export const SET_INFO = {
  birch_clear_lacquer: { tile: 0.25, grain: true },
  wood_painted_black: { tile: 0.2, grain: true },
  wood_painted_red: { tile: 0.2, grain: true },
  metal_brushed_silver: { tile: 0.12, grain: true },
  metal_powder_black: { tile: 0.12, grain: false },
  metal_powder_blue: { tile: 0.12, grain: false },
  metal_powder_yellow: { tile: 0.12, grain: false },
  plastic_matte_black: { tile: 0.08, grain: false },
  plastic_gloss_white: { tile: 0.08, grain: false },
  fabric_anthracite: { tile: 0.06, grain: false },
  fabric_beige: { tile: 0.06, grain: false },
  fabric_blue: { tile: 0.06, grain: false },
  leather_black: { tile: 0.15, grain: false },
};

let manifestPromise = null;
const setCache = new Map();

function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(`${PACK_BASE}material_manifest.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`manifest ${r.status}`))))
      .catch((error) => {
        console.warn('재질 팩 manifest를 읽지 못했습니다. 절차적 질감만 사용합니다.', error);
        return { materials: {} };
      });
  }
  return manifestPromise;
}

/**
 * 이름 목록에 해당하는 텍스처 세트를 불러온다. 실패한 세트는 절차적 'noise'로 대체하고 경고를 남긴다.
 * @returns {Promise<Map<string, object>>}
 */
export async function loadTextureSets(names, renderer) {
  const manifest = await loadManifest();
  const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
  const result = new Map();
  await Promise.all(
    [...new Set(names)].map(async (name) => {
      if (name === 'noise' || name === 'weave') {
        result.set(name, getProceduralSet(name));
        return;
      }
      if (!setCache.has(name)) setCache.set(name, loadPackSet(name, manifest.materials?.[name], maxAnisotropy));
      result.set(name, await setCache.get(name));
    }),
  );
  return result;
}

async function loadPackSet(name, entry, maxAnisotropy) {
  if (!entry?.baseColor || !entry?.normal || !entry?.roughness) {
    console.warn(`재질 팩에 '${name}' 텍스처 경로가 없어 절차적 질감으로 대체합니다.`);
    return { ...getProceduralSet('noise'), fallback: name };
  }
  try {
    const loader = new THREE.TextureLoader();
    const load = async (path, colorSpace) => {
      const texture = await loader.loadAsync(PACK_BASE + path);
      texture.colorSpace = colorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = maxAnisotropy;
      return texture;
    };
    const [color, normal, roughness] = await Promise.all([
      load(entry.baseColor, THREE.SRGBColorSpace),
      load(entry.normal, THREE.NoColorSpace),
      load(entry.roughness, THREE.NoColorSpace),
    ]);
    return {
      color,
      normal,
      roughness,
      colorMean: imageMean(color.image, true),
      roughMean: imageMean(roughness.image, false),
      normalScale: entry.normalScale ?? 0.2, // 팩이 권장하는 노멀 세기
      ...SET_INFO[name],
      name,
    };
  } catch (error) {
    console.warn(`재질 팩 '${name}' 텍스처를 불러오지 못해 절차적 질감으로 대체합니다.`, error);
    return { ...getProceduralSet('noise'), fallback: name };
  }
}

// 이미지의 평균 밝기 (색 텍스처는 선형 휘도, 데이터 텍스처는 R 채널 그대로)
function imageMean(image, isColor) {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);
  const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (isColor) {
      sum += 0.2126 * toLinear(data[i] / 255) + 0.7152 * toLinear(data[i + 1] / 255) + 0.0722 * toLinear(data[i + 2] / 255);
    } else {
      sum += data[i] / 255;
    }
  }
  return sum / (data.length / 4);
}
