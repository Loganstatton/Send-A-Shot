// Plinko — real Matter.js physics simulation.
//
// The board runs in a fixed *virtual* coordinate space (VIRTUAL_WIDTH x
// VIRTUAL_HEIGHT) regardless of how big the on-screen board is rendered —
// the renderer just scales this space uniformly to fit the canvas. Keeping
// physics tuning (gravity, restitution, steering force) independent of the
// viewer's actual screen size means the constants below only ever need to
// be tuned once.
//
// THE HONESTY CONSTRAINT: the backend has already decided the outcome
// (`resultDetail.path` / `resultDetail.bucket`) before any animation starts.
// The browser must never let live physics chance decide a payout. Instead,
// `simulateUntilMatch` runs the exact same Matter.js engine *headless*
// (no rendering, stepped far faster than real time) over and over, each
// time with small randomized spawn/velocity jitter and a small constant
// "steering" force toward the target bucket's column, until one full run's
// ball actually settles — physically, via real gravity/restitution/peg
// collisions — in the correct bucket. That one real, physically-valid run
// is recorded frame-by-frame and is exactly what gets played back in the
// real-time renderer. Nothing is snapped or faked after the fact; we only
// ever choose *which* valid physical outcome to show.
//
// Multi-ball groundwork: nothing here assumes a singleton ball — every
// function takes/returns its own engine, world and ball body, so running
// several independent simulations (or later, world instances) concurrently
// is just calling these functions more than once.

import Matter from "matter-js";

export const VIRTUAL_WIDTH = 300;
export const VIRTUAL_HEIGHT = 400;

// Layout regions as constant fractions of VIRTUAL_HEIGHT, independent of
// row count — the renderer reuses these fractions to position the DOM
// bucket row so it lines up with the canvas-drawn physics world exactly.
export const PEG_TOP_FRAC = 0.1;
export const PEG_BOTTOM_FRAC = 0.7;
export const BUCKET_TOP_FRAC = 0.76;
export const BUCKET_BOTTOM_FRAC = 0.94;
export const FLOOR_FRAC = 0.9;

export interface PegSpec {
  row: number;
  index: number;
  x: number;
  y: number;
}

export interface PlinkoLayout {
  width: number;
  height: number;
  rows: number;
  centerX: number;
  pegTopY: number;
  pegBottomY: number;
  rowSpacingY: number;
  spacingX: number;
  pegRadius: number;
  ballRadius: number;
  bucketTop: number;
  bucketBottom: number;
  floorY: number;
  leftWallX: number;
  rightWallX: number;
  spawnY: number;
  pegs: PegSpec[];
  bucketCount: number;
  bucketCenters: number[];
  /** length bucketCount + 1 */
  bucketBoundaries: number[];
}

export function computePlinkoLayout(rows: number, width: number = VIRTUAL_WIDTH, height: number = VIRTUAL_HEIGHT): PlinkoLayout {
  const pegTopY = height * PEG_TOP_FRAC;
  const pegBottomY = height * PEG_BOTTOM_FRAC;
  const bucketTop = height * BUCKET_TOP_FRAC;
  const bucketBottom = height * BUCKET_BOTTOM_FRAC;
  const floorY = height * FLOOR_FRAC;
  const centerX = width / 2;

  const rowSpacingY = rows > 1 ? (pegBottomY - pegTopY) / (rows - 1) : 0;
  const usableSpan = width * 0.82;
  const spacingX = usableSpan / Math.max(rows, 2);

  const pegRadius = Math.max(2, spacingX * 0.095);
  const ballRadius = Math.max(3.4, spacingX * 0.2);

  const pegs: PegSpec[] = [];
  for (let row = 0; row < rows; row++) {
    const count = row + 1;
    const y = rows > 1 ? pegTopY + row * rowSpacingY : pegTopY;
    const span = spacingX * (count - 1);
    for (let i = 0; i < count; i++) {
      pegs.push({ row, index: i, x: centerX - span / 2 + i * spacingX, y });
    }
  }

  const bucketCount = rows + 1;
  const bucketCenters: number[] = [];
  for (let k = 0; k < bucketCount; k++) {
    bucketCenters.push(centerX + (k - rows / 2) * spacingX);
  }
  const bucketBoundaries: number[] = [bucketCenters[0] - spacingX / 2];
  for (let k = 0; k < bucketCount - 1; k++) {
    bucketBoundaries.push((bucketCenters[k] + bucketCenters[k + 1]) / 2);
  }
  bucketBoundaries.push(bucketCenters[bucketCount - 1] + spacingX / 2);

  return {
    width,
    height,
    rows,
    centerX,
    pegTopY,
    pegBottomY,
    rowSpacingY,
    spacingX,
    pegRadius,
    ballRadius,
    bucketTop,
    bucketBottom,
    floorY,
    leftWallX: bucketBoundaries[0] - spacingX * 0.45,
    rightWallX: bucketBoundaries[bucketCount] + spacingX * 0.45,
    spawnY: Math.max(4, pegTopY - rowSpacingY * 0.9),
    pegs,
    bucketCount,
    bucketCenters,
    bucketBoundaries,
  };
}

