import axios from 'axios';
import { API_BASE_URL } from '../config/apiConfig';

const api = axios.create({ baseURL: API_BASE_URL });

// Units
export const getUnits        = ()             => api.get('/units');
export const registerUnit    = (data)         => api.post('/register-unit', data);
export const updateUnitLoc   = (data)         => api.post('/update-unit-location', data);
export const getNearestUnits = (lat, lng, type, limit = 10) =>
  api.get('/nearest', { params: { lat, lng, type, limit } });

// Alerts / dispatch
export const sendAlert  = (data) => api.post('/send-alert', data);
export const assignUnit = (data) => api.post('/assign', data);
export const getStatus  = ()     => api.get('/status');

// Location — NOW per-unit using /unit-location/:unitId
// Falls back to /ambulance-location only if no unitId provided (legacy)
export const getAmbulanceLocation = (unitId) =>
  unitId
    ? api.get(`/unit-location/${unitId}`)
    : api.get('/ambulance-location');

// Forms
export const getForm       = (unitType) => api.get(`/forms/${unitType}`);
export const submitForm    = (formId, data) => api.post(`/forms/${formId}/submit`, data);

// Directions (proxy through backend)
export const getDirections = (originLat, originLng, destLat, destLng) =>
  api.get('/directions', { params: { originLat, originLng, destLat, destLng, mode: 'driving' } });

export default api;