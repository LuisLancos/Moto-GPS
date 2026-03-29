"""Post-route anomaly detection and improvement suggestions.

Detects waypoint-level issues (backtracking, proximity, detour ratio),
route geometry issues (U-turns), and road-quality issues via PostGIS.
"""

import asyncio
import time

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.route import (
    AnomalyFix,
    AnomalySegment,
    AnomalySeverity,
    AnomalyType,
    RouteAnomaly,
    RouteAnalysisResponse,
    RouteResult,
    Waypoint,
)


# ──────────────────── Geometry Helpers ────────────────────

from app.utils.geo import (
    bearing as _bearing,
    haversine_m_lnglat as _haversine_m,
    angular_diff as _angular_diff,
)


def _wp_to_lnglat(wp: Waypoint) -> list[float]:
    """Convert Waypoint to [lng, lat] for geometry functions."""
    return [wp.lng, wp.lat]


def _shape_index_for_leg(route: RouteResult, leg_index: int) -> tuple[int, int]:
    """Estimate shape index range for a given leg using maneuvers."""
    if not route.maneuvers:
        # Fallback: divide shape evenly across legs
        n = len(route.shape)
        num_legs = max(len(route.legs), 1)
        start = (n * leg_index) // num_legs
        end = (n * (leg_index + 1)) // num_legs
        return start, end

    # Find maneuvers belonging to this leg by accumulating leg distances
    cum_dist = 0.0
    leg_start_dist = sum(l.distance_m for l in route.legs[:leg_index])
    leg_end_dist = leg_start_dist + (route.legs[leg_index].distance_m if leg_index < len(route.legs) else 0)

    start_idx = 0
    end_idx = len(route.shape) - 1
    for m in route.maneuvers:
        m_dist = m.length * 1000  # km to m
        if cum_dist + m_dist <= leg_start_dist:
            start_idx = m.end_shape_index
        if cum_dist >= leg_end_dist:
            end_idx = m.begin_shape_index
            break
        cum_dist += m_dist

    return start_idx, min(end_idx, len(route.shape) - 1)


# ──────────────────── Geometry Detectors ────────────────────

def detect_backtracking(waypoints: list[Waypoint], route: RouteResult) -> list[RouteAnomaly]:
    """Detect waypoints that cause the route to reverse direction.

    Uses LOCAL context (previous + next segment bearings) instead of a global
    overall bearing.  This correctly handles loop routes where start ≈ end.

    A waypoint is flagged only when it causes a sharp reversal (>140°) relative
    to the PREVIOUS travel direction AND adds significant extra distance
    (the two legs around it are >2× the straight-line from prev→next).
    """
    if len(waypoints) < 4:
        return []

    anomalies: list[RouteAnomaly] = []

    for i in range(1, len(waypoints) - 1):
        prev = _wp_to_lnglat(waypoints[i - 1])
        curr = _wp_to_lnglat(waypoints[i])
        nxt  = _wp_to_lnglat(waypoints[i + 1])

        # Bearing of incoming leg vs outgoing leg
        bearing_in  = _bearing(prev, curr)
        bearing_out = _bearing(curr, nxt)
        reversal    = _angular_diff(bearing_in, bearing_out)

        if reversal < 140:
            continue  # Not a sharp enough reversal

        # Check if it actually adds significant distance (not just a slight zig-zag)
        dist_via = (
            _haversine_m(prev, curr) + _haversine_m(curr, nxt)
        )
        dist_direct = _haversine_m(prev, nxt)
        if dist_direct < 500:
            continue  # Prev and next are very close — not worth flagging
        if dist_via < dist_direct * 2.0:
            continue  # The detour isn't significant enough

        si, ei = _shape_index_for_leg(route, i - 1)
        _, ei2 = _shape_index_for_leg(route, i)
        ei = max(ei, ei2)  # Span both legs around the problematic waypoint

        wp_label = waypoints[i].label or f"waypoint {i + 1}"

        # Suggest moving to the midpoint between prev and next
        mid_lng = (waypoints[i - 1].lng + waypoints[i + 1].lng) / 2
        mid_lat = (waypoints[i - 1].lat + waypoints[i + 1].lat) / 2

        fixes = [
            AnomalyFix(
                action="move_waypoint",
                waypoint_index=i,
                suggested_coord=[mid_lng, mid_lat],
                description=f"Move {wp_label} to a position between the surrounding waypoints",
            ),
            AnomalyFix(
                action="remove_waypoint",
                waypoint_index=i,
                description=f"Remove {wp_label}",
            ),
        ]

        extra_km = (dist_via - dist_direct) / 1000
        anomalies.append(RouteAnomaly(
            type=AnomalyType.backtracking,
            severity=AnomalySeverity.issue,
            title=f"Route reverses at {wp_label}",
            description=(
                f"{wp_label} causes a {reversal:.0f}° direction reversal, "
                f"adding ~{extra_km:.0f}km of extra distance. "
                f"The route doubles back on itself here."
            ),
            segment=AnomalySegment(
                start_shape_index=si,
                end_shape_index=ei,
                start_coord=prev,
                end_coord=nxt,
            ),
            affected_waypoint_index=i,
            metric_value=reversal,
            metric_threshold=140.0,
            fix=fixes[0],
            fixes=fixes,
        ))

    return anomalies


