import { createContext, useContext, useState } from "react";
import { matrixLogin, createSynapseUser, userExists } from "../services/MatrixService";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [dispatcher, setDispatcher] = useState(() => {
    const stored = localStorage.getItem("dispatcher");
    return stored ? JSON.parse(stored) : null;
  });

  // callbacks = { onUserNotFound, onUserCreated, onLoginSuccess }
  async function login(username, password, callbacks = {}) {
    const { onUserNotFound, onUserCreated, onLoginSuccess } = callbacks;
    console.log("[Auth] login() started for:", username);

    let session;

    try {
      // ── Step 1: Try login directly ──────────────────────────────────────
      console.log("[Auth] Trying Matrix login first...");
      session = await matrixLogin(username, password);
      console.log("[Auth] Existing user login success:", session.user_id);
      onLoginSuccess?.();

    } catch (err) {
      console.warn("[Auth] Login failed:", err.errcode, err.error);

      if (err.errcode === "M_FORBIDDEN" || err.errcode === "M_USER_DOES_NOT_EXIST") {

        // ── Step 2: Check if user truly exists via admin API ────────────
        const exists = await userExists(username);
        console.log("[Auth] userExists check:", exists);

        if (exists) {
          // User exists but password is wrong — do NOT override
          console.error("[Auth] User exists but wrong password");
          throw new Error("Incorrect access code. Contact your administrator.");
        }

        // ── Step 3: New user — create then login ────────────────────────
        onUserNotFound?.();
        console.log("[Auth] New user, creating Synapse account...");

        try {
          await createSynapseUser(username, password);
          console.log("[Auth] Synapse user created successfully");
          onUserCreated?.();

          session = await matrixLogin(username, password);
          console.log("[Auth] Post-creation login success:", session.user_id);
          onLoginSuccess?.();

        } catch (createErr) {
          console.error("[Auth] Creation or post-creation login failed:", createErr);
          throw new Error("Account creation failed. Contact admin.");
        }

      } else {
        console.error("[Auth] Unexpected error:", err);
        throw new Error(err.error || "Connection error. Try again.");
      }
    }

    // ── Step 4: Persist session ─────────────────────────────────────────
    const user = {
      username,
      userId:      session.user_id,
      accessToken: session.access_token,
      deviceId:    session.device_id,
    };

    console.log("[Auth] Session stored:", user.userId);
    localStorage.setItem("dispatcher", JSON.stringify(user));
    setDispatcher(user);
    return user;
  }

  function logout() {
    localStorage.removeItem("dispatcher");
    setDispatcher(null);
    console.log("[Auth] Dispatcher logged out");
  }

  return (
    <AuthContext.Provider value={{ dispatcher, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);