import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('./draco/');

const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

/**
 * GLB modelni yuklab, Box3 yordamida avtomatik masshtablaydi va y = 0 tekisligiga qo'yadi.
 */
export async function loadNormalizedModel(url, options = {}) {
  const {
    targetHeight = null,
    targetMaxSize = null,
    rotateY = 0,
    centerXZ = true,
    envIntensity = 1.05
  } = options;

  const gltf = await gltfLoader.loadAsync(url);
  const inner = gltf.scene;
  inner.rotation.y = rotateY;

  const box = new THREE.Box3().setFromObject(inner);
  const size = new THREE.Vector3();
  box.getSize(size);

  let scale = 1;
  if (targetHeight && size.y > 0.0001) {
    scale = targetHeight / size.y;
  } else if (targetMaxSize) {
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 0.0001) scale = targetMaxSize / maxDim;
  }

  inner.scale.multiplyScalar(scale);
  inner.updateMatrixWorld(true);

  const scaledBox = new THREE.Box3().setFromObject(inner);
  const center = new THREE.Vector3();
  scaledBox.getCenter(center);

  if (centerXZ) {
    inner.position.x -= center.x;
    inner.position.z -= center.z;
  }
  inner.position.y -= scaledBox.min.y;

  inner.traverse((obj) => {
    if (obj.isMesh) {
      obj.frustumCulled = true;
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => {
          if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
          if ('envMapIntensity' in m) m.envMapIntensity = envIntensity;
        });
      }
    }
  });

  const root = new THREE.Group();
  root.add(inner);

  const finalBox = new THREE.Box3().setFromObject(root);
  const finalSize = new THREE.Vector3();
  finalBox.getSize(finalSize);

  return {
    root,
    inner,
    animations: gltf.animations || [],
    size: finalSize,
    box: finalBox
  };
}

/**
 * Yumshoq contact shadow (GPU shadow map o'rniga 60 FPS tezkor soya)
 */
export function createContactShadow(width = 2.2, length = 4.4) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  grad.addColorStop(0, 'rgba(0,0,0,0.58)');
  grad.addColorStop(0.65, 'rgba(0,0,0,0.22)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);

  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, length), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.04;
  return mesh;
}

/**
 * Personaj uchun oyoq-qo'l animatsiyasi (GLB clip + protsedural qo'l/oyoq harakati)
 */
export function setupCharacterRig(charRoot, inner, animations = []) {
  let mixer = null;
  let walkAction = null;

  if (animations && animations.length > 0) {
    mixer = new THREE.AnimationMixer(inner);
    const walkClip =
      animations.find((c) => /walk|run|move/i.test(c.name)) || animations[0];
    walkAction = mixer.clipAction(walkClip);
  }

  // Agar modelda suyak/mesh nomlari bo'lsa (qo'l, oyoq) protsedural harakat uchun yig'amiz
  const leftArms = [];
  const rightArms = [];
  const leftLegs = [];
  const rightLegs = [];

  inner.traverse((obj) => {
    if (!obj.name) return;
    const n = obj.name.toLowerCase();
    if (/(arm|shoulder|upperarm|hand)/i.test(n)) {
      if (/(left|_l|\.l|l_)/i.test(n)) leftArms.push(obj);
      else if (/(right|_r|\.r|r_)/i.test(n)) rightArms.push(obj);
    } else if (/(leg|thigh|upleg|calf|shin|foot)/i.test(n)) {
      if (/(left|_l|\.l|l_)/i.test(n)) leftLegs.push(obj);
      else if (/(right|_r|\.r|r_)/i.test(n)) rightLegs.push(obj);
    }
  });

  let walkPhase = Math.random() * Math.PI * 2;
  const baseY = inner.position.y;

  return {
    animate(dt, isMoving) {
      if (mixer && walkAction) {
        if (isMoving) {
          if (!walkAction.isRunning()) walkAction.play();
          mixer.update(dt);
        } else if (walkAction.isRunning()) {
          walkAction.stop();
        }
      }

      if (isMoving) {
        walkPhase += dt * 10.5;
        const swing = Math.sin(walkPhase) * 0.55;
        // Agar clip bo'lmasa suyak/qismlarni silkitish
        if (!walkAction) {
          leftArms.forEach((b) => { b.rotation.x = swing; });
          rightArms.forEach((b) => { b.rotation.x = -swing; });
          leftLegs.forEach((b) => { b.rotation.x = -swing; });
          rightLegs.forEach((b) => { b.rotation.x = swing; });
        }
        // Qadam tashlashda yengil tebranish
        inner.position.y = baseY + Math.abs(Math.sin(walkPhase)) * 0.055;
        inner.rotation.z = Math.sin(walkPhase) * 0.035;
      } else {
        inner.position.y = THREE.MathUtils.lerp(inner.position.y, baseY, dt * 10);
        inner.rotation.z = THREE.MathUtils.lerp(inner.rotation.z, 0, dt * 10);
        if (!walkAction) {
          leftArms.forEach((b) => { b.rotation.x = THREE.MathUtils.lerp(b.rotation.x, 0, dt * 10); });
          rightArms.forEach((b) => { b.rotation.x = THREE.MathUtils.lerp(b.rotation.x, 0, dt * 10); });
          leftLegs.forEach((b) => { b.rotation.x = THREE.MathUtils.lerp(b.rotation.x, 0, dt * 10); });
          rightLegs.forEach((b) => { b.rotation.x = THREE.MathUtils.lerp(b.rotation.x, 0, dt * 10); });
        }
      }
    }
  };
}

