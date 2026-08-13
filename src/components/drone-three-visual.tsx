"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { DroneTransform } from "../simulator/drone-transform";
import {
  EMPTY_DRONE_SCENE,
  type DroneSceneMarker,
  type DroneScenePresentation,
} from "../simulator/scene-presentation";
import { selectRenderQuality } from "../simulator/render-quality";
import { DroneVisual as DroneCanvasFallback } from "./drone-visual";

interface DroneThreeVisualProps {
  readTransform: () => DroneTransform;
  readScene?: () => DroneScenePresentation;
}

interface NavigatorWithDeviceMemory extends Navigator {
  deviceMemory?: number;
}

interface DroneModel {
  root: THREE.Group;
  tilt: THREE.Group;
  rotors: THREE.Group[];
  shadow: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
}

const FORWARD = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);

function meshMaterial(
  color: THREE.ColorRepresentation,
  roughness = 0.62,
  metalness = 0.08,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function configureShadow(mesh: THREE.Object3D, enabled: boolean): void {
  mesh.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = enabled;
      child.receiveShadow = enabled;
    }
  });
}

function makeArm(
  end: THREE.Vector3,
  material: THREE.Material,
): THREE.Mesh<THREE.CylinderGeometry, THREE.Material> {
  const start = new THREE.Vector3(0, 0.03, 0);
  const direction = end.clone().sub(start);
  const arm = new THREE.Mesh(
    new THREE.CylinderGeometry(0.075, 0.095, direction.length(), 8),
    material,
  );
  arm.position.copy(start).add(end).multiplyScalar(0.5);
  arm.quaternion.setFromUnitVectors(UP, direction.clone().normalize());
  return arm;
}

function createDroneModel(shadows: boolean): DroneModel {
  const root = new THREE.Group();
  const tilt = new THREE.Group();
  root.add(tilt);

  const white = meshMaterial(0xf8fbff, 0.32, 0.18);
  const navy = meshMaterial(0x152b47, 0.48, 0.32);
  const blue = meshMaterial(0x256ff2, 0.38, 0.2);
  const orange = meshMaterial(0xff6f3c, 0.45, 0.12);
  const black = meshMaterial(0x07121f, 0.28, 0.48);

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.74, 20, 12), white);
  body.scale.set(1, 0.42, 1.28);
  body.position.y = 0.12;
  tilt.add(body);

  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.48, 18, 10), navy);
  canopy.scale.set(0.92, 0.38, 1.05);
  canopy.position.set(0, 0.37, -0.04);
  tilt.add(canopy);

  const topPanel = new THREE.Mesh(
    new THREE.BoxGeometry(0.38, 0.055, 0.78),
    blue,
  );
  topPanel.position.set(0, 0.55, 0.06);
  topPanel.rotation.x = -0.04;
  tilt.add(topPanel);

  const noseLight = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.09, 0.07),
    orange,
  );
  noseLight.position.set(0, 0.2, 0.93);
  tilt.add(noseLight);

  const camera = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 0.18, 0.2),
    black,
  );
  camera.position.set(0, -0.18, 0.68);
  tilt.add(camera);

  const rotorPositions = [
    new THREE.Vector3(-1.06, 0.12, 0.78),
    new THREE.Vector3(1.06, 0.12, 0.78),
    new THREE.Vector3(-1.06, 0.12, -0.78),
    new THREE.Vector3(1.06, 0.12, -0.78),
  ];
  const rotors: THREE.Group[] = [];

  for (const [index, position] of rotorPositions.entries()) {
    tilt.add(makeArm(position, navy));

    const motor = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.2, 0.23, 12),
      index % 2 === 0 ? orange : blue,
    );
    motor.position.copy(position);
    tilt.add(motor);

    const rotor = new THREE.Group();
    rotor.position.copy(position).add(new THREE.Vector3(0, 0.18, 0));
    const bladeMaterial = new THREE.MeshStandardMaterial({
      color: 0x20364f,
      roughness: 0.34,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    });
    const bladeGeometry = new THREE.BoxGeometry(0.92, 0.018, 0.09);
    const firstBlade = new THREE.Mesh(bladeGeometry, bladeMaterial);
    const secondBlade = firstBlade.clone();
    secondBlade.rotation.y = Math.PI / 2;
    rotor.add(firstBlade, secondBlade);
    tilt.add(rotor);
    rotors.push(rotor);
  }

  for (const x of [-0.48, 0.48]) {
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.045, 0.48, 7),
      navy,
    );
    leg.position.set(x, -0.34, -0.05);
    leg.rotation.z = x < 0 ? -0.15 : 0.15;
    tilt.add(leg);

    const foot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.62, 7),
      navy,
    );
    foot.position.set(x + Math.sign(x) * 0.04, -0.57, -0.02);
    foot.rotation.z = Math.PI / 2;
    tilt.add(foot);
  }

  const shadowMaterial = new THREE.MeshBasicMaterial({
    color: 0x17304a,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
  });
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.86, 24),
    shadowMaterial,
  );
  shadow.rotation.x = -Math.PI / 2;

  configureShadow(root, shadows);
  return { root, tilt, rotors, shadow };
}

