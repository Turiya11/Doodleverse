import * as THREE from 'three';
import { GlowFrame } from './ui/GlowFrame.js';
import { SpatialPanel } from './ui/SpatialPanel.js';
import { GuideHud } from './ui/GuideHud.js';
import { ArtTray, TOOL_TIP } from './ui/ArtTray.js';
import { sampleDoodle } from './sampleDoodle.js';
import { buildCharacter, disposeCharacter } from './awakening/buildCharacter.js';
import { CharacterBody } from './awakening/CharacterBody.js';
import { CatchBall, BALL_RADIUS } from './play/CatchBall.js';
import { Portal } from './portal/Portal.js';
import { clamp01, easeInOutCubic, easeOutBack } from './easing.js';
import { Sparkles } from './vfx/Sparkles.js';
import { BloomRenderer } from './vfx/Bloom.js';
import { isNeon, neonMaterial, markGlow, BLOOM_LAYER } from './vfx/neon.js';
import { Sfx } from './audio/Sfx.js';

// All distances are in metres.
const CANVAS_W = 0.8;
const CANVAS_H = 0.5;
const CANVAS_TILT = Math.PI / 6;    // leaned back like an easel
const CANVAS_DISTANCE = 0.5;        // in front of the user's head when the session starts...
const CANVAS_DROP = 0.3;            // ...and this far below eye level
const PREVIEW_CANVAS_POS = new THREE.Vector3(0, 1.2, -0.6);
const PREVIEW_LOOK_STUDIO = new THREE.Vector3(0, 1.12, -0.6);
const PREVIEW_LOOK_WORLD = new THREE.Vector3(0.15, 0.6, -0.9);

const TOUCH_ENTER = 0.01;           // fingertip within 1cm of the canvas starts ink
const TOUCH_EXIT = 0.015;           // hysteresis so jitter around 1cm doesn't split strokes
const BEHIND_LIMIT = -0.05;         // a virtual canvas has no resistance; allow some push-through, then stop
const ARM_HEIGHT = 0.03;            // a finger must approach from at least 3cm in front before it can ink
const HOVER_RANGE = 0.1;            // show the aiming ring when the fingertip is this close
const MIN_POINT_GAP = 0.002;        // 2mm between recorded samples
const HAND_SMOOTHING = 0.5;         // low-pass on the raw fingertip (1 = raw, lower = smoother but laggier)

const MAX_PREVIEW_POINTS = 4096;
const INK_RADIUS = 0.003;           // puffy-paint thickness
const ERASE_RADIUS = 0.015;

// Awakening timeline, in seconds from the wand tap.
const POP_TIME = 0.7;               // the drawing puffs up out of the canvas
const LIFT_TIME = 1.3;              // then steps forward and stands upright
const LIFT_DISTANCE = 0.15;
const PORTAL_AT = 3.2;              // then the world opens
const HIDE_STUDIO_AT = 0.35;        // portal progress at which the sky has engulfed the user
const FRAME_BURST_TIME = 0.6;       // the canvas frame flares outward as the portal starts

const PINCH_ENTER = 0.02;           // thumb-tip to index-tip joint centres
const PINCH_EXIT = 0.035;
const GRAB_MARGIN = 0.06;           // pinches this far outside the character's bounds still grab it
const FLOOR_Y = 0;                  // local-floor reference space: y = 0 is the real floor
const FLICK_SPEED = 1.5;            // hands moving up faster than this (m/s) while holding = jump
const JUMP_SPEED = 4;
const GRAB_COOLDOWN = 0.6;
const LOOK_RANGE = 0.6;             // the character watches a hand that comes this close, else your head

const HOW_TO_PLAY = [
    '1. Pick up the ball: pinch it',
    '2. Throw it anywhere: it fetches it!',
    '3. Catch it: bring both hands together',
    'Missed it? It hops back into the basket',
    'Tidy up: let go over the glowing basket',
    'Carry your friend: pinch with both hands',
    'Make it jump: flick your hands up',
    'Walk around: explore your room safely',
    'Exit: point at the red diamond and pinch',
];

const BALL_GRAB_REACH = 0.12;       // pinch this close to the ball (centre) to grab it
const BALL_BASKET_REACH = 0.15;     // a little more forgiving while it sits in the basket
const CATCH_REACH = 0.05;           // the ball this close to the character's surface gets caught
const THROW_BACK_DELAY = 1;
const THROW_BACK_SPEED = 3;         // m/s, used to pick the flight time
const CATCH_HOLD_Z = 0.09;          // where the character holds a caught ball, in front of its face
const CATCH_COOLDOWN = 0.5;         // so it doesn't instantly catch its own throw
const CUP_GAP = 0.3;                // palms closer than this count as "hands together" for a catch
const CUP_REACH = 0.25;             // ...and the ball must come this close to between them
const CUP_RELEASE_GAP = 0.4;        // moving the palms this far apart drops a cupped ball
const CUP_LIFT = 0.04;              // the ball rests a little above the palms
const EXIT_HIT_RADIUS = 0.12;
const BALL_HINT_HEIGHT = 0.5;       // the live hint sign floats this high over the basket
const EXIT_CONFIRM_TIME = 3;        // seconds the board's Exit button waits for the confirming tap

const HANDLE_LOCAL = new THREE.Vector3(0, -CANVAS_H / 2 - 0.15, 0.1); // the board's carry handle, canvas-local
const HANDLE_REACH = 0.08;          // pinch this close to the handle to grab the board
const BOARD_FOLLOW = 12;            // how snappily a carried board follows the hand
const MIN_BOARD_HEIGHT = 0.5;       // a carried board stays at least this high above the floor
const WAND_REACH = 0.07;            // pinch this close to the wand to pick it up
const TOOL_REACH = 0.06;            // ...or this close to a crayon or the eraser
const POINT_MIN_DISTANCE = 0.2;     // point-and-pinch works from at least this far; closer, you touch or pinch
const WELCOME_TIME = 6;             // seconds the guide shows its welcome after entering
const OUT_OF_VIEW_ANGLE = 0.7;      // ~40° off the gaze counts as out of view
const RETURN_AFTER = 4;             // seconds the character may be out of view before it hops back
const RETURN_DISTANCE = 1;          // ...to a spot this far in front of the user
const RETURN_CLOSE = 0.4;
const SWIRL_WINDOW = 1.2;           // seconds of wand motion considered...
const SWIRL_PATH = 0.6;             // ...it must travel this far (metres) in that time...
const SWIRL_MAX_DRIFT = 0.2;        // ...while ending up roughly where it started (a circle, not a swipe)...
const SWIRL_MIN_SIZE = 0.08;        // ...and the circle must be at least this big, not jitter

const HOW_TO_DRAW = [
    'Draw: touch the board with a finger',
    'Hold a crayon: pinch it, draw with its tip',
    'Erase: pinch the eraser, rub a line',
    'Far away? Point at it and pinch',
    'Move the board: pinch the grey handle',
    'Bring it to life: pinch the wand',
    '...and wave it in a circle!',
    '(or tap the green Done button)',
    'Exit: tap the red Exit button twice',
];
const TRAIL_COLORS = [0xffd93d, 0xffffff, 0xff8fd8, 0x7fe9ff];
const BURST_COUNT = 320;            // sparkles in the awakening explosion
const BABBLE_MIN = 2.5;             // seconds between the character's little babbles...
const BABBLE_MAX = 6.5;
const BOING_MIN_SPEED = 0.6;        // ...and the slowest floor impact that still goes "boing"
const EXIT_RISE = 0.55;             // exit diamond height above the canvas centre
const EXIT_BACK = 0.4;              // ...and how far beyond it

const _world = new THREE.Vector3();
const _local = new THREE.Vector3();
const _ink = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _quat2 = new THREE.Quaternion();
const _thumb = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _center = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _look = new THREE.Vector3();
const _guideTarget = new THREE.Vector3();
const _head = new THREE.Vector3();
const _gaze = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _front = new THREE.Vector3();
const _zero = new THREE.Vector3();
const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _tip = new THREE.Vector3();

class Doodleverse {
    constructor() {
        this.appState = 'DRAWING'; // DRAWING -> AWAKENING -> PORTAL -> WORLD
        this.stateTime = 0;
        this.strokes = [];      // every finished stroke, canvas-local: { points, color, curve, object }
        this.character = null;
        this.portal = null;
        this.grab = null;       // { by: 'hands' | 'pointer', offset, ... } while the character is held
        this.hands = [];
        this.inkMaterials = new Map();
        this.handTracking = true;
        this.canvasPlaced = false;
        this.tool = 'crayon';
        this.activeColor = null;
        // The desktop mouse behaves like one more "finger" so drawing can be tested without a headset.
        this.pointer = { stroke: null, armed: true, smoothed: new THREE.Vector3(), smoothing: 1 };

        this.init();
    }

    init() {
        this.scene = new THREE.Scene();
        // Far plane must contain the portal's sky dome (in XR this also sets the session's depthFar).
        this.camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.01, 100);
        this.fitPreviewCamera();
        this.camera.position.set(0, 1.5, 0.2);
        this.previewLook = PREVIEW_LOOK_STUDIO.clone();
        this.camera.lookAt(this.previewLook);
        this.clock = new THREE.Clock();

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setPixelRatio(devicePixelRatio);
        this.renderer.setSize(innerWidth, innerHeight);
        this.renderer.xr.enabled = true;
        this.renderer.xr.setReferenceSpaceType('local-floor');
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        document.body.appendChild(this.renderer.domElement);

        this.renderer.xr.addEventListener('sessionstart', () => this.onSessionStart());
        this.renderer.xr.addEventListener('sessionend', () => this.onSessionEnd());

