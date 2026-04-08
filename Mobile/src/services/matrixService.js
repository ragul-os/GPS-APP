/**
 * matrixService.js — Mobile Matrix API Service
 * Added: sendFileMessage for document/file uploads
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const SYNAPSE_BASE = 'http://192.168.2.52:8008';
const ADMIN_TOKEN = 'syt_YWRtaW4x_ORxyHHzfMxvFIQxGouDM_0bUXx3';
const KEY_SESSION = 'MATRIX_SESSION';

// ── 1. Check if user exists ────────────────────────────────────────────────
export async function userExists(username) {
  const res = await fetch(
    `${SYNAPSE_BASE}/_synapse/admin/v2/users/@${username}:localhost`,
    { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } }
  );
  return res.ok;
}

// ── 2. Create user ─────────────────────────────────────────────────────────
export async function createSynapseUser(username, password, displayname) {
  const res = await fetch(
    `${SYNAPSE_BASE}/_synapse/admin/v2/users/@${username}:localhost`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ admin: false, id: username, displayname: displayname || username, password }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to create user');
  return data;
}

// ── 3. Login ───────────────────────────────────────────────────────────────
export async function matrixLogin(username, password) {
  console.log(username, password);
  const res = await fetch(`${SYNAPSE_BASE}/_matrix/client/r0/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'm.login.password', user: username, password }),
  });
  const data = await res.json();
  if (!res.ok) throw { errcode: data.errcode, error: data.error, status: res.status };
  return data;
}

// ── 4. Join room ──────────────────────────────────────────────────────────
export async function joinRoom(accessToken, roomId) {
  const res = await fetch(
    `${SYNAPSE_BASE}/_matrix/client/r0/join/${encodeURIComponent(roomId)}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }
  );
  const data = await res.json();
  if (!res.ok && data.errcode !== 'M_FORBIDDEN' && data.errcode !== 'M_ALREADY_JOINED') {
    throw new Error(data.error || 'Failed to join room');
  }
  return data;
}

// ── 5. Force join via admin ────────────────────────────────────────────────
export async function forceJoinRoom(username, roomId) {
  const userId = username.startsWith('@') ? username : `@${username}:localhost`;
  const url = `${SYNAPSE_BASE}/_synapse/admin/v1/join/${encodeURIComponent(roomId)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId }),
  });
  const data = await res.json();
  if (!res.ok) {
    if (data.errcode === 'M_ALREADY_MEMBER' || (data.error && data.error.toLowerCase().includes('already'))) {
      return data;
    }
    throw new Error(data.error || `Force join failed: ${res.status}`);
  }
  return data;
}

// ── 6. Create room ────────────────────────────────────────────────────────
export async function createRoom(accessToken, name) {
  const res = await fetch(`${SYNAPSE_BASE}/_matrix/client/r0/createRoom`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, preset: 'private_chat', visibility: 'private' }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to create room');
  return data;
}

// ── 7. Invite user ────────────────────────────────────────────────────────
export async function inviteUser(accessToken, roomId, userId) {
  const res = await fetch(
    `${SYNAPSE_BASE}/_matrix/client/r0/rooms/${encodeURIComponent(roomId)}/invite`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    }
  );
  const data = await res.json();
  if (!res.ok && data.errcode !== 'M_ALREADY_MEMBER') {
    throw new Error(data.error || 'Failed to invite user');
  }
  return data;
}

// ── 8. Get joined rooms ────────────────────────────────────────────────────
export async function getJoinedRooms(accessToken) {
  const res = await fetch(`${SYNAPSE_BASE}/_matrix/client/r0/joined_rooms`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  return data.joined_rooms || [];
}

// ── 9. Get room messages ───────────────────────────────────────────────────
export async function getRoomMessages(accessToken, roomId, from = null, limit = 50) {
  const params = new URLSearchParams({ limit: String(limit), dir: 'b' });
  if (from) params.set('from', from);
  const res = await fetch(
    `${SYNAPSE_BASE}/_matrix/client/r0/rooms/${encodeURIComponent(roomId)}/messages?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await res.json();
  return data;
}

// ── 10. Send text ─────────────────────────────────────────────────────────
export async function sendTextMessage(accessToken, roomId, body) {
  const txnId = `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const res = await fetch(
    `${SYNAPSE_BASE}/_matrix/client/r0/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'm.text', body }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to send message');
  return data;
}

// ── 11. Upload media ──────────────────────────────────────────────────────
export async function uploadMedia(accessToken, fileUri, mimeType, filename) {
  const response = await fetch(fileUri);
  const blob = await response.blob();
  const res = await fetch(
    `${SYNAPSE_BASE}/_matrix/media/v3/upload?filename=${encodeURIComponent(filename)}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': mimeType },
      body: blob,
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data.content_uri;
}

// ── 12. Send image ────────────────────────────────────────────────────────
export async function sendImageMessage(accessToken, roomId, mxcUri, filename, width, height) {
  const txnId = `img_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const res = await fetch(
    `${SYNAPSE_BASE}/_matrix/client/r0/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'm.image', body: filename, url: mxcUri,
        info: { w: width || 800, h: height || 600, mimetype: 'image/jpeg' },
      }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to send image');
  return data;
}

// ── 13. Send video ────────────────────────────────────────────────────────
export async function sendVideoMessage(accessToken, roomId, mxcUri, filename) {
  const txnId = `vid_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const res = await fetch(
    `${SYNAPSE_BASE}/_matrix/client/r0/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'm.video', body: filename, url: mxcUri, info: { mimetype: 'video/mp4' } }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to send video');
  return data;
}

// ── 14. Send audio ────────────────────────────────────────────────────────
export async function sendAudioMessage(accessToken, roomId, mxcUri, filename, durationMs = 0) {
  const txnId = `aud_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const res = await fetch(
    `${SYNAPSE_BASE}/_matrix/client/r0/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'm.audio', body: filename, url: mxcUri,
        info: { mimetype: 'audio/m4a', duration: durationMs },
      }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to send audio');
  return data;
}

// ── 15. Send file / document ──────────────────────────────────────────────
// NEW — supports any file type (PDF, Word, Excel, zip, etc.)
export async function sendFileMessage(accessToken, roomId, mxcUri, filename, mimeType, fileSize = 0) {
  const txnId = `fil_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const res = await fetch(
    `${SYNAPSE_BASE}/_matrix/client/r0/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'm.file',
        body: filename,
        filename: filename,
        url: mxcUri,
        info: {
          mimetype: mimeType,
          size: fileSize,
        },
      }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to send file');
  return data;
}

// ── 16. Send location ──────────────────────────────────────────────────────
export async function sendLocationMessage(accessToken, roomId, lat, lng, description = 'Location') {
  const txnId = `loc_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const res = await fetch(
    `${SYNAPSE_BASE}/_matrix/client/r0/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'm.location',
        body: `Location ${lat},${lng}`,
        geo_uri: `geo:${lat},${lng}`,
        "org.matrix.msc3488.location": { uri: `geo:${lat},${lng}`, description }
      }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to send location');
  return data;
}

// ── 17. Send live location ──────────────────────────────────────────────
export async function sendLiveLocationMessage(accessToken, roomId, lat, lng, durationMs) {
  const txnId = `live_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const res = await fetch(
    `${SYNAPSE_BASE}/_matrix/client/r0/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msgtype: 'm.location',
        body: `Live Location (Duration: ${Math.round(durationMs / 60000)}m)`,
        geo_uri: `geo:${lat},${lng}`,
        live_until: Date.now() + durationMs,
        is_live: true
      }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to send live location');
  return data;
}

// ── 18. Sync ──────────────────────────────────────────────────────────────
export async function syncMatrix(accessToken, since = null, timeout = 10000) {
  const params = new URLSearchParams({ timeout: String(timeout) });
  if (since) params.set('since', since);
  const res = await fetch(
    `${SYNAPSE_BASE}/_matrix/client/r0/sync?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error('sync failed: ' + res.status + ' ' + err);
  }
  return await res.json();
}

// ── 19. mxc → HTTP ───────────────────────────────────────────────────────
// NEW — matches web MatrixService.js exactly
export function mxcToHttp(mxcUri, accessToken) {
  if (!mxcUri?.startsWith('mxc://')) return mxcUri;
  const stripped = mxcUri.slice(6);
  return `${SYNAPSE_BASE}/_matrix/client/v1/media/download/${stripped}?allow_redirect=true`;
}

export function getThumbnailUrl(mxcUri, width = 200, height = 150) {
  if (!mxcUri?.startsWith('mxc://')) return mxcUri;
  const stripped = mxcUri.slice(6);
  return `${SYNAPSE_BASE}/_matrix/client/v1/media/thumbnail/${stripped}?width=${width}&height=${height}&method=scale&allow_redirect=true`;
}

// ── 20. Session helpers ────────────────────────────────────────────────────
export async function saveSession(session) {
  await AsyncStorage.setItem(KEY_SESSION, JSON.stringify(session));
}

export async function loadSession() {
  const raw = await AsyncStorage.getItem(KEY_SESSION);
  return raw ? JSON.parse(raw) : null;
}

export async function clearSession() {
  await AsyncStorage.removeItem(KEY_SESSION);
}