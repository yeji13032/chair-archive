import * as THREE from 'three';
import { gsap } from 'gsap';

/**
 * SHOW STRUCTURE / RETURN TO FORM + 분해 상태의 무중력 부품 드래그.
 *
 * 부품 = GLB 노드 중 extras(userData)에 partId가 있는 노드. 하나의 부품 노드 아래에 여러 메시가 있으면
 * 그 노드(Group)를 움직여 메시들이 함께 이동한다. 메시·재질·계층은 바꾸지 않고 노드의 transform만 움직인다.
 *
 * 분해 방향은 GLB에 저장된 값을 사용한다 (부모 노드 좌표계 기준).
 *   - explodeOffset / explodeRot (001·002·004·005·006, mm 단위 모델)
 *   - off / rot (003·007, m 단위 모델)
 * stage(조립 순서)가 있으면 조립의 역순(마지막에 조립된 부품부터)으로 분해한다.
 *
 * 상태: ASSEMBLED → EXPLODING → EXPLODED(부품 드래그 가능) → ASSEMBLING → ASSEMBLED
 *
 * options (chair-details.js의 explode):
 *   distance  분해 거리 배율 (1 = GLB 값 그대로)
 *   duration  분해·재조립 시간(초)
 *   padding   분해 상태를 화면에 맞출 때의 여유 (0.92 = 안전 영역의 92%만 사용)
 */
export const MODES = {
  ASSEMBLED: 'ASSEMBLED',
  EXPLODING: 'EXPLODING',
  EXPLODED: 'EXPLODED',
  ASSEMBLING: 'ASSEMBLING',
};

// 무중력 드래그 느낌
const FOLLOW = 12; // 커서를 따라가는 빠르기 (클수록 즉각적). 지수 감쇠 보간 계수 (1/초)
const GLIDE = 0.12; // 손을 놓은 뒤 미끄러지는 거리 = 놓는 순간 속도 × GLIDE 초
const MAX_GLIDE_PX = 80; // 미끄러지는 거리의 상한 (화면 픽셀)
const POINTS_PER_PART = 400; // 화면 범위 계산용 부품별 꼭짓점 샘플 수

