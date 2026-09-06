import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

/** Presentation only: the simulator still owns position, attitude and motor state. */
export function createIndustrialDrone(shadows: boolean) {
  const root = new THREE.Group();
  const tilt = new THREE.Group();
  root.add(tilt);
  const carbon = new THREE.MeshStandardMaterial({ color: 0x252b2d, roughness: 0.48, metalness: 0.35 });
  const shell = new THREE.MeshStandardMaterial({ color: 0xbfc6c5, roughness: 0.34, metalness: 0.6 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x14191b, roughness: 0.86 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x808a8d, roughness: 0.25, metalness: 0.86 });
  const frontMark = new THREE.MeshStandardMaterial({ color: 0xc85229, roughness: 0.52, metalness: 0.15 });

  const box = (w: number, h: number, d: number, material: THREE.Material, x = 0, y = 0, z = 0, radius = 0.025) => {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, radius), material);
    mesh.position.set(x, y, z);
    tilt.add(mesh);
    return mesh;
  };
  const strut = (a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material) => {
    const direction = b.clone().sub(a);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), 10), material);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    tilt.add(mesh);
  };

  box(0.66, 0.27, 1.05, carbon, 0, 0.06, 0);
  box(0.61, 0.12, 0.83, shell, 0, 0.23, -0.03, 0.05);
  // Twin replaceable batteries, heatsink fins and fasteners make the scale legible.
  for (const side of [-1, 1]) {
    box(0.23, 0.17, 0.56, rubber, side * 0.15, 0.36, -0.12);
    box(0.12, 0.025, 0.13, metal, side * 0.15, 0.46, -0.2, 0.008);
    for (let i = 0; i < 6; i++) box(0.012, 0.07, 0.32, carbon, side * (0.2 + i * 0.018), 0.25, 0.08, 0.003);
    for (const z of [-0.39, 0.37]) {
      const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.012, 8), metal);
      screw.position.set(side * 0.26, 0.301, z);
      tilt.add(screw);
    }
    strut(new THREE.Vector3(side * 0.27, -0.02, 0.22), new THREE.Vector3(side * 0.53, -0.56, 0.22), 0.025, carbon);
    strut(new THREE.Vector3(side * 0.27, -0.02, -0.26), new THREE.Vector3(side * 0.53, -0.56, -0.26), 0.025, carbon);
    strut(new THREE.Vector3(side * 0.53, -0.575, -0.46), new THREE.Vector3(side * 0.53, -0.575, 0.48), 0.03, rubber);
    strut(new THREE.Vector3(side * 0.24, 0.36, -0.35), new THREE.Vector3(side * 0.25, 0.63, -0.37), 0.013, carbon);
  }
  box(0.38, 0.055, 0.03, frontMark, 0, 0.14, 0.537, 0.004);

  const gimbal = new THREE.Mesh(new THREE.SphereGeometry(0.095, 16, 10), metal);
  gimbal.position.set(0, -0.16, 0.38);
  tilt.add(gimbal);
  box(0.21, 0.18, 0.19, rubber, 0, -0.28, 0.4);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.075, 0.1, 20), metal);
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0, -0.28, 0.535);
  tilt.add(lens);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.053, 20), new THREE.MeshPhysicalMaterial({ color: 0x132d36, metalness: 0.48, roughness: 0.08, clearcoat: 1 }));
  glass.position.set(0, -0.28, 0.586);
  tilt.add(glass);

  const rotors: THREE.Group[] = [];
  for (const x of [-1.02, 1.02]) {
    for (const z of [-0.84, 0.84]) {
      const end = new THREE.Vector3(x, 0.19, z);
      strut(new THREE.Vector3(Math.sign(x) * 0.22, 0.04, Math.sign(z) * 0.28), end, 0.048, carbon);
      const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.12, 0.17, 20), carbon);
      motor.position.copy(end);
      tilt.add(motor);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.109, 0.109, 0.025, 20), z > 0 ? frontMark : metal);
      band.position.copy(end).add(new THREE.Vector3(0, 0.065, 0));
      tilt.add(band);
      const rotor = new THREE.Group();
      rotor.position.copy(end).add(new THREE.Vector3(0, 0.12, 0));
      const bladeShape = new THREE.Shape();
      bladeShape.moveTo(0, -0.045);
      bladeShape.bezierCurveTo(0.25, -0.07, 0.54, -0.09, 0.57, -0.015);
      bladeShape.bezierCurveTo(0.55, 0.025, 0.23, 0.04, 0, 0.028);
      bladeShape.closePath();
      const bladeMaterial = carbon.clone();
      bladeMaterial.side = THREE.DoubleSide;
      const blade = new THREE.Mesh(new THREE.ShapeGeometry(bladeShape, 8), bladeMaterial);
      blade.rotation.x = -Math.PI / 2;
      const opposite = blade.clone();
      opposite.rotation.z = Math.PI;
      rotor.add(blade, opposite);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.042, 12, 8), metal);
      cap.scale.y = 0.38;
      rotor.add(cap);
      tilt.add(rotor);
      rotors.push(rotor);
    }
  }

  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = shadows;
      object.receiveShadow = shadows;
    }
  });
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.86, 32), new THREE.MeshBasicMaterial({ color: 0x111a20, transparent: true, opacity: 0.16, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  return { root, tilt, rotors, shadow };
}
