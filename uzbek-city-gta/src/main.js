import * as THREE from 'three';
import {
  loadNormalizedModel,
  createFallbackCar,
  createFallbackCharacter,
  createContactShadow,
  setupCharacterRig,
  setupVehicleRig,
  applyCarDent,
  repairCarRig
} from './modelLoader.js';
import { SoundEngine } from './soundEngine.js';

// ==========================================
// 1. YUKSIZ 60 FPS RENDERER VA "9D" REALISTIK MUHIT
// ==========================================
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false, // Mobil GPU da qotmasligi uchun
  logarithmicDepthBuffer: true,
  powerPreference: 'high-performance'
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = false; // Contact shadow ishlatiladi -> 60 FPS silliq!

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x9bd6f0, 260, 1400);

const camera = new THREE.PerspectiveCamera(
  62,
  window.innerWidth / window.innerHeight,
  0.5,
  2500
);

// Realistik osmon aks-sadosi (PMREM Environment) -> mashinalar yaltirashi uchun
function setupRealisticEnvironment() {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const skyGeo = new THREE.SphereGeometry(50, 16, 12);
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 4;
  skyCanvas.height = 128;
  const ctx = skyCanvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0.0, '#1d4ed8');
  grad.addColorStop(0.45, '#7dd3fc');
  grad.addColorStop(0.52, '#fef3c7');
  grad.addColorStop(0.55, '#475569');
  grad.addColorStop(1.0, '#1e293b');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 4, 128);
  const skyTex = new THREE.CanvasTexture(skyCanvas);
  skyTex.colorSpace = THREE.SRGBColorSpace;

  const skyDome = new THREE.Mesh(
    skyGeo,
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide })
  );
  envScene.add(skyDome);

  const envRT = pmrem.fromScene(envScene, 0.04);
  scene.environment = envRT.texture;
  pmrem.dispose();
}
setupRealisticEnvironment();

const hemiLight = new THREE.HemisphereLight(0xe0f2fe, 0x334155, 1.3);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xfff1d6, 2.3);
sunLight.position.set(110, 180, 85);
scene.add(sunLight);

// Zaxira yer (shahar yo'llaridan pastda y = -0.4, Z-fighting yo'q)
const fallbackGround = new THREE.Mesh(
  new THREE.PlaneGeometry(3000, 3000),
  new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.92 })
);
fallbackGround.rotation.x = -Math.PI / 2;
fallbackGround.position.y = -0.4;
scene.add(fallbackGround);

// ==========================================
// 2. TEZKOR O(1) HEIGHT GRID (QOTISHNI YO'QOTISH UCHUN)
// ==========================================
const cityColliderMeshes = [];
const buildingObstacles = [];
const groundRaycaster = new THREE.Raycaster();
const downVec = new THREE.Vector3(0, -1, 0);

const GRID_RES = 80;
const GRID_RANGE = 220; // -220 .. +220
const heightGrid = new Float32Array(GRID_RES * GRID_RES);
let heightGridBaked = false;

function bakeGroundHeightGrid() {
  if (cityColliderMeshes.length === 0) return;
  const step = (GRID_RANGE * 2) / (GRID_RES - 1);
  for (let gz = 0; gz < GRID_RES; gz++) {
    const wz = -GRID_RANGE + gz * step;
    for (let gx = 0; gx < GRID_RES; gx++) {
      const wx = -GRID_RANGE + gx * step;
      groundRaycaster.set(new THREE.Vector3(wx, 200, wz), downVec);
      const hits = groundRaycaster.intersectObjects(cityColliderMeshes, true);
      // Eng past yoki yo'l darajasidagi nuqtani olish (bino tomiga chiqib ketmaslik uchun)
      let y = 0;
      for (let k = hits.length - 1; k >= 0; k--) {
        if (hits[k].point.y < 3.5) {
          y = hits[k].point.y;
          break;
        }
      }
      heightGrid[gz * GRID_RES + gx] = y;
    }
  }
  heightGridBaked = true;
}

function getGroundY(x, z) {
  if (!heightGridBaked) return 0;
  const u = ((x + GRID_RANGE) / (GRID_RANGE * 2)) * (GRID_RES - 1);
  const v = ((z + GRID_RANGE) / (GRID_RANGE * 2)) * (GRID_RES - 1);
  const gx = Math.max(0, Math.min(GRID_RES - 2, Math.floor(u)));
  const gz = Math.max(0, Math.min(GRID_RES - 2, Math.floor(v)));
  const fx = u - gx;
  const fz = v - gz;

  const h00 = heightGrid[gz * GRID_RES + gx];
  const h10 = heightGrid[gz * GRID_RES + gx + 1];
  const h01 = heightGrid[(gz + 1) * GRID_RES + gx];
  const h11 = heightGrid[(gz + 1) * GRID_RES + gx + 1];

  return (
    h00 * (1 - fx) * (1 - fz) +
    h10 * fx * (1 - fz) +
    h01 * (1 - fx) * fz +
    h11 * fx * fz
  );
}

