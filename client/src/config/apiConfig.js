/**
 * Central URLs for backend, Matrix/Synapse, and third-party APIs.
 * Override via Vite env (e.g. .env: VITE_API_BASE_URL=https://api.example.com)
 */

function trimTrailingSlash(url) {
  return typeof url === 'string' ? url.replace(/\/+$/, '') : url;
}

/** REST backend (Express / dispatch API) */
export const API_BASE_URL = trimTrailingSlash(
  import.meta.env.VITE_API_BASE_URL ?? 'http://192.168.24.9:5000',
);

/** Webhook Engine V3 */
export const WEBHOOK_BASE_URL = trimTrailingSlash(
  import.meta.env.VITE_WEBHOOK_BASE_URL ?? 'http://192.168.24.9:5001',
);

// export const WEBHOOK_BASE_URL = trimTrailingSlash(
//   import.meta.env.VITE_WEBHOOK_BASE_URL ??
//     'https://lioness-emerging-chicken.ngrok-free.app',
// );

/** Synapse homeserver root (Client-Server API lives under /_matrix/...) */
export const SYNAPSE_BASE_URL = trimTrailingSlash(
  import.meta.env.VITE_SYNAPSE_BASE_URL ?? 'http://192.168.24.9:8008',
);

/**
 * Matrix ID domain: @user:SERVER_NAME and #alias:SERVER_NAME
 * (must match Synapse server_name / delegation)
 */
export const MATRIX_SERVER_NAME =
  import.meta.env.VITE_MATRIX_SERVER_NAME ?? 'localhost';

/** Synapse admin API token — prefer VITE_SYNAPSE_ADMIN_TOKEN in .env for real deploys */
export const SYNAPSE_ADMIN_TOKEN =
  import.meta.env.VITE_SYNAPSE_ADMIN_TOKEN ??
  'syt_YWRtaW4x_ORxyHHzfMxvFIQxGouDM_0bUXx3';

/** Google Routes API v2 (traffic-aware polylines) */
export const GOOGLE_ROUTES_COMPUTE_URL =
  import.meta.env.VITE_GOOGLE_ROUTES_COMPUTE_URL ??
  'https://routes.googleapis.com/directions/v2:computeRoutes';

/** Google Maps / Routes API key */
export const GOOGLE_MAPS_API_KEY =
  import.meta.env.VITE_GOOGLE_MAPS_API_KEY ??
  'AIzaSyAVz9omOzS8B29CEi50AkrNPMPn3JXhbcg';

/** Maps JavaScript API loader (script src before ?key=...) */
export const GOOGLE_MAPS_JS_URL_BASE =
  import.meta.env.VITE_GOOGLE_MAPS_JS_URL_BASE ??
  'https://maps.googleapis.com/maps/api/js';

/** @localpart:server.name */
export function matrixUserId(localpart) {
  return `@${localpart}:${MATRIX_SERVER_NAME}`;
}

/** #local_alias:server.name (no leading # on localpart) */
export function matrixRoomAlias(localAlias) {
  return `#${localAlias}:${MATRIX_SERVER_NAME}`;
}

/** Same as SYNAPSE_BASE_URL — kept for existing imports */
export const SYNAPSE_BASE = SYNAPSE_BASE_URL;

/** Matrix File Upload Limit (matches homeserver.yaml max_upload_size) */
export const MATRIX_MAX_UPLOAD_SIZE = 50 * 1024 * 1024; // 50MB