function addRunway(scene: THREE.Scene): void {
  const groundMaterial = meshMaterial(0xcbd8c4, 1, 0);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(150, 190),
    groundMaterial,
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.07, 42);
  ground.receiveShadow = true;
  scene.add(ground);

  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(28, 120),
    meshMaterial(0x87959f, 0.94, 0.02),
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(0, -0.045, 34);
  apron.receiveShadow = true;
  scene.add(apron);

  const shoulderMaterial = meshMaterial(0xb7c2c7, 0.95, 0);
  for (const x of [-15.2, 15.2]) {
    const shoulder = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 120),
      shoulderMaterial,
    );
    shoulder.rotation.x = -Math.PI / 2;
    shoulder.position.set(x, -0.035, 34);
    scene.add(shoulder);
  }

  const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xf8fbff });
  for (let z = -18; z < 91; z += 8) {
    const centerLine = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34, 4.3),
      lineMaterial,
    );
    centerLine.rotation.x = -Math.PI / 2;
    centerLine.position.set(0, -0.012, z);
    scene.add(centerLine);
  }

  for (const x of [-13.3, 13.3]) {
    const edge = new THREE.Mesh(
      new THREE.PlaneGeometry(0.22, 119),
      lineMaterial,
    );
    edge.rotation.x = -Math.PI / 2;
    edge.position.set(x, -0.01, 34);
    scene.add(edge);
  }
}

function addHillsAndTrees(
  scene: THREE.Scene,
  treeCount: number,
  shadows: boolean,
): void {
  const hillMaterial = meshMaterial(0x77966e, 1, 0);
  const hillPositions = [
    [-32, 3.8, 58, 22, 8, 18],
    [0, 3.2, 69, 27, 7, 17],
    [35, 4.1, 60, 25, 9, 19],
    [-54, 2.8, 77, 29, 7, 15],
    [57, 3, 80, 30, 7, 16],
  ] as const;
  for (const [x, y, z, sx, sy, sz] of hillPositions) {
    const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 7), hillMaterial);
    hill.position.set(x, y - sy * 0.48, z);
    hill.scale.set(sx, sy, sz);
    hill.receiveShadow = true;
    scene.add(hill);
  }

  const trunkGeometry = new THREE.CylinderGeometry(0.12, 0.18, 1.1, 6);
  const crownGeometry = new THREE.ConeGeometry(0.72, 2.2, 7);
  const trunkMaterial = meshMaterial(0x72533d, 1, 0);
  const crownMaterial = meshMaterial(0x3f7651, 0.95, 0);
  const trunks = new THREE.InstancedMesh(
    trunkGeometry,
    trunkMaterial,
    treeCount,
  );
  const crowns = new THREE.InstancedMesh(
    crownGeometry,
    crownMaterial,
    treeCount,
  );
  const transform = new THREE.Matrix4();
  for (let index = 0; index < treeCount; index += 1) {
    const side = index % 2 === 0 ? -1 : 1;
    const row = Math.floor(index / 2);
    const x = side * (20 + ((row * 13) % 24));
    const z = 1 + ((row * 17) % 74);
    const scale = 0.78 + (row % 4) * 0.08;
    transform.compose(
      new THREE.Vector3(x, 0.48 * scale, z),
      new THREE.Quaternion(),
      new THREE.Vector3(scale, scale, scale),
    );
    trunks.setMatrixAt(index, transform);
    transform.compose(
      new THREE.Vector3(x, 1.8 * scale, z),
      new THREE.Quaternion(),
      new THREE.Vector3(scale, scale, scale),
    );
    crowns.setMatrixAt(index, transform);
  }
  trunks.castShadow = shadows;
  crowns.castShadow = shadows;
  scene.add(trunks, crowns);
}