export function createExplodeController(viewer, options = {}) {
  const { model, camera, controls, renderer } = viewer;
  const canvas = renderer.domElement;
  const settings = { distance: 1, duration: 2, padding: 0.92, ...options };

  // ---------- 부품 수집과 원래 transform 저장 ----------
  model.updateMatrixWorld(true);
  const parts = [];
  model.traverse((node) => {
    const data = node.userData;
    if (!data?.partId) return;
    if (parts.some((p) => isAncestor(p.node, node))) return; // 부품 안의 부품은 상위 부품과 함께 움직인다
    const offset = data.explodeOffset ?? data.off ?? [0, 0, 0];
    const rot = data.explodeRot ?? data.rot ?? [0, 0, 0];
    parts.push({
      node,
      id: data.partId,
      name: data.name ?? data.partId,
      stage: data.stage ?? 0,
      // 원래 transform (재조립 기준값, 절대 바뀌지 않음)
      origin: {
        position: node.position.clone(),
        quaternion: node.quaternion.clone(),
        scale: node.scale.clone(),
      },
      // 초기 분해 위치 = 원래 위치 + GLB의 분해 방향 × 배율 (부모 좌표계)
      exploded: {
        position: node.position.clone().add(new THREE.Vector3(...offset).multiplyScalar(settings.distance)),
        quaternion: node.quaternion.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot))),
      },
      localPoints: sampleLocalPoints(node),
      worldPoints: [],
      // 무중력 드래그용: 부품이 향해 가는 위치(부모 좌표계)와 속도
      motion: { target: node.position.clone(), velocity: new THREE.Vector3() },
    });
  });
  parts.forEach((p) => (p.worldPoints = p.localPoints.map(() => new THREE.Vector3())));

  // 조립 순서의 역순으로 시간차: stage가 큰(나중에 조립된) 부품이 먼저 떨어져 나온다
  const stages = [...new Set(parts.map((p) => p.stage))].sort((a, b) => b - a);
  const STAGGER = stages.length > 1 ? 0.35 : 0; // 전체 진행도 중 시간차에 쓰는 비율
  parts.forEach((part) => {
    const order = stages.indexOf(part.stage) / Math.max(1, stages.length - 1);
    part.start = order * STAGGER;
    part.span = 1 - STAGGER;
  });

  // ---------- 상태 ----------
  let mode = MODES.ASSEMBLED;
  let assembledCamera = null; // 분해 직전 카메라 (재조립 때 그대로 돌아간다)
  const listeners = new Set();
  function setMode(next) {
    mode = next;
    listeners.forEach((fn) => fn(mode));
  }

  // ---------- 분해·재조립 애니메이션 ----------
  // 각 부품을 from → to 로 보간한다. 항상 저장된 값에서 계산하므로 반복해도 오차가 쌓이지 않는다.
  const tmpQ = new THREE.Quaternion();
  function applyTransition(progress, fromKey, toKey) {
    for (const part of parts) {
      const t = THREE.MathUtils.clamp((progress - part.start) / part.span, 0, 1);
      const k = t * t * (3 - 2 * t); // 부품별 smoothstep으로 출발·도착을 부드럽게
      const from = part[fromKey];
      const to = part[toKey];
      part.node.position.lerpVectors(from.position, to.position, k);
      part.node.quaternion.copy(tmpQ.copy(from.quaternion).slerp(to.quaternion, k));
      part.node.scale.copy(part.origin.scale); // 크기는 항상 원본
    }
    viewer.invalidateShadows();
  }

  function setPartsTo(key) {
    for (const part of parts) {
      part.node.position.copy(part[key].position);
      part.node.quaternion.copy(part[key].quaternion);
      part.node.scale.copy(part.origin.scale);
      part.motion.target.copy(part.node.position);
      part.motion.velocity.set(0, 0, 0);
    }
    model.updateMatrixWorld(true);
    viewer.invalidateShadows();
  }

  // ---------- 화면 투영 ----------
  function updateWorldPoints(part, matrixWorld = part.node.matrixWorld) {
    for (let i = 0; i < part.localPoints.length; i++) {
      part.worldPoints[i].copy(part.localPoints[i]).applyMatrix4(matrixWorld);
    }
    return part.worldPoints;
  }

  function allWorldPoints() {
    const out = [];
    for (const part of parts) out.push(...updateWorldPoints(part));
    return out;
  }

  function screenBox(points) {
    const { width, height } = viewer.getFrame();
    const v = new THREE.Vector3();
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
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

  // 분해 상태 전체가 안전 영역(상단 메뉴 아래 ~ 하단 캡션 위, 오른쪽 정보 영역 왼쪽)에 맞는 배율
  function fitScale(points, target, position) {
    const { width, height, px, py, safe } = viewer.getFrame();
    const saved = { position: camera.position.clone(), quaternion: camera.quaternion.clone() };
    camera.position.copy(position);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    const v = new THREE.Vector3();
    let left = 1e-6;
    let right = 1e-6;
    let up = 1e-6;
    let down = 1e-6;
    for (const p of points) {
      v.copy(p).project(camera);
      const x = ((v.x + 1) / 2) * width;
      const y = ((1 - v.y) / 2) * height;
      left = Math.max(left, px - x);
      right = Math.max(right, x - px);
      up = Math.max(up, py - y);
      down = Math.max(down, y - py);
    }
    camera.position.copy(saved.position);
    camera.quaternion.copy(saved.quaternion);
    camera.updateMatrixWorld();
    return Math.min((px - safe.left) / left, (safe.right - px) / right, (py - safe.top) / up, (safe.bottom - py) / down);
  }

  function explodedCamera() {
    setPartsTo('exploded');
    const points = allWorldPoints().map((p) => p.clone());
    setPartsTo('origin');

    // 현재 보는 방향은 유지하고, 분해된 전체의 중심을 바라보며 거리만 조정한다
    const direction = camera.position.clone().sub(controls.target).normalize();
    const target = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
    let radius = camera.position.distanceTo(controls.target);
    for (let i = 0; i < 4; i++) {
      const fit = fitScale(points, target, target.clone().addScaledVector(direction, radius));
      radius /= fit * settings.padding;
    }
    const size = new THREE.Box3().setFromPoints(points).getBoundingSphere(new THREE.Sphere()).radius;
    return { target, position: target.clone().addScaledVector(direction, radius), distance: radius, size };
  }

  // 분해·조립을 전환해도 사용자가 확대해 둔 배율을 이어 간다 (너무 가깝거나 먼 배율은 전환 시 적당히 줄인다)
  const MAX_CARRIED_ZOOM = 2.5;
  function carriedZoom() {
    return THREE.MathUtils.clamp(viewer.zoomFactor(), viewer.maxZoomOut, MAX_CARRIED_ZOOM);
  }

  // 카메라 이동: 중심점은 직선으로, 시점은 구면 좌표(거리·방위·높이)로 보간해 흔들림 없이 이동
  function tweenCamera(timeline, to) {
    const fromTarget = controls.target.clone();
    const from = new THREE.Spherical().setFromVector3(camera.position.clone().sub(fromTarget));
    const dest = new THREE.Spherical().setFromVector3(to.position.clone().sub(to.target));
    let dTheta = dest.theta - from.theta;
    dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta)); // 가까운 쪽으로 회전
    const cam = { t: 0 };
    const s = new THREE.Spherical();
    timeline.to(
      cam,
      {
        t: 1,
        duration: settings.duration,
        ease: 'power2.inOut',
        onUpdate: () => {
          controls.target.lerpVectors(fromTarget, to.target, cam.t);
          s.set(
            THREE.MathUtils.lerp(from.radius, dest.radius, cam.t),
            THREE.MathUtils.lerp(from.phi, dest.phi, cam.t),
            from.theta + dTheta * cam.t,
          );
          camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(s));
          camera.lookAt(controls.target);
        },
      },
      0,
    );
  }

  function show() {
    if (mode !== MODES.ASSEMBLED) return false; // 애니메이션 중·이미 분해된 상태에서는 무시
    setMode(MODES.EXPLODING);
    viewer.setAutoRotateAllowed(false); // 분해 상태에서는 자동 회전하지 않는다
    viewer.setUserControl(false);
    assembledCamera = { target: controls.target.clone(), position: camera.position.clone() };

    // 분해 전체가 화면에 맞는 거리(fit)에 지금 확대 배율을 그대로 적용한다 (확대하지 않았다면 기존과 같다)
    const zoom = carriedZoom();
    const fitted = explodedCamera();
    const to = {
      target: fitted.target,
      position: fitted.target.clone().add(fitted.position.clone().sub(fitted.target).divideScalar(zoom)),
    };
    const progress = { value: 0 };
    const tl = gsap.timeline({
      onComplete: () => {
        setPartsTo('exploded');
        // 분해 상태: 빈 공간 드래그로 전체 회전, 휠 확대·축소 가능. 확대 범위는 현재 부품 위치 기준
        viewer.setZoomReference({ base: fitted.distance, center: fitted.target.clone(), size: fitted.size });
        viewer.setUserControl(true);
        setMode(MODES.EXPLODED);
        startMotionLoop();
      },
    });
    tl.to(progress, {
      value: 1,
      duration: settings.duration,
      ease: 'power2.inOut',
      onUpdate: () => applyTransition(progress.value, 'origin', 'exploded'),
    }, 0);
    tweenCamera(tl, to);
    return true;
  }

  function hide() {
    if (mode !== MODES.EXPLODED) return false;
    endDrag();
    stopMotionLoop();
    setMode(MODES.ASSEMBLING);
    // 분해 상태에서의 확대 배율을 조립 상태로 이어 간다 (분해 중 확대하지 않았다면 분해 전 시점으로 그대로 돌아간다)
    const zoom = carriedZoom();
    viewer.setUserControl(false);
    viewer.setZoomReference(null);
    const back = assembledCamera.position.clone().sub(assembledCamera.target).setLength(viewer.zoomReferenceBase() / zoom);
    assembledCamera.position = assembledCamera.target.clone().add(back);

    // 사용자가 옮겨 둔 현재 위치에서 원래 위치로 돌아간다
    for (const part of parts) {
      part.current = { position: part.node.position.clone(), quaternion: part.node.quaternion.clone() };
    }
    const progress = { value: 0 };
    const tl = gsap.timeline({
      onComplete: () => {
        setPartsTo('origin'); // 저장해 둔 원래 transform으로 정확히 복원
        controls.target.copy(assembledCamera.target);
        camera.position.copy(assembledCamera.position);
        camera.lookAt(controls.target);
        viewer.setUserControl(true); // 전체 회전·확대 다시 허용
        viewer.setAutoRotateAllowed(true); // 조립 완료 → 자동 회전 서서히 재시작
        setMode(MODES.ASSEMBLED);
      },
    });
    tl.to(progress, {
      value: 1,
      duration: settings.duration,
      ease: 'power2.inOut',
      onUpdate: () => applyTransition(progress.value, 'current', 'origin'),
    }, 0);
    tweenCamera(tl, assembledCamera);
    return true;
  }

  // ---------- 부품 선택 (Raycaster) ----------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  function setPointer(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
  }

  // 분해 상태에서만 부품을 돌려준다. 조립 상태에서는 개별 부품을 다룰 수 없다.
  function pickPart(clientX, clientY) {
    if (mode !== MODES.EXPLODED) return null;
    setPointer(clientX, clientY);
    const hit = raycaster.intersectObjects(parts.map((p) => p.node), true)[0];
    if (!hit) return null;
    const part = parts.find((p) => isAncestor(p.node, hit.object));
    return part ? { part, point: hit.point } : null;
  }

  // ---------- 무중력 드래그 ----------
  // 카메라와 평행한 평면(집은 지점을 지남) 위에서 커서를 따라 움직인다. 집은 지점과 부품 중심의 간격은 유지된다.
  const drag = {
    part: null,
    pointerId: null,
    plane: new THREE.Plane(),
    grabOffset: new THREE.Vector3(), // 부품 월드 위치 - 집은 지점
    lastTarget: new THREE.Vector3(),
    lastTime: 0,
  };

  function targetFromPointer(clientX, clientY) {
    setPointer(clientX, clientY);
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(drag.plane, hit)) return null;
    const world = hit.add(drag.grabOffset);
    return drag.part.node.parent.worldToLocal(world);
  }

  function onPointerDown(event) {
    if (mode !== MODES.EXPLODED || event.button !== 0) return;
    const picked = pickPart(event.clientX, event.clientY);
    if (!picked) return; // 빈 공간 → OrbitControls가 전체 뷰를 회전한다

    // 부품을 집었으면 OrbitControls에 이벤트가 가지 않게 막고 회전을 일시적으로 끈다
    event.stopImmediatePropagation();
    event.preventDefault();

    const { part, point } = picked;
    drag.part = part;
    drag.pointerId = event.pointerId;
    drag.plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), point);
    drag.grabOffset.copy(part.node.getWorldPosition(new THREE.Vector3())).sub(point);
    part.motion.velocity.set(0, 0, 0);
    drag.lastTarget.copy(part.motion.target);
    drag.lastTime = performance.now();

    controls.enabled = false;
    canvas.style.cursor = 'grabbing';
    try {
      canvas.setPointerCapture(event.pointerId); // 캔버스 밖으로 나가도 드래그 유지
    } catch {
      // 포인터 캡처를 못 해도 window 이벤트로 드래그는 계속된다
    }
  }

  function onPointerMove(event) {
    if (drag.part && event.pointerId === drag.pointerId) {
      const local = targetFromPointer(event.clientX, event.clientY);
      if (!local) return;
      const part = drag.part;
      part.motion.target.copy(clampToScreen(part, local));
      // 놓는 순간의 속도(부모 좌표계, 초당)를 부드럽게 추정
      const now = performance.now();
      const dt = Math.max(1, now - drag.lastTime) / 1000;
      const v = part.motion.target.clone().sub(drag.lastTarget).divideScalar(dt);
      part.motion.velocity.lerp(v, 0.35);
      drag.lastTarget.copy(part.motion.target);
      drag.lastTime = now;
      return;
    }
    // 분해 상태에서 부품 위에 커서가 있으면 집을 수 있다는 커서
    if (mode === MODES.EXPLODED && event.target === canvas && event.buttons === 0) {
      canvas.style.cursor = pickPart(event.clientX, event.clientY) ? 'grab' : '';
    }
  }

  function onPointerUp(event) {
    if (!drag.part || (event && event.pointerId !== drag.pointerId)) return;
    const part = drag.part;
    // 짧게 미끄러진 뒤 멈춘다 (GLIDE 초 분량, 화면에서 최대 MAX_GLIDE_PX까지만 → 계속 날아가지 않는다)
    const glide = part.motion.velocity.clone().multiplyScalar(GLIDE);
    const maxGlide = MAX_GLIDE_PX * localUnitsPerPixel(part, part.motion.target);
    if (glide.length() > maxGlide) glide.setLength(maxGlide);
    part.motion.target.copy(clampToScreen(part, part.motion.target.clone().add(glide)));
    part.motion.velocity.set(0, 0, 0);
    endDrag();
  }

  function endDrag() {
    if (!drag.part) return;
    try {
      if (drag.pointerId != null && canvas.hasPointerCapture(drag.pointerId)) canvas.releasePointerCapture(drag.pointerId);
    } catch {
      // 이미 해제된 포인터
    }
    drag.part = null;
    drag.pointerId = null;
    canvas.style.cursor = '';
    if (mode === MODES.EXPLODED) controls.enabled = true; // 드래그 종료 → 카메라 회전 다시 허용
  }

  canvas.addEventListener('pointerdown', onPointerDown, { capture: true });
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);

  // ---------- 이동 범위: 부품 전체가 안전 영역 안에 머물도록 ----------
  // 후보 위치에서 부품 꼭짓점을 화면에 투영해, 벗어난 픽셀만큼 드래그 평면 위에서 되돌린다.
  // 목표 위치만 제한하고 실제 이동은 보간되므로 경계에 닿아도 튕기지 않고 부드럽게 멈춘다.
  const tmpMatrix = new THREE.Matrix4();
  function clampToScreen(part, local) {
    const { width, height, safe } = viewer.getFrame();
    const node = part.node;
    const candidate = local.clone();
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    for (let i = 0; i < 3; i++) {
      tmpMatrix.compose(candidate, node.quaternion, node.scale).premultiply(node.parent.matrixWorld);
      const b = screenBox(updateWorldPoints(part, tmpMatrix));
      const w = b.x1 - b.x0;
      const h = b.y1 - b.y0;
      // 부품이 안전 영역보다 크면 중앙 정렬, 아니면 넘친 만큼만 되돌린다
      const dx = w > safe.right - safe.left ? (safe.left + safe.right) / 2 - (b.x0 + b.x1) / 2
        : Math.max(0, safe.left - b.x0) - Math.max(0, b.x1 - safe.right);
      const dy = h > safe.bottom - safe.top ? (safe.top + safe.bottom) / 2 - (b.y0 + b.y1) / 2
        : Math.max(0, safe.top - b.y0) - Math.max(0, b.y1 - safe.bottom);
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) break;

      const worldCenter = candidate.clone().applyMatrix4(node.parent.matrixWorld);
      const worldPerPixel = worldPerPixelAt(worldCenter, height);
      const shift = right.clone().multiplyScalar(dx * worldPerPixel).addScaledVector(up, -dy * worldPerPixel);
      const moved = node.parent.worldToLocal(worldCenter.add(shift));
      candidate.copy(moved);
    }
    return candidate;
  }

  // 픽셀 → 월드: 해당 깊이에서 화면 1px이 차지하는 월드 길이
  function worldPerPixelAt(worldPoint, height = viewer.getFrame().height) {
    const depth = worldPoint.clone().sub(camera.position).dot(camera.getWorldDirection(new THREE.Vector3()));
    return (2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / (camera.zoom * height);
  }

  // 부품 부모 좌표계(mm 또는 m) 기준 1px 길이
  function localUnitsPerPixel(part, local) {
    const parent = part.node.parent;
    const world = local.clone().applyMatrix4(parent.matrixWorld);
    return worldPerPixelAt(world) / parent.matrixWorld.getMaxScaleOnAxis();
  }

  // ---------- requestAnimationFrame 기반 보간 ----------
  // 부품은 목표 위치를 지수 감쇠로 따라가 커서보다 살짝 늦게, 가볍게 떠서 움직인다. 중력은 없다.
  let rafId = null;
  let lastFrame = 0;
  function startMotionLoop() {
    if (rafId) return;
    lastFrame = performance.now();
    const step = (now) => {
      const dt = Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;
      const k = 1 - Math.exp(-FOLLOW * dt);
      let moving = false;
      for (const part of parts) {
        if (part.node.position.distanceToSquared(part.motion.target) > 1e-12) moving = true;
        part.node.position.lerp(part.motion.target, k);
      }
      if (moving) viewer.invalidateShadows(); // 부품이 움직이는 동안에만 그림자 갱신
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
  }
  function stopMotionLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  return {
    parts,
    show,
    hide,
    pickPart: (x, y) => pickPart(x, y)?.part ?? null,
    get mode() {
      return mode;
    },
    onChange: (fn) => listeners.add(fn),
  };
}

// 부품 노드 기준 좌표계로 메시 꼭짓점을 샘플링 (화면 범위 계산용)
function sampleLocalPoints(node) {
  const inverse = node.matrixWorld.clone().invert();
  const meshes = [];
  node.traverse((o) => o.isMesh && meshes.push(o));
  const total = meshes.reduce((n, m) => n + m.geometry.attributes.position.count, 0);
  const step = Math.max(1, Math.ceil(total / POINTS_PER_PART));
  const points = [];
  const toLocal = new THREE.Matrix4();
  for (const mesh of meshes) {
    toLocal.multiplyMatrices(inverse, mesh.matrixWorld);
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += step) {
      points.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(toLocal));
    }
  }
  return points;
}

function isAncestor(ancestor, node) {
  for (let n = node; n; n = n.parent) if (n === ancestor) return true;
  return false;
}