// ==========================================
// 3. OVOZ VA HUD ELEMENTLARI (SHAFFOF TUGMALAR)
// ==========================================
const sound = new SoundEngine();

const loadingScreen = document.getElementById('loading-screen');
const speedVal = document.getElementById('speed-val');
const carHpFill = document.getElementById('car-hp-fill');
const enterExitBtn = document.getElementById('enter-exit-btn');
const joystickZone = document.getElementById('joystick-zone');
const joystickStick = document.getElementById('joystick-stick');
const steerControls = document.getElementById('steer-controls');
const pedalsRow = document.getElementById('pedals-row');
const btnRepair = document.getElementById('btn-repair');
const btnRadio = document.getElementById('btn-radio');
const btnHorn = document.getElementById('btn-horn');
const btnCameraMode = document.getElementById('btn-camera-mode');
const btnSwitchChar = document.getElementById('btn-switch-char');

// ==========================================
// 4. MODELLARNI AVTOMATIK ANIQLASH VA JOYLASH
// ==========================================
const CAMERA_MODES = ['close', 'far', 'firstPerson']; // Yaqindan, Uzoqdan, Ko'z bilan

const state = {
  manifest: [],
  characters: [], // { id, root, rig }
  activeCharIdx: 0,
  playerPos: new THREE.Vector3(0, 0, 14),
  playerYaw: 0,
  footstepTimer: 0,
  cars: [],
  activeCar: null,
  lastCar: null,
  cameraModeIdx: 0,
  cameraYaw: Math.PI, // Oldinga qarab turadi (+Z)
  cameraPitch: 0.24,
  npcs: [],
  trafficCars: []
};

async function loadManifest() {
  try {
    const res = await fetch('./models-manifest.json');
    if (res.ok) {
      state.manifest = await res.json();
      return;
    }
  } catch (e) {
    // Lokal dev fallback
  }
  state.manifest = [
    'ccity_building_set_1.glb',
    'tashkent_tv_tower.glb',
    'cyberpunk_women.glb',
    'wladimir_p..glb',
    'gentra.glb',
    'daewoo_nexia_2.glb',
    'chevrolet_damas.glb',
    'daewoo_matiz_turbo.glb',
    '2019_chevrolet_malibu_premier.glb',
    'chevrolet_cobalt_ltz.glb',
    'registon.glb',
    '7440512639.mp3'
  ];
}

function findModelFile(keyword) {
  const rx = new RegExp(keyword, 'i');
  const found = state.manifest.find((f) => rx.test(f));
  return found ? `./models/${found}` : null;
}

async function loadCityAndLandmarks() {
  const cityUrl = findModelFile('ccity_building') || './models/ccity_building_set_1.glb';
  try {
    const city = await loadNormalizedModel(cityUrl, { targetMaxSize: 420 });
    scene.add(city.root);
    city.root.traverse((obj) => {
      if (obj.isMesh) {
        cityColliderMeshes.push(obj);
        const b = new THREE.Box3().setFromObject(obj);
        const s = new THREE.Vector3();
        b.getSize(s);
        if (s.y > 2.6 && s.x < 85 && s.z < 85) {
          buildingObstacles.push(b);
        }
      }
    });
    bakeGroundHeightGrid();
  } catch (e) {
    createFallbackCityRoads();
  }

  // Toshkent Teleminorasi (shahar markaziga yaqin va ko'rinadigan joyda)
  const towerUrl = findModelFile('tashkent_tv_tower') || './models/tashkent_tv_tower.glb';
  try {
    const tower = await loadNormalizedModel(towerUrl, { targetHeight: 135 });
    const tx = 36;
    const tz = -38;
    tower.root.position.set(tx, getGroundY(tx, tz), tz);
    scene.add(tower.root);
  } catch (e) {}

  // Registon (ixtiyoriy)
  const registonUrl = findModelFile('registon');
  if (registonUrl) {
    try {
      const reg = await loadNormalizedModel(registonUrl, { targetMaxSize: 75 });
      reg.root.position.set(-65, getGroundY(-65, -55), -55);
      scene.add(reg.root);
    } catch (e) {}
  }
}