function addSkyDetails(scene: THREE.Scene): void {
  const cloudMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const positions = [
    [-18, 14, 30],
    [22, 17, 52],
    [-38, 19, 68],
  ] as const;
  for (const [x, y, z] of positions) {
    const cloud = new THREE.Group();
    for (let index = 0; index < 4; index += 1) {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(1.4 + (index % 2) * 0.45, 10, 7),
        cloudMaterial,
      );
      puff.position.set((index - 1.5) * 1.35, (index % 2) * 0.4, 0);
      puff.scale.y = 0.62;
      cloud.add(puff);
    }
    cloud.position.set(x, y, z);
    scene.add(cloud);
  }
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) material.dispose();
  });
  group.clear();
}

function addPad(marker: DroneSceneMarker, group: THREE.Group): void {
  const radius = marker.radius ?? (marker.kind === "landing-pad" ? 2.4 : 1.8);
  const completed = marker.completed ?? false;
  const active = marker.active ?? false;
  const color = completed ? 0x48bf73 : active ? 0x2b77ff : 0xf3f7fb;
  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 0.08, 28),
    meshMaterial(0x30475c, 0.84, 0.05),
  );
  pad.position.set(marker.position.x, 0, marker.position.z);
  group.add(pad);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius * 0.72, 0.08, 8, 32),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: active ? 0.38 : 0.12,
    }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.set(marker.position.x, 0.075, marker.position.z);
  group.add(ring);
}

function addGate(marker: DroneSceneMarker, group: THREE.Group): void {
  const radius = marker.radius ?? 2.1;
  const color = marker.completed ? 0x48bf73 : marker.active ? 0x2b77ff : 0xff9f43;
  const gate = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.13, 10, 38),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: marker.active ? 0.42 : 0.12,
      metalness: 0.24,
      roughness: 0.38,
    }),
  );
  gate.position.set(marker.position.x, marker.position.y, marker.position.z);
  group.add(gate);

  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.08, Math.max(0.5, marker.position.y), 7),
      meshMaterial(color, 0.62, 0.12),
    );
    post.position.set(
      marker.position.x + side * radius,
      marker.position.y / 2,
      marker.position.z,
    );
    group.add(post);
  }
}

function addArrow(marker: DroneSceneMarker, group: THREE.Group): void {
  const color = marker.completed ? 0x48bf73 : marker.active ? 0x2674ff : 0xffffff;
  const arrow = new THREE.ArrowHelper(
    FORWARD,
    new THREE.Vector3(marker.position.x, 0.08, marker.position.z - 1.2),
    2.8,
    color,
    0.8,
    0.55,
  );
  const lineMaterial = arrow.line.material as THREE.LineBasicMaterial;
  lineMaterial.transparent = true;
  lineMaterial.opacity = marker.active ? 1 : 0.6;
  group.add(arrow);
}

function addBuilding(marker: DroneSceneMarker, group: THREE.Group): void {
  const radius = marker.radius ?? 2.2;
  const isHospital = marker.kind === "hospital";
  const height = isHospital ? 4.6 : 3.4 + (marker.id.length % 4) * 0.75;
  const building = new THREE.Mesh(
    new THREE.BoxGeometry(radius * 1.6, height, radius * 1.6),
    meshMaterial(isHospital ? 0xe8edf2 : 0x667b8d, 0.78, 0.04),
  );
  building.position.set(marker.position.x, height / 2, marker.position.z);
  group.add(building);

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(radius * 1.72, 0.18, radius * 1.72),
    meshMaterial(isHospital ? 0xf8fbff : 0x354c60, 0.7, 0.08),
  );
  roof.position.set(marker.position.x, height + 0.09, marker.position.z);
  group.add(roof);

  if (isHospital) {
    const red = new THREE.MeshBasicMaterial({ color: 0xe94343 });
    const horizontal = new THREE.Mesh(
      new THREE.BoxGeometry(radius * 0.9, 0.03, radius * 0.25),
      red,
    );
    const vertical = new THREE.Mesh(
      new THREE.BoxGeometry(radius * 0.25, 0.03, radius * 0.9),
      red,
    );
    horizontal.position.set(marker.position.x, height + 0.2, marker.position.z);
    vertical.position.copy(horizontal.position);
    group.add(horizontal, vertical);
  }
}

function addSearchTarget(marker: DroneSceneMarker, group: THREE.Group): void {
  const radius = marker.radius ?? 1.3;
  const color = marker.completed ? 0x48bf73 : marker.active ? 0xffb12d : 0x52a4ff;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.1, 8, 30),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: marker.active ? 0.55 : 0.18,
    }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.set(marker.position.x, 0.1, marker.position.z);
  group.add(ring);
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, radius * 0.55, 3.8, 18, 1, true),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: marker.active ? 0.18 : 0.08,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  beacon.position.set(marker.position.x, 1.9, marker.position.z);
  group.add(beacon);
}

