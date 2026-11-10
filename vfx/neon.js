import * as THREE from 'three';

// Neon ink: a crayon that draws with glowing light.
// Objects that should glow are put on BLOOM_LAYER (as well as the default layer). The desktop preview
// renders that layer through a bloom pass (see Bloom.js); WebXR sessions can't run three.js
// post-processing, so in the headset neon strokes get a soft additive halo instead.

export const NEON_COLOR = 0xbf40ff;
export const BLOOM_LAYER = 5;
const NEON_INTENSITY = 2.5;

export function isNeon(color) {
    return color === NEON_COLOR;
}

export function neonMaterial(color = NEON_COLOR) {
    const material = new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: NEON_INTENSITY, roughness: 0.3, toneMapped: false,
    });
    material.userData.neon = true;
    return material;
}

// Puts every mesh with a neon material (or everything, with `all`) under `root` on the bloom layer.
export function markGlow(root, all = false) {
    root.traverse((o) => {
        if (all || o.material?.userData?.neon) o.layers.enable(BLOOM_LAYER);
    });
}
