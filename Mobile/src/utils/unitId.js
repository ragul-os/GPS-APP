/**
 * utils/unitId.js
 *
 * Generates a unique alphanumeric unit ID on first launch and persists it
 * in AsyncStorage so the same device always gets the same ID.
 *
 * Format: <PREFIX>-<6 random uppercase alphanumeric chars>
 * Examples: AMB-A3F9K2 | POL-X7BQ1R | FIR-TK28NM
 *
 * The prefix is determined by the unit type chosen at login.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'DEVICE_UNIT_ID';

const TYPE_PREFIX = {
  ambulance: 'AMB',
  police:    'POL',
  fire:      'FIR',
  rescue:    'RES',
  hazmat:    'HAZ',
};

/**
 * Generates a random 6-character alphanumeric string (uppercase).
 */
function randomSuffix(length = 6) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Returns the persisted unit ID for this device.
 * If none exists yet, generates one using the given unitType prefix and saves it.
 *
 * @param {string} unitType - One of: ambulance, police, fire, rescue, hazmat
 * @returns {Promise<string>} - e.g. "AMB-A3F9K2"
 */
export async function getOrCreateUnitId(unitType = 'ambulance') {
  try {
    const existing = await AsyncStorage.getItem(STORAGE_KEY);
    if (existing) return existing;

    const prefix = TYPE_PREFIX[unitType] || 'UNT';
    const newId = `${prefix}-${randomSuffix()}`;
    await AsyncStorage.setItem(STORAGE_KEY, newId);
    console.log('[UnitId] Generated new unit ID:', newId);
    return newId;
  } catch (err) {
    console.warn('[UnitId] AsyncStorage error:', err.message);
    // Fallback: return a temporary ID (not persisted — rare edge case)
    const prefix = TYPE_PREFIX[unitType] || 'UNT';
    return `${prefix}-${randomSuffix()}`;
  }
}

/**
 * Returns the stored unit ID synchronously from a cached value.
 * Call getOrCreateUnitId() first during app init to warm the cache.
 */
export function getUnitIdSync() {
  // Use this pattern: call getOrCreateUnitId() at app startup,
  // then read from AuthContext where you store it after resolution.
  throw new Error('Use getOrCreateUnitId() (async) instead, or read from AuthContext.');
}