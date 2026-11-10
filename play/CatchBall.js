import * as THREE from 'three';

// A beach ball in a basket on the floor, for playing catch with the character.
// States: basket (waiting to be picked up) | held (pinched) | cupped (caught in two hands) |
// flying (in the air or rolling) | resting | caught (by the character).
// The app moves the ball while it's held or caught; everything else is simulated here.

export const BALL_RADIUS = 0.05;
const GRAVITY = 9.8;
const MAX_SPEED = 8;
const BOUNCE = 0.65;
const BOUNCE_FRICTION = 0.85;
const MIN_BOUNCE = 0.4;         // slower impacts stop bouncing and roll
const ROLL_DRAG = 2;
const STOP_SPEED = 0.05;
const BASKET_RADIUS = 0.16;
const BASKET_HEIGHT = 0.22;
const RESPAWN_DIST = 3;         // resting this far from the user (maybe behind a real wall)...
const RESPAWN_AFTER = 3;        // ...for this many seconds sends it back to the basket
const MISS_DELAY = 0.6;         // a missed throw-back sits this long before hopping home
const DROP_MARGIN = 0.08;       // how far outside the basket's radius still counts as "over it"
const DROP_MAX_SPEED = 1.5;     // letting go slower than this over the basket drops it in

const STRIPES = ['#ff3366', '#ffffff', '#33ccff', '#ffffff', '#ffcc00', '#ffffff', '#33cc33', '#ffffff'];

const _axis = new THREE.Vector3();
const _prev = new THREE.Vector3();
const _vel = new THREE.Vector3();

function beachBallTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const w = canvas.width / STRIPES.length;
    STRIPES.forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.fillRect(i * w, 0, w + 1, canvas.height);
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

export class CatchBall {
    constructor() {
        this.group = new THREE.Group();
        this.group.visible = false;

        this.basket = new THREE.Group();
        const wicker = new THREE.MeshStandardMaterial({ color: 0xffaa00, roughness: 0.8, side: THREE.DoubleSide });
        const wall = new THREE.Mesh(
            new THREE.CylinderGeometry(BASKET_RADIUS, BASKET_RADIUS * 0.8, BASKET_HEIGHT, 24, 1, true),
            wicker
        );
        wall.position.y = BASKET_HEIGHT / 2;
        const bottom = new THREE.Mesh(new THREE.CircleGeometry(BASKET_RADIUS * 0.8, 24), wicker);
        bottom.rotation.x = -Math.PI / 2;
        bottom.position.y = 0.005;
        // The rim glows green while a held ball is over the basket: "let go here".
        this.rim = new THREE.Mesh(
            new THREE.TorusGeometry(BASKET_RADIUS, 0.012, 8, 32),
            new THREE.MeshStandardMaterial({ color: 0xcc7a00, roughness: 0.7, emissive: 0x33ff88, emissiveIntensity: 0 })
        );
        const rim = this.rim;
        rim.rotation.x = Math.PI / 2;
        rim.position.y = BASKET_HEIGHT;
        this.basket.add(wall, bottom, rim);
        this.basket.traverse((o) => { o.castShadow = true; });
        this.group.add(this.basket);

        this.ball = new THREE.Mesh(
            new THREE.SphereGeometry(BALL_RADIUS, 32, 16),
            new THREE.MeshStandardMaterial({ map: beachBallTexture(), roughness: 0.35 })
        );
        this.ball.castShadow = true;
        this.group.add(this.ball);

        this.velocity = new THREE.Vector3();
        this.state = 'basket';
        // Who sent it flying last: 'user' (a throw), 'drop' (let go over the basket), 'character'
        // (a throw-back), 'return' (a missed throw-back hopping home to the basket).
        this.thrownBy = null;
        this.restTimer = 0;
        this.missTimer = 0;
        this.onBounce = null;       // called with the impact speed (m/s) when it bounces off the floor
    }

    // Is the ball over the basket (within its radius plus `margin`), and above the rim?
    get overBasket() {
        const p = this.ball.position;
        const b = this.basket.position;
        return Math.hypot(p.x - b.x, p.z - b.z) < BASKET_RADIUS + DROP_MARGIN && p.y > b.y + BASKET_HEIGHT;
    }

    // A missed throw-back lands, then bounces itself back into the basket.
    get missed() {
        const backToBasket = this.thrownBy === 'character' || this.thrownBy === 'return'; // 'return' retries a miss
        return backToBasket && (this.state === 'resting' || (this.state === 'flying' && this.onGround));
    }

    get position() {
        return this.ball.position;
    }

    // `floorPos` is a point on the floor for the basket.
    place(floorPos) {
        this.basket.position.copy(floorPos);
        this.toBasket();
        this.group.visible = true;
    }

    setRimGlow(on, dt) {
        const m = this.rim.material;
        m.emissiveIntensity += ((on ? 0.9 : 0) - m.emissiveIntensity) * (1 - Math.exp(-dt * 10));
    }

