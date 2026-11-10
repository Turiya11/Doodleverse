import * as THREE from 'three';
import { clamp01, easeInOutCubic } from '../easing.js';

// The world grows out of the canvas: one group holding the sky dome, ground and props is centred on
// the canvas and scaled from a speck to full size, so the sky engulfs the user and the ground lands
// on the real floor at the same moment. A particle burst covers the first instants.
// Everything stays inside the immersive-ar session; the opaque sky simply covers the passthrough.

const DURATION = 2.6;
const SKY_RADIUS = 40;
const START_SCALE = 0.002;
const BURST_COUNT = 400;
const BURST_LIFE = 1.6;
const BURST_COLORS = [0xff758f, 0xffd93d, 0x4ecdc4, 0xffffff, 0xb388ff];

const skyVertex = /* glsl */ `
    varying vec3 vDir;
    void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const skyFragment = /* glsl */ `
    uniform vec3 uTop;
    uniform vec3 uHorizon;
    uniform vec3 uBottom;
    uniform float uOpacity;
    varying vec3 vDir;
    void main() {
        float h = vDir.y;
        vec3 color = h > 0.0 ? mix(uHorizon, uTop, smoothstep(0.0, 0.6, h)) : mix(uHorizon, uBottom, smoothstep(0.0, -0.3, h));
        gl_FragColor = vec4(color, uOpacity);
        #include <colorspace_fragment>
    }
