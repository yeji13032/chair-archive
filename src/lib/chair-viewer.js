import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { applyChairMaterials, textureSetNames } from './chair-materials.js';
import { loadTextureSets } from './texture-sets.js';

const DESIGN_W = 1728;
const DESIGN_H = 1117;

// GLB 텍스처 최대 크기(px). 이보다 큰 텍스처(예: KeyShot 굽기 10025px)는 불러온 뒤 한 번 줄여서 GPU에 올린다.
// 화면에서 쓰는 해상도(최대 확대 포함)에서는 차이가 없고, 메모리(1.5GB → 약 0.4GB)와 저사양 기기 호환성이 크게 나아진다.
// GLB 파일 자체는 바꾸지 않는다.
const MAX_TEXTURE_SIZE = 4096;

// 공통 스튜디오 환경: Poly Haven 'Studio Small 03' (CC0, 1K HDR)
const STUDIO_HDRI = '/env/studio_small_03_1k.hdr';

/**
 * DETAIL 페이지의 의자 3D 뷰어.
 * - GLB를 불러와 메시·계층·형상은 그대로 두고, 의자별 재질 규칙(chair-materials)으로 실사형 PBR 재질을 적용한다.
 * - 조명: 스튜디오 HDRI(반사·전체 광) + 키 라이트(입체감·그림자) + 보조광 + 림 라이트.
 * - 카메라는 view.azimuth / elevation 방향에서 모델을 바라보고,
 *   화면에 비친 모델이 디자인의 view.box 영역에 맞도록 줌과 위치를 자동으로 맞춘다.
 */
// 의자별 render 값이 없을 때의 기본값 (공통 렌더링 설정)
const DEFAULT_RENDER = {
  exposure: 0.8, // 톤매핑 노출
  environment: 1, // HDRI 환경광 강도
  environmentRotation: 0, // 스튜디오 환경 회전(도)
  keyLight: 0.8, // 키 라이트 (그림자)
  fillLight: 0.25, // 보조광: 그림자 쪽 면을 살짝 들어 올림
  rimLight: 0.6, // 림 라이트: 뒤쪽 위에서 윤곽선을 살린다
  // 부품끼리 드리우는 그림자 (self-shadow): 키 라이트가 가려진 부분에서 키 라이트를 얼마나 덜어 낼지 0~1.
  //   HDRI·보조광은 그대로라 그림자 속도 검게 꺼지지 않는다. 바닥 그림자 진하기는 이 값과 무관하게 이전과 같다.
  selfShadow: 0.65,
  // 접촉 그림자 (GTAO, 화면 공간 앰비언트 오클루전): 부품이 가깝게 맞닿거나 겹치는 틈을 은은하게 어둡게
  //   ao: 세기 0~1 (0이면 끔), aoRadius: 그림자가 번지는 거리 (모델 크기 대비 비율)
  ao: 0.6,
  aoRadius: 0.18,
  aoFloor: 0.3, // 다리·발이 바닥에 닿는 곳의 접촉 그림자 진하기 (0~1)
  shadowSoftness: 6, // 키 라이트 그림자 번짐 (VSM 블러 반경). 작을수록 가는 프레임·와이어 그림자가 또렷하게 남는다
};

/**
 * designFrame(width, height): 디자인 좌표(1728 × 1117)를 캔버스 픽셀로 바꾸는 규칙.
 *   { toX(x), toY(y), safe: { left, right, top, bottom } } — safe는 확대·드래그가 벗어나지 않을 캔버스 픽셀 영역.
 *   주지 않으면 기존 규칙(가로 = 화면 너비 / 1728, 세로 = 캔버스 높이 / 1117 비율)을 쓴다.
 */
/**
 * partSource: 부품 정보(partId·분해 위치·회전 등 extras)가 빠진 GLB(예: KeyShot 재출력본)를 쓸 때,
 *   같은 이름의 부품 노드를 가진 원래 GLB 주소. 불러온 모델에 부품 정보가 없을 때만 이름으로 맞춰 복사한다.
 *   형상·UV·재질은 새 GLB 그대로 두고, GLB 파일은 둘 다 바꾸지 않는다.
 */
