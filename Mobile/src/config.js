export const GOOGLE_MAPS_KEY = 'AIzaSyAVz9omOzS8B29CEi50AkrNPMPn3JXhbcg';
export const GOOGLE_DIRECTIONS_KEY = 'AIzaSyAVz9omOzS8B29CEi50AkrNPMPn3JXhbcg';
export const FCM_SERVER_KEY = '';
export const SERVER_URL = 'http://192.168.2.52:5000';
export const SYNAPSE_BASE = 'http://192.168.2.52:8008';

// ─── REMOVED: UNIT_ID and AMBULANCE_NAME ────────────────────────────────────
// These are now generated dynamically per device and stored in AsyncStorage.
// Each device gets a unique ID like "AMB-A3F9K2" on first launch.
// Use: import { generateUnitId } from './utils/unitId';
//
// AMBULANCE_TYPE is also gone — the user selects their unit type at login.
// It is stored in AsyncStorage under the key 'UNIT_TYPE' after login.