/**
 * matrixService.js — Mobile Matrix API Service
 * Original code preserved.
 * NEW additions:
 *  - getRoomMembers
 *  - getUserDisplayName
 *  - getOrCreateDMRoom (with admin force-join)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { SYNAPSE_BASE } from '../config';

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
export async function sendTextMessage(accessToken, roomId, body, extraContent = {}) {
  const txnId = extraContent.txnId || `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const cleanExtra = { ...extraContent };
  delete cleanExtra.txnId;

  const res = await fetch(
    `${SYNAPSE_BASE}/_matrix/client/r0/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'm.text', body, ...cleanExtra }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to send message');
  return { ...data, txnId };
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

// ── 15.1 Get Room Name ────────────────────────────────────────────────────
export async function getRoomName(accessToken, roomId, myUserId) {
  try {
    // 1. Try to get explicit room name
    const nameRes = await fetch(
      `${SYNAPSE_BASE}/_matrix/client/r0/rooms/${encodeURIComponent(roomId)}/state/m.room.name`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (nameRes.ok) {
      const data = await nameRes.json();
      if (data.name) return data.name;
    }

    // 2. Fallback for DMs: find the other member's name
    const membersRes = await fetch(
      `${SYNAPSE_BASE}/_matrix/client/r0/rooms/${encodeURIComponent(roomId)}/members`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (membersRes.ok) {
      const { chunk = [] } = await membersRes.json();
      // Look at both joined and invited members for robust naming
      const relevantMembers = chunk.filter(e => e.content?.membership === 'join' || e.content?.membership === 'invite');

      // If it's a 1:1 room, show the OTHER person's name
      if (relevantMembers.length === 2) {
        const other = relevantMembers.find(m => m.state_key !== myUserId);
        if (other) {
          return other.content?.displayname || other.state_key.replace(/^@/, '').split(':')[0];
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

// ── 15. Send file / document ──────────────────────────────────────────────
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
export function mxcToHttp(mxcUri, accessToken) {
  if (!mxcUri?.startsWith('mxc://')) return mxcUri;
  const stripped = mxcUri.slice(6);
  // Using v1 media endpoint with allow_redirect (matches web version)
  return `${SYNAPSE_BASE}/_matrix/client/v1/media/download/${stripped}?allow_redirect=true`;
}

export function getThumbnailUrl(mxcUri, width = 200, height = 150) {
  if (!mxcUri?.startsWith('mxc://')) return mxcUri;
  const stripped = mxcUri.slice(6);
  return `${SYNAPSE_BASE}/_matrix/client/v1/media/thumbnail/${stripped}?width=${width}&height=${height}&method=scale&allow_redirect=true`;
}

// ── 20. Message Actions (Reactions, Pins, etc.) ───────────────────────
export async function sendReaction(accessToken, roomId, eventId, key) {
  const txnId = `react_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const res = await fetch(`${SYNAPSE_BASE}/_matrix/client/r0/rooms/${encodeURIComponent(roomId)}/send/m.reaction/${txnId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      'm.relates_to': {
        rel_type: 'm.annotation',
        event_id: eventId,
        key: key
      }
    }),
  });
  if (!res.ok) throw new Error('Reaction failed');
  return await res.json();
}

export async function pinMessage(accessToken, roomId, eventId) {
  // 1. Get current pinned events
  const stRes = await fetch(`${SYNAPSE_BASE}/_matrix/client/r0/rooms/${encodeURIComponent(roomId)}/state/m.room.pinned_events`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  let pinned = [];
  if (stRes.ok) {
    const data = await stRes.json();
    pinned = data.pinned || [];
  }

  let nextPinned;
  if (pinned.includes(eventId)) {
    // Unpin logic: remove from list
    nextPinned = pinned.filter(id => id !== eventId);
  } else {
    // Pin logic: add to list
    nextPinned = [...pinned, eventId];
  }

  const res = await fetch(`${SYNAPSE_BASE}/_matrix/client/r0/rooms/${encodeURIComponent(roomId)}/state/m.room.pinned_events`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pinned: nextPinned }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to update pinned messages');
  }

  return nextPinned;
}

export async function forwardMessage(accessToken, targetRoomId, originalMsg) {
  const txnId = `fwd_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const { msgtype, body, mediaUrl, info, geo, id, url } = originalMsg;

  // Use original mxc url if available, otherwise mediaUrl (HTTP)
  const contentUrl = url || mediaUrl;

  return await fetch(`${SYNAPSE_BASE}/_matrix/client/r0/rooms/${encodeURIComponent(targetRoomId)}/send/m.room.message/${txnId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      msgtype,
      body,
      url: contentUrl,
      info,
      geo_uri: geo,
      'm.relates_to': {
        rel_type: 'm.forward',
        event_id: id
      }
    }),
  });
}


// ── 21. Fetch Joined Rooms ────────────────────────────────────────────────
export async function getJoinedRooms(accessToken) {
  const res = await fetch(`${SYNAPSE_BASE}/_matrix/client/r0/joined_rooms`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch rooms');
  return data.joined_rooms;
}

export async function getRoomState(accessToken, roomId, eventType) {
  const res = await fetch(`${SYNAPSE_BASE}/_matrix/client/r0/rooms/${encodeURIComponent(roomId)}/state/${eventType}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (res.ok) return await res.json();
  return null;
}

// ── 22. Session helpers ────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// ── 21. NEW: Get room members ─────────────────────────────────────────────
// Returns array of { userId, displayName, avatarUrl, membership }
// ─────────────────────────────────────────────────────────────────────────────
export async function getRoomMembers(accessToken, roomId) {
  const res = await fetch(
    `${SYNAPSE_BASE}/_matrix/client/r0/rooms/${encodeURIComponent(roomId)}/members`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to get room members');

  return (data.chunk || [])
    .map(e => ({
      userId: e.state_key,
      displayName: e.content?.displayname || e.state_key.split(':')[0].replace('@', ''),
      avatarUrl: e.content?.avatar_url || null,
      membership: e.content?.membership,
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// ── 22. NEW: Save Direct Message (m.direct) ───────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
export async function saveDirectMessage(accessToken, myUserId, targetUserId, roomId) {
  try {
    let existingDMs = {};
    const adRes = await fetch(
      `${SYNAPSE_BASE}/_matrix/client/r0/user/${encodeURIComponent(myUserId)}/account_data/m.direct`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (adRes.ok) existingDMs = await adRes.json();

    const targetDMs = existingDMs[targetUserId] || [];
    if (!targetDMs.includes(roomId)) {
      await fetch(
        `${SYNAPSE_BASE}/_matrix/client/r0/user/${encodeURIComponent(myUserId)}/account_data/m.direct`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...existingDMs,
            [targetUserId]: [...targetDMs, roomId],
          }),
        }
      );
      console.log('[DM] ✅ account_data updated for:', targetUserId);
    }
  } catch (err) {
    console.warn('[DM] saveDirectMessage failed:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ── 22. NEW: Get user display name ────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
/* export async function getUserDisplayName(accessToken, userId) {
  try {
    const res = await fetch(
      `${SYNAPSE_BASE}/_matrix/client/r0/profile/${encodeURIComponent(userId)}/displayname`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const data = await res.json();
    return data.displayname || userId.split(':')[0].replace('@', '');
  } catch {
    return userId.split(':')[0].replace('@', '');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ── 23. NEW: Get or create a DM room with a specific user ─────────────────
// Uses admin force-join so both users are in the room without invite/accept flow.
// ─────────────────────────────────────────────────────────────────────────────
export async function getOrCreateDMRoom(accessToken, myUserId, targetUserId) {
  console.log('[DM] START', { myUserId, targetUserId });

  let resolvedRoomId = null;

  // Step 1: Check account data for an existing DM room
  try {
    const adRes = await fetch(
      `${SYNAPSE_BASE}/_matrix/client/r0/user/${encodeURIComponent(myUserId)}/account_data/m.direct`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (adRes.ok) {
      const adData = await adRes.json();
      const dmRooms = adData[targetUserId] || [];
      if (dmRooms.length > 0) {
        const joinedRooms = await getJoinedRooms(accessToken);
        for (const candidateRoomId of dmRooms) {
          if (joinedRooms.includes(candidateRoomId)) {
            console.log('[DM] ✅ Found existing DM room:', candidateRoomId);
            resolvedRoomId = candidateRoomId;
            break;
          }
        }
      }
    }
  } catch (err) {
    console.warn('[DM] account_data check failed:', err.message);
  }

  // Step 2: Create new DM room if none found
  if (!resolvedRoomId) {
    console.log('[DM] Creating new DM room...');
    const targetName = targetUserId.split(':')[0].replace('@', '');

    const createRes = await fetch(`${SYNAPSE_BASE}/_matrix/client/r0/createRoom`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        preset: 'trusted_private_chat',
        visibility: 'private',
        is_direct: true,
        name: targetName,
        power_level_content_override: {
          users_default: 50,
          events_default: 0,
        },
      }),
    });
    const createData = await createRes.json();
    if (!createRes.ok) throw new Error(createData.error || 'Failed to create DM room');
    resolvedRoomId = createData.room_id;
    console.log('[DM] ✅ Room created:', resolvedRoomId);

    // Save to account_data
    try {
      let existingDMs = {};
      try {
        const adRes = await fetch(
          `${SYNAPSE_BASE}/_matrix/client/r0/user/${encodeURIComponent(myUserId)}/account_data/m.direct`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (adRes.ok) existingDMs = await adRes.json();
      } catch {}
      await fetch(
        `${SYNAPSE_BASE}/_matrix/client/r0/user/${encodeURIComponent(myUserId)}/account_data/m.direct`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...existingDMs,
            [targetUserId]: [...(existingDMs[targetUserId] || []), resolvedRoomId],
          }),
        }
      );
      console.log('[DM] ✅ account_data saved');
    } catch (err) {
      console.warn('[DM] account_data save failed (non-fatal):', err.message);
    }
  }

  // Step 3: Force-join BOTH users via Synapse admin API
  for (const userId of [myUserId, targetUserId]) {
    try {
      console.log('[DM] Force-joining via admin API:', userId);
      const res = await fetch(
        `${SYNAPSE_BASE}/_synapse/admin/v1/join/${encodeURIComponent(resolvedRoomId)}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${ADMIN_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ user_id: userId }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        if (data.error?.toLowerCase().includes('already')) {
          console.log('[DM] Already in room (ok):', userId);
        } else {
          console.warn('[DM] Force-join failed for', userId, ':', data.error);
          // Fallback: invite
          if (userId === targetUserId) {
            try {
              await fetch(
                `${SYNAPSE_BASE}/_matrix/client/r0/rooms/${encodeURIComponent(resolvedRoomId)}/invite`,
                {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ user_id: targetUserId }),
                }
              );
              console.log('[DM] ✅ Fallback invite sent to:', targetUserId);
            } catch (inviteErr) {
              console.warn('[DM] Fallback invite also failed:', inviteErr.message);
            }
          }
        }
      } else {
        console.log('[DM] ✅ Force-joined:', userId);
      }
    } catch (err) {
      console.warn('[DM] Force-join error for', userId, ':', err.message);
    }
  }

  console.log('[DM] ✅ DM room ready:', resolvedRoomId);
  return resolvedRoomId;
} */

