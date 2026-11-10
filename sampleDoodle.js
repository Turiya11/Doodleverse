import * as THREE from 'three';

// A little cloud creature in paper-local coordinates (metres, z = 0), used by "Try a sample drawing".

function arc(cx, cy, rx, ry, from, to, steps) {
    return Array.from({ length: steps + 1 }, (_, i) => {
        const a = from + ((to - from) * i) / steps;
        return new THREE.Vector3(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, 0);
    });
}

export function sampleDoodle() {
    // Scalloped outline: |sin(4a)| bulges between inward cusps, which reads as cloud puffs.
    const body = Array.from({ length: 241 }, (_, i) => {
        const a = (i / 240) * Math.PI * 2;
        const r = 1 + 0.13 * Math.abs(Math.sin(a * 4));
        return new THREE.Vector3(Math.cos(a) * 0.065 * r, Math.sin(a) * 0.045 * r, 0);
    });

    return [
        body,
        arc(-0.022, 0.008, 0.006, 0.008, 0, Math.PI * 2, 24),
        arc(0.022, 0.008, 0.006, 0.008, 0, Math.PI * 2, 24),
        arc(0, -0.002, 0.02, 0.016, Math.PI * 1.15, Math.PI * 1.85, 24),
    ];
}