        this.scene.add(new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1.5));

        // Magic: a sparkle trail behind the waving wand and a burst when the drawing comes alive,
        // spatial sound effects, and bloom for neon ink in the desktop preview.
        this.sfx = new Sfx(this.camera);
        this.trail = new Sparkles({ capacity: 500, size: 0.014 });
        this.burst = new Sparkles({ capacity: 700, size: 0.022 });
        this.burst.layers.disable(BLOOM_LAYER); // hundreds of overlapping sparkles are bright enough unbloomed
        this.scene.add(this.trail, this.burst);
        this.bloom = new BloomRenderer(this.renderer, this.scene, this.camera);
        this.bloom.setSize(innerWidth, innerHeight);
        this.trailAcc = 0;
        this.wandSpeed = 0;
        this.babbleTimer = 0;
        // In the headset (no bloom), neon strokes get a soft additive halo instead.
        this.neonHalo = new THREE.MeshBasicMaterial({
            color: 0xbf40ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false,
        });

        this.buildStudio();
        this.setupHands();
        this.setupControllers();
        this.guide = new GuideHud();
        this.scene.add(this.guide);
        this.sessionTime = 0;
        this.charOutTime = 0;
        this.returning = false;     // the character is hopping back into the user's view
        this.setupPointer();
        this.setupLanding();

        this.selectItem(this.tray.items[0]);

        this.renderer.setAnimationLoop(this.render.bind(this));
        window.addEventListener('resize', this.onWindowResize.bind(this));
    }

    buildStudio() {
        // Canvas-local axes: X/Y span the drawing surface, +Z points out toward the user.
        this.canvasGroup = new THREE.Group();
        this.scene.add(this.canvasGroup);
        this.placeCanvas(PREVIEW_CANVAS_POS, 0);

        this.canvasMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(CANVAS_W, CANVAS_H),
            new THREE.MeshStandardMaterial({ color: 0xfffdf8, roughness: 0.85 })
        );
        this.canvasMesh.receiveShadow = true;
        this.canvasGroup.add(this.canvasMesh);

        // Thin backing so the board reads as a solid object from the side.
        const backing = new THREE.Mesh(
            new THREE.BoxGeometry(CANVAS_W + 0.02, CANVAS_H + 0.02, 0.012),
            new THREE.MeshStandardMaterial({ color: 0xf2e6d9, roughness: 0.7 })
        );
        backing.position.z = -0.0065;
        this.canvasGroup.add(backing);

        this.frame = new GlowFrame(CANVAS_W, CANVAS_H);
        this.frame.position.z = 0.0005;
        this.canvasGroup.add(this.frame);

        // Ink casts soft shadows onto the canvas, which sells its puffy thickness.
        const sun = new THREE.DirectionalLight(0xffffff, 1.2);
        sun.position.set(0.2, 0.4, 0.8);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        sun.shadow.bias = -0.0005;
        Object.assign(sun.shadow.camera, { left: -0.5, right: 0.5, top: 0.5, bottom: -0.5, near: 0.1, far: 2 });
        this.canvasGroup.add(sun, sun.target);

        // Art tray just below the bottom edge, levelled out against the canvas tilt.
        this.tray = new ArtTray();
        this.tray.position.set(0, -CANVAS_H / 2 - 0.06, 0.06);
        this.tray.rotation.x = CANVAS_TILT;
        this.canvasGroup.add(this.tray);

        // Grey handle under the tray: pinch it and move your hand to carry the whole board, which
        // turns to keep facing you.
        this.handleMaterial = new THREE.MeshStandardMaterial({ color: 0x8a8f98, roughness: 0.3, emissive: 0x4ecdc4, emissiveIntensity: 0 });
        this.canvasHandle = new THREE.Mesh(new THREE.CapsuleGeometry(0.016, 0.22, 4, 16), this.handleMaterial);
        this.canvasHandle.rotation.z = Math.PI / 2;
        this.canvasHandle.position.copy(HANDLE_LOCAL);
        this.canvasHandle.castShadow = true;
        this.canvasGroup.add(this.canvasHandle);
        this.canvasDrag = null;     // { by: hand state | 'pointer' } while the board is being carried
        this.wandHold = null;       // { by, samples } while the wand is held
        this.toolHold = null;       // { by, item } while a crayon or the eraser is held

        // In-headset "How to Draw" card to the left of the board, shown while drawing.
        this.drawGuide = new SpatialPanel({ width: 0.3, height: 0.3, radius: 0.02 });
        this.drawGuide.setText('How to Draw', HOW_TO_DRAW);
        this.drawGuide.position.set(-CANVAS_W / 2 - 0.17, 0.02, 0.04);
        this.drawGuide.rotation.y = 0.4;
        this.canvasGroup.add(this.drawGuide);

        this.panel = new SpatialPanel();
        this.panel.position.set(0, CANVAS_H / 2 + 0.06, 0.01);
        this.canvasGroup.add(this.panel);

        // Exit button at the board's top-right corner, clear of the drawing area. The first poke asks
        // "Tap again to exit"; a second poke within a few seconds leaves the Doodleverse.
        this.exitBtn = new SpatialPanel({ width: 0.13, height: 0.045, fill: 'rgba(214, 40, 70, 0.92)', accent: '#ffffff' });
        this.exitBtn.position.set(CANVAS_W / 2 - 0.075, CANVAS_H / 2 + 0.06, 0.01);
        this.canvasGroup.add(this.exitBtn);
        this.exitArmed = 0;
        this.exitBtn.setText('Exit');

        // In-headset "How to Play" card and "Back to Drawing" button, shown once the character wakes.
        // They live in the scene, not on the canvas, so they stay after the portal hides the studio.
        this.playGuide = new THREE.Group();
        this.playGuide.visible = false;
        const howTo = new SpatialPanel({ width: 0.32, height: 0.32, radius: 0.02 });
        howTo.setText('How to Play', HOW_TO_PLAY);
        this.drawAgainBtn = new SpatialPanel({ width: 0.17, height: 0.05 });
        this.drawAgainBtn.setText('Back to Drawing');
        this.drawAgainBtn.position.y = -0.2;
        this.playGuide.add(howTo, this.drawAgainBtn);
        this.scene.add(this.playGuide);

        // Ball and basket for playing catch; they appear on the floor when the portal opens.
        this.ball = new CatchBall();
        this.scene.add(this.ball.group);
        this.ballHint = new SpatialPanel();
        this.ball.group.add(this.ballHint); // shown and hidden with the ball and basket
        this.ballHand = null;       // the hand currently holding the ball
        this.ballSound = this.sfx.attach(this.ball.ball, { refDistance: 0.6 });
        this.ball.onBounce = (speed) => {
            if (speed < BOING_MIN_SPEED) return;
            this.sfx.play(this.ballSound, this.sfx.buffers.boing, {
                volume: THREE.MathUtils.clamp(speed / 4, 0.25, 1), rate: 0.9 + Math.random() * 0.25,
            });
        };
        this.catchTimer = 0;
        this.catchCooldown = 0;

        // Red exit diamond: point at it and do the system pinch (WebXR "select") to go back to drawing.
        this.exitDiamond = new THREE.Group();
        this.exitDiamond.visible = false;
        this.exitGem = new THREE.Mesh(
            new THREE.OctahedronGeometry(0.06),
            new THREE.MeshStandardMaterial({ color: 0xff2244, emissive: 0xff2244, emissiveIntensity: 0.5, roughness: 0.3, flatShading: true })
        );
        // A bigger invisible target than the gem, so a child's wobbly pointing still hits it.
        this.exitHit = new THREE.Mesh(new THREE.SphereGeometry(EXIT_HIT_RADIUS, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
        const exitLabel = new SpatialPanel({ width: 0.2, height: 0.045 });
        exitLabel.setText('Point & pinch to exit');
        exitLabel.position.y = -0.11;
        this.exitDiamond.add(this.exitGem, this.exitHit, exitLabel);
        this.scene.add(this.exitDiamond);
    }

    pressExit() {
        if (this.exitArmed <= 0) {
            this.exitArmed = EXIT_CONFIRM_TIME;
            this.exitBtn.setText('Tap again to exit');
            return;
        }
        this.exitArmed = 0;
        this.exitBtn.setText('Exit');
        // In the headset, ending the session lands back on the start screen (see onSessionEnd).
        const session = this.renderer.xr.getSession();
        if (session) session.end();
        else this.showLanding(true);
    }

    updateExitButton(dt) {
        if (this.exitArmed <= 0) return;
        this.exitArmed -= dt;
        if (this.exitArmed <= 0) this.exitBtn.setText('Exit');
    }

    // Carry the board so its handle follows `p`, turning it to keep facing `headPos`.
    dragBoardTo(p, headPos, dt) {
        const k = 1 - Math.exp(-dt * BOARD_FOLLOW);
        const targetYaw = Math.atan2(headPos.x - p.x, headPos.z - p.z);
        const turn = Math.atan2(Math.sin(targetYaw - this.canvasYaw), Math.cos(targetYaw - this.canvasYaw));
        const yaw = this.canvasYaw + turn * k;
        _quat.setFromEuler(new THREE.Euler(-CANVAS_TILT, yaw, 0, 'YXZ'));
        const center = _center.copy(HANDLE_LOCAL).applyQuaternion(_quat).negate().add(p);
        center.y = Math.max(center.y, FLOOR_Y + MIN_BOARD_HEIGHT);
        this.placeCanvas(_look.copy(this.canvasGroup.position).lerp(center, k), yaw);
    }

    get wandItem() {
        return this.tray.items.find((item) => item.tool === 'wand');
    }

    startWand(by) {
        this.wandItem.held = true;
        this.wandHold = { by, samples: [] };
        this.wandSpeed = 0;
        // A shimmering loop that swells and pitches up the faster the wand swirls (see moveWand).
        this.wandSound ??= this.sfx.attach(this.wandItem.object, { refDistance: 0.4, loop: true });
        this.sfx.play(this.wandSound, this.sfx.buffers.shimmer, { volume: 0, rate: 0.8 });
        this.panel.setText('Wave it in a circle!', 'Keep going to bring your drawing to life');
    }

    // Move the held wand and watch for a circling wave: enough distance travelled in the last moment
    // while staying in roughly the same place. The star glows and spins faster as it charges up.
    moveWand(p) {
        const wand = this.wandItem;
        wand.object.position.copy(this.tray.worldToLocal(_tip.copy(p)));

        const now = performance.now() / 1000;
        const samples = this.wandHold.samples;
        samples.push({ p: p.clone(), t: now });
        while (now - samples[0].t > SWIRL_WINDOW) samples.shift();

        let path = 0;
        _box.makeEmpty();
        samples.forEach((s, i) => {
            _box.expandByPoint(s.p);
            if (i) path += s.p.distanceTo(samples[i - 1].p);
        });
        const size = _box.getSize(_size).length();
        const drift = samples[0].p.distanceTo(samples[samples.length - 1].p);

        wand.charge = clamp01(path / SWIRL_PATH);
        wand.star.material.emissiveIntensity = 0.5 + wand.charge * 2;

        // How fast the tip is moving right now (smoothed), for the sound and the sparkle trail.
        const last = samples[samples.length - 2];
        const step = last ? now - last.t : 0;
        if (step > 0) {
            const speed = p.distanceTo(last.p) / step;
            this.wandSpeed += (Math.min(speed, 4) - this.wandSpeed) * Math.min(step * 8, 1);
            if (this.wandSound?.isPlaying) {
                this.wandSound.setVolume(clamp01(this.wandSpeed / 1.2) * 0.9);
                this.wandSound.setPlaybackRate(0.8 + Math.min(this.wandSpeed, 2.5) * 0.55);
            }
            this.emitTrail(step);
        }

        if (path > SWIRL_PATH && drift < SWIRL_MAX_DRIFT && size > SWIRL_MIN_SIZE) {
            this.dropWand();
            if (this.strokes.length) this.triggerAwakening();
            else this.panel.setText('Draw something first!', 'Then wave the wand again');
        }
    }

    // The closest crayon or eraser within reach of a pinch, if any.
    nearestTool(p) {
        let best = null;
        let bestDist = TOOL_REACH;
        for (const item of this.tray.items) {
            if ((item.tool !== 'crayon' && item.tool !== 'eraser') || item.held) continue;
            const d = item.object.getWorldPosition(_tip).distanceTo(p);
            if (d < bestDist) {
                bestDist = d;
                best = item;
            }
        }
        return best;
    }

    startTool(s, item) {
        this.selectItem(item); // its colour (or the eraser) becomes the active tool
        item.held = true;
        // Ready to draw straight away: a crayon lifted off the tray starts close to the board and
        // shouldn't need pulling back first. (Pushing right through the board still disarms it.)
        s.armed = true;
        this.toolHold = { by: s, item };
        if (item.tool === 'eraser') this.panel.setText('Holding the eraser', 'Rub it on a line to erase it');
        else this.panel.setText(`Holding the ${item.name} crayon`, 'Touch its tip to the board to draw');
    }

    // Place the held tool at the pinch, tilted so its tip points into the board, and return where the
    // tip is in canvas space.
    moveHeldTool(p) {
        const { item } = this.toolHold;
        const obj = item.object;
        obj.position.copy(this.tray.worldToLocal(_tip.copy(p)));
        obj.quaternion.copy(this.tray.getWorldQuaternion(_quat).invert()).multiply(this.canvasGroup.getWorldQuaternion(_quat2));
        obj.updateMatrixWorld(true);
        obj.localToWorld(_tip.set(0, 0, -TOOL_TIP[item.tool]));
        return this.canvasGroup.worldToLocal(_local.copy(_tip));
    }

    dropTool() {
        const { by, item } = this.toolHold;
        item.held = false; // floats back to its slot; it stays the selected tool
        this.endStroke(by);
        this.toolHold = null;
        if (this.appState === 'DRAWING') this.updateHud();
    }

    dropWand() {
        this.sfx.stop(this.wandSound);
        const wand = this.wandItem;
        wand.held = false; // the tray floats it back to its slot
        wand.charge = 0;
        wand.star.material.emissiveIntensity = 0.5;
        this.wandHold = null;
        if (this.appState === 'DRAWING') this.updateHud();
    }

    // Glowing stars streaming off the wand's tip, more of them the faster it moves.
    emitTrail(dt) {
        const star = this.wandItem.star;
        star.updateMatrixWorld(true);
        star.getWorldPosition(_tip);
        this.trailAcc += dt * (12 + this.wandSpeed * 110);
        for (; this.trailAcc >= 1; this.trailAcc--) {
            _dir.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).multiplyScalar(0.12);
            _front.copy(_tip).addScaledVector(_dir, 0.15);
            this.trail.emit(_front, _dir, TRAIL_COLORS[Math.floor(Math.random() * TRAIL_COLORS.length)],
                0.5 + Math.random() * 0.6, { drag: 1.5, gravity: 0.15 });
        }
    }

    // A burst of sparkles in the drawing's colours, flying out of the canvas as the drawing puffs up,
    // which hides the instant the flat ink is swapped for the extruded character.
    emitBurst(center, radius) {
        const colors = [...new Set(this.strokes.map((s) => s.color)), 0xffffff, 0xffd93d];
        for (let i = 0; i < BURST_COUNT; i++) {
            const a = Math.random() * Math.PI * 2;
            const spread = Math.random();
            // Start spread over the drawing rather than from one point, so they don't pile into a blob.
            _front.set(Math.cos(a), Math.sin(a), 0).multiplyScalar(radius * Math.sqrt(Math.random()))
                .applyQuaternion(this.canvasGroup.quaternion).add(center);
            // Canvas-local: out across the board and forward toward the user, then into world space.
            _dir.set(Math.cos(a) * spread, Math.sin(a) * spread, 0.25 + Math.random() * 0.8).normalize()
                .multiplyScalar(0.5 + Math.random() * 1.4)
                .applyQuaternion(this.canvasGroup.quaternion);
            this.burst.emit(_front, _dir, colors[Math.floor(Math.random() * colors.length)],
                0.9 + Math.random() * 1.1, { drag: 1.8, gravity: 0.5 });
        }
    }

    placeExitDiamond() {
        // Above the canvas and a little beyond it, comfortably in view without being in the way.
        const yaw = this.canvasYaw;
        this.exitDiamond.position.copy(this.canvasGroup.position);
        this.exitDiamond.position.x -= Math.sin(yaw) * EXIT_BACK;
        this.exitDiamond.position.z -= Math.cos(yaw) * EXIT_BACK;
        this.exitDiamond.position.y += EXIT_RISE;
        this.exitDiamond.rotation.set(0, yaw, 0);
        this.exitBaseY = this.exitDiamond.position.y;
        this.exitDiamond.visible = true;
    }

    setupControllers() {
        // With hand tracking, a controller's target ray follows where the hand points, and "select"
        // fires on the system pinch. Controllers work the same way with the trigger.
        this.raycaster = new THREE.Raycaster();
        this.controllers = [0, 1].map((i) => {
            const controller = this.renderer.xr.getController(i);
            controller.addEventListener('select', () => this.onPointSelect(controller));

            // A pointer ray that appears only while it's aimed at something usable, ending in a dot.
            const ray = new THREE.Line(
                new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
                new THREE.LineBasicMaterial({ color: 0xffd93d, transparent: true, opacity: 0.8 })
            );
            const dot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffd93d }));
            ray.visible = dot.visible = false;
            controller.add(ray);
            this.scene.add(dot);
            controller.userData.ray = ray;
            controller.userData.dot = dot;

            this.scene.add(controller);
            return controller;
        });
    }

    aimRay(controller) {
        this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
        this.raycaster.ray.direction.set(0, 0, -1).transformDirection(controller.matrixWorld);
    }

    // What a hand (or controller) is pointing at from a distance: { kind, item?, point, distance } or null.
    pointedThing(controller) {
        if (!controller.visible) return null;
        this.aimRay(controller);
        const targets = [];
        if (this.appState === 'DRAWING') targets.push(['tray', this.tray], ['exitBtn', this.exitBtn], ['handle', this.canvasHandle]);
        if (this.playGuide.visible) targets.push(['drawAgain', this.drawAgainBtn]);
        if (this.exitDiamond.visible) targets.push(['diamond', this.exitHit]);
        let best = null;
        for (const [kind, object] of targets) {
            const hit = this.raycaster.intersectObject(object, true)[0];
            if (hit && (!best || hit.distance < best.distance)) {
                best = { kind, item: hit.object.userData.trayItem, point: hit.point, distance: hit.distance };
            }
        }
        if (best?.kind === 'tray' && !best.item) return null; // the tray board itself, not an item
        return best;
    }

    // Point at something and do the system pinch: choose a crayon or the eraser, tap the green Done
    // button, press Exit or Back to Drawing, or leave via the red diamond, all from a distance.
    onPointSelect(controller) {
        // The system "select" fires when a pinch is released, including a pinch that just carried a
        // crayon, the ball or the character; that one mustn't also press whatever the ray crosses.
        const hand = this.hands[this.controllers.indexOf(controller)]?.userData;
        if (hand?.pinchUsed) {
            hand.pinchUsed = false;
            return;
        }
        const thing = this.pointedThing(controller);
        if (!thing || thing.distance < POINT_MIN_DISTANCE) return; // up close, poking and pinching handle it
        if (thing.kind === 'diamond' || thing.kind === 'drawAgain') this.backToDrawing();
        else if (thing.kind === 'exitBtn') this.pressExit();
        else if (thing.kind === 'handle') this.panel.setText('Pinch the handle up close', 'Then move your hand to carry the board');
        else if (thing.kind === 'tray') this.selectItem(thing.item);
    }

    // Show each pointer ray only while it's aimed at something it can use (and not right up close).
    updatePointers() {
        for (const controller of this.controllers) {
            const { ray, dot } = controller.userData;
            const thing = this.renderer.xr.isPresenting ? this.pointedThing(controller) : null;
            const show = !!thing && thing.distance >= POINT_MIN_DISTANCE;
            ray.visible = dot.visible = show;
            if (!show) continue;
            ray.scale.set(1, 1, thing.distance);
            dot.position.copy(thing.point);
        }
    }

    pointingAtExit(controller) {
        if (!this.exitDiamond.visible || !controller.visible) return false;
        this.aimRay(controller);
        return this.raycaster.intersectObject(this.exitHit).length > 0;
    }

    updateExitDiamond(dt, time) {
        if (!this.exitDiamond.visible) return;
        const hovered = this.renderer.xr.isPresenting && this.controllers.some((c) => this.pointingAtExit(c));
        const k = 1 - Math.exp(-dt * 10);
        this.exitGem.scale.setScalar(THREE.MathUtils.lerp(this.exitGem.scale.x, hovered ? 1.35 : 1, k));
        const m = this.exitGem.material;
        m.emissiveIntensity = THREE.MathUtils.lerp(m.emissiveIntensity, hovered ? 1.3 : 0.5, k);
        this.exitGem.rotation.y += dt * 1.2;
        this.exitDiamond.position.y = this.exitBaseY + Math.sin(time * 2) * 0.03;
    }

    placeBasket() {
        // On the floor beside the canvas, to the user's right.
        const yaw = this.canvasYaw;
        const pos = this.canvasGroup.position.clone();
        pos.x += Math.cos(yaw) * 0.5 + Math.sin(yaw) * 0.1;
        pos.z += -Math.sin(yaw) * 0.5 + Math.cos(yaw) * 0.1;
        pos.y = FLOOR_Y;
        this.ball.place(pos);
    }

    // Two-hand catch: bring both palms together where a flying ball is arriving and it settles between
    // them. Pinch it to pick it up properly; move the hands apart and it drops.
    updateCup(dt) {
        const ball = this.ball;
        const [a, b] = this.hands.map((h) => h.userData);
        const tracked = a.palmVisible && b.palmVisible;
        if (tracked) _mid.addVectors(a.palm, b.palm).multiplyScalar(0.5).y += CUP_LIFT;
        const gap = tracked ? a.palm.distanceTo(b.palm) : Infinity;

        if (ball.state === 'cupped') {
            if (gap > CUP_RELEASE_GAP) ball.release();
            else ball.cradle(_mid, dt);
        } else if (ball.state === 'flying' && !this.ballHand && !this.grab && gap < CUP_GAP
            && _mid.distanceTo(ball.position) < CUP_REACH) {
            ball.cradle(_mid, dt);
        }
    }

    // Playing catch: one hand pinches the ball to pick it up and opens to throw it. If it reaches the
    // character, it's caught, held for a moment, then lobbed back to land just in front of the user.
    updateCatch(dt, cam) {
        const ball = this.ball;
        const c = this.character;

        if (this.renderer.xr.isPresenting) {
            for (const hand of this.hands) {
                const s = hand.userData;
                const started = s.pinching && !s.wasPinching;
                s.wasPinching = s.pinching;
                if (this.ballHand === s) {
                    if (s.pinching) ball.hold(s.pinchPoint, dt);
                    else {
                        ball.release();
                        this.ballHand = null;
                    }
                } else if (started && !this.ballHand && this.grab?.by !== 'hands' && ball.state !== 'caught') {
                    const easy = ball.state === 'basket' || ball.state === 'cupped';
                    if (s.pinchPoint.distanceTo(ball.position) < (easy ? BALL_BASKET_REACH : BALL_GRAB_REACH)) {
                        this.ballHand = s;
                        s.pinchUsed = true;
                        ball.hold(s.pinchPoint, 0);
                    }
                }
            }
            this.updateCup(dt);
        }

        ball.update(dt, FLOOR_Y, _camPos);
        ball.setRimGlow(ball.state === 'held' && ball.overBasket, dt);

        // The character can't catch while it's being carried.
        const carried = this.grab && (this.grab.by === 'hands' || this.grab.target === c.body);

        // Fetch: whenever the user throws the ball, the character goes after it, in the air or on the
        // floor. A missed throw-back goes home to the basket instead, and a ball the user drops into
        // the basket is left alone.
        const loose = (ball.state === 'flying' || ball.state === 'resting') && ball.thrownBy === 'user';
        if (loose && !carried && this.canGrab()) {
            if (!c.body) this.ensureBody().state = 'flying'; // drop out of the float and onto the floor
            c.body.chase(ball.position, ball.velocity);
        } else if (c.body) {
            c.body.chasing = false;
        }
        if (this.catchCooldown > 0) this.catchCooldown -= dt;
        else if (loose && !carried) {
            c.pivot.getWorldPosition(_center);
            const reach = c.grabRadius - GRAB_MARGIN + BALL_RADIUS + CATCH_REACH;
            if (_center.distanceTo(ball.position) < reach) {
                ball.state = 'caught';
                this.catchTimer = THROW_BACK_DELAY;
                this.sfx.play(c.popSound, this.sfx.buffers.pop, { volume: 0.9, rate: 0.95 + Math.random() * 0.15 });
                if (c.body) c.body.squash = 0.2;
            }
        }

        if (ball.state === 'caught') {
            c.pivot.localToWorld(ball.position.set(0, 0, CATCH_HOLD_Z));
            this.catchTimer -= dt;
            if (this.catchTimer <= 0) {
                // Aim at chest height a little in front of the user, an easy catch.
                cam.getWorldDirection(_forward);
                _forward.y = 0;
                if (_forward.lengthSq() < 1e-4) _forward.set(0, 0, -1);
                _forward.normalize();
                const target = _tip.copy(_camPos).addScaledVector(_forward, 0.35);
                target.y -= 0.25;
                const time = THREE.MathUtils.clamp(ball.position.distanceTo(target) / THROW_BACK_SPEED, 0.5, 1.2);
                ball.throwTo(target, time);
                if (c.body) c.body.squash = 0.25;
                this.catchCooldown = CATCH_COOLDOWN;
            }
        }

        this.updateBallHint();
    }

    // A live "what to do now" sign floating over the basket, always turned toward the user.
    updateBallHint() {
        const hint = this.ballHint;
        hint.position.copy(this.ball.basket.position).y += BALL_HINT_HEIGHT;
        hint.rotation.set(0, Math.atan2(_camPos.x - hint.position.x, _camPos.z - hint.position.z), 0);
        hint.setText(...this.ballHintText());
    }

    ballHintText() {
        const ball = this.ball;
        const xr = this.renderer.xr.isPresenting;
        const grab = xr ? 'Pinch it' : 'Drag it with the mouse';
        const twoHands = xr ? 'Bring both hands together' : 'Click the ball as it flies';
        switch (ball.state) {
            case 'basket': return ['Pick up the ball', `${grab} to lift it out`];
            case 'held': return ball.overBasket
                ? ['Let go to drop it in', 'The basket is glowing!']
                : ['Throw it anywhere!', xr ? 'Let go while moving your hand' : 'Let go while moving the mouse'];
            case 'cupped': return ['Nice catch!', `${grab} to throw again`];
            case 'caught': return ['Get ready to catch!', twoHands];
            default:
                if (ball.thrownBy === 'user') return ['Watch it fetch!', 'Your friend is going to get it'];
                if (ball.thrownBy === 'character') return ['Catch it!', twoHands];
                if (ball.thrownBy === 'return') return ['Missed!', 'The ball goes back to the basket'];
                return ['Pick up the ball', `${grab}, then drop it in the basket`];
        }
    }

    showPlayGuide() {
        // To the user's left of the canvas, turned in to face them.
        this.canvasGroup.localToWorld(this.playGuide.position.set(-CANVAS_W / 2 - 0.14, 0.02, 0.15));
        this.playGuide.quaternion.setFromEuler(new THREE.Euler(0, this.canvasYaw + 0.45, 0));
        this.playGuideOn = true;
    }

    backToDrawing() {
        this.resetStudio();
        // In the headset, bring the canvas back in front of wherever the user is now.
        if (this.renderer.xr.isPresenting) this.canvasPlaced = false;
    }

    // Stand the canvas up at `center`, facing back along `yaw`, leaned back like an easel.
    placeCanvas(center, yaw) {
        this.canvasYaw = yaw;
        this.canvasGroup.position.copy(center);
        this.canvasGroup.quaternion.setFromEuler(new THREE.Euler(-CANVAS_TILT, yaw, 0, 'YXZ'));
        this.canvasGroup.updateMatrixWorld(true);
    }

    // Put the canvas comfortably in front of wherever the user is, so it suits any height (or a seated child).
    placeCanvasFromViewer(frame) {
        const pose = frame.getViewerPose(this.renderer.xr.getReferenceSpace());
        if (!pose) return;
        const { position: p, orientation: o } = pose.transform;
        _forward.set(0, 0, -1).applyQuaternion(_quat.set(o.x, o.y, o.z, o.w));
        _forward.y = 0;
        if (_forward.lengthSq() < 1e-4) _forward.set(0, 0, -1); // looking straight down: no heading
        _forward.normalize();

        const center = new THREE.Vector3(p.x, p.y - CANVAS_DROP, p.z).addScaledVector(_forward, CANVAS_DISTANCE);
        this.placeCanvas(center, Math.atan2(-_forward.x, -_forward.z));
        this.canvasPlaced = true;
    }

    setupHands() {
        // getHand(0) is not guaranteed to be the right hand, so both hands get their own stroke state.
        for (let i = 0; i < 2; i++) {
            const hand = this.renderer.xr.getHand(i);

            // A small fingertip cursor instead of a full hand mesh, which would hide the real hand in passthrough.
            const cursor = new THREE.Mesh(
                new THREE.SphereGeometry(0.005, 16, 12),
                new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false })
            );
            cursor.renderOrder = 10;
            cursor.visible = false;
            this.scene.add(cursor);

            // With no physical surface to feel, a ring on the canvas shows where the fingertip will land.
            const ring = new THREE.Mesh(
                new THREE.RingGeometry(0.8, 1, 32),
                new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false })
            );
            ring.renderOrder = 5;
            ring.visible = false;
            this.canvasGroup.add(ring);

            hand.userData = {
                stroke: null, armed: false, touchedItem: null,
                pinching: false, wasPinching: false, pinchPoint: new THREE.Vector3(),
                palm: new THREE.Vector3(), palmVisible: false,
                smoothed: new THREE.Vector3(), smoothing: HAND_SMOOTHING, cursor, ring,
            };
            hand.addEventListener('disconnected', () => {
                this.endStroke(hand.userData);
                cursor.visible = false;
                ring.visible = false;
            });

            this.scene.add(hand);
            this.hands.push(hand);
        }
    }

    setupPointer() {
        const raycaster = new THREE.Raycaster();
        const ndc = new THREE.Vector2();
        const el = this.renderer.domElement;
        let down = false;

        const cast = (e) => {
            ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
            raycaster.setFromCamera(ndc, this.camera);
        };
        const trace = (e) => {
            if (!down || this.renderer.xr.isPresenting || this.appState !== 'DRAWING') return;
            cast(e);
            const hit = raycaster.intersectObject(this.canvasMesh)[0];
            if (hit) this.traceAt(this.pointer, this.canvasGroup.worldToLocal(_local.copy(hit.point)));
            else this.endStroke(this.pointer);
        };
        // Desktop stand-in for pinching: drag the character or the ball and let go to throw it.
        let lastMove = 0;
        const dragTo = (e) => {
            cast(e);
            const hit = raycaster.ray.intersectPlane(this.grab.plane, _mid);
            if (!hit) return;
            const now = performance.now();
            this.grab.target.hold(_mid.add(this.grab.offset), (now - lastMove) / 1000);
            lastMove = now;
        };
        const startDrag = (e, target) => {
            const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
                this.camera.getWorldDirection(new THREE.Vector3()), target.position);
            const start = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
            if (!start) return;
            this.grab = { by: 'pointer', target, plane, offset: target.position.clone().sub(start) };
            lastMove = performance.now();
            el.setPointerCapture(e.pointerId);
        };
        // Desktop stand-ins for pinching the board handle or the wand: drag them on a plane facing the camera.
        let toolDrag = null; // { kind: 'board' | 'wand', plane, offset }
        const startToolDrag = (e, kind, worldPos) => {
            const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(new THREE.Vector3()), worldPos);
            const start = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
            if (!start) return false;
            toolDrag = { kind, plane, offset: worldPos.clone().sub(start) };
            lastMove = performance.now();
            el.setPointerCapture(e.pointerId);
            return true;
        };
        const moveToolDrag = (e) => {
            cast(e);
            if (!raycaster.ray.intersectPlane(toolDrag.plane, _mid)) return;
            _mid.add(toolDrag.offset);
            const now = performance.now();
            if (toolDrag.kind === 'board') this.dragBoardTo(_mid, this.camera.position, (now - lastMove) / 1000);
            else this.moveWand(_mid);
            lastMove = now;
        };
        const endToolDrag = () => {
            if (toolDrag?.kind === 'board') this.canvasDrag = null;
            if (toolDrag?.kind === 'wand' && this.wandHold) this.dropWand();
            toolDrag = null;
        };

        el.addEventListener('pointermove', (e) => {
            if (this.grab?.by === 'pointer') dragTo(e);
            else if (toolDrag && (toolDrag.kind === 'board' || this.wandHold)) moveToolDrag(e);
        });
        el.addEventListener('pointerup', () => {
            endToolDrag();
            if (this.grab?.by !== 'pointer') return;
            this.grab.target.release();
            this.grab = null;
        });

        el.addEventListener('pointerdown', (e) => {
            if (this.renderer.xr.isPresenting) return; // in a session (or the laptop tour) hands do the work
            if (this.appState !== 'DRAWING') {
                cast(e);
                const exitClicked = this.exitDiamond.visible && raycaster.intersectObject(this.exitHit).length;
                if (exitClicked || (this.playGuide.visible && raycaster.intersectObject(this.drawAgainBtn).length)) {
                    this.backToDrawing();
                    return;
                }
                if (this.ball.group.visible && this.ball.state !== 'caught' && raycaster.intersectObject(this.ball.ball).length) {
                    startDrag(e, this.ball);
                    return;
                }
                if (this.canGrab() && raycaster.intersectObject(this.character.root, true).length) {
                    startDrag(e, this.ensureBody());
                }
                return;
            }
            cast(e);
            if (raycaster.intersectObject(this.exitBtn).length) { this.pressExit(); return; }
            if (raycaster.intersectObject(this.canvasHandle).length) {
                if (startToolDrag(e, 'board', this.canvasHandle.getWorldPosition(new THREE.Vector3()))) this.canvasDrag = { by: 'pointer' };
                return;
            }
            const item = raycaster.intersectObject(this.tray, true)[0]?.object.userData.trayItem;
            if (item?.tool === 'wand') {
                if (startToolDrag(e, 'wand', item.object.getWorldPosition(new THREE.Vector3()))) this.startWand('pointer');
                return;
            }
            if (item) { this.selectItem(item); return; }
            down = true;
            el.setPointerCapture(e.pointerId);
            trace(e);
        });
        el.addEventListener('pointermove', trace);
        el.addEventListener('pointerup', () => { down = false; this.endStroke(this.pointer); });
        el.addEventListener('pointercancel', () => { down = false; this.endStroke(this.pointer); });

        window.addEventListener('keydown', (e) => {
            if (!document.body.classList.contains('in-preview')) return;
            if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); this.undo(); }
            else if (e.key === 'c' && !e.metaKey && !e.ctrlKey) this.clear();
            else if (e.key === 'Escape') this.showLanding(true);
        });
    }

    setupLanding() {
        const enterBtn = document.getElementById('enter-btn');
        this.xrNote = document.getElementById('xr-note');
        this.hudCount = document.getElementById('hud-count');
        this.hudHint = document.getElementById('hud-hint');

        const supported = navigator.xr ? navigator.xr.isSessionSupported('immersive-ar') : Promise.resolve(false);
        // Without a headset (a laptop), offer a tour through an emulated Meta Quest instead.
        // `?tour` in the URL shows the option even where real WebXR is available.
        const tourBtn = document.getElementById('tour-btn');
        const forceTour = new URLSearchParams(location.search).has('tour');
        supported.catch(() => false).then((ok) => {
            enterBtn.disabled = !ok;
            tourBtn.hidden = ok && !forceTour;
            if (!ok) {
                this.xrNote.textContent = window.isSecureContext
                    ? 'No headset here? Take the laptop tour, or try the sample drawing.'
                    : 'AR needs HTTPS or localhost.';
            }
        });
        tourBtn.addEventListener('click', () => this.startTour(tourBtn));

        // Browsers only let audio start after a tap or click.
        window.addEventListener('pointerdown', () => this.sfx.resume(), true);
        enterBtn.addEventListener('click', () => this.enterAR());
        document.getElementById('sample-btn').addEventListener('click', () => {
            this.loadSample();
            this.showLanding(false);
        });
        document.getElementById('back-btn').addEventListener('click', () => this.showLanding(true));
        document.getElementById('xr-reset').addEventListener('click', () => this.backToDrawing());
        this.lifeBtn = document.getElementById('life-btn');
        this.lifeBtn.addEventListener('click', () => {
            if (this.appState === 'DRAWING') this.triggerAwakening();
            else this.resetStudio();
        });
    }

    showLanding(show) {
        this.endStroke(this.pointer);
        // The HTML How to Draw card starts folded unless the screen is wide enough that it won't cover
        // the board and tray.
        if (!show) document.getElementById('how-to-draw').open = innerWidth > 1200;
        if (show) this.resetStudio();
        document.body.classList.toggle('in-preview', !show);
    }

    // Laptop tour: install Meta's Immersive Web Emulation Runtime (IWER) as an emulated Quest 3 with
    // tracked hands, steered by the mouse and keyboard (tour/TourControls.js), with a synthetic living
    // room standing in for passthrough. Then enter the real WebXR session, exactly as on a headset.
    // The emulator is only downloaded when the tour starts.
    async startTour(button) {
        this.sfx.resume();
        if (!this.tourDevice) {
            button.disabled = true;
            this.xrNote.textContent = 'Loading the emulated headset…';
            try {
                const [{ XRDevice, metaQuest3 }, { SyntheticEnvironmentModule }, { TourControls }] = await Promise.all([
                    import('iwer'), import('@iwer/sem'), import('./tour/TourControls.js'),
                ]);
                const device = new XRDevice(metaQuest3);
                device.primaryInputMode = 'hand';
                // Laptop Chrome exposes navigator.xr even with no headset attached; replace it for the tour.
                device.installRuntime({ forceInstall: true });
                device.installSEM(SyntheticEnvironmentModule);
                await device.sem.loadDefaultEnvironment('living_room').catch(() => {}); // the tour still works without it
                this.tourDevice = device;
                this.tour = new TourControls(this, device);
                document.body.classList.add('tour');
            } catch (err) {
                this.xrNote.textContent = `Couldn't load the emulator: ${err.message}`;
                button.disabled = false;
                return;
            }
            button.disabled = false;
        }
        this.xrNote.textContent = '';
        button.blur(); // so Space (pinch) doesn't press the button again
        await this.enterAR();
    }

    async enterAR() {
        this.sfx.resume();
        try {
            // Hand tracking is optional so the session still starts on devices without it.
            // dom-overlay shows the How to Play card and reset button over the camera on phones;
            // headsets ignore it, and get the 3D versions instead.
            const session = await navigator.xr.requestSession('immersive-ar', {
                requiredFeatures: ['local-floor'],
                optionalFeatures: ['hand-tracking', 'dom-overlay'],
                domOverlay: { root: document.getElementById('xr-overlay') },
            });
            await this.renderer.xr.setSession(session);
        } catch (err) {
            this.xrNote.textContent = `Couldn't start AR: ${err.message}`;
        }
    }

    selectItem(item) {
        // Tapping the wand explains it (it's pinched and waved); the green Done button is the one-tap way.
        if (item.tool === 'wand') {
            if (!this.wandHold) this.panel.setText('Pinch the wand to pick it up', 'Then wave it in a circle!');
            return;
        }
        if (item.tool === 'done') {
            if (this.strokes.length) this.triggerAwakening();
            else this.panel.setText('Draw something first!', 'Then tap the green button');
            return;
        }
        this.tool = item.tool;
        if (item.tool === 'crayon') this.activeColor = item.color;
        this.tray.select(item);
        this.updateHud();
    }

    updateHud() {
        const item = this.tray.selected;
        if (this.appState !== 'DRAWING') {
            this.panel.setText("It's waking up!", 'Watch closely…');
        } else if (!this.handTracking) {
            this.panel.setText('Hand tracking is off', 'Turn it on in Settings › Movement tracking');
        } else if (this.tool === 'eraser') {
            this.panel.setText('Eraser', 'Rub over a line to erase it');
        } else {
            this.panel.setText(`${item.name} crayon`, 'Touch the board to draw · wave the wand when done');
        }

        const n = this.strokes.length;
        this.hudCount.textContent = `${n} stroke${n === 1 ? '' : 's'}`;
        this.hudHint.textContent = this.appState === 'DRAWING'
            ? 'Click a crayon · drag on the canvas · ⌘/Ctrl+Z undo · C clear · '
            : 'Drag your character and let go to throw it · ';
        this.lifeBtn.textContent = this.appState === 'DRAWING' ? 'Bring to life' : 'Draw again';
        this.lifeBtn.disabled = this.appState === 'DRAWING' && n === 0;
    }

    updateHand(hand, dt = 1 / 72) {
        const s = hand.userData;
        const tip = hand.joints['index-finger-tip'];

        // three.js hides only the hand, not its joints, when it disconnects (switching to controllers)
        // or the system menu blurs the session, so stale joints would otherwise look like a frozen pinch.
        if (!hand.visible || !tip || !tip.visible) {
            s.cursor.visible = false;
            s.ring.visible = false;
            s.pinching = false;
            s.prevPinch = false;
            s.palmVisible = false;
            this.endStroke(s);
            // A hand that vanishes lets go of whatever it carried.
            if (this.canvasDrag?.by === s) this.canvasDrag = null;
            if (this.wandHold?.by === s) this.dropWand();
            if (this.toolHold?.by === s) this.dropTool();
            return;
        }

        const palm = hand.joints['middle-finger-metacarpal'];
        s.palmVisible = !!palm?.visible;
        if (s.palmVisible) palm.getWorldPosition(s.palm);

        tip.getWorldPosition(_world);
        s.cursor.visible = true;
        s.cursor.position.copy(_world);

        // Pinch, with hysteresis; the pinch point is between thumb and index tips.
        const thumb = hand.joints['thumb-tip'];
        if (thumb && thumb.visible) {
            thumb.getWorldPosition(_thumb);
            const d = _world.distanceTo(_thumb);
            if (!s.pinching && d < PINCH_ENTER) s.pinching = true;
            else if (s.pinching && d > PINCH_EXIT) s.pinching = false;
            s.pinchPoint.addVectors(_world, _thumb).multiplyScalar(0.5);
        } else {
            s.pinching = false;
        }
        const pinchStarted = s.pinching && !s.prevPinch;
        s.prevPinch = s.pinching;
        if (pinchStarted) s.pinchUsed = false; // set again if this pinch picks something up

        if (this.appState !== 'DRAWING') {
            s.ring.visible = false;
            s.cursor.material.color.set(s.pinching ? 0xffd93d : 0xffffff);

            // Poke the "Back to Drawing" button (once per touch, and not while holding the character).
            if (this.playGuide.visible && !this.grab) {
                const local = this.drawAgainBtn.worldToLocal(_tip.copy(_world));
                const { width, height } = this.drawAgainBtn.size;
                const pressed = Math.abs(local.x) < width / 2 && Math.abs(local.y) < height / 2 && Math.abs(local.z) < 0.025;
                if (pressed && !s.pressing) this.backToDrawing();
                s.pressing = pressed;
            }
            return;
        }

        // Holding a crayon or the eraser: it follows the pinch, tilted toward the board, and draws (or
        // erases) wherever its tip touches.
        if (this.toolHold?.by === s) {
            if (!s.pinching) {
                this.dropTool();
                return;
            }
            const tipLocal = this.moveHeldTool(s.pinchPoint);
            const touching = this.traceAt(s, tipLocal);
            this.updateRing(s.ring, tipLocal, touching);
            s.cursor.material.color.set(touching ? this.toolColor() : 0xffd93d);
            return;
        }

        // Carrying the board or the wand takes this hand over: no drawing until it lets go.
        if (this.canvasDrag?.by === s || this.wandHold?.by === s) {
            s.ring.visible = false;
            s.cursor.material.color.set(0xffd93d);
            if (this.canvasDrag?.by === s) {
                if (s.pinching) this.dragBoardTo(s.pinchPoint, this.renderer.xr.getCamera().getWorldPosition(_camPos), dt);
                else this.canvasDrag = null;
            } else if (s.pinching) this.moveWand(s.pinchPoint);
            else this.dropWand();
            return;
        }
        if (pinchStarted && !s.stroke) {
            if (!this.canvasDrag && s.pinchPoint.distanceTo(this.canvasHandle.getWorldPosition(_tip)) < HANDLE_REACH) {
                this.canvasDrag = { by: s };
                s.pinchUsed = true;
                return;
            }
            if (!this.wandHold && s.pinchPoint.distanceTo(this.wandItem.object.getWorldPosition(_tip)) < WAND_REACH) {
                this.startWand(s);
                s.pinchUsed = true;
                return;
            }
            const tool = !this.toolHold && this.nearestTool(s.pinchPoint);
            if (tool) {
                this.startTool(s, tool);
                s.pinchUsed = true;
                return;
            }
        }

        // Poke the board's Exit button (once per touch).
        const exitLocal = this.exitBtn.worldToLocal(_tip.copy(_world));
        const { width: ew, height: eh } = this.exitBtn.size;
        const onExit = Math.abs(exitLocal.x) < ew / 2 && Math.abs(exitLocal.y) < eh / 2 && Math.abs(exitLocal.z) < 0.025;
        if (onExit && !s.pressingExit && !s.stroke) this.pressExit();
        s.pressingExit = onExit;

        // Tapping a tray item selects it once per touch, not every frame the finger lingers.
        const item = this.tray.hitTest(this.tray.worldToLocal(_local.copy(_world)));
        if (item && item !== s.touchedItem && !s.stroke) this.selectItem(item);
        s.touchedItem = item;

        const local = this.canvasGroup.worldToLocal(_local.copy(_world));
        // The joint position is the centre of the fingertip; the skin is one radius further toward the canvas.
        local.z -= tip.jointRadius ?? 0.008;
        const touching = this.traceAt(s, local);

        this.updateRing(s.ring, local, touching);
        s.cursor.material.color.set(touching ? this.toolColor() : 0xffffff);
    }

    toolColor() {
        return this.tool === 'eraser' ? 0xffb3c6 : this.activeColor;
    }

    updateRing(ring, local, touching) {
        const inBounds = Math.abs(local.x) < CANVAS_W / 2 && Math.abs(local.y) < CANVAS_H / 2;
        ring.visible = inBounds && local.z > 0 && local.z < HOVER_RANGE && !touching;
        if (!ring.visible) return;
        const closeness = 1 - local.z / HOVER_RANGE;
        const base = this.tool === 'eraser' ? ERASE_RADIUS : INK_RADIUS * 2;
        ring.position.set(local.x, local.y, 0.0015);
        ring.scale.setScalar(base * (1 + 2 * (1 - closeness)));
        ring.material.color.set(this.toolColor());
        ring.material.opacity = 0.25 + 0.75 * closeness;
    }

    // Proximity drawing. `local` is the contact point in canvas space. Returns whether it is touching.
    traceAt(owner, local) {
        if (local.z < BEHIND_LIMIT) {
            // Pushed right through; it must come back around the front before it inks again.
            owner.armed = false;
            this.endStroke(owner);
            return false;
        }
        if (!owner.armed) {
            if (local.z > ARM_HEIGHT) owner.armed = true;
            return false;
        }

        const inBounds = Math.abs(local.x) < CANVAS_W / 2 && Math.abs(local.y) < CANVAS_H / 2;
        const threshold = owner.stroke ? TOUCH_EXIT : TOUCH_ENTER;
        const touching = inBounds && local.z < threshold;

        if (!touching) {
            this.endStroke(owner);
            return false;
        }

        if (this.tool === 'eraser') {
            this.eraseAt(local);
            return true;
        }

        // CatmullRom interpolates *through* every point, so jitter must be filtered before it gets there.
        if (owner.stroke) owner.smoothed.lerp(local, owner.smoothing);
        else owner.smoothed.copy(local);
        const p = _ink.set(owner.smoothed.x, owner.smoothed.y, 0); // ink lies on the canvas

        if (owner.stroke) this.pushPoint(owner.stroke, p);
        else this.startStroke(owner, p);
        return true;
    }

    inkMaterial(color) {
        let material = this.inkMaterials.get(color);
        if (!material) {
            material = isNeon(color) ? neonMaterial(color) : new THREE.MeshStandardMaterial({ color, roughness: 0.45 });
            this.inkMaterials.set(color, material);
        }
        return material;
    }

    startStroke(owner, p) {
        // Preallocated buffer + drawRange: setFromPoints on a growing array fails in current three.js.
        const geometry = new THREE.BufferGeometry();
        const attr = new THREE.BufferAttribute(new Float32Array(MAX_PREVIEW_POINTS * 3), 3);
        attr.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('position', attr);
        geometry.setDrawRange(0, 0);

        const color = this.activeColor;
        const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, toneMapped: !isNeon(color) }));
        line.position.z = INK_RADIUS;
        if (isNeon(color)) line.layers.enable(BLOOM_LAYER);
        line.frustumCulled = false;
        this.canvasGroup.add(line);

        owner.stroke = { points: [], line, color };
        this.pushPoint(owner.stroke, p);
    }

    pushPoint(stroke, p) {
        const { points, line } = stroke;
        if (points.length >= MAX_PREVIEW_POINTS) return;
        const last = points[points.length - 1];
        if (last && last.distanceTo(p) < MIN_POINT_GAP) return;

        points.push(p.clone());
        const attr = line.geometry.attributes.position;
        attr.setXYZ(points.length - 1, p.x, p.y, p.z);
        attr.needsUpdate = true;
        line.geometry.setDrawRange(0, points.length);
    }

    endStroke(owner) {
        const stroke = owner.stroke;
        if (!stroke) return;
        owner.stroke = null;

        this.canvasGroup.remove(stroke.line);
        stroke.line.geometry.dispose();
        stroke.line.material.dispose();

        if (stroke.points.length >= 2) this.commitStroke(stroke.points, stroke.color); // fewer is a tap
    }

    // Turn canvas-local points into a smoothed, round-ended tube of puffy ink.
    commitStroke(points, color) {
        const material = this.inkMaterial(color);
        const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
        const segments = THREE.MathUtils.clamp(points.length * 2, 8, 2000);

        const object = new THREE.Group();
        object.position.z = INK_RADIUS;
        object.add(new THREE.Mesh(new THREE.TubeGeometry(curve, segments, INK_RADIUS, 8, false), material));
        for (const end of [points[0], points[points.length - 1]]) {
            const cap = new THREE.Mesh(this.capGeometry ??= new THREE.SphereGeometry(INK_RADIUS, 12, 8), material);
            cap.position.copy(end);
            object.add(cap);
        }
        object.traverse((o) => { o.castShadow = true; });
        if (isNeon(color)) {
            markGlow(object);
            const halo = new THREE.Mesh(new THREE.TubeGeometry(curve, segments, INK_RADIUS * 3, 8, false), this.neonHalo);
            halo.castShadow = false;
            object.add(halo);
        }
        this.canvasGroup.add(object);

        this.strokes.push({ points, color, curve, object });
        this.updateHud();
    }

    eraseAt(local) {
        const r2 = ERASE_RADIUS * ERASE_RADIUS;
        const before = this.strokes.length;
        this.strokes = this.strokes.filter((stroke) => {
            const hit = stroke.points.some((p) => (p.x - local.x) ** 2 + (p.y - local.y) ** 2 < r2);
            if (hit) this.disposeStroke(stroke);
            return !hit;
        });
        if (this.strokes.length !== before) this.updateHud();
    }

    disposeStroke(stroke) {
        this.canvasGroup.remove(stroke.object);
        for (const o of stroke.object.children) if (o.geometry !== this.capGeometry) o.geometry.dispose(); // caps share one
    }

    loadSample() {
        this.clear();
        const colors = [0x33ccff, 0xff3366, 0xff3366, 0xff3366];
        sampleDoodle().forEach((points, i) => this.commitStroke(points, colors[i]));
    }

    undo() {
        const stroke = this.strokes.pop();
        if (!stroke) return;
        this.disposeStroke(stroke);
        this.updateHud();
    }

    clear() {
        while (this.strokes.length) this.undo();
    }

    setAppState(state) {
        this.appState = state;
        document.body.classList.toggle('awake', state !== 'DRAWING');
        // The HTML card starts folded on narrow screens so it doesn't cover the character.
        if (state === 'AWAKENING') document.getElementById('how-to').open = innerWidth > 600;
        this.stateTime = 0;
        this.updateHud();
    }

    // Phase 2: the drawing puffs up out of the canvas and steps forward.
    triggerAwakening() {
        if (this.appState !== 'DRAWING' || !this.strokes.length) return;
        this.endStroke(this.pointer);
        for (const hand of this.hands) this.endStroke(hand.userData);
        this.canvasDrag = null;
        if (this.wandHold) this.dropWand();
        if (this.toolHold) this.dropTool();

        const { group, center } = buildCharacter(this.strokes);
        const size = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
        const grabRadius = size.length() / 2 + GRAB_MARGIN;
        // root carries the canvas pose (then straightens up), pivot sits at the drawing's centre so the
        // character bobs and sways about its own middle, content is offset back so it lines up with the ink.
        const root = new THREE.Group();
        root.position.copy(this.canvasGroup.position);
        root.quaternion.copy(this.canvasGroup.quaternion);
        const pivot = new THREE.Group();
        pivot.rotation.order = 'YXZ'; // look left/right first, then tip up/down toward what it watches
        pivot.position.set(center.x, center.y, 0);
        group.position.set(-center.x, -center.y, 0);
        group.scale.z = 0.001;
        pivot.add(group);
        root.add(pivot);
        this.scene.add(root);

        this.character = {
            root, pivot, content: group, center, grabRadius, body: null, time: 0,
            tilted: this.canvasGroup.quaternion.clone(),
            upright: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, this.canvasYaw, 0)),
        };
        for (const stroke of this.strokes) stroke.object.visible = false; // the extrusion replaces the ink
        this.emitBurst(this.canvasGroup.localToWorld(new THREE.Vector3(center.x, center.y, 0.02)), Math.min(size.x, size.y) / 2);
        // The character's voice and catch sound come from its own body.
        this.character.babbleSound = this.sfx.attach(pivot, { refDistance: 0.5 });
        this.character.popSound = this.sfx.attach(pivot, { refDistance: 0.6 });
        this.babbleTimer = POP_TIME + 0.4; // a first happy babble as it pops out
        this.frame.setAnimated(true);
        this.showPlayGuide();
        this.setAppState('AWAKENING');
    }

    animateCharacter(t, dt, lookPos) {
        const { pivot, content, center, root, tilted, upright } = this.character;
        content.scale.z = Math.max(easeOutBack(clamp01(t / POP_TIME)), 0.001);

        const lift = easeInOutCubic(clamp01((t - POP_TIME) / LIFT_TIME));
        root.quaternion.slerpQuaternions(tilted, upright, lift);
        pivot.position.z = LIFT_DISTANCE * lift;

        // Idle: a gentle breathing bob, and it watches you (or a hand reaching for it), fading in as it
        // stands up. A slow sway keeps it alive when nothing moves.
        pivot.position.y = center.y + 0.015 * Math.sin(t * 2) * lift;
        root.updateMatrixWorld();
        const local = root.worldToLocal(_look.copy(lookPos)).sub(pivot.position);
        const yaw = THREE.MathUtils.clamp(Math.atan2(local.x, local.z), -0.9, 0.9) + 0.1 * Math.sin(t);
        const pitch = THREE.MathUtils.clamp(-Math.atan2(local.y, Math.hypot(local.x, local.z)), -0.5, 0.5);
        const k = 1 - Math.exp(-dt * 5);
        pivot.rotation.y += (yaw * lift - pivot.rotation.y) * k;
        pivot.rotation.x += (pitch * lift - pivot.rotation.x) * k;

        if (lift >= 1 && !this.character.hinted) {
            this.character.hinted = true;
            this.panel.setText('Pick me up!', 'Pinch me with both hands, then throw');
        }
    }

    // What the character watches: a fingertip that comes within reach, otherwise the user's head.
    // While it's held it looks at the user, since the hands are all around it.
    lookTarget(headPos) {
        const c = this.character;
        // A ball in the air (or in your hand) is the most interesting thing in the room.
        const ballState = this.ball.state;
        if (this.ball.group.visible && (ballState === 'flying' || ballState === 'held' || c.body?.chasing)) {
            return _look.copy(this.ball.position);
        }
        if (this.grab || !this.renderer.xr.isPresenting) return headPos;
        if (c.body) _center.copy(c.body.position);
        else c.pivot.getWorldPosition(_center);

        let best = headPos;
        let bestDist = LOOK_RANGE;
        for (const hand of this.hands) {
            const tip = hand.joints['index-finger-tip'];
            if (!hand.visible || !tip?.visible) continue;
            const d = tip.getWorldPosition(_tip).distanceTo(_center);
            if (d < bestDist) {
                bestDist = d;
                best = _look.copy(_tip);
            }
        }
        return best;
    }

    // The character can be picked up once it has finished stepping off the canvas.
    canGrab() {
        return !!this.character && this.character.time >= POP_TIME + LIFT_TIME;
    }

    ensureBody() {
        const c = this.character;
        c.body ??= new CharacterBody(c.root, c.pivot, c.content);
        return c.body;
    }

    // Two-handed pickup: both hands pinching within reach of the character grabs it, and it follows the
    // midpoint between them. Letting go with either hand throws it with the hands' recent velocity.
    updateHandGrab(dt) {
        const [a, b] = this.hands.map((h) => h.userData);
        // A hand holding the ball isn't free to hold the character.
        const both = a.pinching && b.pinching && this.ballHand !== a && this.ballHand !== b;
        _mid.addVectors(a.pinchPoint, b.pinchPoint).multiplyScalar(0.5);

        if (this.grab?.by === 'hands') {
            const body = this.character.body;
            if (both) body.hold(_center.addVectors(_mid, this.grab.offset), dt);
            // A quick upward flick of the hands makes it leap out of them, even mid-pinch.
            const flick = both && body.velocity.y > FLICK_SPEED;
            if (flick) body.velocity.y = Math.max(body.velocity.y, JUMP_SPEED);
            if (flick || !both) {
                body.release();
                this.grab = null;
                this.grabCooldown = GRAB_COOLDOWN; // so still-pinching hands don't instantly catch it again
            }
            return;
        }
        if (this.grabCooldown > 0) {
            this.grabCooldown -= dt;
            return;
        }
        if (this.grab || !both || !this.canGrab()) return;

        const c = this.character;
        if (c.body) _center.copy(c.body.position);
        else c.pivot.getWorldPosition(_center);
        if (a.pinchPoint.distanceTo(_center) > c.grabRadius || b.pinchPoint.distanceTo(_center) > c.grabRadius) return;

        const body = this.ensureBody();
        this.grab = { by: 'hands', offset: body.position.clone().sub(_mid) };
        a.pinchUsed = b.pinchUsed = true;
    }

    // Phase 3: the world grows out of the canvas and swallows the room.
    startPortal() {
        this.portal = new Portal();
        this.portal.start(this.scene, this.canvasGroup.position, this.canvasYaw, 0);
        this.placeBasket();
        this.placeExitDiamond();
        this.setAppState('PORTAL');
    }

    updatePortal(dt) {
        const progress = this.portal.update(dt);

        // The glowing frame flares outward and fades, masking the moment the sky orb appears.
        const flare = clamp01(this.stateTime / FRAME_BURST_TIME);
        this.frame.scale.setScalar(1 + 1.5 * easeInOutCubic(flare));
        this.frame.material.uniforms.uOpacity.value = 1 - flare;

        if (progress > HIDE_STUDIO_AT) this.canvasGroup.visible = false;
        if (progress >= 1) this.setAppState('WORLD');
    }

    resetStudio() {
        // Anything still in hand goes back on the tray.
        if (this.toolHold) this.dropTool();
        if (this.wandHold) this.dropWand();
        this.canvasDrag = null;
        this.grab = null;
        this.grabCooldown = 0;
        this.returning = false;
        this.charOutTime = 0;
        this.playGuideOn = false;
        this.ball.group.visible = false;
        this.exitDiamond.visible = false;
        this.ballHand = null;
        this.catchCooldown = 0;
        if (this.character) {
            this.sfx.release(this.character.babbleSound);
            this.sfx.release(this.character.popSound);
            this.character.root.removeFromParent();
            disposeCharacter(this.character.root);
            this.character = null;
        }
        this.portal?.dispose();
        this.portal = null;
        this.canvasGroup.visible = true;
        this.frame.scale.setScalar(1);
        this.frame.setAnimated(false);
        for (const stroke of this.strokes) stroke.object.visible = true;
        this.setAppState('DRAWING');
    }

    onSessionStart() {
        const session = this.renderer.xr.getSession();
        // Quest can grant the session without hand tracking if it's disabled in system settings.
        this.handTracking = !session.enabledFeatures || session.enabledFeatures.includes('hand-tracking');
        this.endStroke(this.pointer);
        this.canvasPlaced = false;
        for (const hand of this.hands) hand.userData.armed = false;
        // Re-centre the studio when the user re-centres their view (holding the Meta button).
        this.renderer.xr.getReferenceSpace()?.addEventListener('reset', () => { this.canvasPlaced = false; });
        document.body.classList.add('in-xr');
        // Start the gaze-following guide fresh, with its welcome.
        this.sessionTime = 0;
        this.guide.reset();
        this.charOutTime = 0;
        this.returning = false;
        this.updateHud();
    }

    onSessionEnd() {
        document.body.classList.remove('in-xr');
        for (const hand of this.hands) this.endStroke(hand.userData);
        this.handTracking = true;
        this.resetStudio();
        this.placeCanvas(PREVIEW_CANVAS_POS, 0);
        this.updateHud();
        this.showLanding(true);
    }

    render(time, frame) {
        const dt = Math.min(this.clock.getDelta(), 0.1);
        // The 3D How to Play card is for the headset; the desktop preview shows the HTML one.
        this.playGuide.visible = !!this.playGuideOn && this.renderer.xr.isPresenting;
        this.drawGuide.visible = this.renderer.xr.isPresenting && this.appState === 'DRAWING';
        // The handle lights up while the board is being carried.
        this.handleMaterial.emissiveIntensity = THREE.MathUtils.lerp(this.handleMaterial.emissiveIntensity, this.canvasDrag ? 0.7 : 0, 1 - Math.exp(-dt * 10));
        if (this.renderer.xr.isPresenting) {
            if (!this.canvasPlaced && frame) this.placeCanvasFromViewer(frame);
            this.tour?.update(dt);
            for (const hand of this.hands) this.updateHand(hand, dt);
        }

        // Sequenced by elapsed frame time rather than setTimeout, so it can't drift from the animation
        // or fire after a reset.
        this.stateTime += dt;
        if (this.character) {
            const c = this.character;
            c.time += dt;
            if (this.renderer.xr.isPresenting) this.updateHandGrab(dt);
            const cam = this.renderer.xr.isPresenting ? this.renderer.xr.getCamera() : this.camera;
            cam.getWorldPosition(_camPos);
            const lookPos = this.lookTarget(_camPos);
            if (c.body) {
                // After the first pickup, physics owns the character instead of the scripted float.
                c.content.scale.z = 1;
                c.body.update(dt, _camPos, lookPos, FLOOR_Y);
            } else {
                this.animateCharacter(c.time, dt, lookPos);
            }
            if (this.ball.group.visible) this.updateCatch(dt, cam);
            if (this.renderer.xr.isPresenting && this.appState !== 'DRAWING') this.keepCharacterInView(dt);
        }

        // Headset: the gaze-following guide and the point-and-pinch rays.
        this.sessionTime += dt;
        if (this.renderer.xr.isPresenting) this.updateGuide(dt);
        else this.guide.visible = false;
        this.updatePointers();

        // Desktop preview: once the world opens, tilt the view down to the ground where the play is.
        if (!this.renderer.xr.isPresenting) {
            const outside = this.appState === 'PORTAL' || this.appState === 'WORLD';
            this.previewLook.lerp(outside ? PREVIEW_LOOK_WORLD : PREVIEW_LOOK_STUDIO, 1 - Math.exp(-dt * 2));
            this.camera.lookAt(this.previewLook);
        }
        if (this.appState === 'AWAKENING' && this.stateTime >= PORTAL_AT) this.startPortal();
        else if (this.appState === 'PORTAL') this.updatePortal(dt);
        else if (this.appState === 'WORLD') this.portal.update(dt);

        this.frame.update(time / 1000);
        this.tray.update(dt);
        this.trail.update(dt);
        this.burst.update(dt);
        this.neonHalo.visible = this.renderer.xr.isPresenting;
        this.updateBabble(dt);
        this.updateExitDiamond(dt, time / 1000);
        this.updateExitButton(dt);
        // WebXR can't use post-processing, so bloom is for the desktop preview only.
        if (this.renderer.xr.isPresenting) this.renderer.render(this.scene, this.camera);
        else this.bloom.render();
    }

    // Now and then the awake character babbles a little gibberish, from its own body.
    updateBabble(dt) {
        const c = this.character;
        if (!c?.babbleSound) return;
        this.babbleTimer -= dt;
        if (this.babbleTimer > 0) return;
        this.babbleTimer = BABBLE_MIN + Math.random() * (BABBLE_MAX - BABBLE_MIN);
        if (c.babbleSound.isPlaying) return;
        const options = this.sfx.buffers.babble;
        this.sfx.play(c.babbleSound, options[Math.floor(Math.random() * options.length)], {
            volume: 0.45, rate: 0.92 + Math.random() * 0.22,
        });
    }

    updateGuide(dt) {
        const [message, target, name] = this.guideState();
        this.guide.update(dt, this.renderer.xr.getCamera(), message, target, name);
    }

    // What the gaze-following guide says right now, and what it keeps the user pointed at.
    guideState() {
        if (this.appState === 'DRAWING') {
            const board = this.canvasGroup.getWorldPosition(_guideTarget);
            let message;
            if (this.sessionTime < WELCOME_TIME) message = ['Welcome to the Doodleverse!', 'Your drawing board is right in front of you'];
            else if (this.toolHold?.item.tool === 'eraser') message = ['Rub the board to erase', 'Let go to put the eraser back'];
            else if (this.toolHold) message = ['Draw with the crayon tip', 'Let go to put it back'];
            else if (this.wandHold) message = ['Wave the wand in a circle!', 'Your drawing will come alive'];
            else if (this.canvasDrag) message = ['Moving the board', 'Let go to leave it here'];
            else if (!this.strokes.length) message = ['Draw something!', 'Touch the board, or pinch a crayon to hold it'];
            else message = ['Looking great!', 'When you are done, pinch the wand and wave it'];
            return [message, board, 'Your board'];
        }

        const c = this.character;
        const friend = c ? (c.body ? _guideTarget.copy(c.body.position) : c.pivot.getWorldPosition(_guideTarget)) : null;
        let message;
        if (this.appState === 'AWAKENING') message = ['Your drawing is waking up!', 'Watch it come to life'];
        else if (this.appState === 'PORTAL') message = ['Welcome to your world!', 'Look around, then play with your friend'];
        else if (this.returning) message = ['Here comes your friend!', 'It is hopping back to you'];
        else message = this.ballHintText();
        return [message, friend, 'Your friend'];
    }

    // If the character stays out of view for a few seconds, it hops back to a spot just in front of
    // the user, so it's never lost. It doesn't interrupt a fetch or being carried.
    keepCharacterInView(dt) {
        const c = this.character;
        const cam = this.renderer.xr.getCamera();
        cam.getWorldPosition(_head);
        cam.getWorldDirection(_gaze);
        const pos = c.body ? c.body.position : c.pivot.getWorldPosition(_guideTarget);
        const out = _dir.subVectors(pos, _head).normalize().angleTo(_gaze) > OUT_OF_VIEW_ANGLE;
        this.charOutTime = out ? this.charOutTime + dt : 0;

        const ball = this.ball;
        const fetching = ball.group.visible && ball.thrownBy === 'user' && (ball.state === 'flying' || ball.state === 'resting');
        const carried = !!this.grab && (this.grab.by === 'hands' || this.grab.target === c.body);
        if (fetching || carried) {
            this.returning = false;
            return;
        }
        if (!this.returning && this.charOutTime > RETURN_AFTER && this.canGrab()) this.returning = true;
        if (!this.returning) return;

        // A spot on the floor about a metre in front of the user.
        _gaze.y = 0;
        if (_gaze.lengthSq() < 1e-4) _gaze.set(0, 0, -1);
        _gaze.normalize();
        _front.copy(_head).addScaledVector(_gaze, RETURN_DISTANCE);
        _front.y = FLOOR_Y;

        if (!c.body) this.ensureBody().state = 'flying'; // drop out of the float and hop over
        c.body.chase(_front, _zero);
        if (Math.hypot(c.body.position.x - _front.x, c.body.position.z - _front.z) < RETURN_CLOSE) {
            this.returning = false;
            c.body.chasing = false;
        }
    }

    onWindowResize() {
        if (this.renderer.xr.isPresenting) return; // the XR session owns the framebuffer size
        this.fitPreviewCamera();
        this.renderer.setSize(innerWidth, innerHeight);
        this.bloom.setSize(innerWidth, innerHeight);
    }

    // Keep enough horizontal view for the whole studio on portrait screens.
    fitPreviewCamera() {
        const aspect = innerWidth / innerHeight;
        const minHalfH = THREE.MathUtils.degToRad(32);
        const fov = 2 * Math.atan(Math.tan(minHalfH) / aspect);
        this.camera.fov = Math.max(65, THREE.MathUtils.radToDeg(fov));
        this.camera.aspect = aspect;
        this.camera.updateProjectionMatrix();
    }
}

// Exposed for console debugging and for Phase 2 to read `doodleverse.strokes`.
window.doodleverse = new Doodleverse();