def detect_close_proximity(waypoints: list[Waypoint], route: RouteResult) -> list[RouteAnomaly]:
    """Detect consecutive waypoints that are very close together.

    Skips pairs where either waypoint is an overnight stop or POI (hotels, fuel stations)
    since those are intentionally placed near other waypoints.
    """
    if len(waypoints) < 3:
        return []

    # Keywords indicating intentional close placement
    _skip_keywords = {"hotel", "b&b", "inn", "lodge", "guest", "hostel", "overnight",
                      "accommodation", "fuel", "petrol", "shell", "bp", "esso", "four seasons",
                      "premier inn", "travelodge", "holiday inn"}

    anomalies = []
    distances = []
    for i in range(len(waypoints) - 1):
        d = _haversine_m(_wp_to_lnglat(waypoints[i]), _wp_to_lnglat(waypoints[i + 1]))
        distances.append(d)

    avg_spacing = sum(distances) / len(distances) if distances else 0
    threshold = max(avg_spacing * 0.08, 1500)  # 8% of average or 1.5km floor

    for i, d in enumerate(distances):
        if d < threshold and len(distances) > 1:
            # Skip if either waypoint looks like an overnight stop or POI
            wp1_label = (getattr(waypoints[i], "label", "") or "").lower()
            wp2_label = (getattr(waypoints[i + 1], "label", "") or "").lower()
            if any(kw in wp1_label for kw in _skip_keywords) or any(kw in wp2_label for kw in _skip_keywords):
                continue
            # Skip if either has is_overnight flag
            if getattr(waypoints[i], "is_overnight", False) or getattr(waypoints[i + 1], "is_overnight", False):
                continue

            si, ei = _shape_index_for_leg(route, i)
            wp1_label = waypoints[i].label or f"waypoint {i + 1}"
            wp2_label = waypoints[i + 1].label or f"waypoint {i + 2}"

            # Midpoint for merge suggestion
            mid_lng = (waypoints[i].lng + waypoints[i + 1].lng) / 2
            mid_lat = (waypoints[i].lat + waypoints[i + 1].lat) / 2

            fixes = [
                AnomalyFix(
                    action="remove_waypoint",
                    waypoint_index=i + 1,
                    description=f"Remove {wp2_label} — it's very close to {wp1_label}",
                ),
                AnomalyFix(
                    action="move_waypoint",
                    waypoint_index=i + 1,
                    suggested_coord=[mid_lng, mid_lat],
                    description=f"Merge: move {wp2_label} to midpoint between the two",
                ),
            ]

            anomalies.append(RouteAnomaly(
                type=AnomalyType.close_proximity,
                severity=AnomalySeverity.warning,
                title=f"{wp1_label} and {wp2_label} are very close",
                description=(
                    f"Only {d / 1000:.1f} km apart (average spacing is {avg_spacing / 1000:.1f} km). "
                    f"This may be a misplaced waypoint."
                ),
                segment=AnomalySegment(
                    start_shape_index=si,
                    end_shape_index=ei,
                    start_coord=_wp_to_lnglat(waypoints[i]),
                    end_coord=_wp_to_lnglat(waypoints[i + 1]),
                ),
                affected_waypoint_index=i + 1,
                metric_value=d,
                metric_threshold=threshold,
                fix=fixes[0],
                fixes=fixes,
            ))

    return anomalies


