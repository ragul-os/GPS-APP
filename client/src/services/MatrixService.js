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
export async function createRoom(accessToken, roomName, inviteUserIds = []) {
  console.log("[Matrix] createRoom:", roomName);

  const safeAlias = roomName.replace(/[^a-zA-Z0-9_\-]/g, '_');

  const res = await fetch(`${SYNAPSE_BASE}/_matrix/client/v3/createRoom`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: roomName,
      room_alias_name: safeAlias,
      preset: "public_chat",
      visibility: "public",
      invite: inviteUserIds,
    }),
  });

  const data = await res.json();
  console.log("[Matrix] createRoom response:", data);

  if (!res.ok) {
    if (data.errcode === 'M_ROOM_IN_USE') {
      console.log("[Matrix] Room alias already in use, resolving existing roomId...");
      const alias = `#${safeAlias}:${SYNAPSE_BASE.split('://')[1].split(':')[0]}`;
      // In a real app we'd fetch the alias properly, but let's try to resolve it.
      try {
        const resolveRes = await fetch(`${SYNAPSE_BASE}/_matrix/client/v3/directory/room/${encodeURIComponent(alias)}`, {
          headers: { "Authorization": `Bearer ${accessToken}` }
        });
        if (resolveRes.ok) {
          const resolveData = await resolveRes.json();
          return resolveData; // { room_id }
        }
      } catch (err) {
        console.error("[Matrix] Failed to resolve existing room alias:", err.message);
      }
    }
    throw new Error(data.error || "Room creation failed");
  }
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
  const res = await fetch(`${SYNAPSE_BASE}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/join`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'joinRoom failed');
  return data;
}