export async function getOrCreateDMRoom(accessToken, myUserId, targetUserId) {
  console.log("[DM] Checking existing DM...");

  // 1. Get all joined rooms
  const rooms = await getJoinedRooms(accessToken);

  // 2. Check each room members
  for (const roomId of rooms) {
    try {
      const members = await getRoomMembers(accessToken, roomId);
      const userIds = members.map(m => m.userId);

      // Check if ONLY these 2 users exist
      if (
        userIds.includes(myUserId) &&
        userIds.includes(targetUserId) &&
        userIds.length === 2
      ) {
        console.log("[DM] ✅ Existing DM found:", roomId);
        return roomId;
      }
    } catch (err) {
      console.warn("[DM] Error checking room:", roomId);
    }
  }

  // 3. If not found → create new room
  console.log("[DM] ❌ No DM found, creating new one...");

  const room = await createRoom(accessToken, "DM Room");
  const roomId = room.room_id;

  console.log("[DM] ✅ Room created:", roomId);

  // 4. Invite user
  await inviteUser(accessToken, roomId, targetUserId);
  console.log("[DM] ✅ Invite sent");

  // 5. Wait for join
  let joined = false;

  for (let i = 0; i < 6; i++) {
    const members = await getRoomMembers(accessToken, roomId);
    const userIds = members.map(m => m.userId);

    console.log("[DM] Members:", userIds);

    if (userIds.includes(targetUserId)) {
      console.log("[DM] ✅ User joined");
      joined = true;
      break;
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  if (!joined) {
    console.warn("[DM] ⚠️ User not joined yet");
  }

  return roomId;
}

export async function leaveRoom(accessToken, roomId) {
  const res = await fetch(`${SYNAPSE_BASE}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/leave`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error('Failed to leave room');
}