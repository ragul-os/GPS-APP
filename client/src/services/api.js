// Helper functions for Chat and Dispatch synchronization via localStorage

export { SYNAPSE_BASE, SYNAPSE_BASE_URL, API_BASE_URL, MATRIX_SERVER_NAME } from '../config/apiConfig';

export function getAlertHistory() {
  return JSON.parse(localStorage.getItem('alertHistory') || '[]');
}

export function getAgentTickets() {
  return JSON.parse(localStorage.getItem('agentTickets') || '[]');
}

export function getSession() {
  const stored = localStorage.getItem('dispatcher');
  return stored ? JSON.parse(stored) : {};
}
