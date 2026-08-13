import * as THREE from "three";
import type { DroneScenePresentation } from "../simulator/scene-presentation";

type EnvironmentKind = NonNullable<DroneScenePresentation["environment"]>;

interface EnvironmentBuildOptions {
  treeCount: number;
  shadows: boolean;
}

interface BuildingOptions {
  x: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  color: number;
  damaged?: boolean;
}

const GROUND_Y = -0.055;

function material(
  color: THREE.ColorRepresentation,
  roughness = 0.86,
  metalness = 0.02,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function basicMaterial(
  color: THREE.ColorRepresentation,
  opacity = 1,
): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1,
  });
}

function setShadow(object: THREE.Object3D, enabled: boolean): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = enabled;
      child.receiveShadow = enabled;
    }
  });
}

function addGround(
  group: THREE.Group,
  color: number,
  width = 100,
  depth = 120,
  z = 24,
): void {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    material(color, 1, 0),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, GROUND_Y, z);
  group.add(ground);
}

function addRoad(
  group: THREE.Group,
  x: number,
  z: number,
  width: number,
  length: number,
  rotationY = 0,
  color = 0x4c565d,
): void {
  const road = new THREE.Group();
  road.position.set(x, 0, z);
  road.rotation.y = rotationY;

  const surface = new THREE.Mesh(
    new THREE.PlaneGeometry(width, length),
    material(color, 0.96, 0.01),
  );
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = -0.02;
  road.add(surface);

  const sidewalkMaterial = material(0xb7b8b3, 0.98, 0);
  for (const side of [-1, 1]) {
    const sidewalk = new THREE.Mesh(
      new THREE.BoxGeometry(1.15, 0.14, length),
      sidewalkMaterial,
    );
    sidewalk.position.set(side * (width / 2 + 0.58), 0.025, 0);
    road.add(sidewalk);
  }

  const laneMaterial = basicMaterial(0xe6d7a0);
  for (let offset = -length / 2 + 2.5; offset < length / 2; offset += 5.5) {
    const lane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.13, 2.5),
      laneMaterial,
    );
    lane.rotation.x = -Math.PI / 2;
    lane.position.set(0, 0.008, offset);
    road.add(lane);
  }
  group.add(road);
}

function addCrosswalk(
  group: THREE.Group,
  x: number,
  z: number,
  rotationY = 0,
): void {
  const crosswalk = new THREE.Group();
  crosswalk.position.set(x, 0.012, z);
  crosswalk.rotation.y = rotationY;
  for (let index = -3; index <= 3; index += 1) {
    const stripe = new THREE.Mesh(
      new THREE.PlaneGeometry(0.48, 5.2),
      basicMaterial(0xe8eceb),
    );
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.x = index * 0.7;
    crosswalk.add(stripe);
  }
  group.add(crosswalk);
}

function addDoorAndWindows(
  group: THREE.Group,
  options: BuildingOptions,
  centerY: number,
): void {
  const frontZ = options.z - options.depth / 2 - 0.025;
  const door = new THREE.Mesh(
    new THREE.PlaneGeometry(0.72, 1.15),
    basicMaterial(0x263845),
  );
  door.position.set(options.x, 0.62, frontZ);
  group.add(door);

  const windows = new THREE.Group();
  const rows = Math.max(1, Math.min(3, Math.floor(options.height / 1.7)));
  const columns = Math.max(2, Math.min(5, Math.floor(options.width / 1.25)));
  const windowMaterial = basicMaterial(0x8dc1d5);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const removedForDamage =
        options.damaged && column >= columns - 2 && row >= rows - 2;
      if (removedForDamage) continue;
      const pane = new THREE.Mesh(
        new THREE.PlaneGeometry(0.52, 0.42),
        windowMaterial,
      );
      pane.position.set(
        options.x - options.width * 0.36 +
          (column / Math.max(1, columns - 1)) * options.width * 0.72,
        centerY - options.height * 0.25 +
          (row / Math.max(1, rows - 1)) * options.height * 0.5,
        frontZ,
      );
      windows.add(pane);
    }
  }
  group.add(windows);
}

