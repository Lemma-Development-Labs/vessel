/** Base URL of the Vessel service (`/v1` evidence API, `/stats`). Unset means no service. */
const STATS = process.env.NEXT_PUBLIC_STATS_URL;

export function statsUrl(): string | undefined {
  return STATS;
}
