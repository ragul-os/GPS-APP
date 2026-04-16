/**
 * LoginScreen.js
 *
 * CHANGES FROM ORIGINAL:
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. UNIT TYPE DROPDOWN — user picks their unit type at login:
 *      Ambulance | Police | Fire | Rescue | Hazmat
 *    Selection is stored in AsyncStorage ('UNIT_TYPE') and passed to AuthContext.
 *
 * 2. MATRIX AUTH FLOW — mirrors the web LoginPage exactly:
 *      a. userExists(username)   → check if Matrix account exists
 *      b. If NOT found           → createSynapseUser(username, password)
 *      c. matrixLogin(username, password) → get access_token
 *    This means any new driver can self-register just by entering a username
 *    + password — no admin intervention needed.
 *
 * 3. UNIQUE UNIT ID — getOrCreateUnitId(unitType) is called after successful
 *    login to ensure this device always has a stable, unique ID like "AMB-A3F9K2".
 *    The ID is persisted in AsyncStorage and passed into the session.
 *
 * 4. Status messages — shown for each step (checking → registering → success)
 *    so the driver knows what is happening.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import {
  createSynapseUser,
  matrixLogin,
  userExists,
} from '../services/matrixService';
import { getOrCreateUnitId } from '../utils/unitId';

// ─── Unit type options ────────────────────────────────────────────────────────
const UNIT_TYPES = [
  { value: 'ambulance', label: 'Ambulance',  icon: 'ambulance',          iconLib: 'MaterialCommunity' },
  { value: 'police',    label: 'Police',     icon: 'shield-car',         iconLib: 'MaterialCommunity' },
  { value: 'fire',      label: 'Fire',       icon: 'fire-truck',         iconLib: 'MaterialCommunity' },
  { value: 'rescue',    label: 'Rescue',     icon: 'lifebuoy',           iconLib: 'MaterialCommunity' },
  { value: 'hazmat',    label: 'Hazmat',     icon: 'biohazard',          iconLib: 'MaterialCommunity' },
];

// ─── Unit type accent colors ──────────────────────────────────────────────────
const UNIT_COLORS = {
  ambulance: '#EF4444',
  police:    '#1D4ED8',
  fire:      '#F97316',
  rescue:    '#16A34A',
  hazmat:    '#7C3AED',
};

// ─── Step status messages ─────────────────────────────────────────────────────
const STEPS = {
  checking:    'Connecting to dispatch network…',
  registering: 'Registering new account…',
  logging_in:  'Verifying credentials…',
  success:     'Access granted!',
};

export default function LoginScreen() {
  const { login } = useAuth();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  // ── Form state ──────────────────────────────────────────────────────────────
  const [username,   setUsername]   = useState('');
  const [password,   setPassword]   = useState('');
  const [showPass,   setShowPass]   = useState(false);
  const [unitType,   setUnitType]   = useState('ambulance'); // selected unit type
  const [showPicker, setShowPicker] = useState(false);       // dropdown modal open

  // ── Auth state ──────────────────────────────────────────────────────────────
  const [loading,   setLoading]   = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [error,     setError]     = useState('');

  // ── Derived: accent color for selected unit type ────────────────────────────
  const accentColor = UNIT_COLORS[unitType] || '#EF4444';

  // ── Selected unit type object ───────────────────────────────────────────────
  const selectedUnit = UNIT_TYPES.find(u => u.value === unitType);

  // ────────────────────────────────────────────────────────────────────────────
  // handleLogin — Matrix auth flow:
  //   1. Check if user exists in Synapse
  //   2. If not → create the account (self-registration)
  //   3. Login with matrixLogin() → get access_token
  //   4. Generate/retrieve stable device unit ID
  //   5. Store unit type in AsyncStorage
  //   6. Call AuthContext login() with session data
  // ────────────────────────────────────────────────────────────────────────────
  async function handleLogin() {
    if (!username.trim() || !password || loading) return;

    setError('');
    setLoading(true);

    try {
      // ── Step 1: Check if user exists ────────────────────────────────────────
      setStatusMsg(STEPS.checking);
      const exists = await userExists(username.trim());

      // ── Step 2: Create account if new user ─────────────────────────────────
      if (!exists) {
        setStatusMsg(STEPS.registering);
        await createSynapseUser(username.trim(), password);
      }

      // ── Step 3: Login to Matrix ─────────────────────────────────────────────
      setStatusMsg(STEPS.logging_in);
      const matrixSession = await matrixLogin(username.trim(), password);
      // matrixSession = { access_token, user_id, device_id }

      // ── Step 4: Get or create stable device unit ID ─────────────────────────
      const unitId = await getOrCreateUnitId(unitType);

      // ── Step 5: Persist unit type for AlertScreen / registration ───────────
      await AsyncStorage.setItem('UNIT_TYPE', unitType);
      await AsyncStorage.setItem('UNIT_ID', unitId);

      // ── Step 6: Hand off to AuthContext ─────────────────────────────────────
      setStatusMsg(STEPS.success);
      await login({
        username:    username.trim(),
        displayname: username.trim(),
        accessToken: matrixSession.access_token,
        userId:      matrixSession.user_id,
        deviceId:    matrixSession.device_id,
        unitType,    // e.g. 'ambulance'
        unitId,      // e.g. 'AMB-A3F9K2'
      });

    } catch (err) {
      // Matrix error codes
      const matrixErr = err?.errcode;
      if (matrixErr === 'M_FORBIDDEN') {
        setError('Incorrect password. Please try again.');
      } else if (matrixErr === 'M_USER_IN_USE') {
        setError('Username already taken. Choose a different one.');
      } else {
        setError(err.message || err.error || 'Authentication failed. Check your connection.');
      }
      setStatusMsg('');
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = username.trim().length > 0 && password.length > 0 && !loading;

  // ────────────────────────────────────────────────────────────────────────────
  // Unit Type Picker Modal
  // ────────────────────────────────────────────────────────────────────────────
  const UnitTypePicker = () => (
    <Modal
      visible={showPicker}
      transparent
      animationType="slide"
      onRequestClose={() => setShowPicker(false)}
    >
      <TouchableOpacity
        style={styles.modalOverlay}
        activeOpacity={1}
        onPress={() => setShowPicker(false)}
      >
        <View style={[styles.pickerSheet, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={[styles.pickerHandle, { backgroundColor: theme.border }]} />
          <Text style={[styles.pickerTitle, { color: theme.textPrimary }]}>Select Unit Type</Text>

          {UNIT_TYPES.map(unit => {
            const isSelected = unit.value === unitType;
            const color = UNIT_COLORS[unit.value];
            return (
              <TouchableOpacity
                key={unit.value}
                style={[
                  styles.pickerOption,
                  { borderColor: theme.border, backgroundColor: theme.surfaceAlt },
                  isSelected && { backgroundColor: color + '15', borderColor: color },
                ]}
                onPress={() => {
                  setUnitType(unit.value);
                  setShowPicker(false);
                }}
                activeOpacity={0.8}
              >
                <View style={[styles.pickerIconCircle, { backgroundColor: color + '20' }]}>
                  <MaterialCommunityIcons name={unit.icon} size={22} color={color} />
                </View>
                <Text style={[styles.pickerOptionLabel, isSelected && { color }]}>
                  {unit.label}
                </Text>
                {isSelected && (
                  <Ionicons name="checkmark-circle" size={20} color={color} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </TouchableOpacity>
    </Modal>
  );

  // ────────────────────────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: theme.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <UnitTypePicker />

      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <View style={[styles.iconCircle, { backgroundColor: accentColor, shadowColor: accentColor }]}>
            <MaterialCommunityIcons name={selectedUnit?.icon || 'ambulance'} size={40} color="#FFFFFF" />
          </View>
          <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>EMERGENCY{'\n'}CONTROL SYSTEM</Text>
          <Text style={[styles.headerSub, { color: theme.textSecondary }]}>Driver Access Portal</Text>
        </View>

        {/* ── Card ────────────────────────────────────────────────────────── */}
        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={[styles.cardStripAccent, { backgroundColor: accentColor }]} />

          <Text style={[styles.cardTitle, { color: theme.textPrimary }]}>DRIVER LOGIN</Text>
          <Text style={[styles.cardSub, { color: theme.textSecondary }]}>Enter your credentials to go online</Text>

          {/* Status banner */}
          {statusMsg ? (
            <View style={[styles.statusRow, { borderColor: accentColor + '40', backgroundColor: accentColor + '10' }]}>
              <View style={[styles.statusDot, { backgroundColor: accentColor }]} />
              <Text style={[styles.statusTxt, { color: accentColor }]}>{statusMsg}</Text>
            </View>
          ) : null}

          {/* Error banner */}
          {error ? (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={16} color="#EF4444" style={{ marginRight: 8 }} />
              <Text style={styles.errorTxt}>{error}</Text>
            </View>
          ) : null}

          {/* ── Unit Type Selector ─────────────────────────────────────────── */}
          <Text style={styles.label}>UNIT TYPE <Text style={{ color: accentColor }}>*</Text></Text>
          <TouchableOpacity
            style={[styles.dropdownBtn, { borderColor: accentColor }]}
            onPress={() => setShowPicker(true)}
            activeOpacity={0.85}
            disabled={loading}
          >
            <View style={[styles.dropdownIconCircle, { backgroundColor: accentColor + '18' }]}>
              <MaterialCommunityIcons name={selectedUnit?.icon || 'ambulance'} size={20} color={accentColor} />
            </View>
            <Text style={[styles.dropdownLabel, { color: accentColor }]}>
              {selectedUnit?.label || 'Select Unit Type'}
            </Text>
            <Feather name="chevron-down" size={18} color={accentColor} />
          </TouchableOpacity>

          {/* ── Username ──────────────────────────────────────────────────── */}
          <Text style={[styles.label, { color: theme.textSecondary }]}>USERNAME <Text style={{ color: accentColor }}>*</Text></Text>
          <View style={[styles.inputWrap, { borderColor: theme.border, backgroundColor: theme.inputBg }]}>
            <Feather name="user" size={17} color={theme.textSecondary} style={styles.inputIcon} />
            <TextInput
              style={[styles.input, { color: theme.textPrimary }]}
              placeholder="Enter your username"
              placeholderTextColor={theme.textMuted}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!loading}
            />
          </View>

          {/* ── Password ──────────────────────────────────────────────────── */}
          <Text style={[styles.label, { color: theme.textSecondary }]}>PASSWORD <Text style={{ color: accentColor }}>*</Text></Text>
          <View style={[styles.inputWrap, { borderColor: theme.border, backgroundColor: theme.inputBg }]}>
            <Feather name="lock" size={17} color={theme.textSecondary} style={styles.inputIcon} />
            <TextInput
              style={[styles.input, { color: theme.textPrimary }]}
              placeholder="Enter your password"
              placeholderTextColor={theme.textMuted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPass}
              editable={!loading}
            />
            <TouchableOpacity
              onPress={() => setShowPass(p => !p)}
              style={styles.eyeBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather name={showPass ? 'eye-off' : 'eye'} size={18} color="#64748B" />
            </TouchableOpacity>
          </View>

          {/* ── New user hint ─────────────────────────────────────────────── */}
          <Text style={styles.hintTxt}>
            New driver? Just enter a username and password — your account will be created automatically.
          </Text>

          {/* ── Submit button ─────────────────────────────────────────────── */}
          <TouchableOpacity
            style={[
              styles.btn,
              { backgroundColor: accentColor, shadowColor: accentColor },
              (!canSubmit) && styles.btnDisabled,
            ]}
            onPress={handleLogin}
            disabled={!canSubmit}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Feather name="log-in" size={18} color="#fff" style={{ marginRight: 10 }} />
                <Text style={styles.btnTxt}>SIGN IN</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <View style={styles.footerRow}>
          <Feather name="shield" size={11} color="#334155" />
          <Text style={styles.footer}>  All access attempts are monitored and logged</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#060910' },
  container: {
    flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24,
  },

  // ── Header ──
  header: { alignItems: 'center', marginBottom: 32 },
  iconCircle: {
    width: 84, height: 84, borderRadius: 42,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
    shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  headerTitle: {
    fontSize: 22, fontWeight: '900', color: '#F1F5F9',
    textAlign: 'center', letterSpacing: 2, lineHeight: 30, marginBottom: 6,
  },
  headerSub: { fontSize: 11, color: '#475569', letterSpacing: 3, textTransform: 'uppercase' },

  // ── Card ──
  card: {
    width: '100%', maxWidth: 400, backgroundColor: '#0d1117',
    borderRadius: 16, borderWidth: 1, borderColor: '#1e293b',
    overflow: 'hidden', padding: 24,
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 20, shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  cardStripAccent: {
    position: 'absolute', top: 0, left: 0, width: '45%', height: 3,
  },
  cardTitle: {
    fontSize: 18, fontWeight: '800', color: '#F1F5F9',
    letterSpacing: 1.5, marginBottom: 4, marginTop: 8,
  },
  cardSub: { fontSize: 12, color: '#64748B', marginBottom: 20 },

  // ── Banners ──
  statusRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 16, gap: 10,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusTxt: { fontSize: 13, flex: 1 },
  errorRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(239,68,68,0.10)', borderWidth: 1, borderColor: '#EF4444',
    borderRadius: 10, padding: 12, marginBottom: 16,
  },
  errorTxt: { fontSize: 13, color: '#FCA5A5', flex: 1 },

  // ── Labels ──
  label: {
    fontSize: 11, fontWeight: '700', color: '#94A3B8',
    letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8,
  },

  // ── Unit Type Dropdown ──
  dropdownBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#080C14', borderWidth: 1.5,
    borderRadius: 10, marginBottom: 18,
    paddingHorizontal: 14, paddingVertical: 12, gap: 10,
  },
  dropdownIconCircle: {
    width: 32, height: 32, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  dropdownLabel: { flex: 1, fontSize: 15, fontWeight: '700' },

  // ── Inputs ──
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#080C14', borderWidth: 1,
    borderRadius: 10, marginBottom: 18,
    paddingHorizontal: 14, paddingVertical: 2,
  },
  inputIcon: { marginRight: 10 },
  input: {
    flex: 1, color: '#E2E8F0', fontSize: 15,
    paddingVertical: Platform.OS === 'ios' ? 14 : 11,
  },
  eyeBtn: { padding: 4 },

  // ── Hint ──
  hintTxt: {
    fontSize: 11, color: '#475569', lineHeight: 16,
    marginBottom: 18, marginTop: -8,
  },

  // ── Button ──
  btn: {
    borderRadius: 12, paddingVertical: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginTop: 4, marginBottom: 8,
    shadowOpacity: 0.4, shadowRadius: 8, elevation: 4,
  },
  btnDisabled: { opacity: 0.4 },
  btnTxt: { color: '#FFF', fontWeight: '800', fontSize: 15, letterSpacing: 1 },

  // ── Footer ──
  footerRow: { flexDirection: 'row', alignItems: 'center', marginTop: 28 },
  footer: {
    fontSize: 10, color: '#1e293b', letterSpacing: 0.5,
    textTransform: 'uppercase', textAlign: 'center',
  },

  // ── Modal / Picker ──
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  pickerSheet: {
    backgroundColor: '#0d1117', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40,
    borderTopWidth: 1, borderColor: '#1e293b',
  },
  pickerHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: '#334155', alignSelf: 'center', marginBottom: 20,
  },
  pickerTitle: {
    fontSize: 16, fontWeight: '800', color: '#F1F5F9',
    letterSpacing: 0.5, marginBottom: 16, textAlign: 'center',
  },
  pickerOption: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 14, paddingHorizontal: 16,
    borderRadius: 12, marginBottom: 8,
    borderWidth: 1.5, borderColor: '#1e293b',
  },
  pickerIconCircle: {
    width: 40, height: 40, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  pickerOptionLabel: {
    flex: 1, fontSize: 16, fontWeight: '700', color: '#94A3B8',
  },
});