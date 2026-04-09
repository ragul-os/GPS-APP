/**
 * AlertScreen.js
 *
 * Original icons & colors preserved (Feather, Ionicons, MaterialCommunityIcons,
 * useSafeAreaInsets, blue/green theme).
 *
 * NEW additions from new code:
 *  - Duplicate-poll guard (clearInterval before starting new poll)
 *  - Improved console logging in startPolling
 *  - acceptingRef guard already present in old code — kept as-is
 */

import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AMBULANCE_TYPE, SERVER_URL } from '../config';
import { DISPATCH_ROOM_ID, useAuth } from '../context/AuthContext';
import { joinRoom } from '../services/matrixService';
import ChatRoomListScreen from './Chatroomlistscreen';

const POLL_INTERVAL_MS = 3000;
const LOC_POLL_MS = 5000;
const HEARTBEAT_MS = 10000;

const TRIP_STATUS_CONFIG = {
  idle: { color: '#64748B', bg: '#F1F5F9', icon: 'pause-circle', label: 'Idle', iconLib: 'Feather' },
  dispatched: { color: '#D97706', bg: '#FEF3C7', icon: 'alert-circle', label: 'Dispatched', iconLib: 'Feather' },
  en_route: { color: '#1D4ED8', bg: '#DBEAFE', icon: 'navigation', label: 'En Route', iconLib: 'Feather' },
  arrived: { color: '#15803D', bg: '#DCFCE7', icon: 'map-pin', label: 'Arrived', iconLib: 'Feather' },
  completed: { color: '#64748B', bg: '#F1F5F9', icon: 'check-circle', label: 'Completed', iconLib: 'Feather' },
  abandoned: { color: '#DC2626', bg: '#FEE2E2', icon: 'x-circle', label: 'Abandoned', iconLib: 'Feather' },
};

const TAB_STANDBY = 'standby';
const TAB_CHAT = 'chat';

