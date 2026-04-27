import axios from 'axios';
import { API_BASE_URL, WEBHOOK_BASE_URL } from '../config/apiConfig';

const api = axios.create({ baseURL: API_BASE_URL });

// Axios instance pre-configured for the Webhook Engine (ngrok or direct).
// The `ngrok-skip-browser-warning` header bypasses ngrok's free-tier HTML
// interstitial page, which would otherwise block CORS for browser clients.
const webhookApi = axios.create({
  baseURL: WEBHOOK_BASE_URL,
  headers: { 'ngrok-skip-browser-warning': 'true' },
});

// Units — REDIRECTED THROUGH GATEWAY
export const getUnits = () =>
  webhookApi.get('/webhook/gps', {
    params: { action: 'getUnits' },
  });
export const registerUnit = (data) =>
  webhookApi.post('/webhook/gps', {
    alert_type: 'registration',
    unit_data: data,
    timestamp: Date.now(),
  });
export const updateUnitLoc = (data) =>
  webhookApi.post('/webhook/gps', {
    alert_type: 'location_update',
    unit_data: data,
    timestamp: Date.now(),
  });
export const getNearestUnits = (lat, lng, type, limit = 10) =>
  webhookApi.get('/webhook/gps', {
    params: { action: 'getNearestUnits', lat, lng, type, limit },
  });

// Alerts / dispatch — REDIRECTED THROUGH GATEWAY (Webhook Engine)
export const sendAlert = (data) =>
  webhookApi.post('/webhook/gps', {
    alert_type: 'dispatch',
    ticket_data: data,
    timestamp: Date.now(),
  });

export const assignUnit = (data) =>
  webhookApi.post('/webhook/gps', {
    alert_type: 'assignment',
    unit_id: data.unitId,
    ticket_data: data,
    timestamp: Date.now(),
  });
export const getStatus = () =>
  webhookApi.get('/webhook/gps', {
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

  return webhookApi.get('/webhook/abc1234', {
    params: {
      channel: 'gps',
      sessionId: unitId,
      conversationId: ticketNo || unitId,
      eventId: lastEventId || '0-0',
    },
    timeout: WEBHOOK_LONGPOLL_TIMEOUT_MS,
  });
};

// Tickets — fetched from PostgreSQL via backend
export const getTickets = (params = {}) => api.get('/api/tickets', { params });

// Forms
export const getForm = (unitType) => api.get(`/forms/${unitType}`);
export const submitForm = (formId, data) =>
  api.post(`/forms/${formId}/submit`, data);

// Directions (proxy through backend)
export const getDirections = (originLat, originLng, destLat, destLng) =>
  api.get('/directions', {
    params: { originLat, originLng, destLat, destLng, mode: 'driving' },
  });

export const getTicketTimeline = (ticketId) =>
  axios.get(`${API_BASE_URL}/api/timeline/${ticketId}`);

export default api;