/**
 * Fallback personaj (qo'l va oyoqlari qimirlaydigan)
 */
export function createFallbackCharacter(colorHex = '#00e5ff') {
  const root = new THREE.Group();
  const inner = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.45 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xfde68a, roughness: 0.6 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.58, 0.24), mat);
  torso.position.y = 1.08;
  inner.add(torso);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), skinMat);
  head.position.y = 1.54;
  inner.add(head);

  const armGeo = new THREE.BoxGeometry(0.14, 0.52, 0.14);
  armGeo.translate(0, -0.22, 0);
  const leftArm = new THREE.Mesh(armGeo, mat);
  leftArm.name = 'LeftArm';
  leftArm.position.set(-0.32, 1.32, 0);
  inner.add(leftArm);

  const rightArm = new THREE.Mesh(armGeo, mat);
  rightArm.name = 'RightArm';
  rightArm.position.set(0.32, 1.32, 0);
  inner.add(rightArm);

  const legGeo = new THREE.BoxGeometry(0.18, 0.68, 0.18);
  legGeo.translate(0, -0.34, 0);
  const leftLeg = new THREE.Mesh(legGeo, pantsMat);
  leftLeg.name = 'LeftLeg';
  leftLeg.position.set(-0.12, 0.75, 0);
  inner.add(leftLeg);

  const rightLeg = new THREE.Mesh(legGeo, pantsMat);
  rightLeg.name = 'RightLeg';
  rightLeg.position.set(0.12, 0.75, 0);
  inner.add(rightLeg);

  root.add(inner);
  return { root, inner, animations: [] };
}

export function createFallbackCar(colorHex = '#f8fafc', isVan = false) {
  const root = new THREE.Group();
  const inner = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    metalness: 0.65,
    roughness: 0.22,
    envMapIntensity: 1.25
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    metalness: 0.9,
    roughness: 0.08,
    envMapIntensity: 1.4
  });
  const wheelMat = new THREE.MeshStandardMaterial({
    color: 0x111827,
    roughness: 0.85
  });

  const length = isVan ? 3.9 : 4.4;
  const width = isVan ? 1.65 : 1.88;
  const baseH = isVan ? 0.95 : 0.65;

  const chassis = new THREE.Mesh(
    new THREE.BoxGeometry(width, baseH, length, 4, 2, 6),
    bodyMat
  );
  chassis.name = 'car_body_chassis';
  chassis.position.y = 0.58;
  inner.add(chassis);

  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.85, isVan ? 0.78 : 0.54, isVan ? length * 0.8 : length * 0.48),
    glassMat
  );
  cabin.name = 'car_glass_cabin';
  cabin.position.set(0, baseH + 0.5, isVan ? -0.05 : -0.15);
  inner.add(cabin);

  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 14);
  wheelGeo.rotateZ(Math.PI / 2);

  [
    { name: 'wheel_fl', x: -width * 0.48, z: length * 0.32 },
    { name: 'wheel_fr', x: width * 0.48, z: length * 0.32 },
    { name: 'wheel_rl', x: -width * 0.48, z: -length * 0.32 },
    { name: 'wheel_rr', x: width * 0.48, z: -length * 0.32 }
  ].forEach((w) => {
    const mesh = new THREE.Mesh(wheelGeo, wheelMat);
    mesh.name = w.name;
    mesh.position.set(w.x, 0.34, w.z);
    inner.add(mesh);
  });

  root.add(inner);
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);
  return { root, inner, animations: [], size, box };
}

