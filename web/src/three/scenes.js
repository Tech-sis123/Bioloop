// BioLoop 3D scenes, built from primitives so there are no model files to load.
// mountBin(container, { mode: 'hero' | 'sensor', onTick })  -> cleanup()
// mountLoop(container)                                         -> cleanup()
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}

// Shared renderer setup: transparent canvas, filmic tone mapping, soft shadows,
// studio reflections, pause when off screen, resize with the container.
function stage(container, { fov = 30, shadows = true } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.touchAction = 'pan-y';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.7;

  const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 100);

  const resize = () => {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  let visible = true;
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.01 });
  io.observe(container);

  let raf = 0;
  const loop = (fn) => {
    const clock = new THREE.Clock();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!visible || document.hidden) return;
      fn(clock.getElapsedTime(), clock.getDelta());
      renderer.render(scene, camera);
    };
    tick();
  };

  const dispose = () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    io.disconnect();
    scene.traverse((o) => {
      o.geometry?.dispose?.();
      if (o.material) [].concat(o.material).forEach((m) => { m.map?.dispose?.(); m.dispose?.(); });
    });
    pmrem.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
  return { renderer, scene, camera, loop, dispose };
}

function lights(scene, tint = 0x7ce3a3) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x1b3a2a, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(3.5, 6, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -3; key.shadow.camera.right = 3;
  key.shadow.camera.top = 3; key.shadow.camera.bottom = -3;
  key.shadow.radius = 6;
  key.shadow.bias = -0.0004;
  scene.add(key);
  const rim = new THREE.DirectionalLight(tint, 2.4);
  rim.position.set(-4, 3, -3);
  scene.add(rim);
  const fill = new THREE.PointLight(0xff8cc6, 6, 8);
  fill.position.set(2.5, 1.2, 2.5);
  scene.add(fill);
}

function radialTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function solarTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = '#1b2a6b';
  g.fillRect(0, 0, 256, 160);
  g.strokeStyle = '#9fb3ff';
  g.lineWidth = 2;
  for (let x = 0; x <= 256; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 160); g.stroke(); }
  for (let y = 0; y <= 160; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const STREAMS = [
  { key: 'general', color: 0xf2b705, x: -0.5 },
  { key: 'recyclable', color: 0x2f5bff, x: 0 },
  { key: 'organic', color: 0x1f9d5a, x: 0.5 },
];

function buildBin({ cutaway = false } = {}) {
  const bin = new THREE.Group();
  const frameMat = new THREE.MeshPhysicalMaterial({ color: 0x1d2522, metalness: 0.35, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.3 });
  const shadowy = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
  const box = (w, h, d, r, mat) => shadowy(new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, r), mat));

  // Frame
  const base = box(1.66, 0.12, 0.96, 0.05, frameMat); base.position.y = 0.16; bin.add(base);
  const rim = box(1.72, 0.14, 1.0, 0.05, frameMat); rim.position.y = 1.86; bin.add(rim);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const p = box(0.11, 1.72, 0.11, 0.04, frameMat);
    p.position.set(sx * 0.8, 1.0, sz * 0.44);
    bin.add(p);
  }
  for (const x of [-0.25, 0.25]) {
    const d = box(0.06, 1.66, 0.06, 0.02, frameMat);
    d.position.set(x, 1.0, 0.46);
    bin.add(d);
  }
  const back = box(1.6, 1.66, 0.05, 0.02, frameMat); back.position.set(0, 1.0, -0.44); bin.add(back);
  const band = box(1.66, 0.08, 0.98, 0.03, frameMat); band.position.y = 0.62; bin.add(band);

  // Wheels
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0d1210, roughness: 0.7 });
  for (const sx of [-1, 1]) {
    const w = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.08, 24), wheelMat));
    w.rotation.z = Math.PI / 2;
    w.position.set(sx * 0.86, 0.13, -0.36);
    bin.add(w);
  }

  // Inner bins, gauges, small lids, sensors
  const parts = {};
  for (const s of STREAMS) {
    const plastic = new THREE.MeshPhysicalMaterial({
      color: s.color, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.15,
      transparent: cutaway, opacity: cutaway ? 0.28 : 1, depthWrite: !cutaway,
    });
    const inner = box(0.44, 1.5, 0.8, 0.05, plastic);
    inner.position.set(s.x, 1.0, 0.02);
    bin.add(inner);

    // Waste level inside (only visible in cutaway)
    const wasteMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(s.color).multiplyScalar(0.7), roughness: 0.9 });
    const waste = box(0.38, 1, 0.72, 0.04, wasteMat);
    waste.position.set(s.x, 0.3, 0.02);
    waste.visible = cutaway;
    bin.add(waste);

    // LED gauge on the front face
    const track = new THREE.Mesh(new RoundedBoxGeometry(0.07, 1.1, 0.02, 3, 0.03), new THREE.MeshStandardMaterial({ color: 0x0b1210, roughness: 0.4 }));
    track.position.set(s.x, 1.0, 0.43);
    bin.add(track);
    const glowMat = new THREE.MeshStandardMaterial({ color: s.color, emissive: s.color, emissiveIntensity: 1.6, roughness: 0.3 });
    const glow = new THREE.Mesh(new RoundedBoxGeometry(0.05, 1, 0.025, 3, 0.02), glowMat);
    glow.position.set(s.x, 0.45, 0.445);
    bin.add(glow);

    // Little coloured lid, propped open
    const lidPivot = new THREE.Group();
    lidPivot.position.set(s.x, 1.78, -0.36);
    const smallLid = box(0.42, 0.04, 0.74, 0.02, new THREE.MeshPhysicalMaterial({ color: s.color, roughness: 0.3, clearcoat: 1 }));
    smallLid.position.set(0, 0, 0.37);
    lidPivot.add(smallLid);
    lidPivot.rotation.x = -0.55;
    bin.add(lidPivot);

    // Lock ring (shown when locked)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 12, 48), new THREE.MeshStandardMaterial({ color: 0xff9a6b, emissive: 0xff6a3d, emissiveIntensity: 2 }));
    ring.position.set(s.x, 1.97, 0.1);
    ring.rotation.x = Math.PI / 2;
    ring.visible = false;
    bin.add(ring);

    // Ultrasonic beam (cutaway mode)
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xbff7d3, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const beam = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1, 32, 1, true), beamMat);
    beam.visible = cutaway;
    bin.add(beam);
    const puck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 20), new THREE.MeshStandardMaterial({ color: 0x111, emissive: 0x7ce3a3, emissiveIntensity: 0.8 }));
    puck.position.set(s.x, 1.74, 0.05);
    puck.visible = cutaway;
    bin.add(puck);

    parts[s.key] = { glow, glowMat, ring, waste, beam, beamMat, lidPivot, baseColor: new THREE.Color(s.color) };
  }

  // Big lid with solar panel, hinged at the back
  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, 1.95, -0.5);
  const lid = box(1.78, 0.08, 1.06, 0.04, frameMat);
  lid.position.set(0, 0, 0.53);
  lidPivot.add(lid);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.56), new THREE.MeshPhysicalMaterial({ map: solarTexture(), roughness: 0.2, metalness: 0.4, clearcoat: 1 }));
  panel.rotation.x = -Math.PI / 2;
  panel.position.set(0, 0.045, 0.53);
  lidPivot.add(panel);
  lidPivot.rotation.x = cutaway ? -1.25 : -0.95;
  bin.add(lidPivot);

  return { bin, parts, lidPivot };
}

function ground(scene, glow = 'rgba(124,227,163,0.55)') {
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1.6, 48), new THREE.ShadowMaterial({ opacity: 0.4 }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.receiveShadow = true;
  scene.add(shadow);
  const halo = new THREE.Mesh(new THREE.CircleGeometry(1.5, 48), new THREE.MeshBasicMaterial({ map: radialTexture(glow, 'rgba(124,227,163,0)'), transparent: true, depthWrite: false, opacity: 0.7 }));
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.002;
  scene.add(halo);
}

