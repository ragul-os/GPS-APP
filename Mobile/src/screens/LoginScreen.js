import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
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

export default function LoginScreen() {
  const { login } = useAuth();
  const insets = useSafeAreaInsets();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError] = useState('');

  async function handleLogin() {
    if (!username.trim() || !password) return;
    setError('');
    setLoading(true);
    setStatusMsg('Verifying credentials...');
    try {
      await login(username.trim(), password, {
        onChecking: () => setStatusMsg('Connecting to dispatch network...'),
        onSuccess: () => setStatusMsg('Access granted!'),
      });
    } catch (err) {
      setError(err.message);
      setStatusMsg('');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.iconCircle}>
            <MaterialCommunityIcons name="ambulance" size={40} color="#FFFFFF" />
          </View>
          <Text style={styles.headerTitle}>EMERGENCY{'\n'}CONTROL SYSTEM</Text>
          <Text style={styles.headerSub}>Driver Access Portal</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.cardStripAccent} />

          <Text style={styles.cardTitle}>DRIVER LOGIN</Text>
          <Text style={styles.cardSub}>Enter your credentials to go online</Text>

          {statusMsg ? (
            <View style={styles.statusRow}>
              <View style={styles.statusDot} />
              <Text style={styles.statusTxt}>{statusMsg}</Text>
            </View>
          ) : null}

          {error ? (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={16} color="#EF4444" style={{ marginRight: 8 }} />
              <Text style={styles.errorTxt}>{error}</Text>
            </View>
          ) : null}

          <Text style={styles.label}>USERNAME</Text>
          <View style={styles.inputWrap}>
            <Feather name="user" size={17} color="#64748B" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Enter your username"
              placeholderTextColor="#475569"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!loading}
            />
          </View>

          <Text style={styles.label}>PASSWORD</Text>
          <View style={styles.inputWrap}>
            <Feather name="lock" size={17} color="#64748B" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Enter your password"
              placeholderTextColor="#475569"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPass}
              editable={!loading}
            />
            <TouchableOpacity onPress={() => setShowPass(p => !p)} style={styles.eyeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name={showPass ? 'eye-off' : 'eye'} size={18} color="#64748B" />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.btn, (!username.trim() || !password || loading) && styles.btnDisabled]}
            onPress={handleLogin}
            disabled={!username.trim() || !password || loading}
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

        <View style={styles.footerRow}>
          <Feather name="shield" size={11} color="#334155" />
          <Text style={styles.footer}>  All access attempts are monitored and logged</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#060910' },
  container: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },

  header: { alignItems: 'center', marginBottom: 32 },
  iconCircle: {
    width: 84, height: 84, borderRadius: 42,
    backgroundColor: '#EF4444',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
    shadowColor: '#EF4444', shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 6 },
    elevation: 12,
  },
  headerTitle: { fontSize: 22, fontWeight: '900', color: '#F1F5F9', textAlign: 'center', letterSpacing: 2, lineHeight: 30, marginBottom: 6 },
  headerSub: { fontSize: 11, color: '#475569', letterSpacing: 3, textTransform: 'uppercase' },

  card: {
    width: '100%', maxWidth: 400, backgroundColor: '#0d1117',
    borderRadius: 16, borderWidth: 1, borderColor: '#1e293b',
    overflow: 'hidden', padding: 24,
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 20, shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  cardStripAccent: { position: 'absolute', top: 0, left: 0, width: '45%', height: 3, backgroundColor: '#ef4444' },
  cardTitle: { fontSize: 18, fontWeight: '800', color: '#F1F5F9', letterSpacing: 1.5, marginBottom: 4, marginTop: 8 },
  cardSub: { fontSize: 12, color: '#64748B', marginBottom: 24 },

  statusRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(239,68,68,0.07)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)',
    borderRadius: 10, padding: 12, marginBottom: 16, gap: 10,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#EF4444' },
  statusTxt: { fontSize: 13, color: '#FCA5A5', flex: 1 },

  errorRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(239,68,68,0.10)', borderWidth: 1, borderColor: '#EF4444',
    borderRadius: 10, padding: 12, marginBottom: 16,
  },
  errorTxt: { fontSize: 13, color: '#FCA5A5', flex: 1 },

  label: { fontSize: 11, fontWeight: '700', color: '#94A3B8', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#080C14', borderWidth: 1, borderColor: '#334155', borderRadius: 10, marginBottom: 18, paddingHorizontal: 14, paddingVertical: 2 },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, color: '#E2E8F0', fontSize: 15, paddingVertical: Platform.OS === 'ios' ? 14 : 11 },
  eyeBtn: { padding: 4 },

  btn: { backgroundColor: '#EF4444', borderRadius: 12, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 4, marginBottom: 8, shadowColor: '#EF4444', shadowOpacity: 0.4, shadowRadius: 8, elevation: 4 },
  btnDisabled: { opacity: 0.4 },
  btnTxt: { color: '#FFF', fontWeight: '800', fontSize: 15, letterSpacing: 1 },

  footerRow: { flexDirection: 'row', alignItems: 'center', marginTop: 28 },
  footer: { fontSize: 10, color: '#1e293b', letterSpacing: 0.5, textTransform: 'uppercase', textAlign: 'center' },
});
