/**
 * ChatRoomListScreen.js
 *
 * CHANGES:
 *  1. DM room appears instantly after creation — no refresh needed
 *  2. Unread badge (WhatsApp-style) shown on right side of each room row
 *  3. Current open room is highlighted in the list when navigating back
 */

import { Feather, Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ActivityIndicator,
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
import { DISPATCH_ROOM_ID, useAuth } from '../context/AuthContext';
import { SERVER_URL } from '../config';
import {
  getJoinedRooms,
  getOrCreateDMRoom,
  getRoomMembers,
  getRoomMessages,
  syncMatrix,
} from '../services/matrixService';
import ChatScreen from './ChatScreen';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
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
// MembersPanel
// ─────────────────────────────────────────────────────────────────────────────
function MembersPanel({ visible, roomId, myUserId, accessToken, onClose, onStartDM }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dmLoading, setDmLoading] = useState(null);

  const slideAnim = useRef(new Animated.Value(320)).current;

  useEffect(() => {
    if (!visible || !roomId) return;
    Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 65, friction: 10 }).start();
    loadMembers();
  }, [visible, roomId]);

  const closeAnim = (cb) => {
    Animated.timing(slideAnim, { toValue: 320, duration: 220, useNativeDriver: true }).start(cb);
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

  if (!visible) return null;

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <TouchableOpacity style={MP.backdrop} activeOpacity={1} onPress={handleClose} />
      <Animated.View style={[MP.panel, { transform: [{ translateX: slideAnim }] }]}>
        <View style={MP.header}>
          <View style={MP.headerLeft}>
            <Ionicons name="people" size={20} color="#fff" />
            <Text style={MP.headerTitle}>Members</Text>
            {!loading && (
              <View style={MP.countBadge}>
                <Text style={MP.countTxt}>{members.length}</Text>
              </View>
            )}
          </View>
          <TouchableOpacity onPress={handleClose} style={MP.closeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={18} color="#fff" />
          </TouchableOpacity>
        </View>

        <Text style={MP.subheading}>Tap a member to start a private chat</Text>
        <View style={MP.divider} />

        {loading ? (
          <View style={MP.loaderWrap}>
            <ActivityIndicator color="#1E40AF" size="large" />
            <Text style={MP.loaderTxt}>Loading members…</Text>
          </View>
        ) : (
          <FlatList
            data={members}
            keyExtractor={m => m.userId}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 32 }}
            renderItem={({ item: member }) => {
              const isMe = member.userId === myUserId;
              const colors = memberAvatarColor(member.userId);
              const initials = member.displayName.charAt(0).toUpperCase();
              const isLoading = dmLoading === member.userId;

              return (
                <TouchableOpacity
                  style={[MP.memberRow, isMe && MP.memberRowMe]}
                  onPress={() => handleMemberPress(member)}
                  disabled={isMe || !!dmLoading}
                  activeOpacity={isMe ? 1 : 0.7}
                >
                  <View style={[MP.memberAvatar, { backgroundColor: colors.bg }]}>
                    <Text style={[MP.memberInitial, { color: colors.text }]}>{initials}</Text>
                    <View style={[MP.presenceDot, { backgroundColor: isMe ? '#22C55E' : '#94A3B8' }]} />
                  </View>
                  <View style={MP.memberInfo}>
                    <Text style={[MP.memberName, isMe && MP.memberNameMe]}>
                      {member.displayName}{isMe ? ' (You)' : ''}
                    </Text>
                    <Text style={MP.memberUserId} numberOfLines={1}>{member.userId}</Text>
                  </View>
                  {!isMe && (
                    <View style={MP.dmBtn}>
                      {isLoading
                        ? <ActivityIndicator size="small" color="#1E40AF" />
                        : <Ionicons name="chatbubble-outline" size={18} color="#1E40AF" />
                      }
                    </View>
                  )}
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <View style={MP.empty}>
                <Text style={MP.emptyTxt}>No members found</Text>
              </View>
            }
          />
        )}
      </Animated.View>
    </Modal>
  );
}

