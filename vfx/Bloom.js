import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { BLOOM_LAYER } from './neon.js';

// Selective bloom for the desktop preview: only objects on BLOOM_LAYER (neon ink, sparkles) glow.
// 1. Render just the bloom layer (lights live on the default layer, so only emissive and unlit
//    colour shows) and blur it with UnrealBloomPass.
// 2. Render the whole scene normally and add the blurred glow on top.
// WebXR can't use EffectComposer, so the app renders directly while presenting.

const MixShader = {
    uniforms: { baseTexture: { value: null }, bloomTexture: { value: null } },
    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
    fragmentShader: /* glsl */`
        uniform sampler2D baseTexture;
        uniform sampler2D bloomTexture;
        varying vec2 vUv;
        void main() {
            vec4 base = texture2D(baseTexture, vUv);
            vec3 glow = texture2D(bloomTexture, vUv).rgb;
            // Glow over the transparent page background still shows (the canvas is premultiplied).
            gl_FragColor = vec4(base.rgb + glow, max(base.a, max(glow.r, max(glow.g, glow.b))));
        }`,
};

export class BloomRenderer {
    constructor(renderer, scene, camera) {
        this.camera = camera;
        const target = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });

        this.bloomComposer = new EffectComposer(renderer, target());
        this.bloomComposer.renderToScreen = false;
        this.bloomComposer.addPass(new RenderPass(scene, camera));
        this.bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 1.0, 0.2, 0);
        this.bloomComposer.addPass(this.bloomPass);

        this.finalComposer = new EffectComposer(renderer, target());
        this.finalComposer.addPass(new RenderPass(scene, camera));
        const mix = new ShaderPass(new THREE.ShaderMaterial({
            uniforms: {
                baseTexture: { value: null },
                bloomTexture: { value: this.bloomComposer.renderTarget2.texture },
            },
            vertexShader: MixShader.vertexShader,
            fragmentShader: MixShader.fragmentShader,
        }), 'baseTexture');
        mix.needsSwap = true;
        this.finalComposer.addPass(mix);
        this.finalComposer.addPass(new OutputPass());
    }

    setSize(width, height) {
        this.bloomComposer.setSize(width, height);
        this.finalComposer.setSize(width, height);
    }

    render() {
        const mask = this.camera.layers.mask;
        this.camera.layers.set(BLOOM_LAYER);
        this.bloomComposer.render();
        this.camera.layers.mask = mask;
        this.finalComposer.render();
    }
}
