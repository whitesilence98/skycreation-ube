import type { PlacedItem } from '@/lib/builderStore';
import {
  buildNavGrid,
  findNearestWalkable,
  findPath,
  isWorldWalkable,
  sampleRandomWalkable,
  type NavGrid,
} from '@/lib/builder/navGrid';
import {
  getSmartObjectDef,
  resolveSmartSlot,
  type ActionTag,
  type NeedKey,
  type SmartObjectDef,
} from '@/lib/builder/smartObjects';
import type { LifeActivitySnapshot, NeedsMap } from '@/lib/builder/lifeStore';

const NEED_DECAY_PER_GAME_MIN: Record<NeedKey, number> = {
  energy: 0.065,
  comfort: 0.08,
  fun: 0.095,
  grooming: 0.055,
};

const INDOOR_WALK_SPEED = 1.15;
const TURN_SPEED_RAD = 7.5;

type QueueStep =
  | {
      kind: 'move';
      waypoints: Array<[number, number]>;
      cursor: number;
    }
  | {
      kind: 'align';
      targetYaw: number;
    }
  | {
      kind: 'act';
      actionTag: ActionTag;
      durationGameMins: number;
      elapsedGameMins: number;
      restores: Partial<Record<NeedKey, number>>;
    };

interface ActivePlan {
  targetItemId: string | null;
  targetPosSnapshot: [number, number, number] | null;
  label: string;
  reason: string;
  actionTag: ActionTag;
  steps: QueueStep[];
}

export interface BrainStepInput {
  dtRealSec: number;
  deltaGameMins: number;
  timeScale: number;
  hourOfDay: number;
  clockFormatted: string;
  pos: [number, number];
  yaw: number;
  needs: NeedsMap;
  placedItems: PlacedItem[];
  recentItemIds: string[];
}

export interface BrainStepOutput {
  pos: [number, number];
  yaw: number;
  animationId: 'walk' | 'idle-clip';
  needs: NeedsMap;
  activity: LifeActivitySnapshot;
  consumedRecentItemId: string | null;
  newThought: string | null;
}

function clampNeed(v: number): number {
  return Math.max(0, Math.min(100, v));
}

