export const SPEED_ROUTE_MAX_KMH = 150;

/** Keep route speed colors identical everywhere a track is shown. */
export function getSpeedRouteColor(speedKmh: number): string {
  const safeSpeed = Number.isFinite(speedKmh) ? Math.max(0, speedKmh) : 0;
  const ratio = Math.min(safeSpeed / SPEED_ROUTE_MAX_KMH, 1);
  const lightness = 90 - ratio * 65;

  return `hsl(215, 95%, ${lightness}%)`;
}
