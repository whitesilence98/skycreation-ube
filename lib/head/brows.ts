import * as THREE from 'three';
import { applyFacialWeights, type Rig } from '@/lib/head/rig';

export function createBrowMesh(source: THREE.BufferGeometry, rig: Rig): THREE.SkinnedMesh {
  const geometry = source.clone();
  applyFacialWeights(geometry, rig.skeleton.bones);
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const direction = new THREE.Vector3();
  // ponytail: fitted overlays only; arbitrary sculpt/mesh pairs need surface fitting.
  const clearance = 0.0008; // 0.8 mm outward; weights use the unshifted positions.
  for (let i = 0; i < position.count; i++) {
    direction.fromBufferAttribute(normal, i).normalize().multiplyScalar(clearance);
    position.setXYZ(i, position.getX(i) + direction.x, position.getY(i) + direction.y, position.getZ(i) + direction.z);
  }
  position.needsUpdate = true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  // Reuse the head material until the component assigns its brow/placeholder material.
  const mesh = new THREE.SkinnedMesh(geometry, rig.mesh.material);
  mesh.name = 'Brows';
  mesh.renderOrder = 4;
  mesh.frustumCulled = false;
  // Explicit bind matrix preserves shared rest inverses, even on a late load while posed.
  mesh.bind(rig.skeleton, rig.mesh.bindMatrix);
  return mesh;
}

/** Keep strand alpha; material.color supplies the tint without multiplying dark atlas RGB.
 * A real white-RGB texture also survives GLB export, unlike a viewport-only shader patch. */
export function prepareBrowTexture(texture: THREE.Texture): void {
  const image = texture.image as HTMLImageElement;
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Cannot prepare brow alpha texture');
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255;
  }
  context.putImageData(pixels, 0, 0);
  texture.image = canvas;
  texture.needsUpdate = true;
}