export default function AlertScreen() {
  const [activeTab, setActiveTab] = useState(TAB_STANDBY);
  const [status, setStatus] = useState('waiting');
  const [alertData, setAlertData] = useState(null);
  const [roomId, setRoomId] = useState(null);
  const [countdown, setCountdown] = useState(30);
  const [serverOnline, setServerOnline] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [tripStatus, setTripStatus] = useState('idle');
  const [isRegistered, setIsRegistered] = useState(false);
  const insets = useSafeAreaInsets();

  const { session, logout, setActiveRoomId } = useAuth();

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(300)).current;
  const countdownRef = useRef(null);
  const pollRef = useRef(null);
  const locPollRef = useRef(null);
  const heartbeatRef = useRef(null);
  const lastAlertId = useRef(null);
  const statusRef = useRef('waiting');
  const isActiveRef = useRef(true);
  const roomIdRef = useRef(null);
  const acceptingRef = useRef(false);

  useEffect(() => { statusRef.current = status; }, [status]);
  useEffect(() => { isActiveRef.current = isActive; }, [isActive]);
  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);

  useEffect(() => {
    if (!session?.username || isRegistered) return;
    registerAmbulance();
  }, [session?.username, isRegistered]);

  useEffect(() => {
    if (!isRegistered) return;
    startPolling();
    startLocPoll();
    startPulse();
    return () => {
      clearInterval(pollRef.current);
      clearInterval(locPollRef.current);
      clearInterval(heartbeatRef.current);
      stopCountdown();
    };
  }, [isRegistered]);

  const registerAmbulance = async () => {
    try {
      await Location.requestForegroundPermissionsAsync();
      const res = await fetch(`${SERVER_URL}/register-ambulance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ambulanceId: session.username,
          name: session.displayname || session.username,
          type: AMBULANCE_TYPE || 'ambulance',
        }),
      });
      const json = await res.json();
      if (json.success) {
        setIsRegistered(true);
        if (!heartbeatRef.current) startHeartbeat();
      }
    } catch (err) {
      console.warn('[Alert] Registration failed:', err.message);
    }
  };

  const startHeartbeat = () => {
    clearInterval(heartbeatRef.current);
    heartbeatRef.current = setInterval(async () => {
      try {
        let lat = null, lng = null, heading = 0, speed = 0;
        try {
          const loc = await Location.getCurrentPositionAsync({ accuracy: 3, maximumAge: 8000, timeout: 6000 });
          lat = loc.coords.latitude;
          lng = loc.coords.longitude;
          heading = loc.coords.heading >= 0 ? loc.coords.heading : 0;
          speed = loc.coords.speed >= 0 ? Math.round(loc.coords.speed * 3.6 * 10) / 10 : 0;
        } catch { }
        await fetch(`${SERVER_URL}/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ambulanceId: session.username, unitId: session.username, latitude: lat, longitude: lng, heading, speed }),
        });
      } catch { }
    }, HEARTBEAT_MS);
  };

  // NEW: duplicate-poll guard + logging
  const startPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
    }
    console.log('[Polling] Started for:', session.username);

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${SERVER_URL}/my-alert?ambulanceId=${session.username}`);
        const json = await res.json();
        const data = json.alert;
        console.log('[Polling] Response JSON:', data);
        setServerOnline(true);
        if (
          data && data.status === 'pending' &&
          data.id !== lastAlertId.current &&
          statusRef.current === 'waiting' &&
          isActiveRef.current &&
          (tripStatus === 'idle' || tripStatus === 'completed') // Only receive if not on a trip
        ) {
          lastAlertId.current = data.id;
          receiveAlert(data);
        }
      } catch (err) {
        console.log('[Polling] ❌ Error:', err.message);
        setServerOnline(false);
      }
    }, POLL_INTERVAL_MS);
  };

  const startLocPoll = () => {
    fetchTripStatus();
    locPollRef.current = setInterval(fetchTripStatus, LOC_POLL_MS);
  };

  const fetchTripStatus = async () => {
    try {
      if (!session?.username) return;
      const res = await fetch(`${SERVER_URL}/unit-location/${session.username}`);
      const data = await res.json();

      // Update tripStatus from the unit-specific state
      const ts = data.tripStatus || 'idle';
      setTripStatus(ts);

      // If we are waiting for an alert but the backend says we're on a trip,
      // stay in waiting but let the UI show the active trip controls.
      // But we must NOT prompt for a new alert if we are busy.
    } catch { }
  };

  const startPulse = () => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.4, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1.0, duration: 900, useNativeDriver: true }),
      ])
    ).start();
  };

  const slideIn = () => {
    slideAnim.setValue(300);
    Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 60, friction: 8 }).start();
  };

  const stopCountdown = () => {
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
  };

  const toggleActive = () => {
    const next = !isActive;
    setIsActive(next);
    if (!next && statusRef.current === 'incoming') doReject('disconnected');
  };

  const receiveAlert = async (data) => {
    stopCountdown();
    setAlertData(data);
    setStatus('incoming');
    setCountdown(30);
    slideIn();

    const extractedRoomId = data.roomId || data.matrixRoomId || null;
    if (extractedRoomId) {
      setRoomId(extractedRoomId);
      roomIdRef.current = extractedRoomId;
    } else {
      setRoomId(DISPATCH_ROOM_ID);
      roomIdRef.current = DISPATCH_ROOM_ID;
    }

    Vibration.vibrate([0, 500, 200, 500, 200, 500]);

    let remaining = 30;
    countdownRef.current = setInterval(() => {
      remaining -= 1;
      setCountdown(remaining);
      if (remaining <= 0) {
        stopCountdown();
        if (statusRef.current === 'incoming') doReject('timeout', data);
      }
    }, 1000);
  };

  const handleAccept = async () => {
    if (acceptingRef.current) {
      console.log('[Alert] handleAccept already in progress, ignoring duplicate call');
      return;
    }
    acceptingRef.current = true;
    console.log('👉 Accept clicked');

    if (!alertData) { acceptingRef.current = false; return; }
    stopCountdown();

    const captured = alertData;
    const capturedRoomId = roomIdRef.current;

    console.log('[Alert] Room ID:', capturedRoomId);
    setActiveRoomId(capturedRoomId);

    try {
      if (capturedRoomId && session?.accessToken) {
        console.log('[Alert] Joining room...');
        await joinRoom(session.accessToken, capturedRoomId);
        console.log('[Alert] Joined room ✅');
      }
    } catch (err) {
      console.warn('[Alert] joinRoom failed:', err.message);
    }

    try {
      await fetch(`${SERVER_URL}/accept-assignment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ambulanceId: session.username }),
      });
      console.log('[Alert] Accepted in backend ✅');
    } catch (err) {
      console.warn('[Alert] Accept API failed:', err.message);
    }

    setStatus('accepted');
    setAlertData(null);

    console.log('[Alert] Navigating to map...');
    router.replace({
      pathname: '/(app)/(dispatch)/map',
      params: {
        destination: JSON.stringify(captured.destination),
        roomId: capturedRoomId || '',
        ambulanceId: session.username,
        initialTripStatus: 'accepted',
      },
    });

    setTimeout(() => { acceptingRef.current = false; }, 3000);
  };

  const doReject = async (reason = 'manual', forceData = null) => {
    acceptingRef.current = false;
    const target = forceData || alertData;
    if (!target || statusRef.current !== 'incoming') return;
    stopCountdown();
    setStatus('rejected');
    setAlertData(null);
    setRoomId(null);
    roomIdRef.current = null;
    try {
      await fetch(`${SERVER_URL}/reject-assignment`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ambulanceId: session.username, unitId: session.username, reason }),
      });
    } catch { }
    try {
      await fetch(`${SERVER_URL}/update-dispatch-status`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unitId: session.username, tripStatus: 'idle' }),
      });
    } catch { }
    setTimeout(() => { setStatus('waiting'); setTripStatus('idle'); slideAnim.setValue(300); }, 2500);
  };

  // Original StatusPill using Feather icons
  const StatusPill = ({ ts }) => {
    const cfg = TRIP_STATUS_CONFIG[ts] || TRIP_STATUS_CONFIG.idle;
    return (
      <View style={[styles.statusPill, { backgroundColor: cfg.bg, borderColor: cfg.color }]}>
        <Feather name={cfg.icon} size={13} color={cfg.color} />
        <Text style={[styles.statusPillText, { color: cfg.color }]}>{cfg.label}</Text>
      </View>
    );
  };

  // Original TabBar using MaterialCommunityIcons + Ionicons
  const TabBar = () => (
    <View style={[styles.tabBar, { paddingBottom: insets.bottom || 16 }]}>
      <TouchableOpacity
        style={[styles.tabBtn, activeTab === TAB_STANDBY && styles.tabBtnActive]}
        onPress={() => setActiveTab(TAB_STANDBY)}
        activeOpacity={0.8}
      >
        <MaterialCommunityIcons
          name="ambulance"
          size={22}
          color={activeTab === TAB_STANDBY ? '#1E40AF' : '#94A3B8'}
        />
        <Text style={[styles.tabLabel, activeTab === TAB_STANDBY && styles.tabLabelActive]}>Standby</Text>
        {activeTab === TAB_STANDBY && <View style={styles.tabUnderline} />}
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.tabBtn, activeTab === TAB_CHAT && styles.tabBtnActive]}
        onPress={() => setActiveTab(TAB_CHAT)}
        activeOpacity={0.8}
      >
        <Ionicons
          name="chatbubbles"
          size={22}
          color={activeTab === TAB_CHAT ? '#1E40AF' : '#94A3B8'}
        />
        <Text style={[styles.tabLabel, activeTab === TAB_CHAT && styles.tabLabelActive]}>Chats</Text>
        {activeTab === TAB_CHAT && <View style={styles.tabUnderline} />}
      </TouchableOpacity>
    </View>
  );

  if (status === 'rejected') {
    return (
      <View style={[styles.waitingContainer, { backgroundColor: '#FFF5F5' }]}>
        <TabBar />
        <View style={[styles.topBarAbsolute, { top: insets.top + 8 }]}>
          <StatusPill ts="idle" />
        </View>
        <Ionicons name="close-circle" size={80} color="#DC2626" style={{ marginBottom: 16 }} />
        <Text style={[styles.waitingTitle, { color: '#DC2626' }]}>Alert Rejected</Text>
        <Text style={[styles.waitingSubtitle, { color: '#94A3B8' }]}>Returning to standby…</Text>
      </View>
    );
  }

  if (activeTab === TAB_CHAT) {
    return (
      <View style={styles.flex}>
        <ChatRoomListScreen extraRoomId={roomId} />
        <TabBar />
      </View>
    );
  }

  const IncomingAlert = () => (
    <View style={styles.incomingContainer}>
      <View style={styles.overlay} />
      <Animated.View style={[styles.alertCard, { transform: [{ translateY: slideAnim }] }]}>
        <View style={styles.alertHeader}>
          <View style={styles.alertHeaderIconCircle}>
            <Ionicons name="alert" size={26} color="#fff" />
          </View>
          <Text style={styles.alertHeaderTitle}>EMERGENCY ALERT</Text>
        </View>

        <View style={styles.countdownRow}>
          <View style={[
            styles.countdownCircle,
            countdown <= 10 && { borderColor: '#DC2626', backgroundColor: '#FEE2E2' },
          ]}>
            <Text style={[styles.countdownNum, countdown <= 10 && { color: '#DC2626' }]}>
              {countdown}
            </Text>
            <Text style={styles.countdownLabel}>sec</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.countdownNote}>Auto-reject after timeout</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, {
                width: `${(countdown / 30) * 100}%`,
                backgroundColor: countdown <= 10 ? '#DC2626' : '#1E40AF',
              }]} />
            </View>
          </View>
        </View>

        {alertData && (
          <View style={styles.infoBox}>
            <InfoRow icon="user" label="Patient" value={alertData.patientName || 'Unknown'} />
            {alertData.patientPhone ? <InfoRow icon="phone" label="Phone" value={alertData.patientPhone} /> : null}
            <InfoRow icon="map-pin" label="Location" value={alertData.address || 'See map'} />
            {alertData.destination && (
              <InfoRow
                icon="crosshair"
                label="Coords"
                value={`${alertData.destination.latitude?.toFixed(4)}, ${alertData.destination.longitude?.toFixed(4)}`}
              />
            )}
            {alertData.notes ? <InfoRow icon="file-text" label="Notes" value={alertData.notes} /> : null}
          </View>
        )}

        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.rejectBtn} onPress={() => doReject('manual')} activeOpacity={0.85}>
            <Ionicons name="close" size={32} color="#DC2626" />
            <Text style={styles.rejectText}>Reject</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.acceptBtn} onPress={handleAccept} activeOpacity={0.85}>
            <Ionicons name="checkmark" size={32} color="#fff" />
            <Text style={styles.acceptText}>Accept</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.chatPreviewBtn} onPress={() => setActiveTab(TAB_CHAT)} activeOpacity={0.8}>
          <Ionicons name="chatbubbles-outline" size={16} color="#1E40AF" style={{ marginRight: 8 }} />
          <Text style={styles.chatPreviewTxt}>View Dispatch Chat</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );

  return (
    <View style={styles.flex}>
      <View style={styles.waitingContainer}>
        <View style={[styles.topBarAbsolute, { top: insets.top + 8 }]}>
          <StatusPill ts={tripStatus} />
          <TouchableOpacity onPress={logout} style={styles.logoutBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="log-out" size={18} color="#94A3B8" />
          </TouchableOpacity>
        </View>

        {isActive && (
          <Animated.View style={[styles.pulseRing, { transform: [{ scale: pulseAnim }] }]} />
        )}

        <View style={styles.ambulanceIconCircle}>
          <MaterialCommunityIcons name="ambulance" size={56} color="#1E40AF" />
        </View>
        <Text style={styles.waitingTitle}>Ready for Dispatch</Text>
        <Text style={styles.waitingSubtitle}>
          {isActive ? 'Waiting for emergency alert…' : 'Notifications paused'}
        </Text>

        <View style={[styles.regBadge, { borderColor: isRegistered ? '#15803D' : '#D97706' }]}>
          <Ionicons
            name={isRegistered ? 'checkmark-circle' : 'time'}
            size={14}
            color={isRegistered ? '#15803D' : '#D97706'}
            style={{ marginRight: 6 }}
          />
          <Text style={{ color: isRegistered ? '#15803D' : '#D97706', fontSize: 13, fontWeight: '700' }}>
            {isRegistered
              ? `${session?.displayname || session?.username} — Online`
              : 'Registering…'}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.toggleBtn, isActive ? styles.toggleBtnActive : styles.toggleBtnInactive]}
          onPress={toggleActive}
          activeOpacity={0.75}
        >
          <View style={[styles.toggleDot, { backgroundColor: isActive ? '#15803D' : '#DC2626' }]} />
          <View style={styles.toggleTextWrap}>
            <Text style={styles.toggleLabel}>{isActive ? 'Connected' : 'Disconnected'}</Text>
            <Text style={styles.toggleSub}>{isActive ? 'Tap to disconnect' : 'Tap to connect'}</Text>
          </View>
          <Feather name={isActive ? 'pause' : 'play'} size={22} color="#CBD5E1" />
        </TouchableOpacity>

        {/* ── ACTIVE TRIP OVERLAY ── */}
        {tripStatus !== 'idle' && tripStatus !== 'completed' && tripStatus !== 'abandoned' && (
          <View style={styles.activeTripCard}>
            <View style={styles.activeTripHeader}>
              <Ionicons name="flash" size={20} color="#1E40AF" />
              <Text style={styles.activeTripTitle}>Active Trip in Progress</Text>
            </View>
            <Text style={styles.activeTripSub}>You have an ongoing incident dispatch.</Text>
            <View style={styles.activeTripActions}>
              <TouchableOpacity
                style={styles.resumeTripBtn}
                onPress={() => {
                  // Re-fetch the alert details to resume mapping
                  fetch(`${SERVER_URL}/my-alert?ambulanceId=${session.username}`)
                    .then(r => r.json())
                    .then(json => {
                      if (json.alert && json.alert.id) {
                        router.replace({
                          pathname: '/(app)/(dispatch)/map',
                          params: {
                            destination: JSON.stringify(json.alert.destination),
                            roomId: json.alert.roomId || '',
                            ambulanceId: session.username,
                            initialTripStatus: tripStatus,
                          },
                        });
                      }
                    });
                }}
              >
                <Text style={styles.resumeTripBtnTxt}>Resume Trip</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.clearTripBtn}
                onPress={() => {
                  Alert.alert('Complete Trip?', 'This will clear your status and return you to standby.', [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Complete', onPress: () => {
                        fetch(`${SERVER_URL}/complete-trip`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ unitId: session.username }),
                        }).then(() => {
                          setTripStatus('idle');
                          setAlertData(null);
                        });
                      }
                    }
                  ]);
                }}
              >
                <Text style={styles.clearTripBtnTxt}>Complete</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={styles.serverRow}>
          <View style={[styles.serverDot, { backgroundColor: serverOnline ? '#22C55E' : '#94A3B8' }]} />
          <Text style={styles.serverText}>
            {serverOnline ? 'Server online' : 'Server offline'}
          </Text>
        </View>
      </View>

      {status === 'incoming' && <IncomingAlert />}
      <TabBar />
    </View>
  );
}

