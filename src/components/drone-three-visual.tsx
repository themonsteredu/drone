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
const FRONT_ROTOR_COLOR = 0xff783f;
const REAR_ROTOR_COLOR = 0x3478f6;
const LANDING_PAD_VISUAL_SCALE = 1.18;
const LANDING_PAD_SURFACE_Y = 0.04;
// The landing feet end at local Y -0.605. Keep them a few millimetres above
// the pad surface so shadows can meet the pad without the geometry clipping.
const DRONE_MODEL_LOWEST_Y = -0.605;
const DRONE_GROUND_GAP = 0.006;
const DRONE_GROUND_CLEARANCE =
  LANDING_PAD_SURFACE_Y - DRONE_MODEL_LOWEST_Y + DRONE_GROUND_GAP;
const CAMERA_GROUND_LOCK_HEIGHT = 0.08;

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

  for (const position of rotorPositions) {
    tilt.add(makeArm(position, navy));
    const isFrontRotor = position.z > 0;
    const rotorColor = isFrontRotor
      ? FRONT_ROTOR_COLOR
      : REAR_ROTOR_COLOR;

    const motor = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.2, 0.23, 12),
      isFrontRotor ? orange : blue,
    );
    motor.position.copy(position);
    tilt.add(motor);

    const rotor = new THREE.Group();
    rotor.position.copy(position).add(new THREE.Vector3(0, 0.18, 0));
    const bladeMaterial = new THREE.MeshStandardMaterial({
      color: rotorColor,
      roughness: 0.34,
      transparent: true,
      opacity: 0.82,
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

function addSkyDome(scene: THREE.Scene): void {
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(135, 20, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x57b8f4) },
        horizonColor: { value: new THREE.Color(0xeaf8ff) },
        lowerColor: { value: new THREE.Color(0xf7fbf4) },
      },
      vertexShader: `
        varying float vHeight;
        void main() {
          vHeight = normalize(position).y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 lowerColor;
        varying float vHeight;
        void main() {
          float skyMix = smoothstep(-0.02, 0.72, vHeight);
          float groundMix = smoothstep(-0.18, 0.02, vHeight);
          vec3 lower = mix(lowerColor, horizonColor, groundMix);
          gl_FragColor = vec4(mix(lower, topColor, skyMix), 1.0);
        }
      `,
    }),
  );
  scene.add(dome);

  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(2.4, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xfff2bf, fog: false }),
  );
  sun.position.set(-34, 28, 74);
  scene.add(sun);
}

function addRunway(scene: THREE.Scene): void {
  const groundMaterial = meshMaterial(0x87aa78, 1, 0);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(150, 190),
    groundMaterial,
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.07, 42);
  ground.receiveShadow = true;
  scene.add(ground);

  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(32, 120),
    meshMaterial(0xd8e0e1, 0.96, 0.01),
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(0, -0.045, 34);
  apron.receiveShadow = true;
  scene.add(apron);

  const shoulderMaterial = meshMaterial(0xb7c6c5, 0.98, 0);
  for (const x of [-15, 15]) {
    const shoulder = new THREE.Mesh(
      new THREE.PlaneGeometry(1.8, 120),
      shoulderMaterial,
    );
    shoulder.rotation.x = -Math.PI / 2;
    shoulder.position.set(x, -0.035, 34);
    scene.add(shoulder);
  }

  const lineMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (let z = -18; z < 91; z += 8) {
    const centerLine = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34, 4.3),
      lineMaterial,
    );
    centerLine.rotation.x = -Math.PI / 2;
    centerLine.position.set(0, -0.012, z);
    scene.add(centerLine);
  }

  const edgeMaterial = new THREE.MeshBasicMaterial({ color: 0x2c78d8 });
  for (const x of [-13.8, 13.8]) {
    const edge = new THREE.Mesh(
      new THREE.PlaneGeometry(0.28, 119),
      edgeMaterial,
    );
    edge.rotation.x = -Math.PI / 2;
    edge.position.set(x, -0.01, 34);
    scene.add(edge);
  }

  for (const z of [-4, 12, 28, 44, 60, 76]) {
    const guide = new THREE.Mesh(
      new THREE.PlaneGeometry(27, 0.08),
      new THREE.MeshBasicMaterial({ color: 0x9fb1b5 }),
    );
    guide.rotation.x = -Math.PI / 2;
    guide.position.set(0, -0.008, z);
    scene.add(guide);
  }
}