def detect_detour_ratio(waypoints: list[Waypoint], route: RouteResult) -> list[RouteAnomaly]:
    """Detect legs where the routed distance is disproportionately longer than straight-line."""
    if len(route.legs) < 2:
        return []

    anomalies = []
    ratios = []
    for i, leg in enumerate(route.legs):
        if i >= len(waypoints) - 1:
            break
        straight = _haversine_m(_wp_to_lnglat(waypoints[i]), _wp_to_lnglat(waypoints[i + 1]))
        if straight < 1000:  # skip very short segments
            ratios.append(1.0)
            continue
        ratio = leg.distance_m / straight
        ratios.append(ratio)

    if not ratios:
        return []

    avg_ratio = sum(ratios) / len(ratios)

    for i, ratio in enumerate(ratios):
        if ratio > 2.5 and ratio > avg_ratio * 1.8:
            si, ei = _shape_index_for_leg(route, i)
            straight = _haversine_m(_wp_to_lnglat(waypoints[i]), _wp_to_lnglat(waypoints[i + 1]))
            anomalies.append(RouteAnomaly(
                type=AnomalyType.detour_ratio,
                severity=AnomalySeverity.warning,
                title=f"Large detour on leg {i + 1}→{i + 2}",
                description=(
                    f"Route covers {route.legs[i].distance_m / 1000:.1f} km "
                    f"for a {straight / 1000:.1f} km straight-line distance "
                    f"({ratio:.1f}x ratio, average is {avg_ratio:.1f}x)."
                ),
                segment=AnomalySegment(
                    start_shape_index=si,
                    end_shape_index=ei,
                    start_coord=_wp_to_lnglat(waypoints[i]),
                    end_coord=_wp_to_lnglat(waypoints[i + 1]),
                ),
                affected_waypoint_index=i + 1 if i > 0 else None,
                metric_value=ratio,
                metric_threshold=2.5,
                fix=AnomalyFix(
                    action="add_waypoint",
                    suggested_coord=[
                        (waypoints[i].lng + waypoints[i + 1].lng) / 2,
                        (waypoints[i].lat + waypoints[i + 1].lat) / 2,
                    ],
                    description="Add a waypoint midway to guide the router more directly",
                ),
            ))

    return anomalies