function createFallbackCityRoads() {
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.9 });
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xfef08a, roughness: 0.6 });
  const r1 = new THREE.Mesh(new THREE.BoxGeometry(16, 0.2, 420), roadMat);
  r1.position.y = -0.1;
  scene.add(r1);
  const r2 = new THREE.Mesh(new THREE.BoxGeometry(420, 0.2, 16), roadMat);
  r2.position.y = -0.09;
  scene.add(r2);
  for (let i = -180; i <= 180; i += 16) {
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.22, 6), lineMat);
    dash.position.set(0, -0.08, i);
    scene.add(dash);
  }
}

async function loadCharacters() {
  const charSpecs = [
    { id: 'cyberpunk', url: findModelFile('cyberpunk_women') || './models/cyberpunk_women.glb', color: '#00e5ff' },
    { id: 'wladimir', url: findModelFile('wladim') || './models/wladimir_p..glb', color: '#f59e0b' }
  ];

  for (const spec of charSpecs) {
    let loaded = null;
    if (spec.url) {
      try {
        loaded = await loadNormalizedModel(spec.url, { targetHeight: 1.75 });
      } catch (e) {}
    }
    if (!loaded && spec.id === 'cyberpunk') {
      loaded = createFallbackCharacter(spec.color);
    }
    if (!loaded) continue;

    loaded.root.add(createContactShadow(0.85, 0.85));
    const rig = setupCharacterRig(loaded.root, loaded.inner, loaded.animations);
    loaded.root.visible = state.characters.length === 0;
    loaded.root.position.copy(state.playerPos);
    loaded.root.position.y = getGroundY(state.playerPos.x, state.playerPos.z);
    scene.add(loaded.root);

    state.characters.push({ id: spec.id, root: loaded.root, rig });
  }

  if (state.characters.length < 2) {
    const fb = createFallbackCharacter('#f59e0b');
    fb.root.add(createContactShadow(0.85, 0.85));
    fb.root.visible = false;
    scene.add(fb.root);
    state.characters.push({
      id: 'wladimir',
      root: fb.root,
      rig: setupCharacterRig(fb.root, fb.inner, [])
    });
  }
}

async function spawnRoadCars() {
  // Barcha yuklangan mashinalar yo'l bo'ylab joylashtiriladi (tepadan tanlash yo'q!)
  const carDefinitions = [
    {
      id: 'gentra',
      match: 'gentra',
      pos: new THREE.Vector3(-4.2, 0, 5),
      color: '#f8fafc',
      plate: { region: '01', number: 'A 777 AA' },
      maxSpeed: 38,
      accel: 18,
      rotateY: Math.PI
    },
    {
      id: 'nexia',
      match: 'nexia',
      pos: new THREE.Vector3(4.2, 0, -6),
      color: '#94a3b8',
      plate: { region: '01', number: 'O 070 OO' },
      maxSpeed: 35,
      accel: 17,
      rotateY: Math.PI
    },
    {
      id: 'damas',
      match: 'damas',
      pos: new THREE.Vector3(-4.2, 0, -18),
      color: '#f8fafc',
      plate: { region: '30', number: 'D 505 DA' },
      maxSpeed: 28,
      accel: 13,
      rotateY: Math.PI,
      isVan: true
    },
    {
      id: 'matiz',
      match: 'matiz',
      pos: new THREE.Vector3(4.2, 0, 18),
      color: '#10b981',
      plate: { region: '01', number: 'M 101 MA' },
      maxSpeed: 36,
      accel: 18,
      rotateY: Math.PI
    },
    {
      id: 'malibu',
      match: 'malibu',
      pos: new THREE.Vector3(-4.2, 0, 30),
      color: '#111827',
      plate: { region: '01', number: 'Z 001 ZZ' },
      maxSpeed: 44,
      accel: 22,
      rotateY: Math.PI
    },
    {
      id: 'cobalt',
      match: 'cobalt',
      pos: new THREE.Vector3(4.2, 0, -30),
      color: '#2563eb',
      plate: { region: '10', number: 'C 333 CC' },
      maxSpeed: 37,
      accel: 18,
      rotateY: Math.PI,
      optional: true
    }
  ];

  for (const def of carDefinitions) {
    const url = findModelFile(def.match);
    let model = null;
    if (url) {
      try {
        model = await loadNormalizedModel(url, {
          targetMaxSize: 4.5,
          rotateY: def.rotateY
        });
      } catch (e) {}
    }

    if (!model) {
      if (def.optional && !url) continue;
      model = createFallbackCar(def.color, Boolean(def.isVan));
    }

    const rig = setupVehicleRig(model.root, model.inner, def.color);
    rig.setPlate(def.plate.region, def.plate.number);
    model.root.position.set(def.pos.x, getGroundY(def.pos.x, def.pos.z), def.pos.z);
    scene.add(model.root);

    state.cars.push({
      ...def,
      mesh: model.root,
      rig,
      speed: 0,
      steerAngle: 0,
      yaw: 0,
      hp: 100,
      radius: 2.15
    });
  }
}

