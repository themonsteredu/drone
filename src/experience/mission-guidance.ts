import type { MissionRuntimeState } from "./missions";
import type { MissionDefinition, Vector3 } from "./types";
import type { FlightState } from "../simulator/flight-model";

export interface MissionGuidance {
  phaseLabel: string;
  destinationLabel: string;
  distanceMeters: number;
  relativeBearingDegrees: number;
  directionLabel: string;
  action: string;
  detail: string;
  routePercent: number;
  tone: "normal" | "warning";
}

const distance = (a: Vector3, b: Vector3) => Math.hypot(a.x - b.x, a.z - b.z);
const distance3 = (a: Vector3, b: Vector3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** A bearing relative to the aircraft nose, never a screen-stick command. */
export function destinationBearing(position: Vector3, yaw: number, target: Vector3) {
  const degrees = ((Math.atan2(target.x - position.x, target.z - position.z) - yaw) * 180) / Math.PI;
  const relativeBearingDegrees = ((degrees + 180) % 360 + 360) % 360 - 180;
  const directions = ["기체 앞쪽", "기체 오른쪽 앞", "기체 오른쪽", "기체 오른쪽 뒤", "기체 뒤쪽", "기체 왼쪽 뒤", "기체 왼쪽", "기체 왼쪽 앞"];
  return {
    relativeBearingDegrees,
    directionLabel: distance(position, target) < 0.4
      ? "지점 바로 위"
      : directions[(Math.round(relativeBearingDegrees / 45) + 8) % 8],
  };
}

/** Select the next point on the chosen corridor, not a shortcut to the clinic. */
function routePosition(points: readonly Vector3[], position: Vector3) {
  let nearest = Infinity;
  let nextIndex = 1;
  let travelled = 0;
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    const length = distance3(start, end);
    const fraction = length > 0 ? Math.max(0, Math.min(1,
      ((position.x - start.x) * (end.x - start.x) + (position.y - start.y) * (end.y - start.y) + (position.z - start.z) * (end.z - start.z)) / (length * length),
    )) : 0;
    const projected = { x: start.x + (end.x - start.x) * fraction, y: start.y + (end.y - start.y) * fraction, z: start.z + (end.z - start.z) * fraction };
    const separation = distance3(position, projected);
    if (separation < nearest) {
      nearest = separation;
      nextIndex = index;
      travelled = total + length * fraction;
    }
    total += length;
  }
  if (points[nextIndex] && distance3(position, points[nextIndex]) < 1.4) {
    nextIndex = Math.min(points.length - 1, nextIndex + 1);
  }
  return { nextIndex, percent: total > 0 ? Math.min(100, (travelled / total) * 100) : 0 };
}