const MP = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  panel: {
    position: 'absolute', top: 0, right: 0, bottom: 0,
    width: '78%', maxWidth: 320,
    backgroundColor: '#F8FAFF',
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 20,
    shadowOffset: { width: -4, height: 0 }, elevation: 20,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#1E40AF',
    paddingHorizontal: 16, paddingVertical: 14, paddingTop: 52,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatarSmall: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#fff' },
  countBadge: { backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  countTxt: { fontSize: 12, fontWeight: '700', color: '#fff' },
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  subheading: { fontSize: 11, color: '#94A3B8', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4, fontStyle: 'italic' },
  divider: { height: 0.5, backgroundColor: '#E2E8F0', marginHorizontal: 16 },
  loaderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
  loaderTxt: { color: '#64748B', fontSize: 13 },
  memberRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 0.5, borderBottomColor: '#E2E8F0',
    backgroundColor: '#fff', gap: 12,
  },
  memberRowMe: { backgroundColor: '#F0FDF4' },
  memberAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', flexShrink: 0, position: 'relative' },
  memberInitial: { fontSize: 17, fontWeight: '700' },
  presenceDot: { position: 'absolute', bottom: 1, right: 1, width: 11, height: 11, borderRadius: 6, borderWidth: 2, borderColor: '#fff' },
  memberInfo: { flex: 1, minWidth: 0 },
  memberName: { fontSize: 14, fontWeight: '600', color: '#0F172A', marginBottom: 2 },
  memberNameMe: { color: '#15803D' },
  memberUserId: { fontSize: 11, color: '#94A3B8' },
  dmBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' },
  empty: { padding: 32, alignItems: 'center' },
  emptyTxt: { color: '#94A3B8', fontSize: 14 },
});

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────
export default function ChatRoomListScreen({ extraRoomId, autoOpenRoomId }) {
  const { session } = useAuth();
  const insets = useSafeAreaInsets();

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
            cache[rid] = {
              name: inc.patientName || 'Unknown',
              address: inc.address || ''
            };
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
      if (raw) {
        try { 
          const cache = JSON.parse(raw);
          setTicketNames(cache); 
        } catch (e) {}
      }
    });
    fetchIncidents(); // Initial fetch
  }, []);

  const syncActive = useRef(true);
  // Track the currently open room in a ref for use inside the sync closure
  const openRoomIdRef = useRef(null);

  useEffect(() => {
    openRoomIdRef.current = openRoomId;
  }, [openRoomId]);

  useEffect(() => {
    if (autoOpenRoomId) {
      setOpenRoomId(autoOpenRoomId);
      setOpenLabel(roomDisplayName(autoOpenRoomId, dmNames));
    }
  }, [autoOpenRoomId]);

  useEffect(() => {
    syncActive.current = true;
    loadRooms();
    return () => { syncActive.current = false; };
  }, [extraRoomId]);

  const loadRooms = async () => {
    try {
      setLoading(true);
      await fetchIncidents(); // Ensure we have latest patient names
      const joined = await getJoinedRooms(session.accessToken);
      const allIds = Array.from(new Set([
        ...(extraRoomId ? [extraRoomId] : []),
        ...joined,
      ]));

      // Fetch names for unknown rooms
      const { getRoomName } = await import('../services/matrixService');
      const names = { ...roomNames };
      for (const rid of allIds) {
        if (!names[rid] && rid !== DISPATCH_ROOM_ID) {
          try {
            const n = await getRoomName(session.accessToken, rid, session.userId);
            if (n) names[rid] = n;
          } catch {}
        }
      }
      setRoomNames(names);

      const roomData = await Promise.all(
        allIds.map(async (roomId) => {
          try {
            const data = await getRoomMessages(session.accessToken, roomId, null, 20);
            const events = (data.chunk || []).filter(e => e.type === 'm.room.message');
            const lastEvent = events[0] || null;
            return { roomId, lastEvent, unread: 0 };
          } catch {
            return { roomId, lastEvent: null, unread: 0 };
          }
        })
      );
      roomData.sort((a, b) => {
        const ta = a.lastEvent?.origin_server_ts || 0;
        const tb = b.lastEvent?.origin_server_ts || 0;
        return tb - ta;
      });
      setRooms(roomData);
    } catch (err) {
      console.warn('[RoomList] loadRooms error:', err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── FIX 1: Live sync — now properly tracks new DM rooms & clears unread ──
  useEffect(() => {
    let since = null;
    const run = async () => {
      try {
        const init = await syncMatrix(session.accessToken, null, 0);
        since = init.next_batch;
      } catch { }
      while (syncActive.current) {
        try {
          const data = await syncMatrix(session.accessToken, since, 10000);
          since = data.next_batch;
          const updatedRooms = data.rooms?.join || {};

          // Auto-join any invited rooms
          const invitedRooms = data.rooms?.invite || {};
          let newRoomsFound = false;
          for (const invitedRoomId in invitedRooms) {
            try {
              const { joinRoom, saveDirectMessage } = await import('../services/matrixService');
              await joinRoom(session.accessToken, invitedRoomId);
              newRoomsFound = true;
              
              // NEW: If this is a DM invite, ensure it's recorded in m.direct
              const inviteState = invitedRooms[invitedRoomId].invite_state?.events || [];
              const createEvent = inviteState.find(e => e.type === 'm.room.create');
              const isDirect = createEvent?.content?.is_direct === true;
              
              if (isDirect) {
                const memberEvent = inviteState.find(e => e.type === 'm.room.member' && e.state_key !== session.userId);
                if (memberEvent?.state_key) {
                  await saveDirectMessage(session.accessToken, session.userId, memberEvent.state_key, invitedRoomId);
                }
              }
            } catch (err) {
              console.warn('[RoomList] Auto-join failed for:', invitedRoomId, err.message);
            }
          }

          // If we joined new rooms or have updates in existing ones
          if (newRoomsFound || Object.keys(updatedRooms).length > 0) {
            // Resolve names for new rooms
            const newIds = [
              ...Object.keys(invitedRooms),
              ...Object.keys(updatedRooms)
            ].filter(rid => !roomNames[rid] && rid !== DISPATCH_ROOM_ID);

            if (newIds.length > 0) {
              const { getRoomName } = await import('../services/matrixService');
              const nextNames = { ...roomNames };
              let changed = false;
              for (const rid of newIds) {
                try {
                  const n = await getRoomName(session.accessToken, rid, session.userId);
                  if (n) { nextNames[rid] = n; changed = true; }
                } catch { }
              }
              if (changed) setRoomNames(nextNames);
            }

            setRooms(prev => {
              const map = {};
              prev.forEach(r => { map[r.roomId] = { ...r }; });

              // 1. Add newly joined rooms from the invite block
              for (const rid in invitedRooms) {
                if (!map[rid]) {
                  map[rid] = { roomId: rid, lastEvent: null, unread: 0 };
                }
              }

              // 2. Process updates from join block
              Object.entries(updatedRooms).forEach(([rId, rData]) => {
                // Ensure the room exists in our map even if no new messages
                if (!map[rId]) {
                  map[rId] = { roomId: rId, lastEvent: null, unread: 0 };
                }

                const events = (rData.timeline?.events || []).filter(e => e.type === 'm.room.message');
                if (events.length > 0) {
                  const last = events[events.length - 1];
                  const incomingUnread = events.filter(
                    e => e.sender !== session.userId && rId !== openRoomIdRef.current
                  ).length;

                  map[rId].lastEvent = last;
                  if (incomingUnread > 0) {
                    map[rId].unread = (map[rId].unread || 0) + incomingUnread;
                  }
                }
              });

              return Object.values(map).sort((a, b) => {
                const ta = a.lastEvent?.origin_server_ts || 0;
                const tb = b.lastEvent?.origin_server_ts || 0;
                return tb - ta;
              });
            });
          }
        } catch {
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    };
    run();
    return () => { syncActive.current = false; };
  }, [session.accessToken]);

  const openRoom = (room, label) => {
    // Clear unread when opening room
    setRooms(prev => prev.map(r => r.roomId === room.roomId ? { ...r, unread: 0 } : r));
    const displayLabel = label || roomDisplayName(room.roomId, roomNames, dmNames);
    setOpenLabel(displayLabel);
    setOpenRoomId(room.roomId);
    setMembersVisible(false);
  };

  const closeRoom = () => {
    setOpenRoomId(null);
    setOpenLabel('');
    setMembersVisible(false);
  };

  // ── FIX 1: DM handler — room appears instantly without needing refresh ──
  const handleStartDM = (dmRoomId, memberDisplayName) => {
    setMembersVisible(false);

    // Register the display name for this DM room
    setDmNames(prev => ({ ...prev, [dmRoomId]: memberDisplayName }));

    // Add to rooms list immediately if not already there
    setRooms(prev => {
      if (prev.some(r => r.roomId === dmRoomId)) {
        // Already exists — just bring it to top and clear unread
        return prev
          .map(r => r.roomId === dmRoomId ? { ...r, unread: 0 } : r)
          .sort((a, b) => {
            // Bring this room to top
            if (a.roomId === dmRoomId) return -1;
            if (b.roomId === dmRoomId) return 1;
            const ta = a.lastEvent?.origin_server_ts || 0;
            const tb = b.lastEvent?.origin_server_ts || 0;
            return tb - ta;
          });
      }
      // New room — prepend it
      return [{ roomId: dmRoomId, lastEvent: null, unread: 0 }, ...prev];
    });

    // Open the DM room immediately
    setOpenLabel(memberDisplayName);
    setOpenRoomId(dmRoomId);
  };

  // ── Open room view ──────────────────────────────────────────────────────
  if (openRoomId) {
    const colors = avatarColor(openRoomId);
    const isDM = !!dmNames[openRoomId];

    return (
      <View style={styles.flex}>
        <View style={[styles.chatHeader, { paddingTop: insets.top + 10 }]}>
          <TouchableOpacity onPress={closeRoom} style={styles.backBtn} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="chevron-back" size={26} color="#fff" />
          </TouchableOpacity>
          <View style={[styles.chatHeaderAvatar, { backgroundColor: colors.bg }]}>
            <Text style={[styles.chatHeaderAvatarTxt, { color: colors.text }]}>
              {roomInitials(openRoomId, roomNames, dmNames)}
            </Text>
          </View>
          <View style={styles.chatHeaderInfo}>
            <Text style={styles.chatHeaderName} numberOfLines={1}>{openLabel}</Text>
            <Text style={styles.chatHeaderSub}>
              {isDM
                ? '🔒 Private conversation'
                : 'Alert Communication'}
            </Text>
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
          myUserId={session.userId}
          accessToken={session.accessToken}
          onClose={() => setMembersVisible(false)}
          onStartDM={handleStartDM}
        />
      </View>
    );
  }

  // ── Room list ────────────────────────────────────────────────────────────
  const filtered = rooms.filter(r =>
    roomDisplayName(r.roomId, roomNames, dmNames).toLowerCase().includes(search.toLowerCase())
  );

    const renderRoom = ({ item }) => {
      const name = roomDisplayName(item.roomId, roomNames, dmNames);
      const isTicketRoom = name?.trim()?.toLowerCase()?.includes('ticket-');
      
      const ticketInfo = ticketNames[item.roomId];
      const patientName = ticketInfo?.name;
      const patientAddress = ticketInfo?.address;
      
      const displayName = patientName || (isTicketRoom ? 'Incident Chat' : name);
      const cleanTicketId = isTicketRoom ? name.replace(/ticket-/gi, '') : name;

      const preview = previewText(item.lastEvent);
      const time = formatTime(item.lastEvent?.origin_server_ts);
      const isMe = item.lastEvent?.sender === session.userId;
      const hasUnread = (item.unread || 0) > 0;
      const unreadCount = item.unread || 0;
    const colors = avatarColor(item.roomId);
    const isDMRoom = !!dmNames[item.roomId];

    const getMsgTypeIcon = () => {
      const type = item.lastEvent?.content?.msgtype;
      if (type === 'm.image') return <Feather name="image" size={12} color="#94A3B8" style={{ marginRight: 3 }} />;
      if (type === 'm.video') return <Feather name="video" size={12} color="#94A3B8" style={{ marginRight: 3 }} />;
      if (type === 'm.audio') return <Feather name="mic" size={12} color="#94A3B8" style={{ marginRight: 3 }} />;
      if (type === 'm.file') return <Feather name="paperclip" size={12} color="#94A3B8" style={{ marginRight: 3 }} />;
      return null;
    };

    return (
      <TouchableOpacity style={styles.roomRow} onPress={() => openRoom(item, displayName)} activeOpacity={0.75}>
        <View style={[styles.avatar, { backgroundColor: colors.bg }]}>
            <Text style={[styles.avatarTxt, { color: colors.text }]}>{getInitials(displayName)}</Text>
          {isDMRoom && <View style={[styles.onlineDot, { backgroundColor: '#A78BFA' }]} />}
        </View>

        <View style={styles.roomInfo}>
          <View style={styles.roomNameRow}>
            <View style={styles.roomNameWrap}>
              {isDMRoom && <View style={styles.dmTag}><Text style={styles.dmTagTxt}>DM</Text></View>}
              <Text style={[styles.roomName, hasUnread && styles.roomNameUnread]} numberOfLines={1}>
                {displayName}
              </Text>
            </View>
            <Text style={[styles.roomTime, hasUnread && styles.roomTimeUnread]}>{time}</Text>
          </View>

          {isTicketRoom && (
            <View style={{ marginBottom: 2 }}>
              <Text style={{ fontSize: 10, color: '#10B981', fontWeight: 'bold' }}>{cleanTicketId}</Text>
            </View>
          )}

          {isTicketRoom && patientAddress && (
            <View style={{ marginBottom: 4 }}>
              <Text style={{ fontSize: 11, color: '#475569' }} numberOfLines={1}>{patientAddress}</Text>
            </View>
          )}

          <View style={styles.roomPreviewRow}>
            <View style={styles.previewLeft}>
              {getMsgTypeIcon()}
              <Text
                style={[styles.roomPreview, hasUnread && styles.roomPreviewUnread]}
                numberOfLines={1}
              >
                {isMe ? `You: ${preview}` : preview}
              </Text>
            </View>

            {/* FIX 2: WhatsApp-style unread badge on the right */}
            {hasUnread && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadTxt}>{unreadCount > 99 ? '99+' : String(unreadCount)}</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.flex}>
      <View style={[styles.topBar, { paddingTop: insets.top + 10 }]}>
        <Text style={styles.topBarTitle}>Messages</Text>
        <TouchableOpacity onPress={loadRooms} style={styles.refreshBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Feather name="refresh-cw" size={20} color="rgba(255,255,255,0.8)" />
        </TouchableOpacity>
      </View>

      <View style={styles.searchWrap}>
        <View style={styles.searchBar}>
          <Feather name="search" size={16} color="#94A3B8" style={{ marginRight: 8 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search chats…"
            placeholderTextColor="#94A3B8"
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={17} color="#94A3B8" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color="#1E40AF" />
          <Text style={styles.loaderTxt}>Loading chats…</Text>
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="chatbubbles-outline" size={56} color="#BFDBFE" />
          <Text style={styles.emptyTxt}>No chats yet</Text>
          <Text style={styles.emptySub}>Your dispatch and alert rooms will appear here</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={r => r.roomId}
          renderItem={renderRoom}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 20 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#F8FAFF' },

  topBar: {
    backgroundColor: '#1E40AF',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingBottom: 14,
  },
  topBarTitle: { fontSize: 22, fontWeight: '700', color: '#fff', letterSpacing: 0.2 },
  refreshBtn: { padding: 4 },

  searchWrap: { backgroundColor: '#1E40AF', paddingHorizontal: 14, paddingBottom: 14 },
  searchBar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#EFF6FF', borderRadius: 26,
    paddingHorizontal: 14, paddingVertical: 9,
  },
  searchInput: { flex: 1, fontSize: 15, color: '#1E3A8A', paddingVertical: 0 },

  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loaderTxt: { color: '#64748B', fontSize: 14 },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  emptyTxt: { fontSize: 18, fontWeight: '600', color: '#334155' },
  emptySub: { fontSize: 13, color: '#94A3B8', textAlign: 'center' },

  roomRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: '#fff', gap: 14,
  },
  avatar: {
    width: 52, height: 52, borderRadius: 26,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0, position: 'relative',
  },
  avatarTxt: { fontSize: 17, fontWeight: '700' },
  onlineDot: {
    position: 'absolute', bottom: 2, right: 2,
    width: 13, height: 13, borderRadius: 7,
    backgroundColor: '#22C55E', borderWidth: 2, borderColor: '#fff',
  },

  roomInfo: { flex: 1, minWidth: 0 },
  roomNameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 },
  roomNameWrap: { flexDirection: 'row', alignItems: 'center', gap: 5, flex: 1, marginRight: 8 },

  dmTag: { backgroundColor: '#EDE9FE', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 },
  dmTagTxt: { fontSize: 9, fontWeight: '800', color: '#7C3AED', letterSpacing: 0.5 },

  roomName: { fontSize: 15, fontWeight: '500', color: '#0F172A', flex: 1 },
  // FIX 3: Bold when has unread messages
  roomNameUnread: { fontWeight: '700', color: '#0F172A' },

  roomTime: { fontSize: 12, color: '#94A3B8' },
  // FIX 2: Blue time when unread
  roomTimeUnread: { color: '#1E40AF', fontWeight: '600' },

  roomPreviewRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  previewLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 },
  roomPreview: { fontSize: 13, color: '#94A3B8', flex: 1 },
  // FIX 2: Darker preview text when unread
  roomPreviewUnread: { color: '#475569', fontWeight: '500' },

  // FIX 2: WhatsApp-style green unread badge
  unreadBadge: {
    backgroundColor: '#22C55E',
    borderRadius: 12,
    minWidth: 22, height: 22,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 6,
    flexShrink: 0,
  },
  unreadTxt: { color: '#fff', fontSize: 11, fontWeight: '800' },

  separator: { height: 0.5, backgroundColor: '#E2E8F0', marginLeft: 82 },

  chatHeader: {
    backgroundColor: '#1E40AF',
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingBottom: 12, gap: 10,
  },
  backBtn: { padding: 4 },
  chatHeaderAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  chatHeaderAvatarTxt: { fontSize: 14, fontWeight: '700' },
  chatHeaderInfo: { flex: 1, minWidth: 0 },
  chatHeaderName: { fontSize: 16, fontWeight: '700', color: '#fff' },
  chatHeaderSub: { fontSize: 11, color: 'rgba(255,255,255,0.65)' },

  membersToggleBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)',
  },
  membersToggleBtnActive: {
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderColor: '#fff',
  },
});