export async function createChairViewer({ canvas, container, modelUrl, view, render: renderSettings, materials, designFrame, partSource }) {
  const look = { ...DEFAULT_RENDER, ...renderSettings };

  // 의자마다 렌더러가 따로 있으므로 노출값도 렌더러별로 설정한다.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // 고해상도 화면 대응 (최대 2배)
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Neutral 톤매핑: 원본 색을 유지하면서 하이라이트를 부드럽게 눌러 준다 (ACES는 밝은 패브릭을 탈색시켜 제외)
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = look.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap; // 부드럽게 번지는 그림자
  // 키 라이트·바닥이 고정이라 카메라만 돌 때는 그림자가 변하지 않는다 → 부품이 움직일 때만 다시 그린다
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const camera = new THREE.PerspectiveCamera(22, 1, 0.01, 1000);
  scene.add(camera); // 보조광·림 라이트를 카메라에 붙여 시점이 바뀌어도 같은 스튜디오 배치를 유지

  // ---------- 모델 + 스튜디오 HDRI + 이 의자에 필요한 PBR 텍스처 세트 (동시에 불러온다) ----------
  const [gltf, environment, textureSets] = await Promise.all([
    loadGltf(modelUrl),
    loadStudioEnvironment(pmrem),
    loadTextureSets(textureSetNames(materials), renderer),
  ]);
  scene.environment = environment;
  scene.environmentIntensity = look.environment;
  scene.environmentRotation.set(0, THREE.MathUtils.degToRad(look.environmentRotation), 0);

  const model = gltf.scene;
  const partGraft = partSource ? await graftPartData(model, partSource) : null;
  // 부품이 그림자를 드리우고(cast) 받기도(receive) 해서, 좌판 아래·프레임이 등받이에 드리우는 그림자 같은 self-shadow가 생긴다
  model.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
  limitTextureSize(model, Math.min(MAX_TEXTURE_SIZE, renderer.capabilities.maxTextureSize));
  const materialReport = applyChairMaterials(model, materials, renderer, textureSets);
  scene.add(model);

  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = size.length() / 2;

  // ---------- 스튜디오 조명 ----------
  // 키 라이트: 위 앞쪽에서 부드럽게 비추고 옅은 그림자를 만든다 (월드 고정)
  const sun = new THREE.DirectionalLight(0xffffff, look.keyLight);
  sun.position.copy(center).add(new THREE.Vector3(0.25, 2, 0.35).multiplyScalar(radius * 2));
  sun.target.position.copy(center);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = look.shadowSoftness;
  sun.shadow.blurSamples = 24;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = radius * 0.002; // 곡면에 생기는 줄무늬(shadow acne) 방지
  sun.shadow.intensity = look.selfShadow; // 그림자 속에서도 키 라이트 일부만 덜어 내 부드럽게
  const sc = sun.shadow.camera;
  // 분해된 부품까지 그림자가 잘리지 않도록 그림자 카메라 범위를 넉넉하게 잡는다
  sc.left = sc.bottom = -radius * 2.5;
  sc.right = sc.top = radius * 2.5;
  sc.near = radius * 0.1;
  sc.far = radius * 8;
  scene.add(sun, sun.target);

  // 보조광(카메라 기준 오른쪽 낮은 앞)과 림 라이트(카메라 기준 뒤쪽 위): 그림자 없음
  const fill = new THREE.DirectionalLight(0xfff6ee, look.fillLight);
  fill.position.set(1.2, 0.2, 1);
  const rim = new THREE.DirectionalLight(0xffffff, look.rimLight);
  rim.position.set(-0.6, 1.1, -1.4);
  for (const light of [fill, rim]) {
    light.target.position.set(0, 0, -1); // 카메라가 바라보는 방향
    camera.add(light, light.target);
  }

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 8, radius * 8),
    // 그림자 세기(shadow.intensity)만큼 바닥 그림자가 옅어지므로 나눠서 보정 → 바닥 그림자는 이전과 같은 진하기
    new THREE.ShadowMaterial({ opacity: 0.05 / Math.max(0.05, look.selfShadow) }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(center.x, box.min.y, center.z);
  ground.receiveShadow = true;
  scene.add(ground);

  // ---------- 접촉 그림자 (GTAO) ----------
  // 장면 → GTAO(부품이 가깝게 맞닿은 틈을 은은하게 어둡게) → 톤매핑·색 공간 변환(OutputPass) 순서로 그린다.
  // OutputPass가 렌더러의 톤매핑(Neutral)·노출·sRGB 설정을 그대로 쓰므로 기존 밝기·색은 같다.
  // 배경은 투명 그대로(GTAO는 색만 곱하고 투명도는 건드리지 않는다). 계단 현상 방지를 위해 MSAA 4배 렌더 타깃을 쓴다.
  let composer = null;
  let gtao = null;
  if (look.ao > 0) {
    composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
    composer.addPass(new RenderPass(scene, camera));
    gtao = new GTAOPass(scene, camera, 1, 1, undefined, {
      radius: radius * look.aoRadius, // 그림자가 번지는 거리 (월드 단위)
      distanceExponent: 1.4,
      thickness: radius * look.aoRadius, // 앞 부품 뒤로 얼마나 두꺼운 것으로 볼지 (얇은 프레임 뒤가 과하게 어두워지지 않게)
      scale: 1,
      samples: 16,
      distanceFallOff: 1,
    });
    gtao.blendIntensity = look.ao;
    // 섞는 방식: 의자 색은 AO만큼 곱해 어둡게(기존과 같음) + 투명한 바닥에서는 AO만큼 옅은 회색을 더해 다리·발이 바닥에 닿는 접촉 그림자를 보이게
    //   (원래는 색만 곱해서 투명한 바닥 위에서는 접촉 그림자가 보이지 않는다)
    gtao.blendMaterial.uniforms.floorStrength = { value: look.aoFloor };
    gtao.blendMaterial.fragmentShader = /* glsl */ `
      uniform float intensity;
      uniform float floorStrength;
      uniform sampler2D tDiffuse;
      varying vec2 vUv;
      void main() {
        float ao = mix(1.0, texture2D(tDiffuse, vUv).r, intensity);
        gl_FragColor = vec4(vec3(ao), (1.0 - ao) * floorStrength);
      }`;
    // 색: 결과 = 기존 색 × ao / 투명도: 결과 = 기존 + (1 - 기존) × 접촉 그림자 (불투명한 의자 부분은 그대로 1)
    Object.assign(gtao.blendMaterial, {
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.ZeroFactor,
      blendSrcAlpha: THREE.OneMinusDstAlphaFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    gtao.blendMaterial.needsUpdate = true;
    // AO는 화면 해상도의 절반으로 계산하고 노이즈 제거 후 원래 크기에 섞는다 (부드럽고, 고해상도 화면에서도 가볍게)
    const setGtaoSize = gtao.setSize.bind(gtao);
    gtao.setSize = (w, h) => setGtaoSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
    composer.addPass(gtao);
    composer.addPass(new OutputPass());
  }

  // ---------- 카메라 구도 ----------
  const az = THREE.MathUtils.degToRad(view.azimuth ?? 30);
  const el = THREE.MathUtils.degToRad(view.elevation ?? 15);
  const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
  const homePosition = center.clone().addScaledVector(dir, distance); // 디자인 구도의 카메라 위치
  camera.position.copy(homePosition);
  // near는 매 프레임 updateClipping()이 카메라와 모델 사이 거리에 맞춰 정한다 (아래 참고)
  camera.near = distance / 100;
  camera.far = distance * 10;
  camera.lookAt(center);
  camera.updateMatrixWorld(); // project()가 쓰는 카메라 행렬을 즉시 갱신

  // 화면에 비친 모델 영역을 계산하기 위한 꼭짓점 샘플 (월드 좌표)
  const points = [];
  model.updateMatrixWorld(true);
  model.traverse((obj) => {
    if (!obj.isMesh) return;
    const pos = obj.geometry.attributes.position;
    const step = Math.max(1, Math.floor(pos.count / 4000));
    for (let i = 0; i < pos.count; i += step) {
      points.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld));
    }
  });

  function projectedBox(width, height) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const v = new THREE.Vector3();
    for (const p of points) {
      v.copy(p).project(camera);
      const x = ((v.x + 1) / 2) * width;
      const y = ((1 - v.y) / 2) * height;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    return { x0, y0, x1, y1 };
  }

  // ---------- 사용자 회전·확대 (OrbitControls) ----------
  // 회전 중심 = 모델 경계 상자의 실제 중심. 카메라가 이 점을 축으로 돌기 때문에
  // 화면에서는 의자가 제자리에서 수직 중심축을 따라 회전하는 것처럼 보인다.
  const MIN_ELEVATION = THREE.MathUtils.degToRad(view.minElevation ?? 2); // 바닥 아래로 내려가지 않게
  const MAX_ELEVATION = THREE.MathUtils.degToRad(view.maxElevation ?? 40); // 위에서 내려다보는 한계

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(center);
  // 마우스: 왼쪽 드래그 = 회전, 휠 = 커서 방향 확대·축소, 오른쪽 드래그 = 화면 이동(Pan)
  controls.enablePan = true;
  controls.screenSpacePanning = true; // 화면 기준 상하좌우로 이동
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.enableDamping = true; // 부드러운 감속 (회전·이동 모두)
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.7;
  controls.zoomSpeed = 0.45; // 휠 한 칸당 확대량 (기존 0.6보다 세밀하게)
  controls.zoomToCursor = true; // 커서가 가리키는 곳을 향해 확대
  controls.minPolarAngle = Math.PI / 2 - MAX_ELEVATION;
  controls.maxPolarAngle = Math.PI / 2 - MIN_ELEVATION;
  controls.update();

  // 오른쪽 드래그(Pan) 중 브라우저 메뉴가 뜨지 않게 한다. OrbitControls는 비활성(분해 애니메이션 중)일 때 막지 않으므로 직접 막는다.
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());

  // ---------- 자동 회전 ----------
  // 조립 상태에서는 항상 천천히 돈다 (기본 27초에 한 바퀴, 항상 같은 방향).
  // - 클릭·터치만으로는 멈추지 않는다.
  // - 드래그하는 동안만 일시 정지하고, 손을 뗀 뒤 RESUME_DELAY(0.2초) 후 RAMP(0.3초) 동안 서서히 다시 빨라진다.
  // - 재조립 완료 시에는 대기 없이 RAMP 동안 서서히 시작한다.
  // - 분해 상태(setAutoRotateAllowed(false))에서는 돌지 않는다.
  // - 휠 확대·축소는 회전과 무관하게 언제나 가능하다.
  const ROTATE_SPEED = 60 / (view.rotateSeconds ?? 27); // OrbitControls 기준: 한 바퀴 = 60 / 속도 (초)
  const RESUME_DELAY = 0.2; // 드래그 종료 후 다시 돌기까지 (초)
  const RAMP = 0.3; // 정지 → 원래 속도까지 걸리는 시간 (초)
  const DRAG_THRESHOLD = 4; // px, 이보다 적게 움직이면 클릭으로 본다

  const autoRotate = {
    allowed: true, // 분해 상태면 false
    dragging: false,
    resumeAt: 0, // 이 시각(초) 이후에 다시 돌기 시작
    factor: 1, // 0 = 정지, 1 = 원래 속도 (처음 진입 시 바로 회전)
  };
  let down = null;
  const now = () => performance.now() / 1000;

  canvas.addEventListener('pointerdown', (event) => {
    down = { x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!down || autoRotate.dragging) return;
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > DRAG_THRESHOLD) {
      autoRotate.dragging = true; // 드래그 시작 → 일시 정지
    }
  });
  window.addEventListener('pointerup', () => {
    down = null;
    if (autoRotate.dragging) {
      autoRotate.dragging = false;
      autoRotate.resumeAt = now() + RESUME_DELAY;
    }
  });
  window.addEventListener('pointercancel', () => {
    down = null;
    autoRotate.dragging = false;
    autoRotate.resumeAt = now() + RESUME_DELAY;
  });

  // 매 프레임 호출: 상태에 맞춰 회전 속도를 0 ↔ 원래 속도로 부드럽게 바꾼다
  function updateAutoRotate(delta) {
    const shouldRotate = autoRotate.allowed && !autoRotate.dragging && now() >= autoRotate.resumeAt;
    if (shouldRotate) {
      autoRotate.factor = Math.min(1, autoRotate.factor + delta / RAMP);
    } else {
      autoRotate.factor = 0;
    }
    const eased = autoRotate.factor * autoRotate.factor * (3 - 2 * autoRotate.factor); // smoothstep
    controls.autoRotate = eased > 0;
    controls.autoRotateSpeed = ROTATE_SPEED * eased; // 항상 같은 부호 → 방향이 바뀌지 않는다
  }

  // 분해 시작 시 false(즉시 정지), 재조립 완료 시 true(서서히 다시 회전)
  function setAutoRotateAllowed(allowed) {
    autoRotate.allowed = allowed;
    if (allowed) autoRotate.resumeAt = now();
    else autoRotate.factor = 0;
  }

  // ---------- 확대·축소 범위 ----------
  // - 최대 확대: 카메라가 모델 표면에 SURFACE_GAP(모델 반경 비율)까지 다가갈 수 있다 → 패브릭 결·연결부를 가까이 볼 수 있다.
  //   커서 방향(확대 방향)으로 표면을 레이캐스트해 그 앞에서 멈추므로 부품 안으로 들어가거나 관통하지 않는다.
  // - 최대 축소: 기본 거리 / MAX_ZOOM_OUT (의자 전체가 작게 한눈에 보이는 정도).
  // - 의자 크기가 달라도 모델 반경 기준이라 001~007 모두 같은 비율의 범위를 가진다 (view.zoom으로 의자별 조정 가능).
  // - 확대한 곳에서 다시 축소하면 회전 중심이 의자(또는 분해 전체)의 중심으로 서서히 돌아온다.
  const SAFE = { left: 24, right: 976, top: 70, bottom: 925 }; // 디자인(1728 × 1117) 기준 3D 영역 안쪽 (designFrame이 없을 때)
  const frameOf =
    designFrame ??
    ((width, height) => {
      const unit = window.innerWidth / DESIGN_W;
      const toY = (y) => (y / DESIGN_H) * height;
      return {
        toX: (x) => x * unit,
        toY,
        safe: { left: SAFE.left * unit, right: SAFE.right * unit, top: toY(SAFE.top), bottom: toY(SAFE.bottom) },
      };
    });
  const MAX_ZOOM_OUT = view.maxZoomOut ?? 0.55; // 기본 크기 대비 최소 축소 배율
  const SURFACE_GAP = radius * (view.surfaceGap ?? 0.04); // 표면과 카메라 사이 최소 간격
  const MIN_DISTANCE = radius * 0.05; // 레이에 걸리는 표면이 없을 때의 최소 거리
  const PAN_LIMIT = 1.5; // 회전 중심이 상태 중심에서 벗어날 수 있는 거리 (상태 크기 배율) → 의자를 화면 밖으로 잃지 않게
  let frame = null; // { width, height, px, py, safe }

  // 확대 범위 기준. 조립 상태 = 조립된 의자, 분해 상태 = 분해된 전체(chair-explode.js가 바꿔 끼운다)
  //   base: 이 상태의 기본 카메라 거리, center: 이 상태의 회전 중심, size: 회전 중심이 벗어날 수 있는 범위
  const assembledZoomRef = { base: distance, center, size: radius };
  let zoomRef = assembledZoomRef;

  function setZoomReference(ref) {
    zoomRef = ref ? { size: radius, ...ref } : assembledZoomRef;
    if (userControl) controls.maxDistance = zoomRef.base / MAX_ZOOM_OUT;
  }

  // 지금 상태의 기본 거리 대비 확대 배율 (1 = 기본 구도)
  function zoomFactor() {
    return zoomRef.base / camera.position.distanceTo(controls.target);
  }

  function updateZoomFrame(width, height, safe) {
    const pivot = center.clone().project(camera);
    frame = {
      width,
      height,
      px: ((pivot.x + 1) / 2) * width,
      py: ((1 - pivot.y) / 2) * height,
      safe,
    };
    if (userControl) controls.maxDistance = zoomRef.base / MAX_ZOOM_OUT;
  }

  // 사용자 조작 허용 여부. 분해·재조립 애니메이션 중에는 회전·확대를 잠근다.
  let userControl = true;
  controls.minDistance = MIN_DISTANCE;

  function setUserControl(enabled) {
    userControl = enabled;
    controls.enabled = enabled;
    if (enabled) {
      controls.minDistance = MIN_DISTANCE;
      controls.maxDistance = zoomRef.base / MAX_ZOOM_OUT;
    } else {
      // 카메라를 애니메이션으로 옮길 때 OrbitControls가 거리를 잘라내지 않도록 범위를 연다
      controls.minDistance = 0;
      controls.maxDistance = Infinity;
    }
  }

  // 확대 방향(커서 레이)으로 가장 가까운 표면까지의 거리 → 그 앞 SURFACE_GAP에서 멈추도록 minDistance를 정한다
  const zoomRay = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function limitZoomTowards(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    zoomRay.setFromCamera(ndc, camera);
    const hit = zoomRay.intersectObject(model, true)[0];
    const current = camera.position.distanceTo(controls.target);
    const room = hit ? hit.distance - SURFACE_GAP : Infinity; // 더 다가갈 수 있는 거리
    controls.minDistance = THREE.MathUtils.clamp(current - Math.max(0, room), MIN_DISTANCE, controls.maxDistance);
  }

  // 회전 중심(Pan·커서 확대로 옮겨진 지점) 관리
  // - Pan·확대로 옮긴 위치는 그대로 둔다 (축소하지 않는 한 되돌리지 않는다).
  // - 휠로 기본 크기보다 더 축소할 때만 조금씩 상태 중심으로 되돌아온다 → 전체를 볼 때는 의자가 가운데.
  // - 상태 크기의 PAN_LIMIT배보다 멀리는 가지 않는다.
  const offset = new THREE.Vector3();
  function shiftView(delta) {
    controls.target.add(delta);
    camera.position.add(delta);
  }
  function constrainTarget(zoomingOut) {
    if (!userControl) return;
    offset.copy(controls.target).sub(zoomRef.center);
    if (zoomingOut && zoomFactor() < 1.05 && offset.lengthSq() > 0) {
      shiftView(offset.clone().multiplyScalar(-0.12)); // 축소 단계마다 12%씩 중심으로
      offset.multiplyScalar(0.88);
    }
    const max = zoomRef.size * PAN_LIMIT;
    if (offset.length() > max) shiftView(offset.clone().setLength(max - offset.length()));
  }

  // 휠 확대를 여러 프레임에 나눠 부드럽게 적용한다.
  // 실제 휠 입력은 OrbitControls에 닿기 전에 모아 두고, 매 프레임 일부씩 같은 위치의 휠 이벤트로 전달한다.
  const wheel = { pending: 0, x: 0, y: 0 };
  const WHEEL_EASE = 0.22; // 프레임마다 남은 양의 22%씩 → 약 0.2초에 걸쳐 부드럽게
  container.addEventListener(
    'wheel',
    (event) => {
      if (!event.isTrusted || event.target !== canvas) return;
      event.preventDefault();
      event.stopPropagation(); // 원래 이벤트는 OrbitControls에 보내지 않는다
      if (!controls.enabled) return;
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1; // 줄·페이지 단위 → px
      wheel.pending += event.deltaY * scale;
      wheel.x = event.clientX;
      wheel.y = event.clientY;
    },
    { capture: true, passive: false },
  );
  // 터치 두 손가락 확대(핀치)도 두 손가락 가운데 방향의 표면 앞에서 멈춘다
  const touches = new Map();
  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch') touches.set(event.pointerId, event);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'touch' || !touches.has(event.pointerId)) return;
    touches.set(event.pointerId, event);
    if (touches.size === 2 && controls.enabled) {
      const [a, b] = [...touches.values()];
      limitZoomTowards((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
    }
  });
  for (const type of ['pointerup', 'pointercancel']) {
    window.addEventListener(type, (event) => {
      touches.delete(event.pointerId);
      if (touches.size < 2) controls.minDistance = userControl ? MIN_DISTANCE : 0;
    });
  }

  function flushWheel() {
    if (!controls.enabled) {
      wheel.pending = 0;
      return false;
    }
    if (Math.abs(wheel.pending) < 0.5) return false;
    const step = Math.abs(wheel.pending) < 2 ? wheel.pending : wheel.pending * WHEEL_EASE;
    wheel.pending -= step;
    if (step < 0) limitZoomTowards(wheel.x, wheel.y); // 확대할 때만 표면 거리 확인
    else controls.minDistance = MIN_DISTANCE;
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: step, deltaMode: 0, clientX: wheel.x, clientY: wheel.y, bubbles: true, cancelable: true }));
    return step > 0; // 축소 중인지
  }

  function layout() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    renderer.setSize(width, height, false);
    if (composer) {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(width, height);
    }

    // 디자인 구도(초기 카메라 위치)를 기준으로 화면 배치를 계산한 뒤, 사용자가 돌려 둔 시점은 그대로 복원한다
    const saved = camera.position.clone();
    camera.position.copy(homePosition);
    camera.lookAt(center);
    camera.updateMatrixWorld();

    camera.aspect = width / height;
    camera.zoom = 1;
    camera.clearViewOffset();
    camera.updateProjectionMatrix();

    // 디자인의 의자 영역을 캔버스 픽셀로 환산 (designFrame 규칙)
    const designToCanvas = frameOf(width, height);
    const [bx0, by0, bx1, by1] = view.box;
    const target = {
      x0: designToCanvas.toX(bx0),
      x1: designToCanvas.toX(bx1),
      y0: designToCanvas.toY(by0),
      y1: designToCanvas.toY(by1),
    };

    // 1) 크기: 모델이 영역 안에 들어오도록 줌 (비율 유지)
    const p = projectedBox(width, height);
    const scale = Math.min((target.x1 - target.x0) / (p.x1 - p.x0), (target.y1 - target.y0) / (p.y1 - p.y0));
    camera.zoom = scale;
    camera.updateProjectionMatrix();
    controls.panSpeed = 1 / scale; // OrbitControls의 Pan은 camera.zoom을 모르므로 보정 (커서와 같은 속도로 이동)

    // 2) 위치: 모델 영역의 중심을 디자인 영역의 중심으로 이동
    const q = projectedBox(width, height);
    const dx = (target.x0 + target.x1) / 2 - (q.x0 + q.x1) / 2;
    const dy = (target.y0 + target.y1) / 2 - (q.y0 + q.y1) / 2;
    camera.setViewOffset(width, height, -dx, -dy, width, height);
    camera.updateProjectionMatrix();

    camera.position.copy(homePosition);
    camera.lookAt(center);
    camera.updateMatrixWorld();
    updateZoomFrame(width, height, designToCanvas.safe);

    camera.position.copy(saved);
    camera.lookAt(controls.target);
    camera.updateMatrixWorld();
    controls.update();
    render();
  }

  function render() {
    if (composer) composer.render();
    else renderer.render(scene, camera);
  }

  window.addEventListener('resize', layout);
  layout();

  // ---------- 깊이 범위(near) ----------
  // near를 고정으로 아주 작게 두면 축소했을 때 깊이 버퍼 정밀도가 떨어져(far/near 비가 수만 배),
  // 원단과 쿠션 속처럼 1mm 안쪽으로 붙은 표면끼리 앞뒤를 가리지 못하고 흰 줄·점·깜빡임(Z-fighting)이 생긴다.
  // → 카메라에서 모델(분해 상태면 현재 부품 위치) 경계 상자까지의 거리의 절반을 near로 쓴다.
  //   멀리서는 near가 커져 정밀도가 충분하고, 표면 가까이 확대하면 near가 작아져 앞쪽이 잘리지 않는다.
  const MIN_NEAR = radius * 0.002;
  const clipBox = new THREE.Box3();
  function updateClipping() {
    clipBox.setFromObject(model);
    const gap = clipBox.distanceToPoint(camera.position); // 상자 안이면 0
    const near = Math.max(MIN_NEAR, gap * 0.5);
    if (Math.abs(near - camera.near) > camera.near * 0.02) {
      camera.near = near;
      camera.updateProjectionMatrix(); // 구도용 zoom·viewOffset은 그대로 유지된다
    }
  }

  // 자동 회전과 감속을 위해 매 프레임 컨트롤을 갱신하고 그린다
  const timer = new THREE.Timer();
  renderer.setAnimationLoop(() => {
    timer.update();
    const delta = timer.getDelta();
    updateAutoRotate(delta);
    const zoomingOut = flushWheel();
    controls.update(delta);
    constrainTarget(zoomingOut);
    updateClipping();
    render();
  });

  return {
    scene,
    camera,
    renderer,
    model,
    controls,
    render,
    layout,
    projectedBox,
    setAutoRotateAllowed,
    autoRotateState: autoRotate,
    zoomFactor,
    updateClipping, // 깊이 범위(near)를 즉시 다시 계산 (매 프레임 자동으로도 호출된다)
    zoomReferenceBase: () => zoomRef.base,
    maxZoomOut: MAX_ZOOM_OUT,
    setUserControl,
    invalidateShadows: () => (renderer.shadowMap.needsUpdate = true),
    setZoomReference,
    center,
    getFrame: () => frame,
    materialReport,
    partGraft, // 부품 정보 이식 결과 (partSource를 쓴 경우)
    shading: { sun, ground, gtao, look }, // 그림자 미세 조정·비교용 (키 라이트, 바닥, 접촉 그림자 패스, 렌더 값)
  };
}