function addHillsAndTrees(
  scene: THREE.Scene,
  treeCount: number,
  shadows: boolean,
): void {
  const addRidge = (
    z: number,
    peaks: readonly (readonly [number, number])[],
    color: number,
  ) => {
    const positions: number[] = [];
    const indices: number[] = [];
    for (const [x, y] of peaks) {
      positions.push(x, y, z, x, -2, z);
    }
    for (let index = 0; index < peaks.length - 1; index += 1) {
      const top = index * 2;
      const bottom = top + 1;
      const nextTop = top + 2;
      const nextBottom = top + 3;
      indices.push(top, bottom, nextTop, bottom, nextBottom, nextTop);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const ridge = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color,
        roughness: 1,
        metalness: 0,
        side: THREE.DoubleSide,
        fog: true,
      }),
    );
    ridge.receiveShadow = shadows;
    scene.add(ridge);
  };

  // Two lightweight irregular silhouettes replace the stretched sphere hills.
  // They keep a calm horizon while using only a few triangles and draw calls.
  addRidge(
    112,
    [
      [-78, 4.2],
      [-64, 7.1],
      [-50, 5.8],
      [-34, 8.4],
      [-19, 6.1],
      [-3, 9.2],
      [14, 6.4],
      [31, 8.7],
      [47, 5.7],
      [63, 7.6],
      [78, 4.4],
    ],
    0xa3b8a0,
  );
  addRidge(
    91,
    [
      [-78, 2.2],
      [-65, 4.8],
      [-51, 3.7],
      [-38, 6.3],
      [-23, 4.5],
      [-8, 5.8],
      [8, 3.6],
      [24, 6.5],
      [41, 4.2],
      [57, 5.5],
      [78, 2.3],
    ],
    0x759670,
  );

  const trunkGeometry = new THREE.CylinderGeometry(0.11, 0.18, 1.15, 7);
  const lowerCrownGeometry = new THREE.DodecahedronGeometry(0.78, 0);
  const upperCrownGeometry = new THREE.DodecahedronGeometry(0.62, 0);
  const trunkMaterial = meshMaterial(0x6f5038, 1, 0);
  const crownMaterial = meshMaterial(0x3e7551, 0.98, 0);
  const trunks = new THREE.InstancedMesh(
    trunkGeometry,
    trunkMaterial,
    treeCount,
  );
  const lowerCrowns = new THREE.InstancedMesh(
    lowerCrownGeometry,
    crownMaterial,
    treeCount,
  );
  const upperCrowns = new THREE.InstancedMesh(
    upperCrownGeometry,
    crownMaterial,
    treeCount,
  );
  const transform = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const treeColors = [0x356a48, 0x447d55, 0x527f50] as const;
  for (let index = 0; index < treeCount; index += 1) {
    const side = index % 2 === 0 ? -1 : 1;
    const row = Math.floor(index / 2);
    const x = side * (19 + ((row * 11 + (index % 3) * 3) % 24));
    const z = 3 + ((row * 13 + (index % 4) * 5) % 76);
    const scale = 0.78 + (row % 5) * 0.1;
    rotation.setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      (row % 7) * 0.31,
    );
    transform.compose(
      new THREE.Vector3(x, 0.52 * scale, z),
      rotation,
      new THREE.Vector3(scale, scale, scale),
    );
    trunks.setMatrixAt(index, transform);
    transform.compose(
      new THREE.Vector3(x, 1.48 * scale, z),
      rotation,
      new THREE.Vector3(scale * 1.02, scale * 1.2, scale * 0.92),
    );
    lowerCrowns.setMatrixAt(index, transform);
    transform.compose(
      new THREE.Vector3(x + 0.08 * side, 2.24 * scale, z),
      rotation,
      new THREE.Vector3(scale * 0.82, scale, scale * 0.78),
    );
    upperCrowns.setMatrixAt(index, transform);
    const color = new THREE.Color(treeColors[row % treeColors.length]);
    lowerCrowns.setColorAt(index, color);
    upperCrowns.setColorAt(index, color.clone().offsetHSL(0, 0, 0.035));
  }
  if (lowerCrowns.instanceColor) lowerCrowns.instanceColor.needsUpdate = true;
  if (upperCrowns.instanceColor) upperCrowns.instanceColor.needsUpdate = true;
  trunks.castShadow = shadows;
  lowerCrowns.castShadow = shadows;
  upperCrowns.castShadow = shadows;
  scene.add(trunks, lowerCrowns, upperCrowns);
}