function setFill(part, fill, cutaway, t) {
  const h = Math.max(0.02, fill);
  part.glow.scale.y = h;
  part.glow.position.y = 0.45 + (h * 1) / 2;
  const locked = fill >= 0.9;
  part.ring.visible = locked;
  if (locked) {
    part.ring.scale.setScalar(1 + Math.sin(t * 5) * 0.06);
    part.glowMat.color.set(0xff9a6b);
    part.glowMat.emissive.set(0xff6a3d);
    part.lidPivot.rotation.x = THREE.MathUtils.lerp(part.lidPivot.rotation.x, 0, 0.1);
  } else {
    part.glowMat.color.copy(part.baseColor);
    part.glowMat.emissive.copy(part.baseColor);
    part.lidPivot.rotation.x = THREE.MathUtils.lerp(part.lidPivot.rotation.x, -0.55, 0.1);
  }
  if (cutaway) {
    const wh = 0.05 + fill * 1.38;
    part.waste.scale.y = wh;
    part.waste.position.y = 0.27 + wh / 2;
    const top = 0.27 + wh;
    const len = 1.72 - top;
    part.beam.scale.set(1, len, 1);
    part.beam.position.set(part.waste.position.x, top + len / 2, 0.05);
    part.beam.rotation.x = Math.PI; // point down
    part.beamMat.opacity = 0.12 + (Math.sin(t * 6 + part.waste.position.x * 4) * 0.5 + 0.5) * 0.22;
  }
}

export function mountBin(container, { mode = 'hero', onTick } = {}) {
  const cutaway = mode === 'sensor';
  const s = stage(container);
  lights(s.scene);
  ground(s.scene);
  const { bin, parts } = buildBin({ cutaway });
  s.scene.add(bin);

  s.camera.position.set(cutaway ? 3.6 : 4.2, cutaway ? 2.7 : 2.9, cutaway ? 5.0 : 5.6);
  const controls = new OrbitControls(s.camera, s.renderer.domElement);
  controls.target.set(0, 1.15, 0);
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minPolarAngle = 0.9;
  controls.maxPolarAngle = 1.45;
  controls.autoRotate = !reduceMotion();
  controls.autoRotateSpeed = cutaway ? 0.6 : 1.1;
  controls.update();

  const still = reduceMotion();
  let last = -1;
  s.loop((t) => {
    // General and recyclables drift gently; organic fills up, locks, gets emptied, repeats
    const cycle = still ? 0.6 : (t % 14) / 14;
    const organic = cycle < 0.72 ? 0.35 + (cycle / 0.72) * 0.6 : cycle < 0.86 ? 0.95 : 0.06 + ((cycle - 0.86) / 0.14) * 0.29;
    const fills = {
      general: 0.42 + (still ? 0 : Math.sin(t * 0.5) * 0.03),
      recyclable: 0.68 + (still ? 0 : Math.sin(t * 0.4 + 1) * 0.03),
      organic,
    };
    for (const k of Object.keys(parts)) setFill(parts[k], fills[k], cutaway, t);
    if (!still) bin.position.y = Math.sin(t * 1.2) * 0.02;
    controls.update();
    const pct = Math.round(organic * 100);
    if (onTick && pct !== last) { last = pct; onTick({ organic: pct, locked: organic >= 0.9 }); }
  });

  return () => { controls.dispose(); s.dispose(); };
}

