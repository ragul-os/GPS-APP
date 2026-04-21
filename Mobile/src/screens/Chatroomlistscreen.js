/**
 * ChatRoomListScreen.js
 */

import { Feather, Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { SERVER_URL } from '../config';
import {
  getJoinedRooms,
  getOrCreateDMRoom,
  getRoomMembers,
  getRoomMessages,
  syncMatrix,
} from '../services/matrixService';
import ChatScreen from './ChatScreen';

function formatTime(ts) {
  if (!ts) return '';
  const now = new Date();
  const date = new Date(ts);
  const diff = now - date;
  const day = 86400000;
  if (diff < day && now.getDate() === date.getDate()) {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  }
  if (diff < 2 * day) return 'Yesterday';
  if (diff < 7 * day) return date.toLocaleDateString('en-US', { weekday: 'short' });
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function previewText(event) {
  if (!event) return 'No messages yet';
  const content = event.content || {};
  const type = content.msgtype || '';
  if (type === 'm.text') return content.body || '';
  if (type === 'm.image') return '📷 Photo';
  if (type === 'm.video') return '🎥 Video';
  if (type === 'm.audio') return '🎵 Voice message';
  if (type === 'm.file') return '📎 ' + (content.body || 'File');
  if (type === 'm.location') return '📍 Location';
  return '';
}

function roomDisplayName(roomId, roomNames = {}, dmNames = {}) {
  if (roomNames[roomId]) return roomNames[roomId];
  if (dmNames[roomId]) return dmNames[roomId];
  return 'Loading...';
}

function getInitials(name = '') {
  if (!name) return '?';
  const clean = name.replace(/[^a-zA-Z ]/g, '').trim();
  if (clean.length === 0) return name.slice(0, 2).toUpperCase();
  const parts = clean.split(' ').filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return clean.slice(0, 2).toUpperCase();
}

function roomInitials(roomId, roomNames = {}, dmNames = {}) {
  const name = roomNames[roomId] || dmNames[roomId];
  return getInitials(name);
}

function avatarColor(roomId) {
  const colours = [
    { bg: '#DBEAFE', text: '#1E40AF' },
    { bg: '#FEF3C7', text: '#92400E' },
    { bg: '#D1FAE5', text: '#065F46' },
    { bg: '#EDE9FE', text: '#7C3AED' },
    { bg: '#FCE7F3', text: '#BE185D' },
    { bg: '#FFE4E6', text: '#BE123C' },
    { bg: '#F0FDF4', text: '#166534' },
  ];
  let hash = 0;
  for (let i = 0; i < roomId.length; i++) hash = (hash * 31 + roomId.charCodeAt(i)) & 0xffffffff;
  return colours[Math.abs(hash) % colours.length];
}

function memberAvatarColor(userId) {
  const colours = [
    { bg: '#DBEAFE', text: '#1E40AF' },
    { bg: '#FEF3C7', text: '#92400E' },
    { bg: '#D1FAE5', text: '#065F46' },
    { bg: '#EDE9FE', text: '#7C3AED' },
    { bg: '#FCE7F3', text: '#BE185D' },
    { bg: '#FFE4E6', text: '#BE123C' },
  ];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) & 0xffffffff;
  return colours[Math.abs(hash) % colours.length];
}

// ─────────────────────────────────────────────────────────────────────────────
// MembersPanel — Two-view panel
//
// CONCEPT: The panel has an inner container that is 2x the panel width,
// holding both views side by side. We slide it left/right to show one at a time.
//
// [  Members View (320px)  |  Info View (320px)  ]
//  ^-- slideX=0 (default)    ^-- slideX=-320 (after arrow tap)
//
// The panel itself has overflow:hidden so only 320px is visible at any time.
// ─────────────────────────────────────────────────────────────────────────────
function MembersPanel({
  visible, roomId, roomName, ticketId,
  myUserId, accessToken,
  onClose, onStartDM, onLeaveRoom, onLogout,
  theme,
}) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dmLoading, setDmLoading] = useState(null);
  const [leavingRoom, setLeavingRoom] = useState(false);

  const PANEL_WIDTH = 320;

  // Panel slide-in from screen edge
  const slideAnim = useRef(new Animated.Value(PANEL_WIDTH)).current;
  // Inner container slide (0 = members, -PANEL_WIDTH = info)
  const slideX = useRef(new Animated.Value(0)).current;

  // Reset inner view to members every time panel opens
  useEffect(() => {
    if (visible) {
      slideX.setValue(0);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || !roomId) return;
    Animated.spring(slideAnim, {
      toValue: 0, useNativeDriver: true, tension: 65, friction: 10,
    }).start();
    loadMembers();
  }, [visible, roomId]);

  const goToInfo = () => {
    Animated.spring(slideX, {
      toValue: -PANEL_WIDTH, useNativeDriver: true, tension: 80, friction: 12,
    }).start();
  };

  const goToMembers = () => {
    Animated.spring(slideX, {
      toValue: 0, useNativeDriver: true, tension: 80, friction: 12,
    }).start();
  };

  const closeAnim = (cb) => {
    Animated.timing(slideAnim, {
      toValue: PANEL_WIDTH, duration: 220, useNativeDriver: true,
    }).start(cb);
  };
  const handleClose = () => closeAnim(onClose);

  const loadMembers = async () => {
    setLoading(true);
    try {
      const list = await getRoomMembers(accessToken, roomId);
      list.sort((a, b) => {
        if (a.userId === myUserId) return 1;
        if (b.userId === myUserId) return -1;
        return a.displayName.localeCompare(b.displayName);
      });
      setMembers(list);
    } catch (err) {
      console.warn('[MembersPanel] loadMembers error:', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleMemberPress = async (member) => {
    if (member.userId === myUserId) return;
    setDmLoading(member.userId);
    try {
      const dmRoomId = await getOrCreateDMRoom(accessToken, myUserId, member.userId);
      closeAnim(() => onStartDM(dmRoomId, member.displayName));
    } catch (err) {
      console.warn('[MembersPanel] DM error:', err.message);
    } finally {
      setDmLoading(null);
    }
  };

  const handleLeaveRoom = () => {
    Alert.alert(
      'Leave Room',
      'Are you sure you want to leave this room?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave', style: 'destructive',
          onPress: async () => {
            setLeavingRoom(true);
            try {
              await onLeaveRoom(roomId);
            } catch (err) {
              Alert.alert('Error', 'Could not leave room: ' + err.message);
            } finally {
              setLeavingRoom(false);
            }
          },
        },
      ]
    );
  };

  if (!visible) return null;

  const headerBg = theme.topBar;
  const borderColor = theme.border;
  const textPrimary = theme.textPrimary;
  const textSecondary = theme.textSecondary;
  const accentColor = theme.accent;

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={handleClose} statusBarTranslucent>
      <TouchableOpacity style={MP.backdrop} activeOpacity={1} onPress={handleClose} />

      {/* Outer panel — slides in from right, clips overflow */}
      <Animated.View style={[MP.panel, { backgroundColor: theme.surface, transform: [{ translateX: slideAnim }] }]}>

        {/* Inner container — 2x width, holds both views */}
        <Animated.View style={[MP.innerContainer, { width: PANEL_WIDTH * 2, transform: [{ translateX: slideX }] }]}>

          {/* ════════════════════════════════════════
              VIEW 1: Members List
          ════════════════════════════════════════ */}
          <View style={[MP.viewSlot, { width: PANEL_WIDTH, backgroundColor: theme.surface }]}>

            <View style={[MP.header, { backgroundColor: headerBg }]}>
              <View style={MP.headerLeft}>
                <Ionicons name="people" size={18} color="#fff" />
                <Text style={MP.headerTitle}>Members</Text>
                {!loading && (
                  <View style={MP.countBadge}>
                    <Text style={MP.countTxt}>{members.length}</Text>
                  </View>
                )}
              </View>
              <View style={MP.headerRight}>
                {/* → Arrow: navigates to info view */}
                <TouchableOpacity onPress={goToInfo} style={MP.iconBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="chevron-forward" size={20} color="#fff" />
                </TouchableOpacity>
                {/* X: closes panel */}
                <TouchableOpacity onPress={handleClose} style={MP.iconBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close" size={18} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>

            <Text style={[MP.subheading, { color: textSecondary }]}>Tap a member to start a private chat</Text>
            <View style={[MP.divider, { backgroundColor: borderColor }]} />

            {loading ? (
              <View style={MP.loaderWrap}>
                <ActivityIndicator color={accentColor} size="large" />
                <Text style={[MP.loaderTxt, { color: textSecondary }]}>Loading members…</Text>
              </View>
            ) : (
              <FlatList
                data={members}
                keyExtractor={m => m.userId}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 20 }}
                renderItem={({ item: member }) => {
                  const isMe = member.userId === myUserId;
                  const colors = memberAvatarColor(member.userId);
                  const isLoading = dmLoading === member.userId;
                  return (
                    <TouchableOpacity
                      style={[MP.memberRow, { backgroundColor: isMe ? theme.surfaceAlt : theme.surface, borderBottomColor: borderColor }]}
                      onPress={() => handleMemberPress(member)}
                      disabled={isMe || !!dmLoading}
                      activeOpacity={isMe ? 1 : 0.7}
                    >
                      <View style={[MP.memberAvatar, { backgroundColor: colors.bg }]}>
                        <Text style={[MP.memberInitial, { color: colors.text }]}>{member.displayName.charAt(0).toUpperCase()}</Text>
                        <View style={[MP.presenceDot, { backgroundColor: isMe ? '#22C55E' : '#94A3B8' }]} />
                      </View>
                      <View style={MP.memberInfo}>
                        <Text style={[MP.memberName, { color: isMe ? '#15803D' : textPrimary }]}>
                          {member.displayName}{isMe ? ' (You)' : ''}
                        </Text>
                        <Text style={[MP.memberUserId, { color: textSecondary }]} numberOfLines={1}>{member.userId}</Text>
                      </View>
                      {!isMe && (
                        <View style={[MP.dmBtn, { backgroundColor: theme.accentBg }]}>
                          {isLoading
                            ? <ActivityIndicator size="small" color={accentColor} />
                            : <Ionicons name="chatbubble-outline" size={18} color={accentColor} />
                          }
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                }}
                ListEmptyComponent={
                  <View style={MP.empty}>
                    <Text style={[MP.emptyTxt, { color: textSecondary }]}>No members found</Text>
                  </View>
                }
              />
            )}
          </View>

          {/* ════════════════════════════════════════
              VIEW 2: Ticket Info + Actions
          ════════════════════════════════════════ */}
          <View style={[MP.viewSlot, { width: PANEL_WIDTH, backgroundColor: theme.surface }]}>

            <View style={[MP.header, { backgroundColor: headerBg }]}>
              {/* ← Back: goes back to members view */}
              <TouchableOpacity onPress={goToMembers} style={MP.iconBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="chevron-back" size={20} color="#fff" />
              </TouchableOpacity>
              <Text style={[MP.headerTitle, { flex: 1, marginLeft: 6 }]}>Room Info</Text>
              {/* X: closes panel */}
              <TouchableOpacity onPress={handleClose} style={MP.iconBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={18} color="#fff" />
              </TouchableOpacity>
            </View>

            <View style={{ flex: 1, padding: 16 }}>

              {/* Ticket ID */}
              {(!!ticketId || !!roomName) && (
  <View
    style={[
      MP.infoCard,
      {
        backgroundColor: theme.surfaceAlt,
        borderColor,
      },
    ]}
  >
    {/* Ticket ID */}
    {!!ticketId && (
      <View style={{ marginBottom: roomName ? 10 : 0 }}>
        <Text style={[MP.infoCardLabel, { color: textSecondary }]}>
          Ticket ID
        </Text>
        <Text
          style={[MP.infoCardValue, { color: '#10B981' }]}
          numberOfLines={2}
        >
          {ticketId}
        </Text>
      </View>
    )}

    {/* Divider (optional clean UI) */}
    {!!ticketId && !!roomName && (
      <View
        style={{
          height: 0.5,
          backgroundColor: borderColor,
          marginVertical: 8,
        }}
      />
    )}

    {/* Room Name */}
    {!!roomName && (
      <View>
        <Text style={[MP.infoCardLabel, { color: textSecondary }]}>
          Room
        </Text>
        <Text
          style={[MP.infoCardValue, { color: textPrimary }]}
          numberOfLines={2}
        >
          {roomName}
        </Text>
      </View>
    )}
  </View>
)}
              <View style={[MP.sectionDivider, { borderColor }]} />
              <Text style={[MP.sectionLabel, { color: textSecondary }]}>Actions</Text>

              {/* Leave Room */}
              <TouchableOpacity
                style={[MP.actionRow, { backgroundColor: theme.surfaceAlt, borderColor: '#DC262640' }]}
                onPress={handleLeaveRoom}
                disabled={leavingRoom}
                activeOpacity={0.75}
              >
                <View style={[MP.actionIcon, { backgroundColor: '#DC262615' }]}>
                  {leavingRoom
                    ? <ActivityIndicator size="small" color="#DC2626" />
                    : <Ionicons name="exit-outline" size={20} color="#DC2626" />
                  }
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[MP.actionTitle, { color: '#DC2626' }]}>{leavingRoom ? 'Leaving…' : 'Leave Room'}</Text>
                  <Text style={[MP.actionSub, { color: textSecondary }]}>Remove yourself from this chat</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#DC262660" />
              </TouchableOpacity>

              {/* Logout */}
              <TouchableOpacity
                style={[MP.actionRow, { backgroundColor: theme.surfaceAlt, borderColor, marginTop: 10 }]}
                onPress={onLogout}
                activeOpacity={0.75}
              >
                <View style={[MP.actionIcon, { backgroundColor: accentColor + '15' }]}>
                  <Feather name="log-out" size={18} color={accentColor} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[MP.actionTitle, { color: textPrimary }]}>Logout</Text>
                  <Text style={[MP.actionSub, { color: textSecondary }]}>Sign out of your account</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={textSecondary + '60'} />
              </TouchableOpacity>

            </View>
          </View>

        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const MP = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  panel: {
    position: 'absolute', top: 0, right: 0, bottom: 0,
     maxWidth: 320,
    overflow: 'hidden',   // ← CRITICAL: clips the inner 2x-wide container
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 20,
    shadowOffset: { width: -4, height: 0 }, elevation: 20,
  },
  innerContainer: {
    flexDirection: 'row',
    height: '100%',
  },
  viewSlot: {
    flexDirection: 'column',
    height: '100%',
  },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 14, paddingTop: 52,
    gap: 6,
  },
  headerLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerTitle: { fontSize: 15, fontWeight: '700', color: '#fff' },
  countBadge: {
    backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 10,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  countTxt: { fontSize: 11, fontWeight: '700', color: '#fff' },
  iconBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  subheading: { fontSize: 11, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4, fontStyle: 'italic' },
  divider: { height: 0.5, marginHorizontal: 16 },
  loaderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
  loaderTxt: { fontSize: 13 },
  memberRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 0.5, gap: 12,
  },
  memberAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', flexShrink: 0, position: 'relative' },
  memberInitial: { fontSize: 17, fontWeight: '700' },
  presenceDot: { position: 'absolute', bottom: 1, right: 1, width: 11, height: 11, borderRadius: 6, borderWidth: 2, borderColor: '#fff' },
  memberInfo: { flex: 1, minWidth: 0 },
  memberName: { fontSize: 14, fontWeight: '600', marginBottom: 2 },
  memberUserId: { fontSize: 11 },
  dmBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  empty: { padding: 32, alignItems: 'center' },
  emptyTxt: { fontSize: 14 },
  infoCard: { borderRadius: 12, padding: 14, borderWidth: 1 },
  infoCardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  infoCardIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  infoCardLabel: { fontSize: 10, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 3 },
  infoCardValue: { fontSize: 14, fontWeight: '700' },
  sectionDivider: { borderTopWidth: 0.5, marginVertical: 18 },
  sectionLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 12 },
  actionRow: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 12, borderWidth: 1, gap: 12 },
  actionIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  actionTitle: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  actionSub: { fontSize: 11 },
});

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────
export default function ChatRoomListScreen({ extraRoomId, autoOpenRoomId }) {
  const { session, logout } = useAuth();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  if (!session?.accessToken) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg }}>
        <ActivityIndicator size="large" color={theme.accent} />
      </View>
    );
  }

  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [openRoomId, setOpenRoomId] = useState(null);
  const [openLabel, setOpenLabel] = useState('');
  const [membersVisible, setMembersVisible] = useState(false);
  const [roomNames, setRoomNames] = useState({});
  const [dmNames, setDmNames] = useState({});
  const [ticketNames, setTicketNames] = useState({});

  const fetchIncidents = async () => {
    try {
      const res = await fetch(`${SERVER_URL}/incidents`);
      const json = await res.json();
      if (json.success && json.data) {
        const cache = { ...ticketNames };
        let changed = false;
        json.data.forEach(inc => {
          const rid = inc.matrixRoomId || inc.roomId;
          if (rid && (!cache[rid] || cache[rid].name !== inc.patientName)) {
            cache[rid] = { name: inc.patientName || 'Unknown', address: inc.address || '' };
            changed = true;
          }
        });
        if (changed) {
          setTicketNames(cache);
          await AsyncStorage.setItem('TICKET_NAMES', JSON.stringify(cache));
        }
      }
    } catch (err) {
      console.warn('[RoomList] fetchIncidents error:', err.message);
    }
  };

  useEffect(() => {
    AsyncStorage.getItem('TICKET_NAMES').then(raw => {
      if (raw) { try { setTicketNames(JSON.parse(raw)); } catch (e) {} }
    });
    fetchIncidents();
  }, []);

  const syncActive = useRef(true);
  const openRoomIdRef = useRef(null);

  useEffect(() => { openRoomIdRef.current = openRoomId; }, [openRoomId]);

  useEffect(() => {
    if (autoOpenRoomId) {
      setOpenRoomId(autoOpenRoomId);
      setOpenLabel(roomDisplayName(autoOpenRoomId, roomNames, dmNames));
    }
  }, [autoOpenRoomId]);

  useEffect(() => {
    syncActive.current = true;
    loadRooms();
    return () => { syncActive.current = false; };
  }, [extraRoomId]);

  useEffect(() => {
    if (openRoomId) setOpenLabel(roomDisplayName(openRoomId, roomNames, dmNames));
  }, [roomNames, dmNames]);

  const loadRooms = async () => {
    if (!session?.accessToken) return;
    try {
      setLoading(true);
      await fetchIncidents();
      const joined = await getJoinedRooms(session.accessToken);
      const allIds = Array.from(new Set([...(extraRoomId ? [extraRoomId] : []), ...joined]));
      const { getRoomName } = await import('../services/matrixService');
      const names = { ...roomNames };
      for (const rid of allIds) {
        if (!names[rid]) {
          try { const n = await getRoomName(session.accessToken, rid, session.userId); if (n) names[rid] = n; } catch {}
        }
      }
      setRoomNames(names);
      const roomData = await Promise.all(
        allIds.map(async (roomId) => {
          try {
            const data = await getRoomMessages(session.accessToken, roomId, null, 20);
            const events = (data.chunk || []).filter(e => e.type === 'm.room.message');
            return { roomId, lastEvent: events[0] || null, unread: 0 };
          } catch { return { roomId, lastEvent: null, unread: 0 }; }
        })
      );
      roomData.sort((a, b) => (b.lastEvent?.origin_server_ts || 0) - (a.lastEvent?.origin_server_ts || 0));
      setRooms(roomData);
    } catch (err) {
      console.warn('[RoomList] loadRooms error:', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!session?.accessToken) return;
    let since = null;
    const run = async () => {
      try { const init = await syncMatrix(session.accessToken, null, 0); since = init.next_batch; } catch {}
      while (syncActive.current) {
        try {
          const data = await syncMatrix(session.accessToken, since, 10000);
          since = data.next_batch;
          const updatedRooms = data.rooms?.join || {};
          const invitedRooms = data.rooms?.invite || {};
          let newRoomsFound = false;
          for (const invitedRoomId in invitedRooms) {
            try {
              const { joinRoom, saveDirectMessage } = await import('../services/matrixService');
              await joinRoom(session.accessToken, invitedRoomId);
              newRoomsFound = true;
              const inviteState = invitedRooms[invitedRoomId].invite_state?.events || [];
              const isDirect = inviteState.find(e => e.type === 'm.room.create')?.content?.is_direct === true;
              if (isDirect) {
                const me = inviteState.find(e => e.type === 'm.room.member' && e.state_key !== session.userId);
                if (me?.state_key) await saveDirectMessage(session.accessToken, session.userId, me.state_key, invitedRoomId);
              }
            } catch (err) { console.warn('[RoomList] Auto-join failed:', invitedRoomId, err.message); }
          }
          if (newRoomsFound || Object.keys(updatedRooms).length > 0) {
            const newIds = [...Object.keys(invitedRooms), ...Object.keys(updatedRooms)].filter(rid => !roomNames[rid]);
            if (newIds.length > 0) {
              const { getRoomName } = await import('../services/matrixService');
              const nextNames = { ...roomNames };
              let changed = false;
              for (const rid of newIds) {
                try { const n = await getRoomName(session.accessToken, rid, session.userId); if (n) { nextNames[rid] = n; changed = true; } } catch {}
              }
              if (changed) setRoomNames(nextNames);
            }
            setRooms(prev => {
              const map = {};
              prev.forEach(r => { map[r.roomId] = { ...r }; });
              for (const rid in invitedRooms) { if (!map[rid]) map[rid] = { roomId: rid, lastEvent: null, unread: 0 }; }
              Object.entries(updatedRooms).forEach(([rId, rData]) => {
                if (!map[rId]) map[rId] = { roomId: rId, lastEvent: null, unread: 0 };
                const events = (rData.timeline?.events || []).filter(e => e.type === 'm.room.message');
                if (events.length > 0) {
                  const last = events[events.length - 1];
                  const incomingUnread = events.filter(e => e.sender !== session.userId && rId !== openRoomIdRef.current).length;
                  map[rId].lastEvent = last;
                  if (incomingUnread > 0) map[rId].unread = (map[rId].unread || 0) + incomingUnread;
                }
              });
              return Object.values(map).sort((a, b) => (b.lastEvent?.origin_server_ts || 0) - (a.lastEvent?.origin_server_ts || 0));
            });
          }
        } catch { await new Promise(r => setTimeout(r, 3000)); }
      }
    };
    run();
    return () => { syncActive.current = false; };
  }, [session.accessToken]);

  const openRoom = (room, label) => {
    setRooms(prev => prev.map(r => r.roomId === room.roomId ? { ...r, unread: 0 } : r));
    setOpenLabel(label || roomDisplayName(room.roomId, roomNames, dmNames));
    setOpenRoomId(room.roomId);
    setMembersVisible(false);
  };

  const closeRoom = () => { setOpenRoomId(null); setOpenLabel(''); setMembersVisible(false); };

  const handleStartDM = (dmRoomId, memberDisplayName) => {
    setMembersVisible(false);
    setDmNames(prev => ({ ...prev, [dmRoomId]: memberDisplayName }));
    setRooms(prev => {
      if (prev.some(r => r.roomId === dmRoomId)) {
        return prev.map(r => r.roomId === dmRoomId ? { ...r, unread: 0 } : r)
          .sort((a, b) => {
            if (a.roomId === dmRoomId) return -1;
            if (b.roomId === dmRoomId) return 1;
            return (b.lastEvent?.origin_server_ts || 0) - (a.lastEvent?.origin_server_ts || 0);
          });
      }
      return [{ roomId: dmRoomId, lastEvent: null, unread: 0 }, ...prev];
    });
    setOpenLabel(memberDisplayName);
    setOpenRoomId(dmRoomId);
  };

  const handleLeaveRoom = async (roomId) => {
    try {
      const { leaveRoom } = await import('../services/matrixService');
      await leaveRoom(session.accessToken, roomId);
      setRooms(prev => prev.filter(r => r.roomId !== roomId));
      closeRoom();
    } catch (err) { throw err; }
  };

  const openRoomRawName = openRoomId ? (roomNames[openRoomId] || '') : '';
  const openRoomIsTicket = openRoomRawName?.trim()?.toLowerCase()?.includes('ticket-');
  const openRoomTicketId = openRoomIsTicket ? openRoomRawName : null;
  const openRoomTicketInfo = openRoomId ? ticketNames[openRoomId] : null;

  if (openRoomId) {
    const colors = avatarColor(openRoomId);
    const isDM = !!dmNames[openRoomId];
    return (
      <View style={[styles.flex, { backgroundColor: theme.bg }]}>
        <View style={[styles.chatHeader, { paddingTop: insets.top + 10, backgroundColor: theme.topBar }]}>
          <TouchableOpacity onPress={closeRoom} style={styles.backBtn} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="chevron-back" size={26} color="#fff" />
          </TouchableOpacity>
          <View style={[styles.chatHeaderAvatar, { backgroundColor: colors.bg }]}>
            <Text style={[styles.chatHeaderAvatarTxt, { color: colors.text }]}>{roomInitials(openRoomId, roomNames, dmNames)}</Text>
          </View>
          <View style={styles.chatHeaderInfo}>
            <Text style={styles.chatHeaderName} numberOfLines={1}>{openLabel}</Text>
            <Text style={styles.chatHeaderSub}>{isDM ? '🔒 Private conversation' : 'Alert Communication'}</Text>
          </View>
          <TouchableOpacity
            style={[styles.membersToggleBtn, membersVisible && styles.membersToggleBtnActive]}
            onPress={() => setMembersVisible(v => !v)}
            activeOpacity={0.75}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="people" size={20} color="#fff" />
          </TouchableOpacity>
        </View>

        <ChatScreen roomId={openRoomId} roomLabel={openLabel} hideHeader />

        <MembersPanel
          visible={membersVisible}
          roomId={openRoomId}
          roomName={openRoomTicketInfo?.name || openRoomRawName || openLabel}
          ticketId={openRoomTicketId}
          myUserId={session.userId}
          accessToken={session.accessToken}
          onClose={() => setMembersVisible(false)}
          onStartDM={handleStartDM}
          onLeaveRoom={handleLeaveRoom}
          onLogout={logout}
          theme={theme}
        />
      </View>
    );
  }

  const filtered = rooms.filter(r =>
    roomDisplayName(r.roomId, roomNames, dmNames).toLowerCase().includes(search.toLowerCase())
  );

  const renderRoom = ({ item }) => {
    const name = roomDisplayName(item.roomId, roomNames, dmNames);
    const isTicketRoom = name?.trim()?.toLowerCase()?.includes('ticket-');
    const ticketInfo = ticketNames[item.roomId];
    const displayName = ticketInfo?.name || name;
    const cleanTicketId = isTicketRoom ? name : null;
    const preview = previewText(item.lastEvent);
    const time = formatTime(item.lastEvent?.origin_server_ts);
    const isMe = item.lastEvent?.sender === session.userId;
    const hasUnread = (item.unread || 0) > 0;
    const unreadCount = item.unread || 0;
    const colors = avatarColor(item.roomId);
    const isDMRoom = !!dmNames[item.roomId];

    const getMsgTypeIcon = () => {
      const type = item.lastEvent?.content?.msgtype;
      if (type === 'm.image') return <Feather name="image" size={12} color={theme.textSecondary} style={{ marginRight: 3 }} />;
      if (type === 'm.video') return <Feather name="video" size={12} color={theme.textSecondary} style={{ marginRight: 3 }} />;
      if (type === 'm.audio') return <Feather name="mic" size={12} color={theme.textSecondary} style={{ marginRight: 3 }} />;
      if (type === 'm.file') return <Feather name="paperclip" size={12} color={theme.textSecondary} style={{ marginRight: 3 }} />;
      return null;
    };

    return (
      <TouchableOpacity style={[styles.roomRow, { backgroundColor: theme.surface }]} onPress={() => openRoom(item, displayName)} activeOpacity={0.75}>
        <View style={[styles.avatar, { backgroundColor: colors.bg }]}>
          <Text style={[styles.avatarTxt, { color: colors.text }]}>{getInitials(displayName)}</Text>
          {isDMRoom && <View style={[styles.onlineDot, { backgroundColor: '#A78BFA' }]} />}
        </View>
        <View style={styles.roomInfo}>
          <View style={styles.roomNameRow}>
            <View style={styles.roomNameWrap}>
              {isDMRoom && (
                <View style={[styles.dmTag, { backgroundColor: theme.accentBg }]}>
                  <Text style={[styles.dmTagTxt, { color: theme.accent }]}>DM</Text>
                </View>
              )}
              <Text style={[styles.roomName, { color: theme.textPrimary }, hasUnread && { fontWeight: '700' }]} numberOfLines={1}>
                {displayName}
              </Text>
            </View>
            <Text style={[styles.roomTime, { color: hasUnread ? theme.accent : theme.textSecondary }, hasUnread && { fontWeight: '600' }]}>
              {time}
            </Text>
          </View>
          {!!(isTicketRoom && cleanTicketId) && (
            <View style={{ marginBottom: 2 }}>
              <Text style={{ fontSize: 10, color: '#10B981', fontWeight: 'bold' }}>{cleanTicketId}</Text>
            </View>
          )}
          {!!(isTicketRoom && ticketInfo?.address) && (
            <View style={{ marginBottom: 4 }}>
              <Text style={{ fontSize: 11, color: theme.textSecondary }} numberOfLines={1}>{ticketInfo.address}</Text>
            </View>
          )}
          <View style={styles.roomPreviewRow}>
            <View style={styles.previewLeft}>
              {getMsgTypeIcon()}
              <Text style={[styles.roomPreview, { color: theme.textSecondary }, hasUnread && { color: theme.textPrimary, fontWeight: '500' }]} numberOfLines={1}>
                {isMe ? `You: ${preview}` : preview}
              </Text>
            </View>
            {hasUnread && (
              <View style={[styles.unreadBadge, { backgroundColor: theme.accent }]}>
                <Text style={styles.unreadTxt}>{unreadCount > 99 ? '99+' : String(unreadCount)}</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.flex, { backgroundColor: theme.bg }]}>
      <View style={[styles.topBar, { paddingTop: insets.top + 10, backgroundColor: theme.topBar }]}>
        <Text style={styles.topBarTitle}>Messages</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <TouchableOpacity onPress={loadRooms} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="refresh-cw" size={20} color="rgba(255,255,255,0.8)" />
          </TouchableOpacity>
          <TouchableOpacity onPress={logout} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="log-out" size={20} color="rgba(255,255,255,0.8)" />
          </TouchableOpacity>
        </View>
      </View>

      <View style={[styles.searchWrap, { backgroundColor: theme.topBar }]}>
        <View style={[styles.searchBar, { backgroundColor: theme.surface }]}>
          <Feather name="search" size={16} color={theme.textSecondary} style={{ marginRight: 8 }} />
          <TextInput
            style={[styles.searchInput, { color: theme.textPrimary }]}
            placeholder="Search chats…"
            placeholderTextColor={theme.textSecondary}
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={17} color={theme.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={theme.accent} />
          <Text style={[styles.loaderTxt, { color: theme.textSecondary }]}>Loading chats…</Text>
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="chatbubbles-outline" size={56} color={theme.accent} />
          <Text style={[styles.emptyTxt, { color: theme.textPrimary }]}>No chats yet</Text>
          <Text style={[styles.emptySub, { color: theme.textSecondary }]}>Your rooms will appear here</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={r => r.roomId}
          renderItem={renderRoom}
          ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: theme.border }]} />}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 20 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 14 },
  topBarTitle: { fontSize: 22, fontWeight: '700', color: '#fff', letterSpacing: 0.2 },
  searchWrap: { paddingHorizontal: 14, paddingBottom: 14 },
  searchBar: { flexDirection: 'row', alignItems: 'center', borderRadius: 26, paddingHorizontal: 14, paddingVertical: 9 },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loaderTxt: { fontSize: 14 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  emptyTxt: { fontSize: 18, fontWeight: '600' },
  emptySub: { fontSize: 13, textAlign: 'center' },
  roomRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 14 },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', flexShrink: 0, position: 'relative' },
  avatarTxt: { fontSize: 17, fontWeight: '700' },
  onlineDot: { position: 'absolute', bottom: 2, right: 2, width: 13, height: 13, borderRadius: 7, borderWidth: 2, borderColor: '#fff' },
  roomInfo: { flex: 1, minWidth: 0 },
  roomNameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 },
  roomNameWrap: { flexDirection: 'row', alignItems: 'center', gap: 5, flex: 1, marginRight: 8 },
  dmTag: { borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  dmTagTxt: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  roomName: { fontSize: 15, fontWeight: '500', flex: 1 },
  roomTime: { fontSize: 12 },
  roomPreviewRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  previewLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 },
  roomPreview: { fontSize: 13, flex: 1 },
  unreadBadge: { borderRadius: 12, minWidth: 22, height: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, flexShrink: 0 },
  unreadTxt: { color: '#fff', fontSize: 11, fontWeight: '800' },
  separator: { height: 0.5, marginLeft: 82 },
  chatHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 12, gap: 10 },
  backBtn: { padding: 4 },
  chatHeaderAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  chatHeaderAvatarTxt: { fontSize: 14, fontWeight: '700' },
  chatHeaderInfo: { flex: 1, minWidth: 0 },
  chatHeaderName: { fontSize: 16, fontWeight: '700', color: '#fff' },
  chatHeaderSub: { fontSize: 11, color: 'rgba(255,255,255,0.65)' },
  membersToggleBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)' },
  membersToggleBtnActive: { backgroundColor: 'rgba(255,255,255,0.3)', borderColor: '#fff' },
});