function addBuilding(
  group: THREE.Group,
  options: BuildingOptions,
): void {
  const centerY = options.height / 2 + 0.02;
  const bodyMaterial = material(options.color, 0.86, 0.02);

  if (options.damaged) {
    const leftWidth = options.width * 0.62;
    const left = new THREE.Mesh(
      new THREE.BoxGeometry(leftWidth, options.height, options.depth),
      bodyMaterial,
    );
    left.position.set(
      options.x - options.width * 0.19,
      centerY,
      options.z,
    );
    group.add(left);

    const rightWidth = options.width * 0.32;
    const rightHeight = options.height * 0.58;
    const right = new THREE.Mesh(
      new THREE.BoxGeometry(rightWidth, rightHeight, options.depth * 0.82),
      bodyMaterial.clone(),
    );
    right.position.set(
      options.x + options.width * 0.33,
      rightHeight / 2 + 0.02,
      options.z + options.depth * 0.06,
    );
    right.rotation.z = -0.035;
    group.add(right);

    const exposedFloorMaterial = material(0x4b555b, 0.96, 0.02);
    for (let floor = 1; floor <= 2; floor += 1) {
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(options.width * 0.34, 0.13, options.depth * 0.86),
        exposedFloorMaterial,
      );
      slab.position.set(
        options.x + options.width * 0.32,
        Math.min(options.height - 0.3, floor * options.height * 0.29),
        options.z,
      );
      group.add(slab);
    }
  } else {
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(options.width, options.height, options.depth),
      bodyMaterial,
    );
    body.position.set(options.x, centerY, options.z);
    group.add(body);
  }

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(options.width * 1.04, 0.2, options.depth * 1.04),
    material(options.damaged ? 0x4b555b : 0x374b58, 0.72, 0.08),
  );
  roof.position.set(
    options.damaged ? options.x - options.width * 0.19 : options.x,
    options.height + 0.12,
    options.z,
  );
  roof.scale.x = options.damaged ? 0.6 : 1;
  group.add(roof);

  const rooftopUnit = new THREE.Mesh(
    new THREE.BoxGeometry(options.width * 0.24, 0.45, options.depth * 0.24),
    material(0x77858c, 0.78, 0.04),
  );
  rooftopUnit.position.set(
    options.x - options.width * 0.17,
    options.height + 0.42,
    options.z + options.depth * 0.12,
  );
  group.add(rooftopUnit);
  addDoorAndWindows(group, options, centerY);

  if (options.damaged) {
    addRubblePile(
      group,
      options.x + options.width * 0.42,
      options.z - options.depth * 0.28,
      1.5,
    );
    const crackMaterial = basicMaterial(0x353b3f);
    for (let index = 0; index < 3; index += 1) {
      const crack = new THREE.Mesh(
        new THREE.PlaneGeometry(0.055, 0.75 - index * 0.12),
        crackMaterial,
      );
      crack.position.set(
        options.x + options.width * (0.05 + index * 0.07),
        options.height * (0.42 + index * 0.12),
        options.z - options.depth / 2 - 0.03,
      );
      crack.rotation.z = 0.38 - index * 0.3;
      group.add(crack);
    }
  }
}

function addRubblePile(
  group: THREE.Group,
  x: number,
  z: number,
  scale = 1,
): void {
  const rubbleMaterial = material(0x717a7d, 0.98, 0);
  const shapes = [
    [-0.65, 0.16, 0.12, 0.66, 0.34, 0.48],
    [0.05, 0.2, -0.18, 0.8, 0.42, 0.55],
    [0.58, 0.13, 0.18, 0.52, 0.25, 0.4],
    [-0.1, 0.38, 0.2, 0.44, 0.55, 0.34],
  ] as const;
  for (const [offsetX, y, offsetZ, width, height, depth] of shapes) {
    const piece = new THREE.Mesh(
      new THREE.BoxGeometry(width * scale, height * scale, depth * scale),
      rubbleMaterial,
    );
    piece.position.set(x + offsetX * scale, y * scale, z + offsetZ * scale);
    piece.rotation.set(offsetZ * 0.18, offsetX * 0.22, offsetX * 0.12);
    group.add(piece);
  }
}