function spawnNPCsAndTraffic() {
  // Piyoda NPC lar (qo'l-oyog'i qimirlab yuradi)
  const npcColors = ['#38bdf8', '#f472b6', '#a78bfa', '#34d399'];
  for (let i = 0; i < 5; i++) {
    const fb = createFallbackCharacter(npcColors[i % npcColors.length]);
    fb.root.add(createContactShadow(0.8, 0.8));
    const x = (Math.random() - 0.5) * 70;
    const z = (Math.random() - 0.5) * 70;
    fb.root.position.set(x, getGroundY(x, z), z);
    scene.add(fb.root);

    state.npcs.push({
      mesh: fb.root,
      rig: setupCharacterRig(fb.root, fb.inner, []),
      angle: Math.random() * Math.PI * 2,
      speed: 1.7 + Math.random() * 0.7,
      turnTimer: 2 + Math.random() * 3
    });
  }

  // Shahar trafigi (tezkorroq yuradigan mashinalar)
  const tColors = ['#dc2626', '#2563eb', '#f59e0b'];
  for (let i = 0; i < 3; i++) {
    const tc = createFallbackCar(tColors[i], i === 2);
    const rig = setupVehicleRig(tc.root, tc.inner, tColors[i]);
    rig.setPlate('01', `T ${200 + i * 111} UZ`);
    const zPos = -75 + i * 55;
    const xPos = i % 2 === 0 ? 3.2 : -3.2;
    tc.root.position.set(xPos, getGroundY(xPos, zPos), zPos);
    const yaw = i % 2 === 0 ? 0 : Math.PI;
    tc.root.rotation.y = yaw;
    scene.add(tc.root);

    state.trafficCars.push({
      mesh: tc.root,
      rig,
      yaw,
      speed: 13.5,
      radius: 2.15
    });
  }
}

// ==========================================
// 5. MULTI-TOUCH BOSHQARUV (SHAFFOF TUGMALAR)
// ==========================================
const input = {
  joyX: 0,
  joyY: 0,
  joyTouchId: null,
  camTouchId: null,
  camLastX: 0,
  camLastY: 0,
  gas: false,
  brake: false,
  steerLeft: false,
  steerRight: false,
  keys: new Set()
};

joystickZone.addEventListener(
  'touchstart',
  (e) => {
    e.preventDefault();
    sound.unlock();
    if (input.joyTouchId !== null) return;
    const t = e.changedTouches[0];
    input.joyTouchId = t.identifier;
    updateJoystick(t);
  },
  { passive: false }
);

joystickZone.addEventListener(
  'touchmove',
  (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === input.joyTouchId) updateJoystick(t);
    }
  },
  { passive: false }
);

const endJoystick = (e) => {
  for (const t of e.changedTouches) {
    if (t.identifier === input.joyTouchId) {
      input.joyTouchId = null;
      input.joyX = 0;
      input.joyY = 0;
      joystickStick.style.transform = 'translate(0px, 0px)';
    }
  }
};
joystickZone.addEventListener('touchend', endJoystick);
joystickZone.addEventListener('touchcancel', endJoystick);

function updateJoystick(touch) {
  const rect = joystickZone.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const maxR = 42;
  let dx = touch.clientX - cx;
  let dy = touch.clientY - cy;
  const dist = Math.hypot(dx, dy);
  if (dist > maxR) {
    dx = (dx / dist) * maxR;
    dy = (dy / dist) * maxR;
  }
  joystickStick.style.transform = `translate(${dx}px, ${dy}px)`;
  input.joyX = dx / maxR;
  input.joyY = dy / maxR; // dy < 0 (tepa) = oldinga!
}

const camZone = document.getElementById('camera-touch-zone');
camZone.addEventListener(
  'touchstart',
  (e) => {
    sound.unlock();
    if (input.camTouchId !== null) return;
    const t = e.changedTouches[0];
    input.camTouchId = t.identifier;
    input.camLastX = t.clientX;
    input.camLastY = t.clientY;
  },
  { passive: true }
);

camZone.addEventListener(
  'touchmove',
  (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === input.camTouchId) {
        const dx = t.clientX - input.camLastX;
        const dy = t.clientY - input.camLastY;
        input.camLastX = t.clientX;
        input.camLastY = t.clientY;
        state.cameraYaw -= dx * 0.0068;
        state.cameraPitch = THREE.MathUtils.clamp(state.cameraPitch + dy * 0.005, -0.25, 1.1);
      }
    }
  },
  { passive: false }
);