export function bucketIndexForX(x: number, layout: PlinkoLayout): number {
  const { bucketBoundaries, bucketCount } = layout;
  const clamped = Math.min(Math.max(x, bucketBoundaries[0]), bucketBoundaries[bucketCount]);
  for (let k = 0; k < bucketCount; k++) {
    if (clamped < bucketBoundaries[k + 1] || k === bucketCount - 1) return k;
  }
  return bucketCount - 1;
}

export interface TrajectoryFrame {
  x: number;
  y: number;
  angle: number;
  speed: number;
}

export interface PegHitEvent {
  step: number;
  row: number;
  index: number;
  x: number;
  y: number;
  impactSpeed: number;
}

export interface SimAttemptResult {
  frames: TrajectoryFrame[];
  pegHits: PegHitEvent[];
  finalBucket: number;
  settled: boolean;
}

export interface ConvergenceResult extends SimAttemptResult {
  attempts: number;
  usedFallback: boolean;
}

interface AttemptOptions {
  rngSeed: number;
  spawnJitterX: number;
  spawnBias: number;
  spawnJitterVX: number;
  steerGain: number;
  steerCap: number;
  disablePegCollisions?: boolean;
}

// Small deterministic PRNG (mulberry32) so a given attempt index always
// reproduces the same jitter — makes tuning/debugging repeatable and keeps
// this module dependency-free.
function mulberry32(seed: number) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIXED_DT = 1000 / 60;
const MAX_STEPS = 480; // generous headroom (~8s of simulated fall time)
const SETTLE_SPEED = 0.05;
const SETTLE_STREAK_NEEDED = 20;
const TRAILING_PAD_FRAMES = 10; // a few resting frames after settle for a smooth stop