/**
 * Mashina balonlari, bo'yaladigan kuzov, tormoz chiroqlari, nomer va pachoq rigi.
 */
export function setupVehicleRig(carRoot, carInner, initialColor = '#f8fafc') {
  const wheels = [];
  const frontSteerPivots = [];
  const paintMaterials = [];
  const deformableMeshes = [];

  carRoot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(carRoot);
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);

  const wheelRegex = /(wheel|tire|tyre|rim|balon|koleso|disk|fl|fr|rl|rr)/i;
  const ignorePaintRegex = /(wheel|tire|tyre|glass|window|windshield|mirror|chrome|light|lamp|plate|black|interior|seat|chassis_bottom)/i;
  const detectedWheelMeshes = [];

  carRoot.traverse((obj) => {
    if (!obj.isMesh) return;
    if (wheelRegex.test(obj.name)) {
      detectedWheelMeshes.push(obj);
      return;
    }

    if (obj.geometry && obj.geometry.attributes?.position) {
      if (!obj.geometry.userData.originalPositions) {
        obj.geometry = obj.geometry.clone();
        obj.geometry.userData.originalPositions = Float32Array.from(
          obj.geometry.attributes.position.array
        );
      }
      deformableMeshes.push(obj);
    }

    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    const clonedMats = mats.map((mat) => {
      if (!mat) return mat;
      const matName = `${obj.name}_${mat.name || ''}`;
      if (!ignorePaintRegex.test(matName) && !mat.transparent) {
        const cloned = mat.clone();
        if ('metalness' in cloned) cloned.metalness = Math.max(cloned.metalness || 0, 0.45);
        if ('roughness' in cloned) cloned.roughness = Math.min(cloned.roughness ?? 0.5, 0.35);
        paintMaterials.push(cloned);
        return cloned;
      }
      return mat;
    });
    obj.material = Array.isArray(obj.material) ? clonedMats : clonedMats[0];
  });

  // Balonlarni markazlashtirib pivotga bog'lash
  detectedWheelMeshes.forEach((wheelObj) => {
    const wheelBox = new THREE.Box3().setFromObject(wheelObj);
    const wheelWorldCenter = new THREE.Vector3();
    wheelBox.getCenter(wheelWorldCenter);

    const wheelLocalCenter = carRoot.worldToLocal(wheelWorldCenter.clone());
    const isFront = wheelLocalCenter.z > center.z;

    const steerPivot = new THREE.Group();
    steerPivot.position.copy(wheelLocalCenter);
    carRoot.add(steerPivot);

    const spinPivot = new THREE.Group();
    steerPivot.add(spinPivot);

    steerPivot.updateMatrixWorld(true);
    spinPivot.attach(wheelObj);

    wheels.push(spinPivot);
    if (isFront) frontSteerPivots.push(steerPivot);
  });

  // Yumshoq contact shadow
  carRoot.add(createContactShadow(size.x * 1.15, size.z * 1.12));

  // Tormoz stop chiroqlari
  const brakeMat = new THREE.MeshBasicMaterial({ color: 0x7f1d1d });
  const tailGeo = new THREE.BoxGeometry(0.28, 0.1, 0.06);
  const leftBrake = new THREE.Mesh(tailGeo, brakeMat);
  leftBrake.position.set(-size.x * 0.34, size.y * 0.44, box.min.z - 0.01);
  const rightBrake = new THREE.Mesh(tailGeo, brakeMat);
  rightBrake.position.set(size.x * 0.34, size.y * 0.44, box.min.z - 0.01);
  carRoot.add(leftBrake, rightBrake);

  // O'zbekiston davlat raqami
  const plateData = { region: '01', number: 'A 777 AA' };
  const plateTexture = createUzbekPlateTexture(plateData.region, plateData.number);
  const plateMat = new THREE.MeshBasicMaterial({ map: plateTexture });
  const plateGeo = new THREE.PlaneGeometry(0.54, 0.13);

  const frontPlate = new THREE.Mesh(plateGeo, plateMat);
  frontPlate.position.set(0, Math.max(0.4, size.y * 0.28), box.max.z + 0.02);
  carRoot.add(frontPlate);

  const rearPlate = new THREE.Mesh(plateGeo, plateMat);
  rearPlate.rotation.y = Math.PI;
  rearPlate.position.set(0, Math.max(0.44, size.y * 0.34), box.min.z - 0.02);
  carRoot.add(rearPlate);

  const setColor = (hex) => {
    paintMaterials.forEach((m) => {
      if (m && m.color) m.color.set(hex);
    });
  };
  setColor(initialColor);

  const setPlate = (region, number) => {
    plateData.region = region;
    plateData.number = number;
    const newTex = createUzbekPlateTexture(region, number);
    plateMat.map?.dispose();
    plateMat.map = newTex;
    plateMat.needsUpdate = true;
  };

  return {
    wheels,
    frontSteerPivots,
    deformableMeshes,
    plateData,
    setColor,
    setPlate,
    setBraking(braking) {
      brakeMat.color.setHex(braking ? 0xff2020 : 0x6b1414);
    },
    flip180() {
      carInner.rotation.y += Math.PI;
    },
    size
  };
}