function addWindZone(marker: DroneSceneMarker, group: THREE.Group): void {
  const radius = marker.radius ?? 3.2;
  const zone = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 0.06, 28),
    new THREE.MeshBasicMaterial({
      color: 0x62c8ff,
      transparent: true,
      opacity: marker.active ? 0.2 : 0.1,
      depthWrite: false,
    }),
  );
  zone.position.set(marker.position.x, 0.02, marker.position.z);
  group.add(zone);
}

function rebuildMarkers(
  markers: readonly DroneSceneMarker[],
  group: THREE.Group,
  shadows: boolean,
): void {
  disposeGroup(group);
  for (const marker of markers) {
    switch (marker.kind) {
      case "start-pad":
      case "landing-pad":
        addPad(marker, group);
        break;
      case "gate":
        addGate(marker, group);
        break;
      case "arrow":
        addArrow(marker, group);
        break;
      case "building":
      case "hospital":
        addBuilding(marker, group);
        break;
      case "search-target":
        addSearchTarget(marker, group);
        break;
      case "wind-zone":
        addWindZone(marker, group);
        break;
    }
  }
  configureShadow(group, shadows);
}

function markerSignature(scene: DroneScenePresentation): string {
  return scene.markers
    .map(
      (marker) =>
        `${marker.id}:${marker.kind}:${marker.position.x}:${marker.position.y}:${marker.position.z}:${marker.radius ?? ""}:${marker.active ? 1 : 0}:${marker.completed ? 1 : 0}`,
    )
    .join("|");
}

function lerpAngle(current: number, target: number, amount: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * amount;
}

