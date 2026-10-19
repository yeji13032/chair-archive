import * as THREE from 'three';

// 캔버스에 Three.js 씬/카메라/렌더러를 만들고 리사이즈·렌더 루프를 관리한다.
export function createScene(canvas) {
  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 0, 5);
  scene.add(camera);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  scene.add(new THREE.AmbientLight(0xffffff, 1));
  const light = new THREE.DirectionalLight(0xffffff, 2);
  light.position.set(3, 4, 5);
  scene.add(light);

  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener('resize', onResize);

  const updaters = new Set();
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const elapsed = clock.getElapsedTime();
    updaters.forEach((fn) => fn(elapsed));
    renderer.render(scene, camera);
  });

  return {
    scene,
    camera,
    renderer,
    onTick: (fn) => updaters.add(fn),
    dispose: () => {
      renderer.setAnimationLoop(null);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
    },
  };
}