const endCamTouch = (e) => {
  for (const t of e.changedTouches) {
    if (t.identifier === input.camTouchId) input.camTouchId = null;
  }
};
camZone.addEventListener('touchend', endCamTouch);
camZone.addEventListener('touchcancel', endCamTouch);

function bindHoldBtn(el, key) {
  const down = (e) => {
    e.preventDefault();
    sound.unlock();
    input[key] = true;
    el.classList.add('pressed');
  };
  const up = (e) => {
    e.preventDefault();
    input[key] = false;
    el.classList.remove('pressed');
  };
  el.addEventListener('touchstart', down, { passive: false });
  el.addEventListener('touchend', up, { passive: false });
  el.addEventListener('touchcancel', up);
  el.addEventListener('mousedown', down);
  el.addEventListener('mouseup', up);
  el.addEventListener('mouseleave', up);
}

bindHoldBtn(document.getElementById('btn-gas'), 'gas');
bindHoldBtn(document.getElementById('btn-brake'), 'brake');
bindHoldBtn(document.getElementById('btn-steer-left'), 'steerLeft');
bindHoldBtn(document.getElementById('btn-steer-right'), 'steerRight');

window.addEventListener('keydown', (e) => input.keys.add(e.code));
window.addEventListener('keyup', (e) => input.keys.delete(e.code));

// ==========================================
// 6. KAMERA REJIMLARI, PERSONAJ TANLASH VA MASHINAGA MINISH
// ==========================================
btnCameraMode.addEventListener('click', () => {
  sound.unlock();
  state.cameraModeIdx = (state.cameraModeIdx + 1) % CAMERA_MODES.length;
  btnCameraMode.classList.toggle('active', CAMERA_MODES[state.cameraModeIdx] === 'firstPerson');
});

btnSwitchChar.addEventListener('click', () => {
  sound.unlock();
  if (state.characters.length < 2 || state.activeCar) return;
  state.characters[state.activeCharIdx].root.visible = false;
  state.activeCharIdx = (state.activeCharIdx + 1) % state.characters.length;
  const nextChar = state.characters[state.activeCharIdx];
  nextChar.root.position.copy(state.playerPos);
  nextChar.root.rotation.y = state.playerYaw;
  nextChar.root.visible = true;
});

btnHorn.addEventListener('click', () => sound.playHorn());

btnRadio.addEventListener('click', () => {
  const on = sound.toggleRadio();
  btnRadio.classList.toggle('active', on);
});

function getActiveChar() {
  return state.characters[state.activeCharIdx] || null;
}

function enterCar(car) {
  if (!car) return;
  sound.playDoor();
  state.activeCar = car;
  state.lastCar = car;
  const ch = getActiveChar();
  if (ch) ch.root.visible = false;

  // Kamerani mashina orqasiga qaratish (Gaz bosganda oldinga qarash uchun)
  state.cameraYaw = car.yaw + Math.PI;

  joystickZone.style.display = 'none';
  steerControls.style.display = 'flex';
  pedalsRow.style.display = 'flex';
  btnHorn.style.display = 'flex';
  enterExitBtn.classList.add('visible');
  enterExitBtn.classList.add('active');
  updateCarHud(car);
}

function exitCar() {
  if (!state.activeCar) return;
  sound.playDoor();
  const car = state.activeCar;
  car.speed *= 0.15;
  car.rig.setBraking(false);

  const sideOffset = new THREE.Vector3(-2.3, 0, 0).applyAxisAngle(
    new THREE.Vector3(0, 1, 0),
    car.yaw
  );
  state.playerPos.copy(car.mesh.position).add(sideOffset);
  state.playerPos.y = getGroundY(state.playerPos.x, state.playerPos.z);

  const ch = getActiveChar();
  if (ch) {
    ch.root.position.copy(state.playerPos);
    ch.root.visible = CAMERA_MODES[state.cameraModeIdx] !== 'firstPerson';
  }

  state.activeCar = null;
  joystickZone.style.display = 'block';
  steerControls.style.display = 'none';
  pedalsRow.style.display = 'none';
  btnHorn.style.display = 'none';
  enterExitBtn.classList.remove('active');
  speedVal.textContent = '0';
  sound.updateEngine(0, 1, false, false);
}

function updateCarHud(car) {
  carHpFill.style.width = `${Math.max(0, car.hp)}%`;
  carHpFill.style.background =
    car.hp > 60 ? '#10b981' : car.hp > 30 ? '#f59e0b' : '#ef4444';
  btnRepair.style.display = car.hp < 100 ? 'flex' : 'none';
}