function buildAndRunAttempt(rows: number, layout: PlinkoLayout, targetBucket: number, opts: AttemptOptions): SimAttemptResult {
  const rng = mulberry32(opts.rngSeed);
  const engine = Matter.Engine.create();
  engine.gravity.y = 1;
  engine.positionIterations = 10;
  engine.velocityIterations = 10;
  const world = engine.world;

  const targetX = layout.bucketCenters[targetBucket];
  const spawnX = Matter.Common.clamp(
    layout.centerX + (targetX - layout.centerX) * opts.spawnBias + (rng() * 2 - 1) * opts.spawnJitterX,
    layout.leftWallX + layout.ballRadius * 1.5,
    layout.rightWallX - layout.ballRadius * 1.5
  );

  const ballGroup = opts.disablePegCollisions ? -1 : 0;
  const ball = Matter.Bodies.circle(spawnX, layout.spawnY, layout.ballRadius, {
    restitution: 0.55,
    friction: 0.03,
    frictionStatic: 0.02,
    frictionAir: 0.011,
    density: 0.02,
    label: "ball",
    collisionFilter: { group: ballGroup },
  });
  Matter.Body.setVelocity(ball, { x: (rng() * 2 - 1) * opts.spawnJitterVX, y: 0 });
  Matter.Body.setAngularVelocity(ball, (rng() * 2 - 1) * 0.03);

  const pegBodies = layout.pegs.map((p) =>
    Matter.Bodies.circle(p.x, p.y, layout.pegRadius, {
      isStatic: true,
      restitution: 0.62,
      friction: 0.12,
      frictionStatic: 0.12,
      label: `peg:${p.row}:${p.index}`,
      collisionFilter: { group: ballGroup },
    })
  );

  const wallHeight = layout.floorY - layout.pegTopY + 60;
  const wallMidY = (layout.floorY + layout.pegTopY) / 2;
  const wallThickness = 24;
  const leftWall = Matter.Bodies.rectangle(layout.leftWallX - wallThickness / 2, wallMidY, wallThickness, wallHeight, {
    isStatic: true,
    restitution: 0.25,
    friction: 0.15,
    label: "wall",
  });
  const rightWall = Matter.Bodies.rectangle(layout.rightWallX + wallThickness / 2, wallMidY, wallThickness, wallHeight, {
    isStatic: true,
    restitution: 0.25,
    friction: 0.15,
    label: "wall",
  });
  const floor = Matter.Bodies.rectangle(
    layout.centerX,
    layout.floorY + 10,
    layout.rightWallX - layout.leftWallX + 20,
    20,
    { isStatic: true, restitution: 0.12, friction: 0.75, label: "floor" }
  );
  // Low channeling stubs between buckets near the very bottom only — not
  // full dividers through the peg field, just enough to keep a settled
  // ball from casually rolling into the next column over.
  const dividers = layout.bucketBoundaries.slice(1, -1).map((bx) =>
    Matter.Bodies.rectangle(bx, (layout.bucketTop + layout.floorY) / 2, 3, layout.floorY - layout.bucketTop, {
      isStatic: true,
      restitution: 0.25,
      friction: 0.2,
      label: "divider",
    })
  );

  Matter.World.add(world, [ball, ...pegBodies, leftWall, rightWall, floor, ...dividers]);

  const pegHits: PegHitEvent[] = [];
  let currentStep = 0;
  Matter.Events.on(engine, "collisionStart", (evt) => {
    for (const pair of evt.pairs) {
      const other = pair.bodyA.label === "ball" ? pair.bodyB : pair.bodyB.label === "ball" ? pair.bodyA : null;
      if (other && other.label.startsWith("peg:")) {
        const [, rowStr, idxStr] = other.label.split(":");
        pegHits.push({
          step: currentStep,
          row: Number(rowStr),
          index: Number(idxStr),
          x: other.position.x,
          y: other.position.y,
          impactSpeed: Math.hypot(ball.velocity.x, ball.velocity.y),
        });
      }
    }
  });

  const frames: TrajectoryFrame[] = [];
  let settledStreak = 0;
  let deadStopStreak = 0;
  let settled = false;
  let lastProgressY = layout.spawnY;
  let stepsSinceProgress = 0;
  for (currentStep = 0; currentStep < MAX_STEPS; currentStep++) {
    const restingBeforeStep = ball.position.y > layout.floorY - layout.ballRadius - 3;
    const dx = targetX - ball.position.x;
    const steer = Matter.Common.clamp(dx * opts.steerGain, -opts.steerCap, opts.steerCap);
    // A real ball can never balance perfectly on a peg's apex — some tiny
    // asymmetry (a dust mote, a breath of air, imperfect roundness) always
    // breaks that equilibrium in practice. Our solver has no such noise by
    // default, so without this a symmetric drop can settle into an exact,
    // physically-unrealistic zero-velocity balance on top of a peg and
    // never reach the bucket floor. Only applied while still airborne/in
    // the peg field — once genuinely resting on the floor we let it settle
    // for real rather than keep perturbing it forever.
    const noise = restingBeforeStep ? 0 : (rng() * 2 - 1) * layout.spacingX * 0.00004;
    Matter.Body.applyForce(ball, ball.position, { x: (restingBeforeStep ? 0 : steer) * ball.mass + noise * ball.mass, y: 0 });

    Matter.Engine.update(engine, FIXED_DT);

    // Hard safety net: the ball must never leave the board's bounds (e.g.
    // tunneling through a thin wall at high speed in a single step). If it
    // somehow does, clamp it back in and kill the outward velocity — this
    // never fires in the normal case, it only guards against a solver
    // edge case, and it never determines *which* bucket wins.
    const minX = layout.leftWallX + layout.ballRadius + 1;
    const maxX = layout.rightWallX - layout.ballRadius - 1;
    if (ball.position.x < minX || ball.position.x > maxX) {
      Matter.Body.setPosition(ball, { x: Matter.Common.clamp(ball.position.x, minX, maxX), y: ball.position.y });
      Matter.Body.setVelocity(ball, { x: ball.velocity.x * -0.3, y: ball.velocity.y });
    }
    const maxY = layout.floorY + layout.ballRadius * 2;
    if (ball.position.y > maxY) {
      Matter.Body.setPosition(ball, { x: ball.position.x, y: layout.floorY - layout.ballRadius });
      Matter.Body.setVelocity(ball, { x: ball.velocity.x, y: 0 });
    }

    const speed = Math.hypot(ball.velocity.x, ball.velocity.y);
    frames.push({ x: ball.position.x, y: ball.position.y, angle: ball.angle, speed });

    const resting = ball.position.y > layout.floorY - layout.ballRadius - 3;

    // Guard against the ball reaching a static friction dead-lock (net
    // applied force too small to overcome frictionStatic) somewhere above
    // the floor — e.g. balanced on a peg. A real ball never truly locks up
    // like that, so if we see a hard, motionless stall away from the floor
    // for too many consecutive steps, give it one small dislodging kick
    // (still just gravity + a nudge, not a teleport) and keep simulating.
    if (!resting && speed < 1e-6) {
      deadStopStreak++;
      if (deadStopStreak > 15) {
        Matter.Body.setVelocity(ball, { x: (rng() * 2 - 1) * layout.spacingX * 0.01, y: -layout.spacingX * 0.003 });
        deadStopStreak = 0;
      }
    } else {
      deadStopStreak = 0;
    }

    // Similar guard for a wedge-jam between two adjacent pegs' V-notch: the
    // ball keeps twitching (nonzero speed) but makes no real downward
    // progress for a long stretch. Two circles of realistic relative size
    // essentially never lock a falling ball like this in the real world;
    // when the solver finds that artifact, give it one firm downward-biased
    // nudge — still ordinary velocity, still subject to gravity and every
    // later peg collision, just enough to break the jam.
    if (!resting && ball.position.y > lastProgressY + layout.ballRadius * 0.4) {
      lastProgressY = ball.position.y;
      stepsSinceProgress = 0;
    } else if (!resting) {
      stepsSinceProgress++;
      if (stepsSinceProgress > 18) {
        Matter.Body.setVelocity(ball, {
          x: (rng() * 2 - 1) * Math.min(layout.spacingX * 0.18, 3.5),
          y: Math.min(layout.spacingX * 0.16, 3),
        });
        stepsSinceProgress = 0;
        lastProgressY = ball.position.y;
      }
    }

    if (resting && speed < SETTLE_SPEED) {
      settledStreak++;
      if (settledStreak >= SETTLE_STREAK_NEEDED) {
        settled = true;
        for (let pad = 0; pad < TRAILING_PAD_FRAMES; pad++) {
          frames.push({ x: ball.position.x, y: ball.position.y, angle: ball.angle, speed: 0 });
        }
        break;
      }
    } else {
      settledStreak = 0;
    }
  }

  const finalBucket = bucketIndexForX(ball.position.x, layout);
  return { frames, pegHits, finalBucket, settled };
}