def detect_u_turns(route: RouteResult, waypoints: list[Waypoint] | None = None) -> list[RouteAnomaly]:
    """Detect U-turns from Valhalla maneuver types or shape bearing reversals."""
    anomalies = []

    # Check Valhalla maneuver types: 12 = U-turn right, 13 = U-turn left
    for m in route.maneuvers:
        if m.type in (12, 13) and m.length > 0.3:  # >300m U-turn
            si = m.begin_shape_index
            ei = m.end_shape_index
            start_coord = route.shape[si] if si < len(route.shape) else route.shape[0]
            end_coord = route.shape[ei] if ei < len(route.shape) else route.shape[-1]
            road_name = ", ".join(m.street_names) or "unnamed road"
            # Try to find the nearest waypoint to this U-turn
            nearest_wp_idx = None
            fixes = []
            if waypoints:
                min_wp_dist = float("inf")
                for wi in range(len(waypoints)):
                    wd = _haversine_m(start_coord, _wp_to_lnglat(waypoints[wi]))
                    if wd < min_wp_dist:
                        min_wp_dist = wd
                        nearest_wp_idx = wi

                if nearest_wp_idx is not None and nearest_wp_idx > 0 and nearest_wp_idx < len(waypoints) - 1:
                    fixes.append(AnomalyFix(
                        action="move_waypoint",
                        waypoint_index=nearest_wp_idx,
                        suggested_coord=[
                            (waypoints[nearest_wp_idx - 1].lng + waypoints[nearest_wp_idx + 1].lng) / 2,
                            (waypoints[nearest_wp_idx - 1].lat + waypoints[nearest_wp_idx + 1].lat) / 2,
                        ],
                        description="Move nearby waypoint to eliminate the U-turn",
                    ))
                    fixes.append(AnomalyFix(
                        action="remove_waypoint",
                        waypoint_index=nearest_wp_idx,
                        description="Remove the waypoint causing this U-turn",
                    ))

            if not fixes:
                fixes.append(AnomalyFix(
                    action="no_action",
                    description="Check nearby waypoints — one may be in the wrong position",
                ))

            anomalies.append(RouteAnomaly(
                type=AnomalyType.u_turn,
                severity=AnomalySeverity.issue,
                title=f"U-turn at {road_name}",
                description=(
                    f"The route makes a U-turn covering {m.length:.1f} km. "
                    f"This usually indicates a misplaced waypoint."
                ),
                segment=AnomalySegment(
                    start_shape_index=si,
                    end_shape_index=ei,
                    start_coord=start_coord,
                    end_coord=end_coord,
                ),
                affected_waypoint_index=nearest_wp_idx,
                metric_value=m.length,
                metric_threshold=0.3,
                fix=fixes[0],
                fixes=fixes,
            ))

    # Also detect from shape bearing changes (catches cases Valhalla doesn't flag)
    if len(route.shape) > 40:
        step = 20
        prev_bearing = _bearing(route.shape[0], route.shape[step])
        reversal_start = None

        for i in range(step, len(route.shape) - step, step):
            curr_bearing = _bearing(route.shape[i], route.shape[min(i + step, len(route.shape) - 1)])
            diff = _angular_diff(prev_bearing, curr_bearing)

            if diff > 150:
                if reversal_start is None:
                    reversal_start = i - step
            elif reversal_start is not None:
                # Reversal ended — check distance
                rev_dist = 0.0
                for j in range(reversal_start, i, step):
                    rev_dist += _haversine_m(route.shape[j], route.shape[min(j + step, len(route.shape) - 1)])
                if rev_dist > 1000:  # >1km reversal
                    # Only add if not already covered by a maneuver-based detection
                    already_detected = any(
                        a.type == AnomalyType.u_turn
                        and abs(a.segment.start_shape_index - reversal_start) < step * 2
                        for a in anomalies
                    )
                    if not already_detected:
                        anomalies.append(RouteAnomaly(
                            type=AnomalyType.u_turn,
                            severity=AnomalySeverity.issue,
                            title="Route reverses direction",
                            description=f"The route doubles back for approximately {rev_dist / 1000:.1f} km.",
                            segment=AnomalySegment(
                                start_shape_index=reversal_start,
                                end_shape_index=i,
                                start_coord=route.shape[reversal_start],
                                end_coord=route.shape[i],
                            ),
                            metric_value=rev_dist,
                            metric_threshold=1000.0,
                            fix=AnomalyFix(
                                action="no_action",
                                description="Check nearby waypoints — one may be causing the detour",
                            ),
                        ))
                reversal_start = None

            prev_bearing = curr_bearing

    return anomalies


# ──────────────────── PostGIS Detectors ────────────────────

