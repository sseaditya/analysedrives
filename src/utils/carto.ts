/** Add the public CARTO basemap key without escaping tile placeholders. */
export function withCartoKey(tileUrl: string): string {
  const key = import.meta.env.CARTO_API;
  if (!key) return tileUrl;
  return `${tileUrl}${tileUrl.includes("?") ? "&" : "?"}key=${encodeURIComponent(key)}`;
}