function addBarrier(
  group: THREE.Group,
  x: number,
  z: number,
  rotationY = 0,
  scale = 1,
): void {
  const barrier = new THREE.Group();
  barrier.position.set(x, 0, z);
  barrier.rotation.y = rotationY;
  const dark = material(0x39464d, 0.7, 0.08);
  const orange = material(0xf07f2f, 0.62, 0.04);
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(
      new THREE.BoxGeometry(0.12 * scale, 0.9 * scale, 0.12 * scale),
      dark,
    );
    post.position.set(side * 1.05 * scale, 0.45 * scale, 0);
    barrier.add(post);
  }
  const rail = new THREE.Mesh(
    new THREE.BoxGeometry(2.3 * scale, 0.27 * scale, 0.14 * scale),
    orange,
  );
  rail.position.y = 0.68 * scale;
  barrier.add(rail);
  for (const offset of [-0.72, 0, 0.72]) {
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.22 * scale, 0.29 * scale, 0.02 * scale),
      basicMaterial(0xf6f3e9),
    );
    stripe.position.set(offset * scale, 0.68 * scale, -0.081 * scale);
    stripe.rotation.z = -0.35;
    barrier.add(stripe);
  }
  group.add(barrier);
}

function addSafetyCone(
  group: THREE.Group,
  x: number,
  z: number,
  scale = 1,
): void {
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.16 * scale, 0.52 * scale, 10),
    material(0xf47d2e, 0.72, 0.02),
  );
  cone.position.set(x, 0.27 * scale, z);
  group.add(cone);
  const band = new THREE.Mesh(
    new THREE.CylinderGeometry(0.105 * scale, 0.13 * scale, 0.11 * scale, 10),
    material(0xf5f2e8, 0.72, 0.02),
  );
  band.position.set(x, 0.28 * scale, z);
  group.add(band);
}

function addTent(
  group: THREE.Group,
  x: number,
  z: number,
  color = 0xece9dc,
): void {
  const tent = new THREE.Group();
  tent.position.set(x, 0, z);
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(2.35, 1.35, 4),
    material(color, 0.94, 0),
  );
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 1.65;
  tent.add(roof);
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 1.4, 3.2),
      material(0xd8d8cf, 0.94, 0),
    );
    wall.position.set(side * 1.55, 0.72, 0);
    tent.add(wall);
  }
  const rear = new THREE.Mesh(
    new THREE.BoxGeometry(3.1, 1.4, 0.1),
    material(0xd8d8cf, 0.94, 0),
  );
  rear.position.set(0, 0.72, 1.55);
  tent.add(rear);
  group.add(tent);
}

function addVehicle(
  group: THREE.Group,
  x: number,
  z: number,
  bodyColor: number,
  medical = false,
  rotationY = 0,
): void {
  const vehicle = new THREE.Group();
  vehicle.position.set(x, 0, z);
  vehicle.rotation.y = rotationY;
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.5, 0.82, 1.25),
    material(bodyColor, 0.55, 0.12),
  );
  body.position.y = 0.65;
  vehicle.add(body);
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.15, 0.72, 1.16),
    material(0xe8eff2, 0.48, 0.14),
  );
  cabin.position.set(0.47, 1.28, 0);
  vehicle.add(cabin);
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(0.68, 0.38),
    basicMaterial(0x5e8fa5),
  );
  glass.position.set(1.055, 1.34, 0);
  glass.rotation.y = Math.PI / 2;
  vehicle.add(glass);
  const wheelMaterial = material(0x202b32, 0.58, 0.16);
  for (const wheelX of [-0.72, 0.72]) {
    for (const wheelZ of [-0.64, 0.64]) {
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 0.25, 0.14, 12),
        wheelMaterial,
      );
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(wheelX, 0.3, wheelZ);
      vehicle.add(wheel);
    }
  }
  if (medical) {
    const red = basicMaterial(0xd84242);
    const horizontal = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.16), red);
    const vertical = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.6), red);
    horizontal.position.set(0.48, 1.28, -0.591);
    vertical.position.copy(horizontal.position);
    vehicle.add(horizontal, vertical);
  } else {
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 0.14, 8),
      basicMaterial(0xf08a31),
    );
    beacon.position.set(0.48, 1.72, 0);
    vehicle.add(beacon);
  }
  group.add(vehicle);
}

function addCargoBoxes(group: THREE.Group, x: number, z: number): void {
  const boxMaterial = material(0xe9ece9, 0.82, 0.02);
  const strapMaterial = basicMaterial(0xd94b43);
  for (let index = 0; index < 3; index += 1) {
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.72, 0.46, 0.55),
      boxMaterial,
    );
    box.position.set(x + index * 0.78, 0.24, z + (index % 2) * 0.18);
    group.add(box);
    const strap = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.47, 0.56),
      strapMaterial,
    );
    strap.position.copy(box.position);
    group.add(strap);
  }
}