// ── 8. Send a plain-text message ─────────────────────────────────────────────
export async function sendMessage(accessToken, roomId, body, customTxnId = null, extraContent = {}) {
  const txnId = customTxnId || `m.${Date.now()}.${Math.random().toString(36).slice(2, 9)}`;
  const res = await fetch(
    `${SYNAPSE_BASE}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
    {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'm.text', body, ...extraContent }),
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
export async function sendImageMessage(accessToken, roomId, url, info = {}, customTxnId = null) {
  const txnId = customTxnId || `m.${Date.now()}.${Math.random().toString(36).slice(2, 9)}`;
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

export async function sendVideoMessage(accessToken, roomId, url, info = {}, customTxnId = null) {
  const txnId = customTxnId || `m.${Date.now()}.${Math.random().toString(36).slice(2, 9)}`;
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

export async function sendAudioMessage(accessToken, roomId, url, info = {}, customTxnId = null) {
  const txnId = customTxnId || `m.${Date.now()}.${Math.random().toString(36).slice(2, 9)}`;
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

export async function sendFileMessage(accessToken, roomId, url, filename = 'file', info = {}, customTxnId = null) {
  const txnId = customTxnId || `m.${Date.now()}.${Math.random().toString(36).slice(2, 9)}`;
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

// ── 20. DM logic mirroring mobile (Strict 1:1 Only) ───────────────────────────
export async function getOrCreateDMRoom(accessToken, myUserId, targetUserId) {
  console.log('[DM] getOrCreateDMRoom for:', targetUserId);
  let resolvedRoomId = null;

  // Step 1: Check account_data for m.direct (standard Matrix way)
  try {
    const adRes = await fetch(
      `${SYNAPSE_BASE}/_matrix/client/v3/user/${encodeURIComponent(myUserId)}/account_data/m.direct`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (adRes.ok) {
      const adData = await adRes.json();
      const dmRooms = adData[targetUserId] || [];

      // STRICT: Verify found room is actually 1:1 (only 2 members)
      for (const rid of dmRooms) {
        try {
          // Use /state to get membership without needing to be joined (more robust for invite check)
          const stateRes = await fetch(
            `${SYNAPSE_BASE}/_matrix/client/v3/rooms/${encodeURIComponent(rid)}/state`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          if (stateRes.ok) {
            const state = await stateRes.json();
            const members = state.filter(e => e.type === 'm.room.member' && (e.content?.membership === 'join' || e.content?.membership === 'invite'));
            if (members.length === 2) {
              resolvedRoomId = rid;
              console.log('[DM] ✅ Found valid 1:1 room in state:', resolvedRoomId);
              break;
            }
          } else {
            // Fallback to /joined_members if /state is forbidden (already joined)
            const membersRes = await fetch(
              `${SYNAPSE_BASE}/_matrix/client/v3/rooms/${encodeURIComponent(rid)}/joined_members`,
              { headers: { Authorization: `Bearer ${accessToken}` } }
            );
            if (membersRes.ok) {
              const { joined } = await membersRes.json();
              const memberCount = Object.keys(joined).length;
              if (memberCount === 2) {
                resolvedRoomId = rid;
                console.log('[DM] ✅ Found valid 1:1 room in joined_members:', resolvedRoomId);
                break;
              }
            }
          }
        } catch (e) { /* skip room on error */ }
      }
    }
  } catch (err) {
    console.warn('[DM] account_data check failed:', err.message);
  }

  // Step 2: Create new DM room if none found (Client API way, no admin join)
  if (!resolvedRoomId) {
    console.log('[DM] Creating new DM room...');

    const createRes = await fetch(`${SYNAPSE_BASE}/_matrix/client/v3/createRoom`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        preset: 'trusted_private_chat',
        visibility: 'private',
        is_direct: true,
        // No 'name' field for DMs - allow clients to calculate name based on members
        invite: [targetUserId],
        initial_state: [
          {
            type: "m.room.guest_access",
            state_key: "",
            content: { guest_access: "can_join" }
          },
          {
            type: "m.room.history_visibility",
            state_key: "",
            content: { history_visibility: "shared" }
          }
        ]
      }),
    });
    const createData = await createRes.json();
    if (!createRes.ok) throw new Error(createData.error || 'Failed to create DM room');
    resolvedRoomId = createData.room_id;
    console.log('[DM] ✅ Room created:', resolvedRoomId);

    // Save to account_data
    try {
      let existingDMs = {};
      const adRes = await fetch(
        `${SYNAPSE_BASE}/_matrix/client/v3/user/${encodeURIComponent(myUserId)}/account_data/m.direct`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (adRes.ok) existingDMs = await adRes.json();

      const targetDMs = existingDMs[targetUserId] || [];
      if (!targetDMs.includes(resolvedRoomId)) {
        await fetch(
          `${SYNAPSE_BASE}/_matrix/client/v3/user/${encodeURIComponent(myUserId)}/account_data/m.direct`,
          {
            method: 'PUT',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...existingDMs,
              [targetUserId]: [...targetDMs, resolvedRoomId],
            }),
          }
        );
        console.log('[DM] ✅ account_data updated');
      }
    } catch (err) {
      console.warn('[DM] account_data save failed (non-fatal):', err.message);
    }
  }

  // Step 3: Ensure I (the dispatcher) am actually joined
  let joinedSuccessfully = false;
  let attempts = 0;
  while (!joinedSuccessfully && attempts < 3) {
    attempts++;
    try {
      const joinRes = await fetch(`${SYNAPSE_BASE}/_matrix/client/v3/rooms/${encodeURIComponent(resolvedRoomId)}/join`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (joinRes.ok) {
        joinedSuccessfully = true;
        console.log(`[DM] ✅ Dispatcher joined on attempt ${attempts}`);
      } else {
        const joinErr = await joinRes.json();
        console.warn(`[DM] Join attempt ${attempts} failed:`, joinErr);
        if (attempts < 3) await new Promise(r => setTimeout(r, 500));
      }
    } catch (err) {
      console.warn(`[DM] Join error on attempt ${attempts}:`, err.message);
      if (attempts < 3) await new Promise(r => setTimeout(r, 500));
    }
  }

  if (!joinedSuccessfully) {
    throw new Error('Could not join the DM room after multiple attempts.');
  }

  return resolvedRoomId;
}

// ── 21. NEW: Message Actions (Reactions, Pins, etc.) ───────────────────────
export async function sendReaction(accessToken, roomId, eventId, key) {
  const txnId = `react_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const res = await fetch(`${SYNAPSE_BASE}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.reaction/${txnId}`, {
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
  const stRes = await fetch(`${SYNAPSE_BASE}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.pinned_events`, {
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

  const res = await fetch(`${SYNAPSE_BASE}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.pinned_events`, {
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
  // Simplest forward: send the same content to another room
  const { msgtype, body, url, info, geo_uri } = originalMsg;
  return await sendMessage(accessToken, targetRoomId, body, undefined, {
    msgtype, url, info, geo_uri,
    'm.relates_to': {
      rel_type: 'm.forward', // custom marker for UI if needed
      event_id: originalMsg.id
    }
  });
}

// ── 22. NEW: Fetch Joined Rooms ───────────────────────────────────────────
export async function getJoinedRooms(accessToken) {
  const res = await fetch(`${SYNAPSE_BASE}/_matrix/client/v3/joined_rooms`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to fetch rooms');
  return data.joined_rooms; // [room_id, ...]
}

export async function getRoomName(accessToken, roomId) {
  const res = await fetch(`${SYNAPSE_BASE}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.name`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (res.ok) {
    const data = await res.json();
    return data.name;
  }
  return roomId;
}

// ── 23. NEW: Save Direct Message (m.direct) ───────────────────────────────