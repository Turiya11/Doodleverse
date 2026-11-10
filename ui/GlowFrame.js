import * as THREE from 'three';

// Glowing dashed border with corner nodes, drawn in the parent's local XY plane (the canvas surface).
// Dash and glow sizes are in metres so the border is equally thick on the long and short edges, and
// dashes march around the perimeter. Calm while drawing; animated for moments like the portal.

const vertexShader = /* glsl */ `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const fragmentShader = /* glsl */ `
    uniform float uTime;
    uniform vec3 uColor;
    uniform vec2 uSize;     // paper size, metres
    uniform float uPad;     // extra plane around the paper for the outer glow
    uniform float uSpeed;   // dash march speed (0 = static)
    uniform float uOpacity;
    varying vec2 vUv;

    const float LINE = 0.0012;
    const float GLOW = 0.005;
    const float DASH = 0.012;

    void main() {
        vec2 p = vUv * (uSize + 2.0 * uPad) - uPad;   // origin at the paper's bottom-left corner
        vec2 c = p - 0.5 * uSize;
        vec2 q = abs(c) - 0.5 * uSize;
        float dist = abs(length(max(q, 0.0)) + min(max(q.x, q.y), 0.0)); // distance to the paper edge

        // Distance travelled along the perimeter, counter-clockwise from the bottom-left corner.
        float s;
        if (q.x > q.y) s = c.x > 0.0 ? uSize.x + p.y : 2.0 * uSize.x + 2.0 * uSize.y - p.y;
        else           s = c.y < 0.0 ? p.x : 2.0 * uSize.x + uSize.y - p.x;

        float dash = step(0.5, fract(s / DASH - uTime * uSpeed));
        float core = 1.0 - smoothstep(LINE * 0.5, LINE, dist);
        float glow = exp(-dist / GLOW) * 0.45;
        float pulse = 0.85 + 0.15 * sin(uTime * 3.0);

        float alpha = (core + glow) * mix(0.25, 1.0, dash) * pulse * uOpacity;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(mix(uColor, vec3(1.0), core * 0.6), alpha);
        #include <colorspace_fragment>
    }
`;

export class GlowFrame extends THREE.Group {
    constructor(width, height, color = 0x4ecdc4) {
        super();
        const pad = 0.02;

        this.material = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            uniforms: {
                uTime: { value: 0 },
                uColor: { value: new THREE.Color(color) },
                uSize: { value: new THREE.Vector2(width, height) },
                uPad: { value: pad },
                uSpeed: { value: 0 },
                uOpacity: { value: 1 },
            },
            vertexShader,
            fragmentShader,
        });
        const border = new THREE.Mesh(new THREE.PlaneGeometry(width + 2 * pad, height + 2 * pad), this.material);
        border.renderOrder = 2;
        this.add(border);

        const nodeGeometry = new THREE.SphereGeometry(0.004, 16, 12);
        const nodeMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
        this.nodes = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
            const node = new THREE.Mesh(nodeGeometry, nodeMaterial);
            node.position.set((sx * width) / 2, (sy * height) / 2, 0.002);
            this.add(node);
            return node;
        });

        this.setAnimated(false);
    }

    setAnimated(animated) {
        this.material.uniforms.uSpeed.value = animated ? 1.5 : 0;
        this.material.uniforms.uOpacity.value = animated ? 1 : 0.6;
        for (const node of this.nodes) node.visible = animated;
    }

    update(seconds) {
        this.material.uniforms.uTime.value = seconds;
        const s = 1 + 0.25 * Math.sin(seconds * 4);
        for (const node of this.nodes) node.scale.setScalar(s);
    }
}
