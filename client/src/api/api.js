import axios from 'axios';
import { API_BASE_URL, WEBHOOK_BASE_URL } from '../config/apiConfig';

const api = axios.create({ baseURL: API_BASE_URL });

// Units — REDIRECTED THROUGH GATEWAY
export const getUnits = () =>
  axios.get(`${WEBHOOK_BASE_URL}/webhook/gps`, {
    params: { action: 'getUnits' },
  });
export const registerUnit = (data) =>
  axios.post(`${WEBHOOK_BASE_URL}/webhook/gps`, {
    alert_type: 'registration',
    unit_data: data,
    timestamp: Date.now(),
  });
export const updateUnitLoc = (data) =>
  axios.post(`${WEBHOOK_BASE_URL}/webhook/gps`, {
    alert_type: 'location_update',
    unit_data: data,
    timestamp: Date.now(),
  });
export const getNearestUnits = (lat, lng, type, limit = 10) =>
  axios.get(`${WEBHOOK_BASE_URL}/webhook/gps`, {
    params: { action: 'getNearestUnits', lat, lng, type, limit },
  });

// Alerts / dispatch — REDIRECTED THROUGH GATEWAY (Webhook Engine)
export const sendAlert = (data) =>
  axios.post(`${WEBHOOK_BASE_URL}/webhook/gps`, {
    alert_type: 'dispatch',
    ticket_data: data,
    timestamp: Date.now(),
  });

export const assignUnit = (data) =>
  axios.post(`${WEBHOOK_BASE_URL}/webhook/gps`, {
    alert_type: 'assignment',
    unit_id: data.unitId,
    ticket_data: data,
    timestamp: Date.now(),
  });
export const getStatus = () =>
  axios.get(`${WEBHOOK_BASE_URL}/webhook/gps`, {
    params: { action: 'getStatus' },
  });

// Location — NOW Uses Webhook long-polling Redis streams!
// 30s timeout per long-poll attempt; caller retries on timeout.
export const WEBHOOK_LONGPOLL_TIMEOUT_MS = 30000;
export const getAmbulanceLocation = (
  unitId,
  ticketNo = null,
  lastEventId = null,
) => {
  if (!unitId) return api.get('/ambulance-location');

  return axios.get(`${WEBHOOK_BASE_URL}/webhook/abc1234`, {
    params: {
      channel: 'gps',
      sessionId: unitId,
      conversationId: ticketNo || unitId,
      eventId: lastEventId || '0-0',
    },
    timeout: WEBHOOK_LONGPOLL_TIMEOUT_MS,
  });
};

// Forms
export const getForm = (unitType) => api.get(`/forms/${unitType}`);
export const submitForm = (formId, data) =>
  api.post(`/forms/${formId}/submit`, data);

// Directions (proxy through backend)
export const getDirections = (originLat, originLng, destLat, destLng) =>
  api.get('/directions', {
    params: { originLat, originLng, destLat, destLng, mode: 'driving' },
  });

export default api;