// Floating recyclables orbiting a glowing loop
export function mountLoop(container) {
  const s = stage(container, { fov: 35, shadows: false });
  lights(s.scene, 0xa9bbff);
  s.camera.position.set(0, 0.4, 8.6);

  const ringMat = new THREE.MeshPhysicalMaterial({ color: 0x7ce3a3, emissive: 0x1f9d5a, emissiveIntensity: 0.6, roughness: 0.15, clearcoat: 1, transmission: 0.2 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.1, 32, 160), ringMat);
  ring.rotation.x = 1.25;
  s.scene.add(ring);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.1, 32, 160), new THREE.MeshPhysicalMaterial({ color: 0xa9bbff, emissive: 0x2f5bff, emissiveIntensity: 0.5, roughness: 0.15, clearcoat: 1 }));
  ring2.rotation.set(1.25, 0, 0);
  ring2.position.x = 0.6;
  s.scene.add(ring2);

  // A plastic bottle from a lathe profile
  const bottleGeo = new THREE.LatheGeometry([
    [0, 0], [0.26, 0], [0.28, 0.05], [0.28, 0.75], [0.22, 0.95], [0.11, 1.08], [0.1, 1.25], [0, 1.25],
  ].map(([x, y]) => new THREE.Vector2(x, y)), 32);
  bottleGeo.translate(0, -0.62, 0);
  const canGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.62, 32);
  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, -0.4);
  leafShape.quadraticCurveTo(0.35, 0, 0, 0.4);
  leafShape.quadraticCurveTo(-0.35, 0, 0, -0.4);
  const leafGeo = new THREE.ExtrudeGeometry(leafShape, { depth: 0.03, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2 });
  const paperGeo = new RoundedBoxGeometry(0.55, 0.7, 0.03, 2, 0.01);

  const mats = {
    bottle: new THREE.MeshPhysicalMaterial({ color: 0x9fd8ff, roughness: 0.05, transmission: 0.85, thickness: 0.4, ior: 1.4, clearcoat: 1 }),
    can: new THREE.MeshStandardMaterial({ color: 0xff8cc6, metalness: 0.85, roughness: 0.25 }),
    can2: new THREE.MeshStandardMaterial({ color: 0xffc21a, metalness: 0.85, roughness: 0.25 }),
    leaf: new THREE.MeshStandardMaterial({ color: 0x2db35a, roughness: 0.5 }),
    paper: new THREE.MeshStandardMaterial({ color: 0xf4f1e6, roughness: 0.8 }),
  };
  const kinds = [[bottleGeo, mats.bottle], [canGeo, mats.can], [leafGeo, mats.leaf], [paperGeo, mats.paper], [canGeo, mats.can2], [bottleGeo, mats.bottle], [leafGeo, mats.leaf]];
  const items = [];
  const N = 14;
  for (let i = 0; i < N; i++) {
    const [g, m] = kinds[i % kinds.length];
    const mesh = new THREE.Mesh(g, m);
    const sc = 0.42 + ((i * 37) % 10) / 30;
    mesh.scale.setScalar(sc);
    s.scene.add(mesh);
    items.push({ mesh, a: (i / N) * Math.PI * 2, r: 1.75 + (((i * 53) % 7) - 3) * 0.1, spin: 0.4 + ((i * 17) % 5) / 6, off: i });
  }

  let mx = 0, my = 0;
  const onMove = (e) => {
    const r = container.getBoundingClientRect();
    mx = ((e.clientX - r.left) / r.width - 0.5) * 2;
    my = ((e.clientY - r.top) / r.height - 0.5) * 2;
  };
  container.addEventListener('pointermove', onMove);

  const still = reduceMotion();
  const tilt = new THREE.Euler(1.25, 0, 0);
  s.loop((t) => {
    const tt = still ? 0 : t;
    for (const it of items) {
      const a = it.a + tt * 0.18;
      const v = new THREE.Vector3(Math.cos(a) * it.r, Math.sin(a) * it.r, Math.sin(tt * 0.8 + it.off) * 0.25).applyEuler(tilt);
      it.mesh.position.copy(v);
      it.mesh.rotation.set(tt * it.spin + it.off, tt * it.spin * 0.7, it.off);
    }
    ring.rotation.z = tt * 0.1;
    ring2.rotation.z = -tt * 0.08;
    s.scene.rotation.y += ((mx * 0.35) - s.scene.rotation.y) * 0.05;
    s.scene.rotation.x += ((my * 0.2) - s.scene.rotation.x) * 0.05;
  });

  return () => { container.removeEventListener('pointermove', onMove); s.dispose(); };
}