// GLB를 불러온다. 일부 출력기(KeyShot 등)는 텍스처 없이 { "scale": 1 }만 있는 normalTexture 같은 항목을 남기는데,
// GLTFLoader는 이런 항목에서 멈춘다. → 파일은 그대로 두고, 메모리에서만 index 없는 텍스처 참조를 지운 뒤 읽는다.
// (가리키는 텍스처가 없는 항목이라 지워도 재질·모양은 변하지 않는다. 문제가 없는 파일은 원래 그대로 읽는다.)
async function loadGltf(url) {
  const loader = new GLTFLoader();
  const buffer = await (await fetch(url)).arrayBuffer();
  const view = new DataView(buffer);
  const isGlb = buffer.byteLength > 20 && view.getUint32(0, true) === 0x46546c67 && view.getUint32(16, true) === 0x4e4f534a;
  const resourcePath = THREE.LoaderUtils.extractUrlBase(new URL(url, window.location.href).href);
  if (!isGlb) return loader.parseAsync(buffer, resourcePath);

  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)));
  const removed = [];
  (json.materials ?? []).forEach((material, i) => {
    const slots = [
      [material, 'normalTexture'],
      [material, 'occlusionTexture'],
      [material, 'emissiveTexture'],
      [material.pbrMetallicRoughness ?? {}, 'baseColorTexture'],
      [material.pbrMetallicRoughness ?? {}, 'metallicRoughnessTexture'],
    ];
    for (const [owner, key] of slots) {
      if (owner[key] && owner[key].index == null) {
        delete owner[key];
        removed.push(`material ${i}.${key}`);
      }
    }
  });
  if (!removed.length) return loader.parseAsync(buffer, resourcePath);

  console.info('GLB의 빈 텍스처 참조를 메모리에서만 정리했습니다 (파일은 그대로):', removed.join(', '));
  let text = new TextEncoder().encode(JSON.stringify(json));
  const padded = new Uint8Array(Math.ceil(text.length / 4) * 4).fill(0x20);
  padded.set(text);
  text = padded;
  const rest = new Uint8Array(buffer, 20 + jsonLength); // BIN 청크(헤더 포함)는 그대로
  const out = new Uint8Array(20 + text.length + rest.length);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, 0x46546c67, true);
  outView.setUint32(4, 2, true);
  outView.setUint32(8, out.length, true);
  outView.setUint32(12, text.length, true);
  outView.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20);
  out.set(rest, 20 + text.length);
  return loader.parseAsync(out.buffer, resourcePath);
}