function shortestAngleDelta(from: number, to: number): number {
  let diff = (to - from) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

function scoreCandidate(
  def: SmartObjectDef,
  needs: NeedsMap,
  hour: number,
  dist: number,
  isRecent: boolean,
): number {
  let motiveUtility = 0;
  let primaryReason = '';
  let maxContribution = -1;

  for (const [key, amount] of Object.entries(def.restores) as Array<[NeedKey, number]>) {
    const deficit = (100 - needs[key]) / 100;
    const contrib = Math.pow(deficit, 1.55) * amount * 1.4;
    motiveUtility += contrib;
    if (contrib > maxContribution) {
      maxContribution = contrib;
      primaryReason = `${key[0].toUpperCase()}${key.slice(1)} ${Math.round(needs[key])}%`;
    }
  }

  const timeMul = def.timeBias ? def.timeBias(hour) : 1.0;
  const noveltyBonus = isRecent ? 32 : 0;
  const distPenalty = dist * 1.35;
  const jitter = Math.random() * 4.5;

  const score = motiveUtility * timeMul + noveltyBonus - distPenalty + jitter;
  if (isRecent && !primaryReason) primaryReason = 'Curious about new item';
  return score;
}

/**
 * Pure simulation controller owning the 2D `NavGrid`, Utility AI task selector,
 * and atomic action queue (`MOVE -> ALIGN -> ACT`). Zero React/Three dependencies.
 */
export class RoomLifeBrain {
  private cachedItemsRef: PlacedItem[] | null = null;
  private grid: NavGrid | null = null;
  private plan: ActivePlan | null = null;
  private cooldownRealSec = 0.6;

  clearPlan(): void {
    this.plan = null;
    this.cooldownRealSec = 0.35;
  }

  private ensureGrid(items: PlacedItem[]): NavGrid {
    if (this.cachedItemsRef !== items || !this.grid) {
      this.cachedItemsRef = items;
      this.grid = buildNavGrid(items);
    }
    return this.grid;
  }

  private pickNextPlan(
    grid: NavGrid,
    input: BrainStepInput,
  ): { plan: ActivePlan; consumedRecentId: string | null; thought: string } {
    const recentSet = new Set(input.recentItemIds);
    let bestScore = -Infinity;
    let bestCandidate: {
      item: PlacedItem;
      def: SmartObjectDef;
      standXZ: [number, number];
      facingYaw: number;
      waypoints: Array<[number, number]>;
      reason: string;
    } | null = null;

    for (const item of input.placedItems) {
      const def = getSmartObjectDef(item.catalogId);
      if (!def) continue;

      const rawSlot = resolveSmartSlot(item, def);
      const safeStand = findNearestWalkable(grid, rawSlot.standXZ, 2);
      if (!safeStand) continue;

      const path = findPath(grid, input.pos, safeStand);
      if (!path) continue;

      const dist = Math.hypot(safeStand[0] - input.pos[0], safeStand[1] - input.pos[1]);
      const isRecent = recentSet.has(item.id);
      const score = scoreCandidate(def, input.needs, input.hourOfDay, dist, isRecent);

      if (score > bestScore) {
        bestScore = score;
        const lowNeed = (Object.keys(def.restores) as NeedKey[]).sort(
          (a, b) => input.needs[a] - input.needs[b],
        )[0];
        const reason = isRecent
          ? 'Inspecting newly placed furniture'
          : lowNeed
            ? `${lowNeed[0].toUpperCase()}${lowNeed.slice(1)} ${Math.round(input.needs[lowNeed])}%`
            : 'Ambient routine';
        bestCandidate = {
          item,
          def,
          standXZ: safeStand,
          facingYaw: rawSlot.facingYaw,
          waypoints: path,
          reason,
        };
      }
    }

    // Include Wander & Idle baseline threshold so well-rested characters still stroll naturally
    const wanderThreshold = 7.5 + Math.random() * 5;
    if (bestCandidate && bestScore >= wanderThreshold) {
      const { item, def, waypoints, facingYaw, reason } = bestCandidate;
      return {
        plan: {
          targetItemId: item.id,
          targetPosSnapshot: [...item.position],
          label: def.label,
          reason,
          actionTag: def.actionTag,
          steps: [
            { kind: 'move', waypoints, cursor: 0 },
            { kind: 'align', targetYaw: facingYaw },
            {
              kind: 'act',
              actionTag: def.actionTag,
              durationGameMins: def.durationGameMins,
              elapsedGameMins: 0,
              restores: def.restores,
            },
          ],
        },
        consumedRecentId: recentSet.has(item.id) ? item.id : null,
        thought: `${input.clockFormatted} · ${def.label} (${reason})`,
      };
    }

    // Fallback: Wander to random open tile
    const wanderTarget = sampleRandomWalkable(grid, input.pos, 1.1);
    const wanderPath = wanderTarget ? findPath(grid, input.pos, wanderTarget) : null;
    if (wanderPath && wanderPath.length > 0) {
      const lastPt = wanderPath[wanderPath.length - 1];
      const lookYaw = Math.atan2(lastPt[0] - input.pos[0], lastPt[1] - input.pos[1]);
      return {
        plan: {
          targetItemId: null,
          targetPosSnapshot: null,
          label: 'Strolling Around',
          reason: 'Needs satisfied',
          actionTag: 'idle',
          steps: [
            { kind: 'move', waypoints: wanderPath, cursor: 0 },
            { kind: 'align', targetYaw: lookYaw },
            {
              kind: 'act',
              actionTag: 'idle',
              durationGameMins: 12,
              elapsedGameMins: 0,
              restores: { comfort: 4 },
            },
          ],
        },
        consumedRecentId: null,
        thought: `${input.clockFormatted} · Strolling around studio`,
      };
    }

    return {
      plan: {
        targetItemId: null,
        targetPosSnapshot: null,
        label: 'Relaxing in Room',
        reason: 'Standing idle',
        actionTag: 'idle',
        steps: [
          {
            kind: 'act',
            actionTag: 'idle',
            durationGameMins: 10,
            elapsedGameMins: 0,
            restores: {},
          },
        ],
      },
      consumedRecentId: null,
      thought: `${input.clockFormatted} · Taking a moment`,
    };
  }

  step(input: BrainStepInput): BrainStepOutput {
    const grid = this.ensureGrid(input.placedItems);
    let pos: [number, number] = [input.pos[0], input.pos[1]];
    let yaw = input.yaw;
    let animationId: 'walk' | 'idle-clip' = 'idle-clip';
    let consumedRecentItemId: string | null = null;
    let newThought: string | null = null;

    // 1. Motive decay proportional to in-game time passed
    const nextNeeds: NeedsMap = {
      energy: clampNeed(input.needs.energy - NEED_DECAY_PER_GAME_MIN.energy * input.deltaGameMins),
      comfort: clampNeed(input.needs.comfort - NEED_DECAY_PER_GAME_MIN.comfort * input.deltaGameMins),
      fun: clampNeed(input.needs.fun - NEED_DECAY_PER_GAME_MIN.fun * input.deltaGameMins),
      grooming: clampNeed(
        input.needs.grooming - NEED_DECAY_PER_GAME_MIN.grooming * input.deltaGameMins,
      ),
    };

    // 2. Rescue if player placed a wall or furniture directly onto character
    if (!isWorldWalkable(grid, pos[0], pos[1])) {
      const safe = findNearestWalkable(grid, pos, 12);
      if (safe) {
        pos = safe;
        this.plan = null;
        this.cooldownRealSec = 0.25;
      }
    }

    // 3. Validate existing plan target if bound to a placed item
    if (this.plan?.targetItemId) {
      const liveItem = input.placedItems.find((i) => i.id === this.plan?.targetItemId);
      const snap = this.plan.targetPosSnapshot;
      const moved =
        !liveItem ||
        !snap ||
        Math.hypot(liveItem.position[0] - snap[0], liveItem.position[2] - snap[2]) > 0.25;
      if (moved) {
        this.plan = null;
        this.cooldownRealSec = 0.2;
      }
    }

    // 4. Select a new plan when idle and cooldown elapsed
    if (!this.plan) {
      if (input.timeScale > 0) {
        this.cooldownRealSec -= input.dtRealSec * Math.min(input.timeScale, 4);
      }
      if (this.cooldownRealSec <= 0 && input.timeScale > 0) {
        const picked = this.pickNextPlan(grid, { ...input, pos, needs: nextNeeds });
        this.plan = picked.plan;
        consumedRecentItemId = picked.consumedRecentId;
        newThought = picked.thought;
      }
    }

    // 5. Execute head step of the atomic queue
    let activity: LifeActivitySnapshot = {
      state: 'idle',
      actionTag: 'idle',
      label: 'Relaxing in Room',
      reason: 'Idle',
      targetItemId: null,
      progress: 0,
    };

    if (this.plan && this.plan.steps.length > 0) {
      const head = this.plan.steps[0];

      if (head.kind === 'move') {
        const target = head.waypoints[head.cursor];
        if (!target) {
          this.plan.steps.shift();
        } else {
          const dx = target[0] - pos[0];
          const dz = target[1] - pos[1];
          const dist = Math.hypot(dx, dz);
          const moveSpeed = INDOOR_WALK_SPEED * Math.min(Math.max(input.timeScale, 0.5), 2.8);
          const stepDist = input.timeScale > 0 ? moveSpeed * input.dtRealSec : 0;

          if (dist <= Math.max(0.08, stepDist)) {
            pos = [target[0], target[1]];
            head.cursor += 1;
            if (head.cursor >= head.waypoints.length) {
              this.plan.steps.shift();
            }
          } else if (stepDist > 0) {
            pos = [pos[0] + (dx / dist) * stepDist, pos[1] + (dz / dist) * stepDist];
            const desiredYaw = Math.atan2(dx, dz);
            const deltaYaw = shortestAngleDelta(yaw, desiredYaw);
            const maxTurn = TURN_SPEED_RAD * input.dtRealSec;
            yaw += Math.max(-maxTurn, Math.min(maxTurn, deltaYaw));
          }
          animationId = input.timeScale > 0 ? 'walk' : 'idle-clip';
          const progress =
            head.waypoints.length > 0 ? Math.min(1, head.cursor / head.waypoints.length) : 0;
          activity = {
            state: 'walking',
            actionTag: this.plan.actionTag,
            label: `Heading to ${this.plan.label.replace(/^(Using|Checking|Resting on|Lounging on|Relaxing in|Enjoying|Browsing)\s+/i, '')}`,
            reason: this.plan.reason,
            targetItemId: this.plan.targetItemId,
            progress,
          };
        }
      } else if (head.kind === 'align') {
        const deltaYaw = shortestAngleDelta(yaw, head.targetYaw);
        const maxTurn = TURN_SPEED_RAD * input.dtRealSec;
        if (Math.abs(deltaYaw) <= maxTurn || input.timeScale === 0) {
          if (input.timeScale > 0) yaw = head.targetYaw;
          if (Math.abs(deltaYaw) <= maxTurn) this.plan.steps.shift();
        } else {
          yaw += Math.sign(deltaYaw) * maxTurn;
        }
        animationId = 'idle-clip';
        activity = {
          state: 'walking',
          actionTag: this.plan.actionTag,
          label: this.plan.label,
          reason: this.plan.reason,
          targetItemId: this.plan.targetItemId,
          progress: 0,
        };
      } else if (head.kind === 'act') {
        animationId = 'idle-clip';
        const prevElapsed = head.elapsedGameMins;
        head.elapsedGameMins = Math.min(head.durationGameMins, prevElapsed + input.deltaGameMins);
        const fractionDelta =
          head.durationGameMins > 0 ? (head.elapsedGameMins - prevElapsed) / head.durationGameMins : 1;

        for (const [key, totalRestore] of Object.entries(head.restores) as Array<[NeedKey, number]>) {
          nextNeeds[key] = clampNeed(nextNeeds[key] + totalRestore * fractionDelta);
        }

        const progress =
          head.durationGameMins > 0 ? Math.min(1, head.elapsedGameMins / head.durationGameMins) : 1;

        activity = {
          state: 'acting',
          actionTag: head.actionTag,
          label: this.plan.label,
          reason: this.plan.reason,
          targetItemId: this.plan.targetItemId,
          progress,
        };

        if (head.elapsedGameMins >= head.durationGameMins) {
          this.plan.steps.shift();
          if (this.plan.steps.length === 0) {
            this.plan = null;
            this.cooldownRealSec = 0.7;
          }
        }
      }
    }

    return {
      pos,
      yaw,
      animationId,
      needs: nextNeeds,
      activity,
      consumedRecentItemId,
      newThought,
    };
  }
}
