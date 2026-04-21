/**
 * AuthContext.js — Mobile Auth Context
 * Wraps Matrix login/signup logic.
 * No Matrix terminology exposed to the user.
 */

import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  clearSession,
  createSynapseUser,
  loadSession,
  matrixLogin,
  saveSession,
  userExists
} from '../services/matrixService';

// ── The default dispatch room — fallback when no alert-specific room exists ──
// Replace with the actual room ID from your dispatcher dashboard

const AuthContext = createContext({
  session: null,
  loading: true,
  login: async () => {},
  signup: async () => {},
  logout: async () => {},
  activeRoomId: null,
  setActiveRoomId: () => {},
});

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);   // { userId, accessToken, deviceId, username }
  const [loading, setLoading] = useState(true);   // true while checking stored session
  const [activeRoomId, setActiveRoomId] = useState(null);

  // ── Restore session from storage on app start ────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const stored = await loadSession();
        if (stored) {
          console.log('[Auth] Restored session for:', stored.username);
          setSession(stored);
        }
      } catch (e) {
        console.warn('[Auth] Session restore failed:', e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // ── Ensure user is in the dispatch room ───────────────────────────────────
  async function ensureInDispatchRoom(username) {
    console.log('[Auth] Ensuring user is in dispatch room:', 'for:', username);
    /* try {
      await forceJoinRoom(username, DISPATCH_ROOM_ID);
      console.log('[Auth] ✅ User is now in dispatch room');
    } catch (err) {
      console.warn('[Auth] Could not force-join dispatch room (non-fatal):', err.message);
    } */
  }

  // ── SIGNUP ────────────────────────────────────────────────────────────────
  async function signup(username, password, displayname, callbacks = {}) {
    const { onCreating, onLoggingIn, onJoiningRoom, onSuccess } = callbacks;
    console.log('[Auth] signup() for:', username);

    // 1. Check if already exists
    const exists = await userExists(username);
    if (exists) throw new Error('Username already taken. Please choose another.');

    // 2. Create the user
    onCreating?.();
    console.log('[Auth] Creating user...');
    await createSynapseUser(username, password, displayname || username);
    console.log('[Auth] User created');

    // 3. Login to get token
    onLoggingIn?.();
    const loginData = await matrixLogin(username, password);
    console.log('[Auth] Login success after signup:', loginData.user_id);

    // 4. Force-join the dispatch room (admin bypasses invite)
    onJoiningRoom?.();
    await ensureInDispatchRoom(username);

    // 5. Persist and return session
    const newSession = {
      username,
      userId:      loginData.user_id,
      accessToken: loginData.access_token,
      deviceId:    loginData.device_id,
      displayname: displayname || username,
    };
    await saveSession(newSession);
    setSession(newSession);
    onSuccess?.();
    console.log('[Auth] signup complete, session saved');
    return newSession;
  }

  // ── LOGIN ─────────────────────────────────────────────────────────────────
  async function login(sessionData, callbacks = {}) {
  console.log('[Auth] login() for:', sessionData);

  // ✅ DIRECTLY USE SESSION (NO matrixLogin again)
  const newSession = {
    username: sessionData.username,
    userId: sessionData.userId,
    accessToken: sessionData.accessToken,
    deviceId: sessionData.deviceId,
    displayname: sessionData.displayname,
    unitType: sessionData.unitType,
    unitId: sessionData.unitId,
  };

  await saveSession(newSession);
  setSession(newSession);

  return newSession;
}

  // ── LOGOUT ────────────────────────────────────────────────────────────────
  async function logout() {
    await clearSession();
    setSession(null);
    console.log('[Auth] Logged out');
  }

  return (
    <AuthContext.Provider value={{ session, loading, login, signup, logout,activeRoomId,
  setActiveRoomId }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);