import {
  SYNAPSE_BASE_URL as SYNAPSE_BASE,
  SYNAPSE_ADMIN_TOKEN as ADMIN_TOKEN,
  matrixUserId,
} from '../config/apiConfig';

/** Localpart only — Synapse expects this for m.id.user (not full @user:server). */
function toLoginLocalpart(input) {
  const s = (input || '').trim();
  if (!s.startsWith('@')) return s;
  const rest = s.slice(1);
  const i = rest.indexOf(':');
  return i === -1 ? rest : rest.slice(0, i);
}

// ── 1. Check if user exists (admin API) ──────────────────────────────────────
export async function userExists(username) {
  console.log("[Matrix] Checking userExists:", username);

  const res = await fetch(
    `${SYNAPSE_BASE}/_synapse/admin/v2/users/${encodeURIComponent(matrixUserId(username))}`,
    {
      headers: { "Authorization": `Bearer ${ADMIN_TOKEN}` }
    }
  );

  console.log("[Matrix] userExists status:", res.status, "for:", username);
  return res.ok; // 200 = exists, 404 = not found
}

// ── 2. Login → get access_token ──────────────────────────────────────────────
export async function matrixLogin(username, password) {
  console.log("[Matrix] matrixLogin attempt for:", username);

  const localpart = toLoginLocalpart(username);

  const res = await fetch(`${SYNAPSE_BASE}/_matrix/client/v3/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "m.login.password",
      identifier: { type: "m.id.user", user: localpart },
      password,
      initial_device_display_name: "GPS Dispatch",
    }),
  });

  const data = await res.json();
  console.log("[Matrix] matrixLogin response:", data);

  if (!res.ok) {
    throw { errcode: data.errcode, error: data.error, status: res.status };
  }

  return data; // { access_token, user_id, device_id }
}

// ── 3. Create user via admin API ─────────────────────────────────────────────
export async function createSynapseUser(username, password) {
  console.log("[Matrix] createSynapseUser:", username);

  const res = await fetch(
    `${SYNAPSE_BASE}/_synapse/admin/v2/users/${encodeURIComponent(matrixUserId(username))}`,
    {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${ADMIN_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        admin: false,
        id: username,
        displayname: username,
        password,
      }),
    }
  );

  const data = await res.json();
  console.log("[Matrix] createSynapseUser response:", data);

  if (!res.ok) throw new Error(data.error || "Failed to create Synapse user");
  return data;
}

// ── 4. Create a Matrix room ───────────────────────────────────────────────────
export async function createRoom(accessToken, roomName) {
  console.log("[Matrix] createRoom:", roomName);

  const res = await fetch(`${SYNAPSE_BASE}/_matrix/client/v3/createRoom`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: roomName,
      room_alias_name: roomName.replace(/[^a-zA-Z0-9_\-]/g, '_'), // safe alias
      preset: "public_chat",
      visibility: "public",
    }),
  });

  const data = await res.json();
  console.log("[Matrix] createRoom response:", data);

  if (!res.ok) throw new Error(data.error || "Room creation failed");
  return data; // { room_id }
}

// ── 5. Invite a user to a room ────────────────────────────────────────────────
export async function inviteUser(accessToken, roomId, targetUserId) {
  console.log("[Matrix] inviteUser:", targetUserId, "→", roomId);

  const res = await fetch(
    `${SYNAPSE_BASE}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/invite`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ user_id: targetUserId }),
    }
  );

  const data = await res.json();
  console.log("[Matrix] inviteUser response:", data);

  if (!res.ok) throw new Error(data.error || "Invite failed");
  return data;
}

// ── 6. Long-poll sync for live messages ──────────────────────────────────────
export async function syncMessages(accessToken, since = null) {
  const params = new URLSearchParams({ timeout: "30000" });
  if (since) params.set("since", since);

  const res = await fetch(
    `${SYNAPSE_BASE}/_matrix/client/v3/sync?${params}`,
    { headers: { "Authorization": `Bearer ${accessToken}` } }
  );

  const data = await res.json();
  console.log("[Matrix] sync next_batch:", data.next_batch);
  return data;
}

// ─── CHAT APIS — added for InteractionsTab ────────────────────────────────────
// Nothing above this line is modified.

// ── 7. Join a room ────────────────────────────────────────────────────────────
export async function joinRoom(accessToken, roomId) {
  const res = await fetch(`${SYNAPSE_BASE}/_matrix/client/v3/join/${encodeURIComponent(roomId)}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'joinRoom failed');
  return data;
}