function attemptOptionsFor(layout: PlinkoLayout, attempt: number): AttemptOptions {
  // Escalate steering strength (and slightly bias the spawn point) the
  // longer we go without a match — most drops converge fast at low,
  // barely-perceptible steering (so the ball still visibly "fights" the
  // pegs), but the rarest edge buckets get progressively more help rather
  // than looping forever.
  const escalation = Math.floor(attempt / 25);
  const forceScale = 1 + escalation * 0.6;
  return {
    rngSeed: attempt * 104729 + 17,
    spawnJitterX: layout.spacingX * 0.5,
    spawnBias: Math.min(0.55, 0.12 + escalation * 0.08),
    spawnJitterVX: layout.spacingX * 0.012,
    steerGain: 0.00075 * forceScale,
    steerCap: layout.spacingX * 0.00075 * forceScale,
  };
}

const HARD_FALLBACK_BUDGET = 500;

/**
 * Runs the headless simulation repeatedly (fast — no rendering, engine
 * stepped directly) until a run's ball settles in `targetBucket`. Returns
 * that run's full recorded trajectory plus how many attempts it took.
 *
 * Guarantee: this always returns a result whose `finalBucket === targetBucket`.
 * If normal attempts (with escalating-but-still-bounded steering) don't
 * converge within the budget — should essentially never happen once tuned —
 * a final deterministic fallback pass disables ball-peg collisions (the
 * ball still falls under real gravity/force/floor collision, it just can't
 * be knocked off column by a peg) and applies strong centering force, which
 * mathematically cannot land anywhere but the target column. It's still a
 * real physics run, just a less chaotic-looking one — never a silent
 * snap-to-bucket after the fact.
 */
export function simulateUntilMatch(rows: number, targetBucket: number, layout: PlinkoLayout = computePlinkoLayout(rows)): ConvergenceResult {
  for (let attempt = 0; attempt < HARD_FALLBACK_BUDGET; attempt++) {
    const opts = attemptOptionsFor(layout, attempt);
    const result = buildAndRunAttempt(rows, layout, targetBucket, opts);
    if (result.finalBucket === targetBucket) {
      return { ...result, attempts: attempt + 1, usedFallback: false };
    }
  }

  // Deterministic guaranteed fallback: no peg collisions to be knocked off
  // course by, strong centering force. This cannot miss the target column.
  const forced = buildAndRunAttempt(rows, layout, targetBucket, {
    rngSeed: 999983,
    spawnJitterX: layout.spacingX * 0.15,
    spawnBias: 1,
    spawnJitterVX: 0,
    steerGain: 0.02,
    steerCap: layout.spacingX * 0.02,
    disablePegCollisions: true,
  });
  return { ...forced, attempts: HARD_FALLBACK_BUDGET, usedFallback: true };
}
