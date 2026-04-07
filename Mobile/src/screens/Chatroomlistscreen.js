import { Feather, Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DISPATCH_ROOM_ID, useAuth } from '../context/AuthContext';
import {
  getJoinedRooms,
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
  if (type === 'm.image') return 'Photo';
  if (type === 'm.video') return 'Video';
  if (type === 'm.audio') return 'Voice message';
  if (type === 'm.file') return content.body || 'File';
  return '';
}

function roomDisplayName(roomId) {
  if (roomId === DISPATCH_ROOM_ID) return 'Dispatch Control';
  return `${roomId}`;
}

function roomInitials(roomId) {
  if (roomId === DISPATCH_ROOM_ID) return 'DC';
  return 'AR';
}

function avatarColor(roomId) {
  if (roomId === DISPATCH_ROOM_ID) return { bg: '#DBEAFE', text: '#1E40AF' };
  return { bg: '#FEF3C7', text: '#92400E' };
}

export default function ChatRoomListScreen({ extraRoomId, autoOpenRoomId }) {
  const { session } = useAuth();
  const insets = useSafeAreaInsets();

  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [openRoomId, setOpenRoomId] = useState(null);
  const [openLabel, setOpenLabel] = useState('');

  const syncActive = useRef(true);

  useEffect(() => {
    if (autoOpenRoomId) {
      setOpenRoomId(autoOpenRoomId);
      setOpenLabel(roomDisplayName(autoOpenRoomId));
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
      const joined = await getJoinedRooms(session.accessToken);
      const allIds = Array.from(new Set([
        DISPATCH_ROOM_ID,
        ...(extraRoomId ? [extraRoomId] : []),
        ...joined,
      ]));
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
          if (Object.keys(updatedRooms).length > 0) {
            setRooms(prev => {
              const map = {};
              prev.forEach(r => { map[r.roomId] = { ...r }; });
              Object.entries(updatedRooms).forEach(([rId, rData]) => {
                const events = (rData.timeline?.events || []).filter(e => e.type === 'm.room.message');
                if (events.length > 0) {
                  const last = events[events.length - 1];
                  if (map[rId]) {
                    map[rId].lastEvent = last;
                    if (last.sender !== session.userId && rId !== openRoomId) {
                      map[rId].unread = (map[rId].unread || 0) + events.filter(e => e.sender !== session.userId).length;
                    }
                  } else {
                    map[rId] = { roomId: rId, lastEvent: last, unread: events.filter(e => e.sender !== session.userId).length };
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
  }, [session.accessToken, openRoomId]);

  const openRoom = (room) => {
    setRooms(prev => prev.map(r => r.roomId === room.roomId ? { ...r, unread: 0 } : r));
    setOpenLabel(roomDisplayName(room.roomId));
    setOpenRoomId(room.roomId);
  };

  const closeRoom = () => {
    setOpenRoomId(null);
    setOpenLabel('');
  };

  if (openRoomId) {
    const colors = avatarColor(openRoomId);
    return (
      <View style={styles.flex}>
        <View style={[styles.chatHeader, { paddingTop: insets.top + 10 }]}>
          <TouchableOpacity onPress={closeRoom} style={styles.backBtn} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="chevron-back" size={26} color="#fff" />
          </TouchableOpacity>
          <View style={[styles.chatHeaderAvatar, { backgroundColor: colors.bg }]}>
            <Text style={[styles.chatHeaderAvatarTxt, { color: colors.text }]}>
              {roomInitials(openRoomId)}
            </Text>
          </View>
          <View style={styles.chatHeaderInfo}>
            <Text style={styles.chatHeaderName}>{openLabel}</Text>
            <Text style={styles.chatHeaderSub}>
              {openRoomId === DISPATCH_ROOM_ID ? 'Emergency Control Channel' : 'Alert Communication'}
            </Text>
          </View>
        </View>
        <ChatScreen roomId={openRoomId} roomLabel={openLabel} hideHeader />
      </View>
    );
  }

  const filtered = rooms.filter(r =>
    roomDisplayName(r.roomId).toLowerCase().includes(search.toLowerCase())
  );

  const renderRoom = ({ item }) => {
    const name = roomDisplayName(item.roomId);
    const preview = previewText(item.lastEvent);
    const time = formatTime(item.lastEvent?.origin_server_ts);
    const isMe = item.lastEvent?.sender === session.userId;
    const hasUnread = (item.unread || 0) > 0;
    const colors = avatarColor(item.roomId);
    const isDispatch = item.roomId === DISPATCH_ROOM_ID;

    const getMsgTypeIcon = () => {
      const type = item.lastEvent?.content?.msgtype;
      if (type === 'm.image') return <Feather name="image" size={12} color="#94A3B8" style={{ marginRight: 3 }} />;
      if (type === 'm.video') return <Feather name="video" size={12} color="#94A3B8" style={{ marginRight: 3 }} />;
      if (type === 'm.audio') return <Feather name="mic" size={12} color="#94A3B8" style={{ marginRight: 3 }} />;
      if (type === 'm.file') return <Feather name="paperclip" size={12} color="#94A3B8" style={{ marginRight: 3 }} />;
      return null;
    };

    return (
      <TouchableOpacity style={styles.roomRow} onPress={() => openRoom(item)} activeOpacity={0.75}>
        <View style={[styles.avatar, { backgroundColor: colors.bg }]}>
          <Text style={[styles.avatarTxt, { color: colors.text }]}>{roomInitials(item.roomId)}</Text>
          {isDispatch && <View style={styles.onlineDot} />}
        </View>

        <View style={styles.roomInfo}>
          <View style={styles.roomNameRow}>
            <Text style={styles.roomName} numberOfLines={1}>{name}</Text>
            <Text style={[styles.roomTime, hasUnread && styles.roomTimeUnread]}>{time}</Text>
          </View>
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
            {hasUnread > 0 && (
              <View style={styles.unreadBadge}>
                <Text style={styles.unreadTxt}>{item.unread > 99 ? '99+' : item.unread}</Text>
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
  roomName: { fontSize: 15, fontWeight: '600', color: '#0F172A', flex: 1, marginRight: 8 },
  roomTime: { fontSize: 12, color: '#94A3B8' },
  roomTimeUnread: { color: '#1E40AF', fontWeight: '600' },

  roomPreviewRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  previewLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 8 },
  roomPreview: { fontSize: 13, color: '#64748B', flex: 1 },
  roomPreviewUnread: { color: '#1E40AF', fontWeight: '500' },

  unreadBadge: {
    backgroundColor: '#1E40AF', borderRadius: 12,
    minWidth: 22, height: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6,
  },
  unreadTxt: { color: '#fff', fontSize: 11, fontWeight: '700' },

  separator: { height: 0.5, backgroundColor: '#E2E8F0', marginLeft: 82 },

  chatHeader: {
    backgroundColor: '#1E40AF',
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingBottom: 12, gap: 10,
  },
  backBtn: { padding: 4 },
  chatHeaderAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  chatHeaderAvatarTxt: { fontSize: 14, fontWeight: '700' },
  chatHeaderInfo: { flex: 1 },
  chatHeaderName: { fontSize: 16, fontWeight: '700', color: '#fff' },
  chatHeaderSub: { fontSize: 11, color: 'rgba(255,255,255,0.65)' },
});