async def detect_road_quality_drop(db: AsyncSession, route: RouteResult) -> list[RouteAnomaly]:
    """Detect segments where road quality drops significantly below route average."""
    if len(route.shape) < 100:
        return []

    anomalies = []
    group_size = 50  # points per group
    groups = []

    for start in range(0, len(route.shape) - group_size, group_size):
        end = min(start + group_size, len(route.shape))
        # Sample a few points from this group
        sample_indices = list(range(start, end, 10))
        points = [route.shape[i] for i in sample_indices if i < len(route.shape)]
        if len(points) < 2:
            continue
        groups.append((start, end, points))

    if len(groups) < 3:
        return []

    # Batch all groups into a SINGLE SQL query with group IDs
    # Instead of N sequential queries, we run one query that returns scores per group
    all_values = []
    for gidx, (start, end, points) in enumerate(groups):
        for p in points:
            all_values.append(f"({gidx}, ST_SetSRID(ST_MakePoint({p[0]}, {p[1]}), 4326))")

    if not all_values:
        return []

    values_sql = ", ".join(all_values)
    query = text(f"""
        WITH pts(gid, pt) AS (VALUES {values_sql})
        SELECT pts.gid,
               COALESCE(AVG(rs.composite_moto_score), 0) AS avg_score,
               COALESCE(AVG(rs.surface_score), 0) AS avg_surface
        FROM pts
        LEFT JOIN road_segments rs
          ON ST_DWithin(rs.geometry, pts.pt, 0.001) AND rs.length_m > 10
        GROUP BY pts.gid
        ORDER BY pts.gid
    """)
    result = await db.execute(query)
    rows = {r.gid: (r.avg_score, r.avg_surface) for r in result.fetchall()}

    group_scores = []
    for gidx, (start, end, _points) in enumerate(groups):
        score, surface = rows.get(gidx, (0, 0))
        group_scores.append((start, end, score, surface))

    if not group_scores:
        return []

    route_avg = sum(s[2] for s in group_scores) / len(group_scores)

    for start, end, score, surface in group_scores:
        if score < route_avg * 0.5 and score < 0.25:
            mid_idx = (start + end) // 2
            mid_pt = route.shape[min(mid_idx, len(route.shape) - 1)]
            # Suggest adding a bypass waypoint slightly offset from the bad section
            offset_lng = mid_pt[0] + 0.005  # ~500m offset
            offset_lat = mid_pt[1] + 0.005

            fixes = [
                AnomalyFix(
                    action="add_waypoint",
                    suggested_coord=[offset_lng, offset_lat],
                    description="Add a waypoint to bypass this poor road section",
                ),
                AnomalyFix(
                    action="no_action",
                    description="Ignore — road conditions may be acceptable",
                ),
            ]

            anomalies.append(RouteAnomaly(
                type=AnomalyType.road_quality_drop,
                severity=AnomalySeverity.warning,
                title="Road quality drops here",
                description=(
                    f"This section scores {score:.2f} vs route average {route_avg:.2f}. "
                    f"Surface quality: {surface:.2f}. May be poor road conditions."
                ),
                segment=AnomalySegment(
                    start_shape_index=start,
                    end_shape_index=end,
                    start_coord=route.shape[start],
                    end_coord=route.shape[min(end, len(route.shape) - 1)],
                ),
                metric_value=score,
                metric_threshold=route_avg * 0.5,
                fix=fixes[0],
                fixes=fixes,
            ))

    return anomalies[:3]  # Limit to avoid overwhelming the UI