    toBasket() {
        this.state = 'basket';
        this.thrownBy = null;
        this.velocity.set(0, 0, 0);
        // Sitting high in the basket so it's easy to reach.
        this.ball.position.copy(this.basket.position).y += BASKET_HEIGHT - BALL_RADIUS * 0.3;
    }

    hold(target, dt) {
        _prev.copy(this.ball.position);
        this.ball.position.copy(target);
        if (dt > 0) this.velocity.lerp(_vel.subVectors(target, _prev).divideScalar(dt), 0.4);
        this.state = 'held';
    }

    // Resting in two cupped hands: follows them softly, and keeps their velocity in case they part.
    cradle(target, dt) {
        _prev.copy(this.ball.position);
        this.ball.position.lerp(target, 1 - Math.exp(-dt * 20));
        if (dt > 0) this.velocity.lerp(_vel.subVectors(this.ball.position, _prev).divideScalar(dt), 0.4);
        this.state = 'cupped';
    }

    release() {
        this.velocity.clampLength(0, MAX_SPEED);
        this.state = 'flying';
        // Let go gently over the basket = putting it away, not a throw (so nothing chases it).
        this.thrownBy = this.overBasket && this.velocity.length() < DROP_MAX_SPEED ? 'drop' : 'user';
    }

    get onGround() {
        return this.ball.position.y <= BALL_RADIUS + 0.01 && Math.abs(this.velocity.y) < 0.5;
    }

    // Launch on an arc that arrives at `target` after `time` seconds.
    throwTo(target, time) {
        this.velocity.subVectors(target, this.ball.position).divideScalar(time);
        this.velocity.y += 0.5 * GRAVITY * time;
        this.state = 'flying';
        this.thrownBy = 'character';
    }

    // Hop back into the basket on a little arc that comes down through the rim.
    returnToBasket() {
        const target = this.basket.position.clone();
        target.y += BASKET_HEIGHT - BALL_RADIUS;
        const time = THREE.MathUtils.clamp(this.ball.position.distanceTo(target) / 2.5, 0.6, 1.2);
        this.throwTo(target, time);
        this.thrownBy = 'return';
    }

    update(dt, floorY, userPos) {
        if (this.missed) {
            this.missTimer += dt;
            if (this.missTimer > MISS_DELAY) this.returnToBasket();
        } else {
            this.missTimer = 0;
        }

        if (this.state === 'flying') this.fly(dt, floorY);
        else if (this.state === 'resting') {
            this.restTimer += dt;
            const far = Math.hypot(this.ball.position.x - userPos.x, this.ball.position.z - userPos.z) > RESPAWN_DIST;
            if (far && this.restTimer > RESPAWN_AFTER) this.toBasket();
        }
    }

    fly(dt, floorY) {
        const p = this.ball.position;
        const v = this.velocity;
        const prevY = p.y;
        const ground = floorY + BALL_RADIUS;
        const onGround = p.y <= ground + 1e-3 && Math.abs(v.y) < 1e-3;

        if (onGround) {
            const drag = Math.exp(-dt * ROLL_DRAG);
            v.x *= drag;
            v.z *= drag;
        } else {
            v.y -= GRAVITY * dt;
        }
        p.addScaledVector(v, dt);

        // Rolling spin, about the axis perpendicular to the direction of travel.
        const speed = Math.hypot(v.x, v.z);
        if (speed > 1e-3) {
            _axis.set(v.z, 0, -v.x).divideScalar(speed);
            this.ball.rotateOnWorldAxis(_axis, (speed * dt) / BALL_RADIUS);
        }

        // Dropped back into the basket: falling through the rim inside its radius (a gentle drop gets
        // a little extra room, since the user is aiming by hand).
        const rimY = this.basket.position.y + BASKET_HEIGHT;
        const dx = p.x - this.basket.position.x;
        const dz = p.z - this.basket.position.z;
        const opening = this.thrownBy === 'drop' ? BASKET_RADIUS + DROP_MARGIN : BASKET_RADIUS - BALL_RADIUS * 0.5;
        if (v.y < 0 && prevY >= rimY && p.y < rimY && Math.hypot(dx, dz) < opening) {
            this.toBasket();
            return;
        }

        if (p.y <= ground && v.y <= 0) {
            p.y = ground;
            if (-v.y > MIN_BOUNCE) {
                this.onBounce?.(-v.y);
                v.y = -v.y * BOUNCE;
                v.x *= BOUNCE_FRICTION;
                v.z *= BOUNCE_FRICTION;
            } else {
                v.y = 0;
            }
        }

        if (p.y <= ground + 1e-3 && v.y === 0 && speed < STOP_SPEED) {
            v.set(0, 0, 0);
            this.state = 'resting';
            this.restTimer = 0;
        }
    }

    dispose() {
        this.group.traverse((o) => {
            o.geometry?.dispose();
            o.material?.map?.dispose();
            o.material?.dispose();
        });
    }
}
