/**
 * Geo utilities for waypoint insertion.
 */

/**
 * Given a click point and a list of waypoints, find which segment
 * (pair of consecutive waypoints) the click is closest to.
 *
 * Returns the index to INSERT the new waypoint at.
 * E.g. if the click is closest to the segment between waypoints[1] and waypoints[2],
 * returns 2 (insert at position 2, pushing old waypoints[2] to position 3).
 */
export function findInsertIndex(
  click: { lat: number; lng: number },
  waypoints: { lat: number; lng: number }[],
): number {
  if (waypoints.length <= 1) return waypoints.length;

  let minDist = Infinity;
  let minIdx = 0;

  for (let i = 0; i < waypoints.length - 1; i++) {
    const d = pointToSegmentDistance(
      click.lat, click.lng,
      waypoints[i].lat, waypoints[i].lng,
      waypoints[i + 1].lat, waypoints[i + 1].lng,
    );
    if (d < minDist) {
      minDist = d;
      minIdx = i;
    }
  }

  // Insert AFTER the first waypoint of the closest segment
  return minIdx + 1;
}

/**
 * Approximate distance from a point to a line segment on Earth's surface.
 * Uses equirectangular approximation (accurate enough for nearby points).
 *
 * Returns distance in approximate degrees (only used for comparison, not absolute value).
 */
function pointToSegmentDistance(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  // Scale longitude by cos(latitude) for equirectangular approximation
  const cosLat = Math.cos(((px + ax + bx) / 3) * Math.PI / 180);

  // Convert to flat coordinates (scaled degrees)
  const pxf = py * cosLat, pyf = px;
  const axf = ay * cosLat, ayf = ax;
  const bxf = by * cosLat, byf = bx;

  // Vector AB
  const abx = bxf - axf;
  const aby = byf - ayf;
  const abLen2 = abx * abx + aby * aby;

  if (abLen2 === 0) {
    // Segment is a point
    const dx = pxf - axf;
    const dy = pyf - ayf;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Project point onto segment, clamped to [0, 1]
  let t = ((pxf - axf) * abx + (pyf - ayf) * aby) / abLen2;
  t = Math.max(0, Math.min(1, t));

  // Closest point on segment
  const cx = axf + t * abx;
  const cy = ayf + t * aby;

  const dx = pxf - cx;
  const dy = pyf - cy;
  return Math.sqrt(dx * dx + dy * dy);
}