function addTrees(
  group: THREE.Group,
  positions: readonly (readonly [number, number, number])[],
  shadows: boolean,
): void {
  const trunkGeometry = new THREE.CylinderGeometry(0.13, 0.2, 1.25, 7);
  const crownGeometry = new THREE.DodecahedronGeometry(0.86, 0);
  const trunks = new THREE.InstancedMesh(
    trunkGeometry,
    material(0x6e523d, 1, 0),
    positions.length,
  );
  const crowns = new THREE.InstancedMesh(
    crownGeometry,
    material(0x426f4f, 0.98, 0),
    positions.length,
  );
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  positions.forEach(([x, z, scale], index) => {
    matrix.compose(
      new THREE.Vector3(x, 0.6 * scale, z),
      rotation,
      new THREE.Vector3(scale, scale, scale),
    );
    trunks.setMatrixAt(index, matrix);
    matrix.compose(
      new THREE.Vector3(x, 1.72 * scale, z),
      rotation,
      new THREE.Vector3(scale, scale * 1.15, scale),
    );
    crowns.setMatrixAt(index, matrix);
  });
  trunks.castShadow = shadows;
  crowns.castShadow = shadows;
  group.add(trunks, crowns);
}

function addMountains(group: THREE.Group): void {
  const mountainMaterial = material(0x829276, 1, 0);
  const rearMaterial = material(0xa4ad91, 1, 0);
  const mountains = [
    [-34, 69, 17, 8, 10, mountainMaterial],
    [-14, 76, 22, 10, 12, rearMaterial],
    [10, 75, 19, 8, 11, mountainMaterial],
    [34, 70, 23, 10, 13, rearMaterial],
  ] as const;
  for (const [x, z, width, height, depth, mountainColor] of mountains) {
    const mountain = new THREE.Mesh(
      new THREE.DodecahedronGeometry(1, 0),
      mountainColor,
    );
    mountain.scale.set(width, height, depth);
    mountain.position.set(x, height * 0.58 - 0.08, z);
    mountain.rotation.set(0.04, x * 0.018, -0.025);
    group.add(mountain);
  }
}

function addRoadDamage(group: THREE.Group, x: number, z: number): void {
  const crackMaterial = basicMaterial(0x242d31);
  const cracks = [
    [0, 0, 2.8, 0.12, 0.45],
    [-1.1, 0.65, 1.7, 0.09, -0.6],
    [1.05, -0.55, 1.6, 0.09, 0.7],
  ] as const;
  for (const [offsetX, offsetZ, length, width, rotation] of cracks) {
    const crack = new THREE.Mesh(
      new THREE.PlaneGeometry(width, length),
      crackMaterial,
    );
    crack.rotation.x = -Math.PI / 2;
    crack.rotation.z = rotation;
    crack.position.set(x + offsetX, 0.016, z + offsetZ);
    group.add(crack);
  }
  const depression = new THREE.Mesh(
    new THREE.CircleGeometry(1.15, 12),
    basicMaterial(0x313b3f),
  );
  depression.rotation.x = -Math.PI / 2;
  depression.scale.z = 0.55;
  depression.position.set(x + 1.5, 0.013, z + 0.9);
  group.add(depression);
}

function buildDisasterZone(options: EnvironmentBuildOptions): THREE.Group {
  const group = new THREE.Group();
  group.name = "disaster-zone";
  addGround(group, 0xa8aa9d, 95, 105, 22);
  addRoad(group, 0, 19, 9.5, 72, 0, 0x4c555a);
  addRoad(group, 0, 13, 8.5, 58, Math.PI / 2, 0x515a5e);
  addCrosswalk(group, 0, 8.5);
  addCrosswalk(group, -5.2, 13, Math.PI / 2);

  addBuilding(group, { x: -12.4, z: 8, width: 5.6, height: 5, depth: 4.8, color: 0x70818a });
  addBuilding(group, { x: 19, z: 16, width: 5.6, height: 4.9, depth: 4.8, color: 0x7d8b92 });
  addBuilding(group, { x: -8.2, z: 9.2, width: 5.2, height: 4.4, depth: 4.6, color: 0x8a8175, damaged: true });
  addBuilding(group, { x: 10.5, z: 18.5, width: 5.8, height: 6.2, depth: 5.2, color: 0x657987, damaged: true });
  addBuilding(group, { x: -6.2, z: 21, width: 4.8, height: 5, depth: 6.2, color: 0x7c898d });
  addBuilding(group, { x: 4.2, z: 22.2, width: 4.5, height: 5.8, depth: 6.5, color: 0x73858d, damaged: true });

  addRoadDamage(group, 0.4, 12.5);
  addRubblePile(group, 5.3, 13.3, 1.45);
  addRubblePile(group, -0.6, 19.2, 1.2);
  addBarrier(group, -2.2, 11.4, Math.PI / 2, 0.92);
  addBarrier(group, 2.3, 14.4, Math.PI / 2, 0.92);
  for (const [x, z] of [[-3, 11.1], [-1.5, 11.2], [1.5, 14.4], [3, 14.5]] as const) {
    addSafetyCone(group, x, z, 1.1);
  }

  addTent(group, -11.8, -1.8, 0xd7ded8);
  addVehicle(group, -2.8, -2.6, 0xf1eee5, false, Math.PI / 2);
  addCargoBoxes(group, -9.7, -0.4);
  addBarrier(group, 5.3, -1.6, 0, 1.05);

  addTrees(
    group,
    [
      [-20, -3, 1], [-23, 8, 0.9], [-20, 18, 1.1], [-22, 31, 0.95],
      [19, -1, 0.9], [22, 9, 1.1], [20, 27, 0.92], [24, 38, 1.05],
    ],
    options.shadows,
  );
  addMountains(group);
  setShadow(group, options.shadows);
  return group;
}