`;

// Deterministic so the island looks the same every time.
function seededRandom(seed) {
    return () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
    };
}

export class Portal {
    constructor() {
        this.world = new THREE.Group();
        this.elapsed = 0;
        this.progress = 0;

        this.skyMaterial = new THREE.ShaderMaterial({
            side: THREE.DoubleSide, // seen from outside while it's a small orb, from inside once it engulfs
            transparent: true,
            depthWrite: false,
            uniforms: {
                uTop: { value: new THREE.Color(0x7ec8ff) },
                uHorizon: { value: new THREE.Color(0xffe0f0) },
                uBottom: { value: new THREE.Color(0xc8f0ff) },
                uOpacity: { value: 0.7 },
            },
            vertexShader: skyVertex,
            fragmentShader: skyFragment,
        });
        this.world.add(new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 48, 24), this.skyMaterial));

        // Props hang off a floor group whose height is set in start() so it lands on the real floor.
        this.floor = new THREE.Group();
        this.world.add(this.floor);
        this.buildIsland();

        const sun = new THREE.DirectionalLight(0xfff4e0, 1.2);
        sun.position.set(5, 10, 3);
        this.world.add(sun);

        this.burst = this.buildBurst();
    }

    buildIsland() {
        const rand = seededRandom(7);
        const ring = (min, max) => {
            const a = rand() * Math.PI * 2;
            const r = min + rand() * (max - min);
            return [Math.cos(a) * r, Math.sin(a) * r];
        };

        const ground = new THREE.Mesh(
            new THREE.CircleGeometry(SKY_RADIUS * 0.75, 64),
            new THREE.MeshStandardMaterial({ color: 0x9be37a, roughness: 1 })
        );
        ground.rotation.x = -Math.PI / 2;
        this.floor.add(ground);

        const hillColors = [0x7fd36b, 0x8ee07a, 0x6cc75d];
        for (let i = 0; i < 9; i++) {
            const [x, z] = ring(10, 24);
            const r = 2 + rand() * 4;
            const hill = new THREE.Mesh(
                new THREE.SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
                new THREE.MeshStandardMaterial({ color: hillColors[i % 3], roughness: 1 })
            );
            hill.scale.y = 0.5;
            hill.position.set(x, 0, z);
            this.floor.add(hill);
        }

        const trunk = new THREE.CylinderGeometry(0.08, 0.12, 1, 8);
        const crown = new THREE.SphereGeometry(0.6, 20, 14);
        const trunkMat = new THREE.MeshStandardMaterial({ color: 0xb07a4f, roughness: 0.9 });
        const crownColors = [0xff9ec4, 0x7fd36b, 0xffd93d];
        for (let i = 0; i < 14; i++) {
            const [x, z] = ring(3.5, 12);
            const tree = new THREE.Group();
            const t = new THREE.Mesh(trunk, trunkMat);
            t.position.y = 0.5;
            const c = new THREE.Mesh(crown, new THREE.MeshStandardMaterial({ color: crownColors[i % 3], roughness: 0.6 }));
            c.position.y = 1.25;
            tree.add(t, c);
            tree.position.set(x, 0, z);
            tree.scale.setScalar(0.8 + rand() * 0.8);
            this.floor.add(tree);
        }

        const puff = new THREE.SphereGeometry(1, 20, 14);
        const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, emissive: 0xffffff, emissiveIntensity: 0.25 });
        this.clouds = [];
        for (let i = 0; i < 10; i++) {
            const [x, z] = ring(6, 18);
            const cloud = new THREE.Group();
            for (let k = 0; k < 4; k++) {
                const p = new THREE.Mesh(puff, cloudMat);
                p.position.set((k - 1.5) * 0.9, (k % 2) * 0.35, rand() * 0.4);
                p.scale.setScalar(0.7 + rand() * 0.5);
                cloud.add(p);
            }
            cloud.position.set(x, 4 + rand() * 4, z);
            cloud.scale.setScalar(0.8 + rand() * 0.8);
            cloud.userData.speed = 0.1 + rand() * 0.15;
            this.floor.add(cloud);
            this.clouds.push(cloud);
        }
    }

    buildBurst() {
        const positions = new Float32Array(BURST_COUNT * 3);
        const colors = new Float32Array(BURST_COUNT * 3);
        const color = new THREE.Color();
        this.velocities = [];
        for (let i = 0; i < BURST_COUNT; i++) {
            color.set(BURST_COLORS[i % BURST_COLORS.length]).toArray(colors, i * 3);
            this.velocities.push(new THREE.Vector3().randomDirection().multiplyScalar(0.6 + Math.random()));
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        // Soft round sparkle instead of the default square point.
        const dot = document.createElement('canvas');
        dot.width = dot.height = 64;
        const ctx = dot.getContext('2d');
        const glow = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        glow.addColorStop(0, 'rgba(255,255,255,1)');
        glow.addColorStop(0.4, 'rgba(255,255,255,0.6)');
        glow.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, 64, 64);

        const points = new THREE.Points(geometry, new THREE.PointsMaterial({
            map: new THREE.CanvasTexture(dot),
            size: 0.02,
            vertexColors: true,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        }));
        points.frustumCulled = false;
        return points;
    }

    // `center` is the canvas centre in world space; `floorY` is the real floor (0 in local-floor space).
    start(scene, center, yaw, floorY = 0) {
        this.world.position.copy(center);
        this.world.rotation.set(0, yaw, 0);
        this.world.scale.setScalar(START_SCALE);
        this.floor.position.y = floorY - center.y;
        this.burst.position.copy(center);
        scene.add(this.world, this.burst);
    }

    update(dt) {
        this.elapsed += dt;
        this.progress = clamp01(this.elapsed / DURATION);
        const s = easeInOutCubic(this.progress);
        this.world.scale.setScalar(THREE.MathUtils.lerp(START_SCALE, 1, s));
        this.skyMaterial.uniforms.uOpacity.value = THREE.MathUtils.lerp(0.7, 1, s);

        for (const cloud of this.clouds) cloud.position.x += cloud.userData.speed * dt;

        if (this.burst.visible) {
            const attr = this.burst.geometry.attributes.position;
            for (let i = 0; i < BURST_COUNT; i++) {
                const v = this.velocities[i];
                v.multiplyScalar(Math.exp(-dt * 1.5));
                v.y -= 0.3 * dt;
                attr.setXYZ(i, attr.getX(i) + v.x * dt, attr.getY(i) + v.y * dt, attr.getZ(i) + v.z * dt);
            }
            attr.needsUpdate = true;
            this.burst.material.opacity = 1 - this.elapsed / BURST_LIFE;
            this.burst.visible = this.elapsed < BURST_LIFE;
        }
        return this.progress;
    }

    dispose() {
        for (const root of [this.world, this.burst]) {
            root.removeFromParent();
            root.traverse((o) => {
                o.geometry?.dispose();
                o.material?.map?.dispose();
                o.material?.dispose();
            });
        }
    }
}
