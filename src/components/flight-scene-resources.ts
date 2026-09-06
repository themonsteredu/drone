import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";

type SurfaceKind = "asphalt" | "stone" | "grass";

export function photographicSurface(kind: SurfaceKind, tint: THREE.ColorRepresentation = 0xffffff) {
  const material = new THREE.MeshStandardMaterial({ color: tint, roughness: kind === "asphalt" ? 0.92 : 0.96, metalness: 0 });
  material.userData.surfaceKind = kind;
  return material;
}

/** One texture pool per renderer. Mission changes reuse images; teardown releases GPU resources. */
export function createSceneResources(renderer: THREE.WebGLRenderer) {
  const textures = new Map<SurfaceKind, THREE.Texture>();
  const loader = new THREE.TextureLoader();
  let disposed = false;
  const textureFor = (kind: SurfaceKind) => {
    const cached = textures.get(kind);
    if (cached) return cached;
    const texture = loader.load(`/textures/${kind}.jpg`, (loaded) => {
      if (disposed) loaded.dispose();
    });
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    textures.set(kind, texture);
    return texture;
  };

  return {
    apply(root: THREE.Object3D) {
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          const kind = material.userData.surfaceKind as SurfaceKind | undefined;
          if (!kind || !(material instanceof THREE.MeshStandardMaterial) || material.map) continue;
          material.map = textureFor(kind);
          // World-space projection preserves metre-scale detail on cliffs, walls and roads.
          material.onBeforeCompile = (shader) => {
            shader.vertexShader = `varying vec3 vSurfacePosition;\nvarying vec3 vSurfaceNormal;\n${shader.vertexShader}`;
            shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
              vSurfacePosition = (modelMatrix * vec4(position, 1.0)).xyz;
              vSurfaceNormal = normalize(mat3(modelMatrix) * normal);`);
            shader.fragmentShader = `varying vec3 vSurfacePosition;\nvarying vec3 vSurfaceNormal;\n${shader.fragmentShader}`;
            shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `
              vec3 weights = pow(abs(normalize(vSurfaceNormal)), vec3(5.0));
              weights /= max(dot(weights, vec3(1.0)), 0.001);
              vec3 p = vSurfacePosition * ${kind === "grass" ? "0.48" : "0.4"};
              vec4 surfaceColor = texture2D(map, p.yz) * weights.x
                + texture2D(map, p.xz) * weights.y + texture2D(map, p.xy) * weights.z;
              diffuseColor *= surfaceColor;`);
          };
          material.customProgramCacheKey = () => `flight-surface-v1-${kind}`;
          material.needsUpdate = true;
        }
      });
    },
    dispose() {
      disposed = true;
      for (const texture of textures.values()) texture.dispose();
      textures.clear();
    },
  };
}

export function createDaylightEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
  const sky = new Sky();
  sky.scale.setScalar(160);
  sky.material.uniforms.turbidity.value = 3.2;
  sky.material.uniforms.rayleigh.value = 1.4;
  sky.material.uniforms.mieCoefficient.value = 0.003;
  sky.material.uniforms.mieDirectionalG.value = 0.82;
  sky.material.uniforms.sunPosition.value.set(-18, 28, -16).normalize();
  const environmentScene = new THREE.Scene();
  environmentScene.add(sky);
  const generator = new THREE.PMREMGenerator(renderer);
  const environment = generator.fromScene(environmentScene, 0.03, 0.1, 300);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.65;
  generator.dispose();
  // The visible atmosphere is a separate sky, so fog and mission tones stay independent.
  return { sky, dispose() { environment.dispose(); sky.geometry.dispose(); sky.material.dispose(); } };
}

function randomSequence(seed: number) {
  let value = seed;
  return () => { value = (Math.imul(value, 1664525) + 1013904223) | 0; return (value >>> 0) / 4294967296; };
}

export function naturalRockGeometry(radius = 1, detail = 3) {
  const geometry = new THREE.IcosahedronGeometry(radius, detail);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const n = 1 + 0.08 * Math.sin(x * 8 + y * 5) * Math.cos(z * 7) + 0.035 * Math.sin(y * 19 + z * 13);
    positions.setXYZ(i, x * n, y * n, z * n);
  }
  geometry.computeVertexNormals();
  return geometry;
}

export function addNaturalMountains(group: THREE.Object3D) {
  const geometry = new THREE.PlaneGeometry(185, 70, 96, 48);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  const colors: number[] = [];
  const low = new THREE.Color(0x4d614d), high = new THREE.Color(0xb3b3a2);
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getZ(i);
    const depth = (z + 35) / 70;
    const rise = Math.sin(Math.min(1, depth) * Math.PI);
    const peaks = 13 + 5 * Math.sin(x * 0.073 + 1.6) + 3.6 * Math.sin(x * 0.18) + 2 * Math.cos(z * 0.14 + x * 0.08);
    const detail = Math.sin(x * 0.53 + z * 0.32) * Math.cos(z * 0.47) * 1.2;
    const height = Math.max(-0.09, rise * peaks + detail * rise - 0.2);
    positions.setY(i, height);
    const color = low.clone().lerp(high, THREE.MathUtils.smoothstep(height, 7, 23));
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const material = photographicSurface("stone", 0xffffff);
  material.vertexColors = true;
  const mountains = new THREE.Mesh(geometry, material);
  mountains.position.z = 90;
  mountains.receiveShadow = true;
  group.add(mountains);
}

/** Small instanced leaves give a natural crown without thousands of separate draw calls. */
export function addNaturalTrees(group: THREE.Object3D, positions: ReadonlyArray<readonly [number, number]>, shadows: boolean) {
  const random = randomSequence(7314);
  const leafCount = 260;
  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, -0.13);
  leafShape.quadraticCurveTo(0.09, -0.03, 0, 0.13);
  leafShape.quadraticCurveTo(-0.09, 0.03, 0, -0.13);
  const leaves = new THREE.InstancedMesh(new THREE.ShapeGeometry(leafShape, 2), new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, roughness: 0.92 }), positions.length * leafCount);
  const bark = new THREE.MeshStandardMaterial({ color: 0x5a5041, roughness: 1 });
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  for (let tree = 0; tree < positions.length; tree++) {
    const [x, z] = positions[tree];
    const height = 3.8 + random() * 2.5;
    const radius = height * 0.29;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.13, height * 0.66, 8), bark);
    trunk.position.set(x, height * 0.33, z);
    trunk.castShadow = shadows;
    group.add(trunk);
    for (let branch = 0; branch < 5; branch++) {
      const angle = branch * 2.4;
      const start = new THREE.Vector3(x, height * (0.32 + branch * 0.065), z);
      const end = new THREE.Vector3(x + Math.cos(angle) * radius * 0.75, height * (0.6 + branch * 0.06), z + Math.sin(angle) * radius * 0.75);
      const direction = end.clone().sub(start);
      const twig = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.045, direction.length(), 5), bark);
      twig.position.copy(start).add(end).multiplyScalar(0.5);
      twig.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
      group.add(twig);
    }
    for (let leaf = 0; leaf < leafCount; leaf++) {
      const angle = random() * Math.PI * 2;
      const vertical = random() * 2 - 1;
      const distance = Math.cbrt(random());
      const ring = Math.sqrt(1 - vertical * vertical) * radius * distance;
      dummy.position.set(x + Math.cos(angle) * ring, height * 0.7 + vertical * radius * 1.3 * distance, z + Math.sin(angle) * ring);
      dummy.rotation.set(random() * Math.PI, random() * Math.PI, random() * Math.PI);
      dummy.scale.setScalar(1.4 + random() * 1.4);
      dummy.updateMatrix();
      leaves.setMatrixAt(tree * leafCount + leaf, dummy.matrix);
      color.setHSL(0.23 + random() * 0.065, 0.22 + random() * 0.23, 0.19 + random() * 0.2);
      leaves.setColorAt(tree * leafCount + leaf, color);
    }
  }
  leaves.castShadow = shadows;
  leaves.receiveShadow = shadows;
  leaves.instanceMatrix.needsUpdate = true;
  if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
  group.add(leaves);
}