export function DroneThreeVisual({
  readTransform,
  readScene,
}: DroneThreeVisualProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const readTransformRef = useRef(readTransform);
  const readSceneRef = useRef(readScene);
  const [rendererFailed, setRendererFailed] = useState(false);

  useEffect(() => {
    readTransformRef.current = readTransform;
  }, [readTransform]);

  useEffect(() => {
    readSceneRef.current = readScene;
  }, [readScene]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const reducedMotionQuery = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    const navigatorInfo = navigator as NavigatorWithDeviceMemory;
    const quality = selectRenderQuality({
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemoryGb: navigatorInfo.deviceMemory,
      devicePixelRatio: window.devicePixelRatio,
      prefersReducedMotion: reducedMotionQuery.matches,
    });

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: quality.antialias,
        alpha: false,
        powerPreference: "low-power",
      });
    } catch {
      window.queueMicrotask(() => setRendererFailed(true));
      return;
    }

    renderer.setPixelRatio(quality.pixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = quality.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.dataset.renderer = "threejs";
    renderer.domElement.dataset.qualityTier = quality.tier;
    renderer.domElement.dataset.targetFps = String(quality.targetFps);
    renderer.domElement.setAttribute("aria-hidden", "true");
    container.append(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9ed6fa);
    scene.fog = new THREE.Fog(0xc9e5f4, 42, 118);

    const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 180);
    camera.position.set(7.5, 5.5, -9.5);
    const lookTarget = new THREE.Vector3(0, 1.2, 3.5);

    const hemisphere = new THREE.HemisphereLight(0xeaf8ff, 0x6f8063, 2.2);
    scene.add(hemisphere);
    const sun = new THREE.DirectionalLight(0xfff3d2, 2.35);
    sun.position.set(-18, 28, -16);
    sun.castShadow = quality.shadows;
    if (quality.shadows) {
      sun.shadow.mapSize.set(512, 512);
      sun.shadow.camera.near = 1;
      sun.shadow.camera.far = 75;
      sun.shadow.camera.left = -24;
      sun.shadow.camera.right = 24;
      sun.shadow.camera.top = 24;
      sun.shadow.camera.bottom = -24;
    }
    scene.add(sun);

    addRunway(scene);
    addHillsAndTrees(scene, quality.treeCount, quality.shadows);
    addSkyDetails(scene);

    const markerGroup = new THREE.Group();
    scene.add(markerGroup);

    const drone = createDroneModel(quality.shadows);
    scene.add(drone.root, drone.shadow);

    const collisionLight = new THREE.PointLight(0xff3d36, 0, 18, 2);
    scene.add(collisionLight);

    let markerState = "";
    let frame = 0;
    let lastFrameTime = 0;
    let previousTime = performance.now();
    let running = !document.hidden;
    let reducedMotion = reducedMotionQuery.matches;
    const targetInterval = 1000 / quality.targetFps;
    const desiredCamera = new THREE.Vector3();
    const desiredLook = new THREE.Vector3();

    const resize = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      renderer.setSize(rect.width, rect.height, false);
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    const onVisibilityChange = () => {
      running = !document.hidden;
      if (running) {
        previousTime = performance.now();
        frame = window.requestAnimationFrame(tick);
      } else if (frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
    };
    const onReducedMotion = () => {
      reducedMotion = reducedMotionQuery.matches;
    };
    const onContextLost = (event: Event) => {
      event.preventDefault();
      setRendererFailed(true);
    };

    const tick = (time: number) => {
      if (!running) return;
      frame = window.requestAnimationFrame(tick);
      if (time - lastFrameTime < targetInterval) return;
      const deltaSeconds = Math.min((time - previousTime) / 1000, 0.05);
      previousTime = time;
      lastFrameTime = time;

      const transform = readTransformRef.current();
      const presentation = readSceneRef.current?.() ?? EMPTY_DRONE_SCENE;
      const signature = markerSignature(presentation);
      if (signature !== markerState) {
        markerState = signature;
        rebuildMarkers(presentation.markers, markerGroup, quality.shadows);
      }

      drone.root.position.set(
        transform.position.x,
        Math.max(0.61, transform.position.y + 0.61),
        transform.position.z,
      );
      drone.root.rotation.y = lerpAngle(
        drone.root.rotation.y,
        transform.rotation.yaw,
        reducedMotion ? 1 : 0.22,
      );
      drone.tilt.rotation.x = THREE.MathUtils.lerp(
        drone.tilt.rotation.x,
        transform.tilt.pitch,
        reducedMotion ? 1 : 0.18,
      );
      drone.tilt.rotation.z = THREE.MathUtils.lerp(
        drone.tilt.rotation.z,
        -transform.tilt.roll,
        reducedMotion ? 1 : 0.18,
      );
      const rotorTurn = deltaSeconds * (3 + transform.rotorSpeed * 58);
      for (const [index, rotor] of drone.rotors.entries()) {
        rotor.rotation.y += rotorTurn * (index % 2 === 0 ? 1 : -1);
      }

      const altitude = Math.max(0, transform.position.y);
      drone.shadow.position.set(transform.position.x, 0.015, transform.position.z);
      drone.shadow.scale.setScalar(1 + Math.min(altitude * 0.16, 1.4));
      drone.shadow.material.opacity = Math.max(0.045, 0.2 - altitude * 0.025);
      collisionLight.position.copy(drone.root.position).add(new THREE.Vector3(0, 1, 0));
      collisionLight.intensity = presentation.collisionPulse ? 5 : 0;

      const isTutorial = presentation.markers.some((marker) =>
        marker.id.startsWith("tutorial-"),
      );
      if (isTutorial) {
        desiredCamera.set(8.6, 6.2, -10.8);
        desiredLook.set(
          transform.position.x * 0.24,
          1.15 + transform.position.y * 0.18,
          4 + transform.position.z * 0.18,
        );
      } else {
        const yaw = transform.rotation.yaw;
        const forwardX = Math.sin(yaw);
        const forwardZ = Math.cos(yaw);
        desiredCamera.set(
          transform.position.x - forwardX * 7.4,
          Math.max(4.6, transform.position.y + 4.1),
          transform.position.z - forwardZ * 7.4,
        );
        desiredLook.set(
          transform.position.x + forwardX * 3.2,
          transform.position.y + 0.9,
          transform.position.z + forwardZ * 3.2,
        );
      }
      const cameraResponse = reducedMotion ? 1 : isTutorial ? 0.09 : 0.12;
      camera.position.lerp(desiredCamera, cameraResponse);
      lookTarget.lerp(desiredLook, cameraResponse);
      camera.lookAt(lookTarget);

      renderer.render(scene, camera);
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    reducedMotionQuery.addEventListener("change", onReducedMotion);
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);
    frame = window.requestAnimationFrame(tick);

    return () => {
      running = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      reducedMotionQuery.removeEventListener("change", onReducedMotion);
      renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      resizeObserver.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      disposeGroup(markerGroup);
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        for (const material of materials) material.dispose();
      });
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);

  if (rendererFailed) {
    return (
      <div className="drone-visual-fallback">
        <DroneCanvasFallback
          readTransform={readTransform}
          readScene={readScene}
        />
        <span>이 기기에서는 가벼운 호환 화면을 사용합니다.</span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="drone-three-scene"
      role="img"
      aria-label="밝은 야외 훈련장에서 실제 조종 입력에 따라 비행하는 3차원 드론"
      aria-describedby="flight-telemetry"
    />
  );
}
