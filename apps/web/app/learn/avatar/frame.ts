import * as THREE from "three";

/**
 * The space the head takes up, for framing it. A head that is a mesh, or
 * a node with meshes under it, has a size of its own. A head that is a
 * bone has none: its size is the part of the skin that follows it or
 * anything under it (the eyes), measured where that skin rests.
 */
export function headBox(root: THREE.Object3D, head: THREE.Object3D | null): THREE.Box3 {
  const box = new THREE.Box3();
  if (!head) return box.setFromObject(root);
  box.setFromObject(head);
  if (!box.isEmpty()) return box;
  const follows = new Set<THREE.Object3D>();
  head.traverse((o) => void follows.add(o));
  root.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh || !m.skeleton) return;
    const pos = m.geometry.getAttribute("position");
    const index = m.geometry.getAttribute("skinIndex");
    const weight = m.geometry.getAttribute("skinWeight");
    if (!pos || !index || !weight) return;
    const mine = m.skeleton.bones.map((b) => follows.has(b));
    for (let i = 0; i < pos.count; i++) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (mine[index.getComponent(i, k)]) w += weight.getComponent(i, k);
      if (w > 0.5) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld));
    }
  });
  return box.isEmpty() ? box.setFromObject(root) : box;
}