export function getMissionGuidance(
  mission: MissionDefinition,
  runtime: MissionRuntimeState,
  flight: FlightState,
): MissionGuidance {
  const medical = mission.kind === "medical_delivery";
  const remaining = mission.targets.filter(target => target.required && target.action === "mission_action" && !runtime.foundTargetIds.includes(target.id));
  const nearby = remaining.find(target => Math.hypot(
    flight.position.x - target.position.x,
    flight.position.y - target.position.y,
    flight.position.z - target.position.z,
  ) <= target.activationRadius);
  const searchTarget = nearby ?? remaining[0];
  const returning = !medical && !searchTarget;
  const plan = mission.plans.find(candidate => candidate.id === runtime.selectedPlanId);
  const points = plan?.waypoints ?? [];
  // Restrict search guidance to the current signal's leg. Otherwise the return
  // path can be geometrically nearer and send a student home before searching.
  const targetIndices = mission.targets
    .filter(candidate => candidate.action === "mission_action")
    .map(candidate => points.findIndex(point => distance3(point, candidate.position) < 0.01))
    .filter(index => index >= 0);
  const endIndex = searchTarget
    ? points.findIndex(point => distance3(point, searchTarget.position) < 0.01)
    : points.length - 1;
  const startIndex = medical ? 0 : Math.max(0, ...targetIndices.filter(index => index < endIndex));
  const leg = points.slice(startIndex, Math.max(startIndex + 1, endIndex + 1));
  const route = routePosition(leg, flight.position);
  const landingDistance = distance(flight.position, mission.landingZone.center);
  const landingRadius = Math.max(...mission.landingZone.bands.map(band => band.maxRadius));
  const landingApproach = (medical || returning) && landingDistance < 4;
  const searchApproach = searchTarget && distance(flight.position, searchTarget.position) < searchTarget.activationRadius;
  const routePoint = !landingApproach && !searchApproach && !nearby ? leg[route.nextIndex] : undefined;
  const target = routePoint ?? searchTarget?.position ?? mission.landingZone.center;
  const intermediate = routePoint && route.nextIndex < leg.length - 1;
  const destinationLabel = intermediate
    ? `${returning ? "복귀" : "항로"} 경유점 ${startIndex + route.nextIndex}`
    : searchTarget?.label ?? mission.landingZone.label;
  const heightDifference = target.y - flight.position.y;
  const heightAction = heightDifference > 1.5 ? "상승하며" : heightDifference < -1.5 ? "하강하며" : "고도를 유지하며";
  const guidance: MissionGuidance = {
    phaseLabel: returning ? "지휘소 복귀" : medical ? "의약품 운송" : "구조 신호 확인",
    destinationLabel,
    distanceMeters: distance(flight.position, target),
    ...destinationBearing(flight.position, flight.yaw, target),
    action: returning ? `${heightAction} 복귀 항로를 따라가세요.` : `${heightAction} ${destinationLabel} 방향으로 운항하세요.`,
    detail: `목표 고도 ${target.y.toFixed(1)}m · 공중의 파란 경로를 따라 장애물을 피하세요.`,
    routePercent: route.percent,
    tone: "normal",
  };

  if (flight.emergencyLatched || flight.phase === "EMERGENCY") {
    return { ...guidance, phaseLabel: "안전 우선", action: flight.position.y > 0.03 ? "긴급 안전 착륙 중입니다." : "모터 정지 후 기체를 초기화하세요.", detail: "임무 진행을 멈추고 기체 상태를 확인하세요.", tone: "warning" };
  }
  if (!runtime.preflightConfirmed) {
    return { ...guidance, phaseLabel: "운항 준비", action: "항로와 출발 전 점검을 확인하세요.", detail: "기상·장애물·배터리를 판단한 뒤 운항을 시작하세요." };
  }
  if (runtime.operationPhase === "HANDOVER") {
    return { ...guidance, phaseLabel: "의약품 인계", action: "의료진에게 의약품을 인계하세요.", detail: "화물 상태를 확인하고 ‘의약품 인계 완료’를 누르세요." };
  }
  if (flight.phase === "READY" || flight.phase === "ARMING" || flight.phase === "STOP") {
    return { ...guidance, phaseLabel: "출발 준비", action: "시동을 걸어 출발하세요.", detail: "모터가 회전하는지 확인한 뒤 천천히 이륙하세요." };
  }
  if (flight.phase === "ARMED" || flight.phase === "START" || flight.phase === "TAKEOFF") {
    return { ...guidance, phaseLabel: "이륙", action: "주변을 확인하며 이륙하세요.", detail: "이륙 후 고도를 확보하고 선택한 항로로 진입하세요." };
  }
  if (flight.phase === "LANDING") {
    return { ...guidance, phaseLabel: "착륙", action: "하강 중 · 착륙 위치를 확인하세요.", detail: landingDistance <= landingRadius ? "지면에 닿은 뒤 모터가 멈출 때까지 확인하세요." : "목적지 착륙장 밖입니다. 착륙 후 재출발해야 합니다.", tone: landingDistance <= landingRadius ? "normal" : "warning" };
  }
  if (nearby) {
    return { ...guidance, action: "위치를 유지하고 촬영·위치 전송을 누르세요.", detail: `${nearby.label}의 구조 신호를 확인해 지휘소에 전달하세요.` };
  }
  if (landingApproach) {
    const centered = landingDistance <= mission.landingZone.bands[0].maxRadius;
    return { ...guidance, phaseLabel: "정밀 착륙", action: centered ? "착륙장 중앙입니다. 천천히 하강하세요." : "속도를 줄여 착륙장 중앙에 맞추세요.", detail: medical ? "의약품 충격을 줄이고 착륙 후 의료진에게 인계하세요." : "잔해와 주변을 살핀 뒤 지휘소 착륙장에 내려오세요." };
  }
  if (runtime.outsideSelectedCorridor) {
    return { ...guidance, action: "선택한 항로 안으로 복귀하세요.", detail: "방향 표시는 다음 지점의 위치입니다. 장애물을 피해 항로로 돌아오세요.", tone: "warning" };
  }
  if (searchTarget && distance(flight.position, searchTarget.position) < searchTarget.activationRadius) {
    return { ...guidance, action: "구조 신호를 확인할 고도로 조절하세요.", detail: `${searchTarget.label} 위에서 고도 ${searchTarget.position.y.toFixed(1)}m 부근으로 접근하세요.` };
  }
  return guidance;
}
