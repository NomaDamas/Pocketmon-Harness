import type { PokemonStateObservation } from "./pokemon-state";
import { STAGE1_VIRIDIAN_ROUTE_KNOWLEDGE } from "./stage1-active-route-knowledge";
import { POKEMON_RED_STAGE1_MAP_IDS } from "./stage1-evaluator";
import type { Stage1RouteWaypoint } from "./stage1-gameplay-schema";
import type { FailedMovementEdge, StuckMemorySnapshot } from "./stuck-memory";

export type Stage1PathfinderAction = "A" | "Down" | "Left" | "Right" | "Up";

export interface Stage1PathfinderPlan {
  action: Stage1PathfinderAction;
  backtrackingActive: boolean;
  blockedActions: readonly Stage1PathfinderAction[];
  currentNodeId: string;
  distance: number;
  method: "dijkstra";
  nextWaypoint?: Stage1RouteWaypoint;
  path: readonly string[];
  reason: string;
  targetNodeId: string;
}

interface GraphEdge {
  action: Stage1PathfinderAction;
  cost: number;
  from: string;
  to: string;
}

interface PlannerPosition {
  mapId: number;
  x: number;
  y: number;
}

const BLOCKED_ATTEMPTS_THRESHOLD = 3;
const BLOCKED_EDGE_COST = 1000;
const DEFAULT_EDGE_COST = 1;
const GOAL_NODE_ID = "goal:viridian-city";
const WAYPOINT_NODE_PATTERN = /^waypoint:(\d+)$/;
const NODE_ROUTE = [
  "current",
  "waypoint:0",
  "waypoint:1",
  "waypoint:2",
  "waypoint:3",
  "waypoint:5",
  GOAL_NODE_ID,
] as const;

const WAYPOINTS = STAGE1_VIRIDIAN_ROUTE_KNOWLEDGE.planning.waypointOrder;

export function planStage1Path({
  state,
  stuckMemory,
}: {
  state: PokemonStateObservation;
  stuckMemory?: StuckMemorySnapshot;
}): Stage1PathfinderPlan | undefined {
  const current = positionFromState(state);
  if (!current || state.battle || state.menuLike === true) {
    return;
  }

  const blockedActions = blockedActionsForCurrentPosition(current, stuckMemory);
  const backtrackingActive = blockedActions.length > 0;
  const currentIndex = routeIndexForPosition(current);
  const graph = createRouteGraph(currentIndex, current, blockedActions);
  const result = dijkstra(graph, NODE_ROUTE[currentIndex], GOAL_NODE_ID);
  if (!result) {
    return;
  }

  const preferredAction = chooseAction({
    blockedActions,
    current,
    nextWaypoint: waypointForNode(result.path[1]),
  });

  return {
    action: preferredAction,
    backtrackingActive,
    blockedActions,
    currentNodeId: NODE_ROUTE[currentIndex],
    distance: result.distance,
    method: "dijkstra",
    nextWaypoint: waypointForNode(result.path[1]),
    path: result.path,
    reason: formatPlanReason({
      backtrackingActive,
      blockedActions,
      current,
      nextWaypoint: waypointForNode(result.path[1]),
      preferredAction,
    }),
    targetNodeId: GOAL_NODE_ID,
  };
}

function positionFromState(
  state: PokemonStateObservation
): PlannerPosition | undefined {
  if (
    state.readStatus !== "available" ||
    state.mapId === null ||
    state.position.x === null ||
    state.position.y === null
  ) {
    return;
  }
  return {
    mapId: state.mapId,
    x: state.position.x,
    y: state.position.y,
  };
}

function createRouteGraph(
  currentIndex: number,
  current: PlannerPosition,
  blockedActions: readonly Stage1PathfinderAction[]
): GraphEdge[] {
  const edges: GraphEdge[] = [];
  for (let index = currentIndex; index < NODE_ROUTE.length - 1; index += 1) {
    const from = NODE_ROUTE[index];
    const to = NODE_ROUTE[index + 1];
    const action = actionTowardWaypoint(
      index === currentIndex ? current : waypointPositionForNode(from),
      waypointPositionForNode(to)
    );
    edges.push({
      action,
      cost: edgeCost(action, blockedActions),
      from,
      to,
    });

    if (index > currentIndex) {
      edges.push({
        action: reverseAction(action),
        cost: DEFAULT_EDGE_COST + 5,
        from: to,
        to: from,
      });
    }
  }
  return edges;
}

function dijkstra(
  edges: readonly GraphEdge[],
  start: string,
  goal: string
): { distance: number; path: string[] } | undefined {
  const nodes = new Set<string>([start, goal]);
  for (const edge of edges) {
    nodes.add(edge.from);
    nodes.add(edge.to);
  }

  const distances = new Map<string, number>();
  const previous = new Map<string, string>();
  const unvisited = new Set(nodes);
  distances.set(start, 0);

  while (unvisited.size > 0) {
    const current = [...unvisited].sort(
      (left, right) =>
        (distances.get(left) ?? Number.POSITIVE_INFINITY) -
        (distances.get(right) ?? Number.POSITIVE_INFINITY)
    )[0];
    if (!current || current === goal) {
      break;
    }
    unvisited.delete(current);

    const currentDistance = distances.get(current);
    if (currentDistance === undefined) {
      continue;
    }
    for (const edge of edges.filter(
      (candidate) => candidate.from === current
    )) {
      const nextDistance = currentDistance + edge.cost;
      if (nextDistance < (distances.get(edge.to) ?? Number.POSITIVE_INFINITY)) {
        distances.set(edge.to, nextDistance);
        previous.set(edge.to, current);
      }
    }
  }

  const distance = distances.get(goal);
  if (distance === undefined) {
    return;
  }

  const path = [goal];
  while (path[0] !== start) {
    const before = previous.get(path[0]);
    if (!before) {
      return;
    }
    path.unshift(before);
  }
  return { distance, path };
}