// ── 8. Send a plain-text message ─────────────────────────────────────────────
export async function sendMessage(accessToken, roomId, body) {
  const txnId = `m.${Date.now()}.${Math.random().toString(36).slice(2, 9)}`;
  const res = await fetch(
    `${SYNAPSE_BASE}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
    {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'm.text', body }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'sendMessage failed');
  return data;
}

// ── 9. Get room message history ───────────────────────────────────────────────
// HTTP/2 preferred — may return large payloads; using fetch for multiplexing
export async function getRoomMessages(accessToken, roomId, from = null, limit = 50) {
  const params = new URLSearchParams({ dir: 'b', limit: String(limit) });
  if (from) params.set('from', from);
  // HTTP/2: native fetch used so browser can negotiate HTTP/2 with the server
  const res = await fetch(
    `${SYNAPSE_BASE}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages?${params}`,
    { headers: { 'Authorization': `Bearer ${accessToken}` } }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'getRoomMessages failed');
  return data; // { chunk, start, end }
}

// ── 10. Sync — mandatory HTTP/2 long-polling via native fetch ─────────────────
export async function sync(accessToken, since = null, signal = null) {
  const params = new URLSearchParams({ timeout: '20000' });
  if (since) params.set('since', since);

  // HTTP/2: Using native fetch() — browser negotiates HTTP/2 automatically when TLS is available
  const fetchOpts = { method: 'GET', headers: { 'Authorization': `Bearer ${accessToken}` } };
  if (signal) fetchOpts.signal = signal;
  const res = await fetch(`${SYNAPSE_BASE}/_matrix/client/v3/sync?${params}`, fetchOpts);
  if (!res.ok) throw new Error('sync failed: ' + res.status);
  return res.json();
}

// ── 11. Upload media ──────────────────────────────────────────────────────────
// HTTP/2 preferred — file uploads benefit from HTTP/2 multiplexing
export async function uploadMedia(accessToken, file) {
  const params = new URLSearchParams({ filename: file.name });
  // HTTP/2: native fetch used; browser multiplexes upload efficiently over HTTP/2
  const res = await fetch(`${SYNAPSE_BASE}/_matrix/media/v3/upload?${params}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'uploadMedia failed');
  return data; // { content_uri: "mxc://..." }
}

// ── 12–15. Send typed media messages ─────────────────────────────────────────
export async function sendImageMessage(accessToken, roomId, url, info = {}) {
  const txnId = `m.${Date.now()}.${Math.random().toString(36).slice(2, 9)}`;
  const res = await fetch(
    `${SYNAPSE_BASE}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
    {
      method: 'PUT', headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'm.image', body: info.name || 'image', url, info })
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'sendImageMessage failed');
  return data;
}

export async function sendVideoMessage(accessToken, roomId, url, info = {}) {
  const txnId = `m.${Date.now()}.${Math.random().toString(36).slice(2, 9)}`;
  const res = await fetch(
    `${SYNAPSE_BASE}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
    {
      method: 'PUT', headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'm.video', body: info.name || 'video', url, info })
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'sendVideoMessage failed');
  return data;
}

export async function sendAudioMessage(accessToken, roomId, url, info = {}) {
  const txnId = `m.${Date.now()}.${Math.random().toString(36).slice(2, 9)}`;
  const res = await fetch(
    `${SYNAPSE_BASE}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
    {
      method: 'PUT', headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'm.audio', body: info.name || 'audio', url, info })
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'sendAudioMessage failed');
  return data;
}

export async function sendFileMessage(accessToken, roomId, url, filename = 'file', info = {}) {
  const txnId = `m.${Date.now()}.${Math.random().toString(36).slice(2, 9)}`;
  const res = await fetch(
    `${SYNAPSE_BASE}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
    {
      method: 'PUT', headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'm.file', body: filename, url, info })
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'sendFileMessage failed');
  return data;
}

// ── 16. Resolve mxc:// → HTTP URL ────────────────────────────────────────────
export function getMediaUrl(mxcUrl) {
  if (!mxcUrl?.startsWith('mxc://')) return mxcUrl;
  const stripped = mxcUrl.slice(6); // remove "mxc://"
  return `${SYNAPSE_BASE}/_matrix/client/v1/media/download/${stripped}?allow_redirect=true`;
}

// ── 17. Get thumbnail URL ─────────────────────────────────────────────────────
export function getThumbnailUrl(mxcUrl, width = 200, height = 150) {
  if (!mxcUrl?.startsWith('mxc://')) return mxcUrl;
  const stripped = mxcUrl.slice(6);
  return `${SYNAPSE_BASE}/_matrix/client/v1/media/thumbnail/${stripped}?width=${width}&height=${height}&method=scale&allow_redirect=true`;
}

// ── 18. Download media as Blob ────────────────────────────────────────────────
// HTTP/2 preferred — file downloads benefit from HTTP/2 multiplexing
export async function downloadMedia(accessToken, mxcUrl) {
  const url = getMediaUrl(mxcUrl);
  // HTTP/2: native fetch used; browser multiplexes download efficiently over HTTP/2
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error('downloadMedia failed: ' + res.status);
  return res.blob();
}

// ── 19. Get room members ──────────────────────────────────────────────────────
export async function getRoomMembers(accessToken, roomId) {
  const res = await fetch(
    `${SYNAPSE_BASE}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/members`,
    { headers: { 'Authorization': `Bearer ${accessToken}` } }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'getRoomMembers failed');
  return data; // { chunk: [membership events] }
}