export function applyCarDent(rig, localHitPoint, impactStrength = 0.22) {
  if (!rig?.deformableMeshes) return;
  const radius = 1.1;
  rig.deformableMeshes.forEach((mesh) => {
    const posAttr = mesh.geometry.attributes.position;
    if (!posAttr) return;
    const v = new THREE.Vector3();
    for (let i = 0; i < posAttr.count; i++) {
      v.fromBufferAttribute(posAttr, i);
      if (v.distanceTo(localHitPoint) < radius) {
        const factor = (1 - v.distanceTo(localHitPoint) / radius) * impactStrength;
        v.x *= 1 - factor * 0.42;
        v.z *= 1 - factor * 0.5;
        v.y += (Math.random() - 0.35) * factor * 0.22;
        posAttr.setXYZ(i, v.x, v.y, v.z);
      }
    }
    posAttr.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  });
}

export function repairCarRig(rig) {
  if (!rig?.deformableMeshes) return;
  rig.deformableMeshes.forEach((mesh) => {
    const orig = mesh.geometry.userData.originalPositions;
    const posAttr = mesh.geometry.attributes.position;
    if (orig && posAttr) {
      posAttr.array.set(orig);
      posAttr.needsUpdate = true;
      mesh.geometry.computeVertexNormals();
    }
  });
}

export function createUzbekPlateTexture(region = '01', number = 'A 777 AA') {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, 502, 118);

  ctx.beginPath();
  ctx.moveTo(108, 6);
  ctx.lineTo(108, 122);
  ctx.lineWidth = 6;
  ctx.stroke();

  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 64px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(region.padStart(2, '0'), 56, 66);
  ctx.fillText(number.toUpperCase(), 280, 66);

  ctx.fillStyle = '#0284c7';
  ctx.fillRect(450, 18, 44, 14);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(450, 32, 44, 14);
  ctx.fillStyle = '#16a34a';
  ctx.fillRect(450, 46, 44, 14);
  ctx.fillStyle = '#0284c7';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText('UZ', 472, 92);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