function routeIndexForPosition(position: PlannerPosition): number {
  if (position.mapId === POKEMON_RED_STAGE1_MAP_IDS.viridianCity) {
    return NODE_ROUTE.indexOf(GOAL_NODE_ID);
  }
  if (position.mapId === POKEMON_RED_STAGE1_MAP_IDS.palletTown) {
    return 1;
  }
  if (position.mapId === POKEMON_RED_STAGE1_MAP_IDS.route1) {
    if (position.y <= 0) {
      return 5;
    }
    return position.y > 20 ? 3 : 4;
  }
  return 0;
}

function waypointForNode(
  nodeId: string | undefined
): Stage1RouteWaypoint | undefined {
  if (!nodeId || nodeId === "current") {
    return;
  }
  if (nodeId === GOAL_NODE_ID) {
    return WAYPOINTS.at(-1);
  }
  const match = nodeId.match(WAYPOINT_NODE_PATTERN);
  if (!match) {
    return;
  }
  return WAYPOINTS[Number(match[1])];
}

function waypointPositionForNode(nodeId: string): PlannerPosition {
  return (
    waypointForNode(nodeId)?.position ?? {
      mapId: POKEMON_RED_STAGE1_MAP_IDS.viridianCity,
      x: 10,
      y: 30,
    }
  );
}

function actionTowardWaypoint(
  current: PlannerPosition,
  waypoint: PlannerPosition
): Stage1PathfinderAction {
  if (current.mapId !== waypoint.mapId) {
    return current.mapId === POKEMON_RED_STAGE1_MAP_IDS.route1 ? "Up" : "Up";
  }
  if (current.y > waypoint.y) {
    return "Up";
  }
  if (current.y < waypoint.y) {
    return "Down";
  }
  if (current.x < waypoint.x) {
    return "Right";
  }
  if (current.x > waypoint.x) {
    return "Left";
  }
  return "Up";
}

function chooseAction({
  blockedActions,
  current,
  nextWaypoint,
}: {
  blockedActions: readonly Stage1PathfinderAction[];
  current: PlannerPosition;
  nextWaypoint?: Stage1RouteWaypoint;
}): Stage1PathfinderAction {
  const direct = nextWaypoint
    ? actionTowardWaypoint(current, nextWaypoint.position)
    : "Up";
  if (!blockedActions.includes(direct)) {
    return direct;
  }
  for (const candidate of lateralBacktrackingCandidates(current.x)) {
    if (!blockedActions.includes(candidate)) {
      return candidate;
    }
  }
  return "A";
}

function lateralBacktrackingCandidates(x: number): Stage1PathfinderAction[] {
  return x <= 9 ? ["Right", "Left"] : ["Left", "Right"];
}

function edgeCost(
  action: Stage1PathfinderAction,
  blockedActions: readonly Stage1PathfinderAction[]
): number {
  return (
    DEFAULT_EDGE_COST +
    (blockedActions.includes(action) ? BLOCKED_EDGE_COST : 0)
  );
}

function reverseAction(action: Stage1PathfinderAction): Stage1PathfinderAction {
  if (action === "Down") {
    return "Up";
  }
  if (action === "Left") {
    return "Right";
  }
  if (action === "Right") {
    return "Left";
  }
  return "Down";
}

function blockedActionsForCurrentPosition(
  position: PlannerPosition,
  stuckMemory: StuckMemorySnapshot | undefined
): Stage1PathfinderAction[] {
  if (!stuckMemory) {
    return [];
  }

  const actions = new Set<Stage1PathfinderAction>();
  for (const edge of stuckMemory.failedMovementEdges) {
    if (
      edge.attempts >= BLOCKED_ATTEMPTS_THRESHOLD &&
      edgeMatchesPosition(edge, position)
    ) {
      const action = parseMovementAction(edge.action);
      if (action) {
        actions.add(action);
      }
    }
  }
  return [...actions];
}

function edgeMatchesPosition(
  edge: FailedMovementEdge,
  position: PlannerPosition
): boolean {
  return (
    edge.context.includes(`map=${position.mapId}`) &&
    edge.context.includes(`x=${position.x}`) &&
    edge.context.includes(`y=${position.y}`)
  );
}

function parseMovementAction(
  action: string
): Stage1PathfinderAction | undefined {
  const button = action.split(":").at(-1);
  if (
    button === "Down" ||
    button === "Left" ||
    button === "Right" ||
    button === "Up"
  ) {
    return button;
  }
  return;
}

function formatPlanReason({
  backtrackingActive,
  blockedActions,
  current,
  nextWaypoint,
  preferredAction,
}: {
  backtrackingActive: boolean;
  blockedActions: readonly Stage1PathfinderAction[];
  current: PlannerPosition;
  nextWaypoint?: Stage1RouteWaypoint;
  preferredAction: Stage1PathfinderAction;
}): string {
  const target = nextWaypoint
    ? `target map=${nextWaypoint.position.mapId} x=${nextWaypoint.position.x} y=${nextWaypoint.position.y}`
    : "target unknown";
  const block = backtrackingActive
    ? `blocked=${blockedActions.join(",")} so backtrack/detour`
    : "no local blocked edge";
  return `from map=${current.mapId} x=${current.x} y=${current.y}; ${target}; ${block}; press/hold ${preferredAction}`;
}