// 부품 정보 이식: model에 partId가 있는 노드가 하나도 없으면, sourceUrl GLB에서 같은 이름의 (메시가 아닌) 노드의 extras를 복사한다
async function graftPartData(model, sourceUrl) {
  let hasParts = false;
  model.traverse((node) => (hasParts ||= !!node.userData?.partId));
  if (hasParts) return { grafted: 0, reason: 'model already has part data' };

  const source = (await new GLTFLoader().loadAsync(sourceUrl)).scene;
  const byName = new Map();
  source.traverse((node) => {
    if (node.userData?.partId && node.name) byName.set(node.name, node.userData);
  });
  const grafted = [];
  model.traverse((node) => {
    const data = byName.get(node.name);
    if (!data || node.isMesh || node.userData?.partId) return; // 부품 그룹 노드에만 (같은 이름의 메시 노드는 제외)
    node.userData = { ...node.userData, ...structuredClone(data) };
    grafted.push(node.name);
  });
  source.traverse((o) => o.geometry?.dispose());
  const missing = [...byName.keys()].filter((name) => !grafted.includes(name));
  if (missing.length) console.warn('부품 정보를 옮기지 못한 부품:', missing);
  return { grafted: grafted.length, missing };
}

// 모델의 재질 텍스처 중 maxSize보다 큰 것을 비율을 유지해 줄인다 (같은 이미지를 쓰는 텍스처는 한 번만 처리)
function limitTextureSize(model, maxSize) {
  const done = new Map(); // 원본 이미지 → 줄인 캔버스
  model.traverse((mesh) => {
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'sheenColorMap', 'sheenRoughnessMap']) {
        const texture = material[key];
        const image = texture?.image;
        if (!image || Math.max(image.width, image.height) <= maxSize) continue;
        if (!done.has(image)) {
          const scale = maxSize / Math.max(image.width, image.height);
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(image.width * scale);
          canvas.height = Math.round(image.height * scale);
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          done.set(image, canvas);
        }
        texture.image = done.get(image);
        texture.needsUpdate = true;
      }
    }
  });
  for (const image of done.keys()) image.close?.(); // 원본 ImageBitmap 메모리 해제
}

