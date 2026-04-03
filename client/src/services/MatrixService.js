const SYNAPSE_BASE = "http://localhost:8008";
const ADMIN_TOKEN  = "syt_YWRtaW4x_ORxyHHzfMxvFIQxGouDM_0bUXx3";

// ── 1. Check if user exists (admin API) ──────────────────────────────────────
export async function userExists(username) {
  console.log("[Matrix] Checking userExists:", username);

  const res = await fetch(
    `${SYNAPSE_BASE}/_synapse/admin/v2/users/@${username}:localhost`,
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

  const res = await fetch(`${SYNAPSE_BASE}/_matrix/client/r0/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "m.login.password",
      user: username,
      password,
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
    `${SYNAPSE_BASE}/_synapse/admin/v2/users/@${username}:localhost`,
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

  const res = await fetch(`${SYNAPSE_BASE}/_matrix/client/r0/createRoom`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: roomName,
      preset: "private_chat",
      visibility: "private",
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
    `${SYNAPSE_BASE}/_matrix/client/r0/rooms/${encodeURIComponent(roomId)}/invite`,
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
    `${SYNAPSE_BASE}/_matrix/client/r0/sync?${params}`,
    { headers: { "Authorization": `Bearer ${accessToken}` } }
  );

  const data = await res.json();
  console.log("[Matrix] sync next_batch:", data.next_batch);
  return data;
}