let nearestCarCache = null;
enterExitBtn.addEventListener('click', () => {
  if (state.activeCar) exitCar();
  else if (nearestCarCache) enterCar(nearestCarCache);
});

btnRepair.addEventListener('click', () => {
  const car = state.activeCar || state.lastCar || state.cars[0];
  if (!car) return;
  car.hp = 100;
  repairCarRig(car.rig);
  updateCarHud(car);
});

// ==========================================
// 7. NOMER, RANG VA 180° YO'NALISH SOZLASH
// ==========================================
const tuningModal = document.getElementById('tuning-modal');
const inputRegion = document.getElementById('input-region');
const inputPlate = document.getElementById('input-plate');
const previewRegion = document.getElementById('preview-region');
const previewPlate = document.getElementById('preview-plate');
let chosenColor = '#f8fafc';

document.getElementById('btn-tuning').addEventListener('click', () => {
  const car = state.activeCar || state.lastCar || state.cars[0];
  if (car) {
    inputRegion.value = car.rig.plateData.region;
    inputPlate.value = car.rig.plateData.number;
    previewRegion.textContent = car.rig.plateData.region;
    previewPlate.textContent = car.rig.plateData.number;
    chosenColor = car.color;
  }
  tuningModal.classList.add('open');
});

document.getElementById('btn-close-tuning').addEventListener('click', () => {
  tuningModal.classList.remove('open');
});

document.getElementById('btn-flip-car').addEventListener('click', () => {
  const car = state.activeCar || state.lastCar || state.cars[0];
  if (car) car.rig.flip180();
});

inputRegion.addEventListener('input', () => {
  previewRegion.textContent = inputRegion.value.replace(/\D/g, '').slice(0, 2) || '01';
});
inputPlate.addEventListener('input', () => {
  previewPlate.textContent = (inputPlate.value || 'A 777 AA').toUpperCase();
});

document.querySelectorAll('.color-swatch').forEach((sw) => {
  sw.addEventListener('click', () => {
    document.querySelectorAll('.color-swatch').forEach((s) => s.classList.remove('selected'));
    sw.classList.add('selected');
    chosenColor = sw.dataset.color;
  });
});

document.getElementById('btn-apply-tuning').addEventListener('click', () => {
  const car = state.activeCar || state.lastCar || state.cars[0];
  if (car) {
    const reg = (inputRegion.value.replace(/\D/g, '') || '01').padStart(2, '0');
    const num = (inputPlate.value || 'A 777 AA').toUpperCase();
    car.color = chosenColor;
    car.rig.setColor(chosenColor);
    car.rig.setPlate(reg, num);
  }
  tuningModal.classList.remove('open');
});

// ==========================================
// 8. ASOSIY TSIKL (FIZIKA, 3 KAMERA REJIMI, NPC, SOUND)
// ==========================================
const clock = new THREE.Clock();

function updatePlayer(dt) {
  const ch = getActiveChar();
  if (state.activeCar || !ch) return;

  let moveX = input.joyX;
  let moveY = input.joyY;
  if (input.keys.has('KeyW') || input.keys.has('ArrowUp')) moveY = -1;
  if (input.keys.has('KeyS') || input.keys.has('ArrowDown')) moveY = 1;
  if (input.keys.has('KeyA') || input.keys.has('ArrowLeft')) moveX = -1;
  if (input.keys.has('KeyD') || input.keys.has('ArrowRight')) moveX = 1;

  const mag = Math.hypot(moveX, moveY);
  const isMoving = mag > 0.08;

  if (isMoving) {
    const forward = new THREE.Vector3(-Math.sin(state.cameraYaw), 0, -Math.cos(state.cameraYaw));
    const right = new THREE.Vector3(Math.cos(state.cameraYaw), 0, -Math.sin(state.cameraYaw));
    const moveDir = new THREE.Vector3()
      .addScaledVector(forward, -moveY)
      .addScaledVector(right, moveX)
      .normalize();

    state.playerPos.addScaledVector(moveDir, 7.2 * Math.min(mag, 1) * dt);
    state.playerYaw = Math.atan2(moveDir.x, moveDir.z);

    state.footstepTimer -= dt;
    if (state.footstepTimer <= 0) {
      sound.playFootstep();
      state.footstepTimer = 0.34;
    }
  }

  state.playerPos.y = getGroundY(state.playerPos.x, state.playerPos.z);
  ch.root.position.copy(state.playerPos);
  ch.root.rotation.y = state.playerYaw;
  ch.root.visible = CAMERA_MODES[state.cameraModeIdx] !== 'firstPerson';
  ch.rig.animate(dt, isMoving);

  let closest = null;
  let bestDist = 4.8;
  for (const car of state.cars) {
    const dist = car.mesh.position.distanceTo(state.playerPos);
    if (dist < bestDist) {
      bestDist = dist;
      closest = car;
    }
  }
  nearestCarCache = closest;
  enterExitBtn.classList.toggle('visible', Boolean(closest));
}