function addRiver(group: THREE.Group): void {
  const river = new THREE.Mesh(
    new THREE.PlaneGeometry(72, 6.8),
    new THREE.MeshStandardMaterial({
      color: 0x66abc3,
      roughness: 0.35,
      metalness: 0.03,
      transparent: true,
      opacity: 0.88,
    }),
  );
  river.rotation.x = -Math.PI / 2;
  river.rotation.z = -0.08;
  river.position.set(0, -0.012, 12.2);
  group.add(river);

  const bankMaterial = material(0xb6a47b, 1, 0);
  for (const offset of [-4.2, 4.2]) {
    const bank = new THREE.Mesh(
      new THREE.PlaneGeometry(74, 1.8),
      bankMaterial,
    );
    bank.rotation.x = -Math.PI / 2;
    bank.rotation.z = -0.08;
    bank.position.set(0, -0.022, 12.2 + offset);
    group.add(bank);
  }
}

function addBrokenBridge(group: THREE.Group): void {
  const bridgeMaterial = material(0x747d7d, 0.94, 0.02);
  for (const side of [-1, 1]) {
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(5.4, 0.35, 2.3),
      bridgeMaterial,
    );
    deck.position.set(0, 0.28, 12.2 + side * 2.45);
    deck.rotation.x = side > 0 ? -0.05 : 0.05;
    group.add(deck);
    for (const railSide of [-1, 1]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.09, 0.65, 2.4),
        material(0x4e5b5f, 0.7, 0.08),
      );
      rail.position.set(railSide * 2.48, 0.72, deck.position.z);
      group.add(rail);
    }
  }
  addBarrier(group, -0.1, 8.6, 0, 1.15);
  addBarrier(group, 0.1, 15.8, Math.PI, 1.15);
  addSafetyCone(group, -2.2, 9.1, 1.2);
  addSafetyCone(group, 2.2, 15.3, 1.2);
}

function addLandslide(group: THREE.Group): void {
  const soilMaterial = material(0x9b7650, 1, 0);
  const rocks = [
    [3.2, 16.2, 1.8, 0.8],
    [1.4, 17.1, 1.45, 0.6],
    [4.8, 17.4, 1.2, 0.55],
    [2.8, 18.2, 1.05, 0.45],
  ] as const;
  for (const [x, z, radius, y] of rocks) {
    const rock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(radius, 0),
      soilMaterial,
    );
    rock.scale.y = 0.58;
    rock.position.set(x, y, z);
    rock.rotation.set(0.2, x * 0.18, 0.14);
    group.add(rock);
  }
  addBarrier(group, 0, 16.4, 0, 1.08);
}

function addHouse(
  group: THREE.Group,
  x: number,
  z: number,
  color: number,
  rotationY = 0,
): void {
  const house = new THREE.Group();
  house.position.set(x, 0, z);
  house.rotation.y = rotationY;
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(3, 2.15, 2.65),
    material(color, 0.92, 0.01),
  );
  body.position.y = 1.1;
  house.add(body);
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(2.25, 1.25, 4),
    material(0x765c4f, 0.9, 0.01),
  );
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 2.75;
  roof.scale.z = 0.88;
  house.add(roof);
  const door = new THREE.Mesh(
    new THREE.PlaneGeometry(0.65, 1.05),
    basicMaterial(0x4a3d38),
  );
  door.position.set(0, 0.56, -1.331);
  house.add(door);
  for (const side of [-1, 1]) {
    const windowPane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.55, 0.45),
      basicMaterial(0x8fc3d6),
    );
    windowPane.position.set(side * 0.88, 1.35, -1.332);
    house.add(windowPane);
  }
  group.add(house);
}