function addSkyDetails(scene: THREE.Scene): void {
  const cloudMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    fog: false,
  });
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
  const baseRadius =
    marker.radius ?? (marker.kind === "landing-pad" ? 2.4 : 1.8);
  const radius = marker.kind === "landing-pad"
    ? baseRadius * LANDING_PAD_VISUAL_SCALE
    : baseRadius;
  const completed = marker.completed ?? false;
  const active = marker.active ?? false;
  const color = completed ? 0x48bf73 : active ? 0x2b77ff : 0xf3f7fb;
  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 0.08, 28),
    meshMaterial(0x30475c, 0.84, 0.05),
  );
  pad.position.set(marker.position.x, 0, marker.position.z);
  group.add(pad);
  for (const [index, ratio] of [0.3, 0.55, 0.78, 0.96].entries()) {
    const ringColor = index === 3 ? color : 0xf4f8fb;
    const bandWidth = index === 3 ? 0.055 : 0.03;
    const ringRadius = radius * ratio;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(
        Math.max(0.01, ringRadius - bandWidth),
        ringRadius + bandWidth,
        36,
      ),
      new THREE.MeshStandardMaterial({
        color: ringColor,
        emissive: ringColor,
        emissiveIntensity: active && index === 3 ? 0.42 : 0.08,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(
      marker.position.x,
      LANDING_PAD_SURFACE_Y + 0.004,
      marker.position.z,
    );
    group.add(ring);
  }

  if (marker.kind === "landing-pad") {
    const markMaterial = new THREE.MeshBasicMaterial({ color: 0xf8fbff });
    const crossbar = new THREE.Mesh(
      new THREE.PlaneGeometry(radius * 0.9, 0.12),
      markMaterial,
    );
    const upright = new THREE.Mesh(
      new THREE.PlaneGeometry(0.12, radius * 0.9),
      markMaterial,
    );
    for (const mark of [crossbar, upright]) {
      mark.rotation.x = -Math.PI / 2;
      mark.position.set(
        marker.position.x,
        LANDING_PAD_SURFACE_Y + 0.005,
        marker.position.z,
      );
      group.add(mark);
    }
  }
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
  const fallbackHeight = isHospital ? 4.6 : 3.4 + (marker.id.length % 4) * 0.75;
  const width = Math.max(0.5, marker.size?.x ?? radius * 1.6);
  const height = Math.max(0.5, marker.size?.y ?? fallbackHeight);
  const depth = Math.max(0.5, marker.size?.z ?? radius * 1.6);
  // Box-volume markers arrive at their exact volume center. The clamp keeps
  // legacy markers above the runway instead of allowing half a mesh to sink.
  const centerY = Math.max(height / 2 + 0.02, marker.position.y);
  const building = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    meshMaterial(isHospital ? 0xe8edf2 : 0x667b8d, 0.78, 0.04),
  );
  building.position.set(marker.position.x, centerY, marker.position.z);
  group.add(building);

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(width * 1.06, 0.18, depth * 1.06),
    meshMaterial(isHospital ? 0xf8fbff : 0x354c60, 0.7, 0.08),
  );
  const roofY = centerY + height / 2 + 0.09;
  roof.position.set(marker.position.x, roofY, marker.position.z);
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
    horizontal.position.set(marker.position.x, roofY + 0.11, marker.position.z);
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
        `${marker.id}:${marker.kind}:${marker.position.x}:${marker.position.y}:${marker.position.z}:${marker.size?.x ?? ""}:${marker.size?.y ?? ""}:${marker.size?.z ?? ""}:${marker.radius ?? ""}:${marker.active ? 1 : 0}:${marker.completed ? 1 : 0}`,
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
    scene.background = new THREE.Color(0x8fd3fb);
    scene.fog = new THREE.Fog(0xdceff2, 66, 145);

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

    addSkyDome(scene);
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
      const grounded = transform.position.y <= 0.02;
      const signature = markerSignature(presentation);
      if (signature !== markerState) {
        markerState = signature;
        rebuildMarkers(presentation.markers, markerGroup, quality.shadows);
      }

      drone.root.position.set(
        transform.position.x,
        Math.max(
          DRONE_GROUND_CLEARANCE,
          transform.position.y + DRONE_GROUND_CLEARANCE,
        ),
        transform.position.z,
      );
      drone.root.rotation.y = lerpAngle(
        drone.root.rotation.y,
        transform.rotation.yaw,
        reducedMotion ? 1 : 0.22,
      );
      drone.tilt.rotation.x = THREE.MathUtils.lerp(
        drone.tilt.rotation.x,
        grounded ? 0 : transform.tilt.pitch,
        reducedMotion || grounded ? 1 : 0.18,
      );
      drone.tilt.rotation.z = THREE.MathUtils.lerp(
        drone.tilt.rotation.z,
        grounded ? 0 : -transform.tilt.roll,
        reducedMotion || grounded ? 1 : 0.18,
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
      // Once the gear touches down, stop the last few damped camera frames.
      // Otherwise a fixed world-space pad appears to slide under a stationary
      // drone even though its marker coordinates never changed.
      const cameraGroundLocked =
        transform.position.y <= CAMERA_GROUND_LOCK_HEIGHT;
      const cameraResponse = reducedMotion || cameraGroundLocked
        ? 1
        : isTutorial
          ? 0.09
          : 0.12;
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