function updateActiveCar(dt) {
  const car = state.activeCar;
  if (!car) return;

  const gas = input.gas || input.keys.has('KeyW') || input.keys.has('ArrowUp');
  const brake = input.brake || input.keys.has('KeyS') || input.keys.has('ArrowDown');
  const left = input.steerLeft || input.keys.has('KeyA') || input.keys.has('ArrowLeft');
  const right = input.steerRight || input.keys.has('KeyD') || input.keys.has('ArrowRight');

  car.rig.setBraking(brake);

  if (gas) {
    car.speed += car.accel * dt;
  } else if (brake) {
    if (car.speed > 0.5) car.speed -= car.accel * 2.2 * dt;
    else car.speed -= car.accel * 0.85 * dt;
  } else {
    car.speed *= Math.pow(0.35, dt);
    if (Math.abs(car.speed) < 0.05) car.speed = 0;
  }

  car.speed = THREE.MathUtils.clamp(car.speed, -14, car.maxSpeed);
  sound.updateEngine(Math.abs(car.speed), car.maxSpeed, true, gas);

  const targetSteer = (left ? 1 : 0) - (right ? 1 : 0);
  car.steerAngle = THREE.MathUtils.lerp(car.steerAngle, targetSteer * 0.52, dt * 9);

  car.rig.frontSteerPivots.forEach((p) => { p.rotation.y = car.steerAngle; });
  const wheelSpin = (car.speed * dt) / 0.34;
  car.rig.wheels.forEach((w) => { w.rotation.x += wheelSpin; });

  if (Math.abs(car.speed) > 0.25) {
    const dirSign = car.speed >= 0 ? 1 : -1;
    const speedFactor = Math.min(Math.abs(car.speed) / 6.5, 1);
    car.yaw += car.steerAngle * 2.25 * speedFactor * dirSign * dt;
  }

  const forwardVec = new THREE.Vector3(Math.sin(car.yaw), 0, Math.cos(car.yaw));
  const nextPos = car.mesh.position.clone().addScaledVector(forwardVec, car.speed * dt);

  const checkCollisionWith = (otherPos, otherRadius) => {
    const dx = nextPos.x - otherPos.x;
    const dz = nextPos.z - otherPos.z;
    const dist = Math.hypot(dx, dz);
    const minDist = car.radius + otherRadius;
    if (dist < minDist && dist > 0.001) {
      nextPos.x += (dx / dist) * (minDist - dist);
      nextPos.z += (dz / dist) * (minDist - dist);
      const impact = Math.abs(car.speed);
      if (impact > 5.0) {
        sound.playCrash(impact / 15);
        const localHit = car.mesh.worldToLocal(otherPos.clone());
        localHit.y = 0.65;
        applyCarDent(car.rig, localHit, Math.min(0.45, impact * 0.015));
        car.hp = Math.max(10, car.hp - impact * 0.9);
        updateCarHud(car);
      }
      car.speed *= -0.32;
    }
  };

  for (const other of state.cars) {
    if (other !== car) checkCollisionWith(other.mesh.position, other.radius);
  }
  for (const t of state.trafficCars) {
    checkCollisionWith(t.mesh.position, t.radius);
  }

  for (const box of buildingObstacles) {
    if (
      nextPos.x > box.min.x - 1.5 &&
      nextPos.x < box.max.x + 1.5 &&
      nextPos.z > box.min.z - 1.5 &&
      nextPos.z < box.max.z + 1.5
    ) {
      if (Math.abs(car.speed) > 5) {
        sound.playCrash(Math.abs(car.speed) / 15);
        applyCarDent(car.rig, new THREE.Vector3(0, 0.6, 1.8), 0.25);
        car.hp = Math.max(10, car.hp - Math.abs(car.speed) * 0.8);
        updateCarHud(car);
      }
      nextPos.copy(car.mesh.position);
      car.speed *= -0.32;
      break;
    }
  }

  nextPos.y = getGroundY(nextPos.x, nextPos.z);
  car.mesh.position.copy(nextPos);
  car.mesh.rotation.y = car.yaw;
  car.mesh.rotation.z = THREE.MathUtils.lerp(
    car.mesh.rotation.z,
    -car.steerAngle * (car.speed / car.maxSpeed) * 0.08,
    dt * 6
  );

  // Haydashda kamera avtomatik orqadan ergashadi (o'ng tomonda barmoq bo'lmasa)
  if (input.camTouchId === null && Math.abs(car.speed) > 1.5) {
    const desiredCamYaw = car.yaw + Math.PI;
    const diff = Math.atan2(
      Math.sin(desiredCamYaw - state.cameraYaw),
      Math.cos(desiredCamYaw - state.cameraYaw)
    );
    state.cameraYaw += diff * dt * 2.8;
  }

  speedVal.textContent = Math.round(Math.abs(car.speed) * 3.6).toString();
}