// 스튜디오 환경광(PMREM 반사용 밉맵)을 만든다.
// 실제 HDRI(Studio Small 03)를 배경 구로 깔고, 제품 촬영 스튜디오처럼
// 흰 사이클로라마 바닥 + 소프트박스(키·보조) + 뒤쪽 스트립(림) + 검은 반사판(flag)을 더한다.
// → 크롬·유광 도장에 소프트박스 형태와 흰 바닥이 자연스럽게 비치고, 검은 반사판이 금속의 윤곽을 잡아 준다.
// HDRI를 못 불러오면 내장 RoomEnvironment로 대체한다.
async function loadStudioEnvironment(pmrem) {
  let hdr = null;
  try {
    hdr = await new HDRLoader().loadAsync(STUDIO_HDRI);
  } catch (error) {
    console.warn('Studio HDRI를 불러오지 못해 기본 환경광을 사용합니다.', error);
  }
  const studio = hdr ? buildStudioScene(hdr) : new RoomEnvironment();
  const env = pmrem.fromScene(studio, 0.02).texture;
  // 환경 맵을 만든 뒤 임시 장면과 원본 HDR은 GPU 메모리에서 해제
  studio.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });
  hdr?.dispose();
  return env;
}

function buildStudioScene(hdr) {
  const scene = new THREE.Scene();
  const panel = (w, h, intensity, color = 0xffffff) =>
    new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }),
    );
  const place = (mesh, x, y, z) => {
    mesh.position.set(x, y, z);
    mesh.lookAt(0, 0, 0);
    scene.add(mesh);
  };

  // 실제 스튜디오 HDRI (주변의 은은한 빛과 색)
  hdr.mapping = THREE.UVMapping;
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(20, 64, 32),
    new THREE.MeshBasicMaterial({ map: hdr, side: THREE.BackSide, color: new THREE.Color(0.55, 0.55, 0.55) }),
  );
  scene.add(dome);

  // 흰 사이클로라마 바닥: 아래쪽 반사를 밝은 무채색으로
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(19, 64),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.9, 0.88) }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -4;
  scene.add(floor);

  place(panel(7, 5, 5.5), -4, 6, 6); // 키 소프트박스: 앞쪽 왼편 위
  place(panel(4, 6, 2.2, 0xfff4e8), 8, 1.5, 3); // 보조 소프트박스: 오른쪽 (살짝 따뜻하게)
  place(panel(10, 1.4, 4), -1, 7, -7); // 림 스트립: 뒤쪽 위
  place(panel(5, 8, 0.02), -8, 1, -2); // 검은 반사판(flag): 금속에 어두운 면을 만들어 형태를 살린다
  return scene;
}
