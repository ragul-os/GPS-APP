import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { 
  AlertOutlined, 
  UserOutlined, 
  LockOutlined, 
  LockFilled, 
  EyeOutlined, 
  EyeInvisibleOutlined, 
  WarningOutlined, 
  CheckOutlined 
} from '@ant-design/icons';

export default function LoginPage() {
  const { login, dispatcher } = useAuth();
  const navigate   = useNavigate();
  const location   = useLocation();
  const from       = location.state?.from?.pathname || "/agent";

  const [username, setUsername]   = useState("");
  const [password, setPassword]   = useState("");
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [step, setStep]           = useState(0);
  const [clock, setClock]         = useState("");
  const [showPass, setShowPass]   = useState(false);
  const passwordRef               = useRef(null);

  // Redirect if already logged in
  useEffect(() => {
    if (dispatcher) navigate("/agent", { replace: true });
  }, [dispatcher, navigate]);

  // Live clock
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setClock(
        now.toLocaleTimeString("en-US", { hour12: false }) +
        "  " +
        now.toLocaleDateString("en-GB", {
          day: "2-digit", month: "short", year: "numeric",
        }).toUpperCase()
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  async function handleSubmit(e) {
    e?.preventDefault();
    if (!username.trim() || !password || loading) return;

    setError("");
    setLoading(true);
    setStep(1);
    setStatusMsg("Verifying dispatcher credentials...");

    try {
      await login(username.trim(), password, {
        onUserNotFound: () => {
          setStep(2);
          setStatusMsg("Registering new dispatcher account...");
        },
        onUserCreated: () => {
          setStatusMsg("Account created. Establishing session...");
        },
        onLoginSuccess: () => {
          setStep(3);
          setStatusMsg("Access granted. Loading control system...");
        },
      });
      setTimeout(() => navigate(from, { replace: true }), 900);
    } catch (err) {
      setError(err.message || "Authentication failed.");
      setStep(0);
      setStatusMsg("");
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = username.trim() && password && !loading;

  return (
    <div style={s.page}>
      <div style={s.gridOverlay} />

      {/* ── Top bar ───────────────────────────────────────────────── */}
      <div style={s.topBar}>
        <div style={s.topBarLeft}>
          <AlertOutlined style={{ color: "#ef4444", fontSize: '16px', verticalAlign: 'middle' }} />
          <span style={s.topBarTitle}>Emergency Control System</span>
        </div>
        <div style={s.topBarRight}>
          <span style={s.clockText}>{clock}</span>
          <div style={s.offlineBadge}>
            <span style={s.offlineDot} />
            NOT AUTHENTICATED
          </div>
        </div>
      </div>

      {/* ── Centered column ───────────────────────────────────────── */}
      <div style={s.center}>
        <div style={s.centerCol}>

          {/* Title block — sits ABOVE the card */}
          <div style={s.titleBlock}>
            <AlertOutlined style={{ color: "#ef4444", fontSize: '28px', verticalAlign: 'middle' }} />
            <div>
              <div style={s.titleMain}>EMERGENCY CONTROL SYSTEM</div>
              <div style={s.titleSub}>Dispatcher Access Portal — Authorised Personnel Only</div>
            </div>
          </div>

          {/* ── Form card ─────────────────────────────────────────── */}
          <div style={s.card}>

            {/* Red accent strip at top of card */}
            <div style={s.cardStrip}>
              <div style={s.cardStripAccent} />
            </div>

            {/* Card header */}
            <div style={s.cardHeader}>
              <div style={s.cardHeaderLabel}>DISPATCHER LOGIN</div>
              <div style={s.cardHeaderSub}>Enter your credentials to access the system</div>
            </div>

            {/* Step indicators */}
            <div style={s.stepRow}>
              {["Credentials", "Verify", "Access"].map((label, i) => {
                const active = step === i + 1;
                const done   = step > i + 1;
                return (
                  <div key={label} style={s.stepItem}>
                    <div style={{
                      ...s.stepDot,
                      background:  done ? "#ef4444" : active ? "#ef4444"  : "#1e293b",
                      border:      done ? "2px solid #991b1b"
                                 : active ? "2px solid #ef4444" : "2px solid #334155",
                      boxShadow:   active ? "0 0 12px rgba(239,68,68,0.6)" : "none",
                    }}>
                      {done ? <CheckOutlined style={{ fontSize: '12px' }} /> : i + 1}
                    </div>
                    <span style={{
                      ...s.stepLabel,
                      color: active || done ? "#ef4444" : "#475569",
                    }}>
                      {label}
                    </span>
                  </div>
                );
              })}
              <div style={{ ...s.stepLine, left: "calc(33% - 8px)" }} />
              <div style={{ ...s.stepLine, left: "calc(66% - 8px)" }} />
            </div>

            {/* Status banner */}
            {statusMsg && (
              <div style={s.statusBanner}>
                <span style={s.statusPulse} />
                {statusMsg}
              </div>
            )}

            {/* Error banner */}
            {error && (
              <div style={s.errorBanner}>
                <WarningOutlined style={{ marginRight: 8, fontSize: 13, color: "#ef4444" }} />
                {error}
              </div>
            )}

            {/* ── Fields ────────────────────────────────────────── */}
            <div style={s.fields}>

              {/* Username field */}
              <div style={s.fieldGroup}>
                <label style={s.label}>
                  USER NAME <span style={s.asterisk}>*</span>
                </label>
                <div style={s.inputRow}>
                  <span style={s.inputIcon}><UserOutlined style={{ color: "#475569" }} /></span>
                  <input
                    style={s.input}
                    type="text"
                    placeholder="Enter your username"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && passwordRef.current?.focus()}
                    disabled={loading}
                    autoComplete="off"
                    autoFocus
                  />
                </div>
              </div>

              {/* Password field */}
              <div style={s.fieldGroup}>
                <label style={s.label}>
                  PASSWORD <span style={s.asterisk}>*</span>
                </label>
                <div style={s.inputRow}>
                  <span style={s.inputIcon}><LockOutlined style={{ color: "#475569" }} /></span>
                  <input
                    ref={passwordRef}
                    style={{ ...s.input, paddingRight: 44 }}
                    type={showPass ? "text" : "password"}
                    placeholder="Enter your password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleSubmit()}
                    disabled={loading}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(p => !p)}
                    style={s.eyeBtn}
                    tabIndex={-1}
                  >
                    {showPass ? <EyeInvisibleOutlined style={{ fontSize: '14px' }} /> : <EyeOutlined style={{ fontSize: '14px' }} />}
                  </button>
                </div>
              </div>

            </div>

            {/* Submit button */}
            <div style={{ padding: "4px 28px 0" }}>
              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                style={{
                  ...s.btn,
                  opacity: canSubmit ? 1 : 0.4,
                  cursor:  canSubmit ? "pointer" : "not-allowed",
                }}
              >
                {loading ? (
                  <>
                    <span style={s.spinner} />
                    {step === 2 ? "CREATING ACCOUNT..." : "AUTHENTICATING..."}
                  </>
                ) : (
                  <>
                    <LockFilled style={{ fontSize: '16px', verticalAlign: 'middle' }} />
                    SIGN IN TO CONTROL SYSTEM
                  </>
                )}
              </button>
            </div>

            {/* Footer note inside card */}
            <div style={s.cardFooter}>
              Having trouble?&nbsp;
              <span style={{ color: "#94a3b8" }}>Contact your system administrator.</span>
            </div>

          </div>{/* end card */}

          {/* Below-card note */}
          <div style={s.belowCard}>
            All login attempts are monitored and logged
          </div>

        </div>
      </div>

      {/* ── Bottom bar ────────────────────────────────────────────── */}
      <div style={s.bottomBar}>
        <span>EMERGENCY CONTROL SYSTEM — RESTRICTED ACCESS</span>
        <span>v3.1.4</span>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        input::placeholder { color: #475569 !important; }

        input:focus {
          outline: none !important;
          border-color: #ef4444 !important;
          box-shadow: 0 0 0 3px rgba(239,68,68,0.15) !important;
          background: #0f172a !important;
        }
        input:disabled { opacity: 0.5; cursor: not-allowed; }

        @keyframes spin     { to { transform: rotate(360deg); } }
        @keyframes pulse    { 0%,100%{opacity:1} 50%{opacity:0.35} }
        @keyframes fadeUp   { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
        @keyframes pulseDot { 0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,0.6)} 50%{box-shadow:0 0 0 4px rgba(239,68,68,0)} }
      `}</style>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = {

  page: {
    minHeight: "100vh",
    background: "#060910",
    color: "#cbd5e1",
    fontFamily: "'IBM Plex Mono', monospace",
    display: "flex",
    flexDirection: "column",
    position: "relative",
    overflow: "hidden",
  },

  gridOverlay: {
    position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0,
    backgroundImage: `
      linear-gradient(rgba(239,68,68,0.04) 1px, transparent 1px),
      linear-gradient(90deg, rgba(239,68,68,0.04) 1px, transparent 1px)`,
    backgroundSize: "36px 36px",
  },

  // ── Top bar ──
  topBar: {
    height: 44, background: "#0d1117",
    borderBottom: "1px solid #1e293b",
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "0 24px", zIndex: 10, flexShrink: 0, position: "relative",
  },
  topBarLeft:  { display: "flex", alignItems: "center", gap: 8 },
  topBarTitle: {
    fontFamily: "'Rajdhani', sans-serif", fontWeight: 700,
    fontSize: 15, letterSpacing: "0.05em", color: "#f1f5f9",
  },
  topBarRight: { display: "flex", alignItems: "center", gap: 16 },
  clockText: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11, color: "#64748b", letterSpacing: "0.06em",
  },
  offlineBadge: {
    display: "flex", alignItems: "center", gap: 6,
    background: "#0f172a", border: "1px solid #1e293b",
    borderRadius: 4, padding: "3px 10px",
    fontSize: 10, color: "#64748b", letterSpacing: "0.08em",
  },
  offlineDot: {
    width: 6, height: 6, borderRadius: "50%", background: "#334155",
  },

  // ── Center ──
  center: {
    flex: 1, display: "flex",
    alignItems: "center", justifyContent: "center",
    padding: "32px 20px", position: "relative", zIndex: 1,
  },
  centerCol: {
    display: "flex", flexDirection: "column",
    alignItems: "center", gap: 16,
    width: "100%", maxWidth: 460,
    animation: "fadeUp 0.5s ease both",
  },

  // ── Title block above card ──
  titleBlock: {
    display: "flex", alignItems: "center", gap: 14,
    padding: "14px 20px",
    background: "#0d1117",
    border: "1px solid #1e293b",
    borderRadius: 8,
    width: "100%",
  },
  titleIcon: { fontSize: 28, flexShrink: 0 },
  titleMain: {
    fontFamily: "'Rajdhani', sans-serif",
    fontWeight: 700, fontSize: 19,
    letterSpacing: "0.06em", color: "#f1f5f9",
    marginBottom: 3,
  },
  titleSub: {
    fontSize: 10, color: "#475569",
    letterSpacing: "0.07em", textTransform: "uppercase",
  },

  // ── Card ──
  card: {
    width: "100%",
    background: "#0d1117",
    border: "1px solid #1e293b",
    borderRadius: 8,
    overflow: "hidden",
  },
  cardStrip: { height: 3, background: "#1e293b", position: "relative" },
  cardStripAccent: {
    position: "absolute", left: 0, top: 0,
    width: "45%", height: "100%", background: "#ef4444",
  },
  cardHeader: {
    padding: "20px 28px 14px",
    borderBottom: "1px solid #1e293b",
  },
  cardHeaderLabel: {
    fontFamily: "'Rajdhani', sans-serif",
    fontWeight: 700, fontSize: 18,
    letterSpacing: "0.08em", color: "#f1f5f9", marginBottom: 4,
  },
  cardHeaderSub: { fontSize: 11, color: "#64748b", letterSpacing: "0.04em" },

  // ── Step row ──
  stepRow: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "14px 28px", borderBottom: "1px solid #1e293b",
    position: "relative",
  },
  stepItem: {
    display: "flex", flexDirection: "column",
    alignItems: "center", gap: 5, zIndex: 1, width: 72,
  },
  stepDot: {
    width: 26, height: 26, borderRadius: "50%",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 11, fontWeight: 600, color: "#f1f5f9",
    transition: "all 0.3s ease",
  },
  stepLabel: {
    fontSize: 9, letterSpacing: "0.09em",
    textTransform: "uppercase", transition: "color 0.3s",
  },
  stepLine: {
    position: "absolute", top: "calc(14px + 13px)",
    height: 1, width: "18%", background: "#1e293b",
  },

  // ── Banners ──
  statusBanner: {
    margin: "14px 28px 0",
    padding: "10px 14px",
    background: "rgba(239,68,68,0.07)",
    border: "1px solid rgba(239,68,68,0.25)",
    borderRadius: 6, fontSize: 11, color: "#fca5a5",
    display: "flex", alignItems: "center", gap: 10,
    letterSpacing: "0.03em",
    animation: "fadeUp 0.3s ease both",
  },
  statusPulse: {
    width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
    background: "#ef4444", animation: "pulseDot 1.4s ease-in-out infinite",
  },
  errorBanner: {
    margin: "14px 28px 0",
    padding: "10px 14px",
    background: "rgba(239,68,68,0.1)",
    border: "1px solid #ef4444",
    borderRadius: 6, fontSize: 11, color: "#fca5a5",
    display: "flex", alignItems: "center",
    letterSpacing: "0.03em",
    animation: "fadeUp 0.3s ease both",
  },

  // ── Fields ──
  fields: { padding: "18px 28px 0" },
  fieldGroup: { marginBottom: 16 },

  // Label — brighter color (#94a3b8 vs old #6b7280), slightly bigger font
  label: {
    display: "block",
    fontSize: 11,
    fontWeight: 500,
    color: "#94a3b8",
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    marginBottom: 8,
    fontFamily: "'IBM Plex Mono', monospace",
  },
  asterisk: { color: "#ef4444", marginLeft: 2 },

  // Input — no boxed prefix, clean left icon, visible border
  inputRow: {
    position: "relative",
    display: "flex", alignItems: "center",
  },
  inputIcon: {
    position: "absolute", left: 13,
    fontSize: 14, pointerEvents: "none", lineHeight: 1,
  },
  input: {
    width: "100%",
    background: "#080c14",
    border: "1px solid #334155",      // visible border (was very dark before)
    borderRadius: 6,
    padding: "12px 14px 12px 40px",
    color: "#e2e8f0",                  // bright readable text
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 13,
    letterSpacing: "0.02em",
    transition: "border-color 0.2s, box-shadow 0.2s, background 0.2s",
  },
  eyeBtn: {
    position: "absolute", right: 10,
    background: "transparent", border: "none",
    cursor: "pointer", fontSize: 14, padding: 4,
    color: "#475569", lineHeight: 1,
  },

  // ── Button ──
  btn: {
    width: "100%", padding: "14px",
    background: "#ef4444", border: "none", borderRadius: 6,
    color: "#fff",
    fontFamily: "'Rajdhani', sans-serif",
    fontWeight: 700, fontSize: 15,
    letterSpacing: "0.1em", textTransform: "uppercase",
    display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
    transition: "background 0.2s, box-shadow 0.2s",
  },
  spinner: {
    display: "inline-block", width: 14, height: 14,
    border: "2px solid rgba(255,255,255,0.3)",
    borderTopColor: "#fff", borderRadius: "50%",
    animation: "spin 0.7s linear infinite", flexShrink: 0,
  },

  cardFooter: {
    padding: "14px 28px 22px",
    fontSize: 11, textAlign: "center",
    color: "#475569", marginTop: 8,
  },

  belowCard: {
    fontSize: 10, color: "#334155",
    letterSpacing: "0.08em", textTransform: "uppercase",
  },

  // ── Bottom bar ──
  bottomBar: {
    height: 32, background: "#0d1117",
    borderTop: "1px solid #1e293b",
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "0 24px", fontSize: 10,
    color: "#334155", letterSpacing: "0.06em",
    flexShrink: 0, zIndex: 10, position: "relative",
  },
};