function updateNPCsAndTraffic(dt) {
  for (const npc of state.npcs) {
    npc.turnTimer -= dt;
    if (npc.turnTimer <= 0) {
      npc.angle += (Math.random() - 0.5) * 2.2;
      npc.turnTimer = 2.5 + Math.random() * 3.5;
    }
    npc.mesh.position.x += Math.sin(npc.angle) * npc.speed * dt;
    npc.mesh.position.z += Math.cos(npc.angle) * npc.speed * dt;
    if (Math.abs(npc.mesh.position.x) > 110 || Math.abs(npc.mesh.position.z) > 110) {
      npc.angle += Math.PI;
    }
    npc.mesh.position.y = getGroundY(npc.mesh.position.x, npc.mesh.position.z);
    npc.mesh.rotation.y = npc.angle;
    npc.rig.animate(dt, true);
  }

  for (const t of state.trafficCars) {
    t.mesh.position.x += Math.sin(t.yaw) * t.speed * dt;
    t.mesh.position.z += Math.cos(t.yaw) * t.speed * dt;
    if (t.mesh.position.z > 130) t.mesh.position.z = -130;
    if (t.mesh.position.z < -130) t.mesh.position.z = 130;
    t.mesh.position.y = getGroundY(t.mesh.position.x, t.mesh.position.z);
    for (const w of t.rig.wheels) {
      w.rotation.x += (t.speed * dt) / 0.34;
    }
  }
}

function updateCamera(dt) {
  const mode = CAMERA_MODES[state.cameraModeIdx];
  const basePos = state.activeCar ? state.activeCar.mesh.position : state.playerPos;

  if (mode === 'firstPerson') {
    // Personaj ko'zi bilan / mashina salonidan ko'rish
    const eyeHeight = state.activeCar ? 1.32 : 1.62;
    const fwdOffset = state.activeCar ? 0.35 : 0.12;
    const yaw = state.activeCar ? state.activeCar.yaw : state.cameraYaw + Math.PI;
    const eyePos = new THREE.Vector3(
      basePos.x + Math.sin(yaw) * fwdOffset,
      basePos.y + eyeHeight,
      basePos.z + Math.cos(yaw) * fwdOffset
    );
    const lookYaw = state.cameraYaw + Math.PI;
    const lookTarget = new THREE.Vector3(
      eyePos.x + Math.sin(lookYaw) * 12,
      eyePos.y - Math.sin(state.cameraPitch) * 6,
      eyePos.z + Math.cos(lookYaw) * 12
    );
    camera.position.copy(eyePos);
    camera.lookAt(lookTarget);
    return;
  }

  const dist = mode === 'far' ? (state.activeCar ? 12.2 : 8.5) : (state.activeCar ? 5.6 : 4.2);
  const targetPos = basePos.clone().add(new THREE.Vector3(0, state.activeCar ? 1.45 : 1.35, 0));
  const pitch = THREE.MathUtils.clamp(state.cameraPitch, 0.06, 1.05);
  const horiz = dist * Math.cos(pitch);
  const camPos = new THREE.Vector3(
    targetPos.x + Math.sin(state.cameraYaw) * horiz,
    targetPos.y + dist * Math.sin(pitch) + 0.45,
    targetPos.z + Math.cos(state.cameraYaw) * horiz
  );

  camera.position.lerp(camPos, Math.min(1, dt * 12));
  camera.lookAt(targetPos);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

async function init() {
  await loadManifest();
  const mp3Url = findModelFile('7440512639') || findModelFile('\\.mp3$');
  sound.setRadioTracks(mp3Url);

  await loadCityAndLandmarks();
  await loadCharacters();
  await spawnRoadCars();
  spawnNPCsAndTraffic();

  loadingScreen.classList.add('hidden');

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    updatePlayer(dt);
    updateActiveCar(dt);
    updateNPCsAndTraffic(dt);
    updateCamera(dt);
    renderer.render(scene, camera);
  }
  animate();
}

init();