function addMedicalTent(group: THREE.Group, x: number, z: number): void {
  addTent(group, x, z, 0xf4f2e9);
  const red = basicMaterial(0xd94343);
  const horizontal = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.23), red);
  const vertical = new THREE.Mesh(new THREE.PlaneGeometry(0.23, 0.95), red);
  horizontal.position.set(x, 1.25, z - 1.61);
  vertical.position.copy(horizontal.position);
  group.add(horizontal, vertical);
}

function buildMedicalDeliveryZone(
  options: EnvironmentBuildOptions,
): THREE.Group {
  const group = new THREE.Group();
  group.name = "medical-delivery-zone";
  addGround(group, 0x91a77c, 110, 120, 24);
  addRoad(group, 1.2, 12, 6.4, 50, -0.08, 0x59605e);
  addRoad(group, 8, 25, 5.8, 24, Math.PI / 2, 0x5c625f);
  addRiver(group);
  addBrokenBridge(group);
  addLandslide(group);

  // Start medical hub: the functional start pad remains at (0, 0, 0).
  addVehicle(group, -3.8, -1.5, 0xf1f2ec, true, Math.PI / 2);
  addCargoBoxes(group, -2.2, 1.8);
  for (const [x, z] of [[-4.8, 1.1], [-3.8, 1.1], [-2.8, 1.1]] as const) {
    addSafetyCone(group, x, z, 1.05);
  }

  // Isolated village and temporary clinic beyond the broken road.
  addHouse(group, 12.5, 20.2, 0xd9c6a4, -0.08);
  addHouse(group, 14.2, 27.8, 0xc9d4cf, 0.16);
  addHouse(group, 5.5, 30.2, 0xe0c4ab, -0.12);
  addHouse(group, 16.8, 24.6, 0xc6c2aa, 0.08);
  addMedicalTent(group, 11.6, 24.7);
  addVehicle(group, 15, 22.6, 0xe8eee9, true, Math.PI);
  addCargoBoxes(group, 10.4, 27.2);

  const treePositions: Array<readonly [number, number, number]> = [];
  const count = Math.max(12, Math.min(options.treeCount, 28));
  for (let index = 0; index < count; index += 1) {
    const side = index % 2 === 0 ? -1 : 1;
    const row = Math.floor(index / 2);
    treePositions.push([
      side * (12 + ((row * 5) % 15)),
      -2 + ((row * 7 + index * 3) % 44),
      0.72 + (row % 4) * 0.11,
    ]);
  }
  addTrees(group, treePositions, options.shadows);
  addMountains(group);
  setShadow(group, options.shadows);
  return group;
}

export function buildMissionEnvironment(
  kind: EnvironmentKind,
  options: EnvironmentBuildOptions,
): THREE.Group {
  if (kind === "disaster-zone") return buildDisasterZone(options);
  if (kind === "medical-delivery-zone") {
    return buildMedicalDeliveryZone(options);
  }
  const empty = new THREE.Group();
  empty.name = "training-environment-placeholder";
  return empty;
}

export function environmentPalette(kind: EnvironmentKind): {
  top: number;
  horizon: number;
  lower: number;
  fog: number;
  fogNear: number;
  fogFar: number;
} {
  if (kind === "disaster-zone") {
    return {
      top: 0x7fa9bd,
      horizon: 0xdce7e9,
      lower: 0xb4b4a7,
      fog: 0xc8d2d2,
      fogNear: 58,
      fogFar: 120,
    };
  }
  if (kind === "medical-delivery-zone") {
    return {
      top: 0x69b6e8,
      horizon: 0xeef8fb,
      lower: 0xb8c99d,
      fog: 0xd5e5da,
      fogNear: 70,
      fogFar: 145,
    };
  }
  return {
    top: 0x57b8f4,
    horizon: 0xeaf8ff,
    lower: 0xf7fbf4,
    fog: 0xdceff2,
    fogNear: 66,
    fogFar: 145,
  };
}
