// Ticket Events API — audit log bridge
// All calls go through the Webhook Engine (:5001) → NATS → App Manager (:5000).
// These are additive; existing /webhook/gps flows are untouched.
import axios from 'axios';
import { WEBHOOK_BASE_URL } from '../config/apiConfig';

const BASE = `${WEBHOOK_BASE_URL}/webhook/ticket-event`;

export const createTicketEvent = (body) =>
  axios.post(`${BASE}/create`, body);

export const updateTicketInfoEvent = (ticketId, body) =>
  axios.post(`${BASE}/${encodeURIComponent(ticketId)}/update-info`, body);

export const dispatchTicketEvent = (ticketId, body) =>
  axios.post(`${BASE}/${encodeURIComponent(ticketId)}/dispatch`, body);

export const unitTicketEvent = (ticketId, body) =>
  axios.post(`${BASE}/${encodeURIComponent(ticketId)}/unit`, body);

export const closeTicketEvent = (ticketId, body) =>
  axios.post(`${BASE}/${encodeURIComponent(ticketId)}/close`, body);

export const getTicketEvent = (ticketId) =>
  axios.get(`${BASE}/${encodeURIComponent(ticketId)}`);

export const listTicketEvents = (params) =>
  axios.get(BASE, { params });