function InfoRow({ icon, label, value }) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoIconWrap}>
        <Feather name={icon} size={13} color="#64748B" />
      </View>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#F8FAFF' },

  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderTopWidth: 0.5,
    borderTopColor: '#E2E8F0',
    paddingTop: 10,
    paddingHorizontal: 8,
  },
  tabBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 12, gap: 3, position: 'relative',
  },
  tabBtnActive: { backgroundColor: '#EFF6FF' },
  tabLabel: { fontSize: 11, fontWeight: '700', color: '#94A3B8', letterSpacing: 0.3 },
  tabLabelActive: { color: '#1E40AF' },
  tabUnderline: { width: 20, height: 3, borderRadius: 2, backgroundColor: '#1E40AF', marginTop: 2 },

  topBarAbsolute: {
    position: 'absolute', left: 0, right: 0, zIndex: 10,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 20,
  },
  logoutBtn: { position: 'absolute', right: 20 },

  statusPill: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1.5, gap: 7,
  },
  statusPillText: { fontSize: 13, fontWeight: '700', letterSpacing: 0.3 },

  regBadge: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderRadius: 20,
    paddingHorizontal: 16, paddingVertical: 8, marginBottom: 20,
  },

  waitingContainer: {
    flex: 1, backgroundColor: '#F8FAFF',
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28,
  },
  pulseRing: {
    position: 'absolute',
    width: 220, height: 220, borderRadius: 110,
    backgroundColor: 'rgba(30,64,175,0.08)',
  },
  ambulanceIconCircle: {
    width: 120, height: 120, borderRadius: 60,
    backgroundColor: '#EFF6FF',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 24,
    shadowColor: '#1E40AF', shadowOpacity: 0.15, shadowRadius: 16, shadowOffset: { width: 0, height: 6 },
    elevation: 8,
    borderWidth: 2, borderColor: '#DBEAFE',
  },
  waitingTitle: { fontSize: 26, fontWeight: '800', color: '#0F172A', marginBottom: 8, textAlign: 'center' },
  waitingSubtitle: { fontSize: 15, color: '#94A3B8', marginBottom: 24, textAlign: 'center' },

  toggleBtn: {
    width: '100%', flexDirection: 'row', alignItems: 'center',
    borderRadius: 18, paddingVertical: 20, paddingHorizontal: 20,
    marginBottom: 20, borderWidth: 2, gap: 14,
  },
  toggleBtnActive: { backgroundColor: '#F0FDF4', borderColor: '#15803D' },
  toggleBtnInactive: { backgroundColor: '#FFF5F5', borderColor: '#DC2626' },
  toggleDot: { width: 16, height: 16, borderRadius: 8, flexShrink: 0 },
  toggleTextWrap: { flex: 1 },
  toggleLabel: { fontSize: 18, fontWeight: '800', color: '#0F172A', marginBottom: 3 },
  toggleSub: { fontSize: 13, color: '#94A3B8' },

  serverRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  serverDot: { width: 7, height: 7, borderRadius: 4 },
  serverText: { fontSize: 12, color: '#CBD5E1' },

  incomingContainer: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end', zIndex: 50 },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  alertCard: {
    backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingBottom: 40, paddingTop: 24, elevation: 24,
  },
  alertHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 20, gap: 12 },
  alertHeaderIconCircle: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#EF4444', alignItems: 'center', justifyContent: 'center',
  },
  alertHeaderTitle: { fontSize: 20, fontWeight: '900', color: '#991B1B', letterSpacing: 1.5 },

  countdownRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 18, gap: 16 },
  countdownCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: '#FEF3C7', borderWidth: 3, borderColor: '#D97706',
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  countdownNum: { fontSize: 26, fontWeight: '900', color: '#92400E' },
  countdownLabel: { fontSize: 10, color: '#92400E', marginTop: -2 },
  countdownNote: { fontSize: 12, color: '#94A3B8', marginBottom: 8 },
  progressTrack: { height: 6, backgroundColor: '#E2E8F0', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3 },

  infoBox: { backgroundColor: '#F8FAFF', borderRadius: 14, padding: 14, marginBottom: 20, borderWidth: 0.5, borderColor: '#E2E8F0' },
  infoRow: { flexDirection: 'row', marginBottom: 10, alignItems: 'flex-start' },
  infoIconWrap: { width: 22, alignItems: 'center', marginRight: 6, marginTop: 1 },
  infoLabel: { width: 72, fontSize: 12, color: '#64748B', fontWeight: '700' },
  infoValue: { flex: 1, fontSize: 13, color: '#0F172A', fontWeight: '500' },

  actionRow: { flexDirection: 'row', gap: 12, marginBottom: 14 },
  rejectBtn: {
    flex: 1, backgroundColor: '#FEE2E2', borderRadius: 18, paddingVertical: 18,
    alignItems: 'center', borderWidth: 2, borderColor: '#FECACA', gap: 4,
  },
  rejectText: { color: '#DC2626', fontWeight: '800', fontSize: 15 },
  acceptBtn: {
    flex: 1, backgroundColor: '#1E40AF', borderRadius: 18, paddingVertical: 18,
    alignItems: 'center', elevation: 4, gap: 4,
    shadowColor: '#1E40AF', shadowOpacity: 0.4, shadowRadius: 8,
  },
  acceptText: { color: '#fff', fontWeight: '800', fontSize: 15 },

  chatPreviewBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 12, borderRadius: 12,
    backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#BFDBFE',
  },
  chatPreviewTxt: { fontSize: 13, color: '#1E40AF', fontWeight: '700' },

  activeTripCard: {
    width: '100%',
    backgroundColor: '#EFF6FF',
    borderRadius: 18,
    padding: 20,
    borderWidth: 2,
    borderColor: '#3B82F6',
    marginTop: 10,
    shadowColor: '#3B82F6',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 4,
  },
  activeTripHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  activeTripTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1E40AF',
  },
  activeTripSub: {
    fontSize: 13,
    color: '#64748B',
    marginBottom: 16,
  },
  activeTripActions: {
    flexDirection: 'row',
    gap: 10,
  },
  resumeTripBtn: {
    flex: 2,
    backgroundColor: '#1E40AF',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  resumeTripBtnTxt: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  clearTripBtn: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
  },
  clearTripBtnTxt: {
    color: '#64748B',
    fontWeight: '700',
    fontSize: 14,
  },
});