async def detect_missed_roads(db: AsyncSession, route: RouteResult) -> list[RouteAnomaly]:
    """Detect high-scoring roads near the route that weren't used."""
    if len(route.shape) < 50:
        return []

    anomalies = []
    # Sample every ~200th point
    sample_step = max(len(route.shape) // 15, 50)

    for i in range(0, len(route.shape) - sample_step, sample_step):
        pt = route.shape[i]
        local_bearing = _bearing(route.shape[i], route.shape[min(i + sample_step, len(route.shape) - 1)])

        query = text("""
            WITH sample AS (
                SELECT ST_SetSRID(ST_MakePoint(:lng, :lat), 4326) AS pt
            ),
            nearby_good AS (
                SELECT rs.name, rs.ref, rs.composite_moto_score,
                       ST_Y(ST_Centroid(rs.geometry)) AS lat,
                       ST_X(ST_Centroid(rs.geometry)) AS lng,
                       degrees(ST_Azimuth(ST_StartPoint(rs.geometry), ST_EndPoint(rs.geometry))) AS seg_bearing
                FROM road_segments rs, sample s
                WHERE ST_DWithin(rs.geometry, s.pt, 0.02)
                  AND rs.composite_moto_score > 0.55
                  AND rs.length_m > 500
                  AND rs.road_class IN ('scenic_rural')
            ),
            on_route AS (
                SELECT rs.id
                FROM road_segments rs, sample s
                WHERE ST_DWithin(rs.geometry, s.pt, 0.002)
            )
            SELECT ng.name, ng.ref, ng.composite_moto_score, ng.lat, ng.lng, ng.seg_bearing
            FROM nearby_good ng
            WHERE NOT EXISTS (
                SELECT 1 FROM road_segments rs2, sample s
                WHERE rs2.name = ng.name AND rs2.ref = ng.ref
                  AND ST_DWithin(rs2.geometry, s.pt, 0.002)
            )
            ORDER BY ng.composite_moto_score DESC
            LIMIT 1
        """)
        result = await db.execute(query, {"lng": pt[0], "lat": pt[1]})
        row = result.fetchone()

        if row and row.composite_moto_score > 0.55:
            # Check bearing similarity (within 45°)
            bearing_diff = _angular_diff(local_bearing, row.seg_bearing or 0)
            if bearing_diff < 45:
                road_name = row.name or row.ref or "unnamed scenic road"
                anomalies.append(RouteAnomaly(
                    type=AnomalyType.missed_high_scoring_road,
                    severity=AnomalySeverity.suggestion,
                    title=f"Scenic road nearby: {road_name}",
                    description=(
                        f"{road_name} (score {row.composite_moto_score:.2f}) is within 2km "
                        f"and goes in a similar direction. Consider routing through it."
                    ),
                    segment=AnomalySegment(
                        start_shape_index=i,
                        end_shape_index=min(i + sample_step, len(route.shape) - 1),
                        start_coord=pt,
                        end_coord=route.shape[min(i + sample_step, len(route.shape) - 1)],
                    ),
                    metric_value=row.composite_moto_score,
                    metric_threshold=0.55,
                    fix=(missed_fix := AnomalyFix(
                        action="add_waypoint",
                        suggested_coord=[row.lng, row.lat],
                        description=f"Add waypoint at {road_name} to route through this scenic road",
                    )),
                    fixes=[
                        missed_fix,
                        AnomalyFix(
                            action="no_action",
                            description="Ignore — current route may be preferable",
                        ),
                    ],
                ))

    # Deduplicate by road name
    seen_names = set()
    unique = []
    for a in anomalies:
        key = a.title
        if key not in seen_names:
            seen_names.add(key)
            unique.append(a)

    return unique[:3]


# ──────────────────── Orchestrator ────────────────────

async def analyze_route(
    db: AsyncSession,
    route: RouteResult,
    waypoints: list[Waypoint],
) -> RouteAnalysisResponse:
    """Run all anomaly detectors and return combined results."""
    t0 = time.perf_counter()

    # Phase 1: Fast geometry checks (no DB)
    geometry_anomalies = []
    geometry_anomalies.extend(detect_backtracking(waypoints, route))
    geometry_anomalies.extend(detect_close_proximity(waypoints, route))
    geometry_anomalies.extend(detect_detour_ratio(waypoints, route))
    geometry_anomalies.extend(detect_u_turns(route, waypoints))

    # Phase 2: PostGIS checks (parallel)
    db_results = await asyncio.gather(
        detect_road_quality_drop(db, route),
        detect_missed_roads(db, route),
        return_exceptions=True,
    )

    db_anomalies = []
    for result in db_results:
        if isinstance(result, list):
            db_anomalies.extend(result)
        # Silently skip failed DB queries

    # Combine and sort: issue > warning > suggestion
    all_anomalies = geometry_anomalies + db_anomalies
    severity_order = {AnomalySeverity.issue: 0, AnomalySeverity.warning: 1, AnomalySeverity.suggestion: 2}
    all_anomalies.sort(key=lambda a: severity_order.get(a.severity, 9))

    # Compute overall health
    issues = sum(1 for a in all_anomalies if a.severity == AnomalySeverity.issue)
    warnings = sum(1 for a in all_anomalies if a.severity == AnomalySeverity.warning)
    if issues >= 2:
        health = "poor"
    elif issues >= 1 or warnings >= 2:
        health = "fair"
    else:
        health = "good"

    elapsed_ms = int((time.perf_counter() - t0) * 1000)

    return RouteAnalysisResponse(
        anomalies=all_anomalies,
        overall_health=health,
        analysis_time_ms=elapsed_ms,
    )
