/**
 * ChatScreen.js — fully theme-aware
 * All hardcoded blue (#1E40AF, #DBEAFE, etc.) replaced with theme.accent / theme variables.
 */

import Slider from '@react-native-community/slider';
import { Feather, Ionicons } from '@expo/vector-icons';
import { Video as AVVideo, ResizeMode } from 'expo-av';
import {
  useAudioPlayer,
  useAudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
} from 'expo-audio';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { Image as ExpoImage } from 'expo-image';
import * as Location from 'expo-location';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import MapView, { Marker } from 'react-native-maps';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  StatusBar,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { SERVER_URL } from '../config';
import {
  getRoomMessages,
  mxcToHttp,
  sendAudioMessage,
  sendFileMessage,
  sendImageMessage,
  sendLocationMessage,
  sendLiveLocationMessage,
  sendTextMessage,
  sendVideoMessage,
  syncMatrix,
  uploadMedia,
  sendReaction,
  pinMessage,
  forwardMessage,
  getRoomMembers,
  getRoomState,
} from '../services/matrixService';

// ─────────────────────────────────────────────────────────────────────────────
// DOWNLOAD HELPER
// ─────────────────────────────────────────────────────────────────────────────
async function downloadMedia(uri, accessToken, filename, mediaType) {
  try {
    if (mediaType === 'image' || mediaType === 'video') {
      const { status } = await MediaLibrary.requestPermissionsAsync(true);
      if (status !== 'granted') {
        Alert.alert('Permission required', 'Allow photo library access to save files.');
        return;
      }
    }
    const fallbackExt = mediaType === 'image' ? 'jpg' : mediaType === 'video' ? 'mp4' : mediaType === 'audio' ? 'm4a' : 'bin';
    const safeName = (filename || `download_${Date.now()}.${fallbackExt}`).replace(/[^a-zA-Z0-9._-]/g, '_');
    const localUri = `${FileSystem.cacheDirectory}${safeName}`;
    const { uri: localPath, status: httpStatus } = await FileSystem.downloadAsync(
      uri, localUri, { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (httpStatus !== 200) { Alert.alert('Download failed', 'Server returned an error.'); return; }
    if (mediaType === 'image' || mediaType === 'video') {
      await MediaLibrary.saveToLibraryAsync(localPath);
      Alert.alert('Saved ✓', `${mediaType === 'image' ? 'Photo' : 'Video'} saved to your gallery.`);
    } else {
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(localPath);
      else Alert.alert('Downloaded ✓', 'File saved to device.');
    }
  } catch (err) {
    console.error('[downloadMedia]', err);
    Alert.alert('Download failed', err.message || 'An unexpected error occurred.');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function ChatScreen({ roomId: propRoomId, roomLabel, hideHeader = false }) {
  const { session } = useAuth();
  const { theme } = useTheme();

  // Derived theme shorthands
  const accent       = theme.accent;
  const accentBg     = theme.accentBg;           // low-opacity accent
  const accentLight  = theme.accentLight;
  const surface      = theme.surface;
  const surfaceAlt   = theme.surfaceAlt;
  const surfaceAlt2  = theme.surfaceAlt2;
  const bg           = theme.bg;
  const topBar       = theme.topBar;
  const textPrimary  = theme.textPrimary;
  const textSecondary = theme.textSecondary;
  const textMuted    = theme.textMuted;
  const border       = theme.border;
  const borderLight  = theme.borderLight;

  // accent at low opacity for backgrounds
  const accentFaint  = accent + '22';  // ~13% opacity
  const accentMid    = accent + '44';  // ~27% opacity
  const accentSoft   = accent + '18';  // ~10% opacity

  const roomId = propRoomId?.trim() || null;
  if (!roomId) return null;

  const [messages, setMessages]     = useState([]);
  const [inputText, setInputText]   = useState('');
  const [sending, setSending]       = useState(false);
  const [uploading, setUploading]   = useState(false);
  const [loadingInit, setLoadingInit] = useState(true);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [isRecording, setIsRecording] = useState(false);
  const [playingId, setPlayingId]   = useState(null);
  const [fullImage, setFullImage]   = useState(null);
  const [showLocationModal, setShowLocationModal]         = useState(false);
  const [showLiveDurationModal, setShowLiveDurationModal] = useState(false);
  const [showPinModal, setShowPinModal]   = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [showActionMenu, setShowActionMenu]   = useState(false);
  const [replyTo, setReplyTo]       = useState(null);
  const [mentionOpen, setMentionOpen]   = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const [roomMembers, setRoomMembers]   = useState([]);
  const [currentRoomName, setCurrentRoomName] = useState(roomLabel || '');
  const [mapRegion, setMapRegion] = useState({
    latitude: 12.9716, longitude: 77.5946, latitudeDelta: 0.01, longitudeDelta: 0.01,
  });
  const [panel, setPanel] = useState('none');
  const [showCameraChoiceModal, setShowCameraChoiceModal] = useState(false);
  const flatRef   = useRef(null);
  const syncActive = useRef(true);
  const roomIdRef  = useRef(roomId);
  const inputRef   = useRef(null);
  const [reactions, setReactions]         = useState({});
  const [pinnedEvents, setPinnedEvents]   = useState([]);
  const [joinedRooms, setJoinedRooms]     = useState([]);
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [forwardMsg, setForwardMsg]       = useState(null);
  const [highlightedMsgId, setHighlightedMsgId] = useState(null);
  const highlightTimeoutRef = useRef(null);
  const [patientData, setPatientData]     = useState(null);
  const [titleLocked, setTitleLocked] = useState(false); 

  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);

  // ─── Keyboard listeners ────────────────────────────────────────────────────
  useEffect(() => {
    const showEv = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEv = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = () => { setPanel('keyboard'); setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 150); };
    const onHide = () => { setPanel(prev => (prev === 'keyboard' ? 'none' : prev)); };
    const s1 = Keyboard.addListener(showEv, onShow);
    const s2 = Keyboard.addListener(hideEv, onHide);
    return () => { s1.remove(); s2.remove(); };
  }, []);

  // ─── Room init ────────────────────────────────────────────────────────────
  useEffect(() => {
    syncActive.current = true;
    setMessages([]); setLoadingInit(true); loadMessages();
    return () => { syncActive.current = false; };
  }, [roomId]);

  useEffect(() => {
    if (!roomId || !session.accessToken) return;
    const fetchData = async () => {
      try {
        const members = await getRoomMembers(session.accessToken, roomId);
        setRoomMembers(members);
        if (!roomLabel) {
          const state = await getRoomState(session.accessToken, roomId, 'm.room.name');
          if (state?.name) setCurrentRoomName(state.name);
        }
      } catch (err) { console.warn('[ChatScreen] fetchData error:', err.message); }
    };
    fetchData();
  }, [roomId, session.accessToken, roomLabel]);

  const handleReaction = async (eventId, emoji) => {
    try { await sendReaction(session.accessToken, roomId, eventId, emoji); }
    catch (err) { console.warn('[Reaction] failed:', err.message); }
  };

  // ─── Load messages ────────────────────────────────────────────────────────
  const loadMessages = async () => {
    try {
      await new Promise(r => setTimeout(r, 300));
      const data = await getRoomMessages(session.accessToken, roomId, null, 80);
      applyMessages(data.chunk || []);
      startSync();
    } catch (err) { console.warn('[ChatScreen] loadMessages error:', err.message); }
    finally { setLoadingInit(false); }
  };

  const applyMessages = (chunk) => {
    const parsed = chunk.filter(e => e.type === 'm.room.message').reverse().map(parseEvent);
    setMessages(parsed);
    setTimeout(() => flatRef.current?.scrollToEnd({ animated: false }), 100);
  };

  // ─── Sync ─────────────────────────────────────────────────────────────────
  const startSync = useCallback(async () => {
    let since = null;
    try {
      const initial = await syncMatrix(session.accessToken, null, 0);
      since = initial.next_batch;
      const joinData = initial.rooms?.join?.[roomIdRef.current];
      const pinEvent = joinData?.state?.events?.find(e => e.type === 'm.room.pinned_events');
      if (pinEvent) setPinnedEvents(pinEvent.content?.pinned || []);
    } catch (err) { console.warn('❌ [SYNC] Initial sync failed:', err.message); }

    while (syncActive.current) {
      try {
        const data = await syncMatrix(session.accessToken, since, 10000);
        since = data.next_batch;
        const cur = roomIdRef.current;
        const roomData = data.rooms?.join?.[cur];
        if (roomData) {
          const pinEvent = roomData.state?.events?.find(e => e.type === 'm.room.pinned_events');
          if (pinEvent) setPinnedEvents(pinEvent.content?.pinned || []);
          if (roomData.timeline?.events) {
            const events = roomData.timeline.events;
            const newReactions = {};
            events.filter(e => e.type === 'm.reaction').forEach(e => {
              const relate = e.content?.['m.relates_to'];
              if (relate?.rel_type === 'm.annotation' && relate.event_id) {
                const eid = relate.event_id, key = relate.key;
                if (!newReactions[eid]) newReactions[eid] = {};
                if (!newReactions[eid][key]) newReactions[eid][key] = [];
                if (!newReactions[eid][key].includes(e.sender)) newReactions[eid][key].push(e.sender);
              }
            });
            if (Object.keys(newReactions).length > 0) {
              setReactions(prev => {
                const next = { ...prev };
                Object.keys(newReactions).forEach(eid => { next[eid] = { ...(next[eid] || {}), ...newReactions[eid] }; });
                return next;
              });
            }
            const newMsgs = events.filter(e => e.type === 'm.room.message').map(parseEvent);
            if (newMsgs.length > 0) {
              setMessages(prev => {
                const ids = new Set(prev.map(m => m.id));
                const incoming = newMsgs.filter(m => !ids.has(m.id));
                if (!incoming.length) return prev;
                const filtered = prev.filter(p => {
                  if (!p.id.startsWith('opt_')) return true;
                  return !incoming.some(i => i.txnId === p.id);
                });
                return [...filtered, ...incoming];
              });
              setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
            }
          }
        }
      } catch (err) { if (syncActive.current) await new Promise(r => setTimeout(r, 3000)); }
    }
  }, [session.accessToken, roomId]);

  // ─── Parse event ──────────────────────────────────────────────────────────
  function parseEvent(event) {
    const content = event.content || {};
    const isMe = event.sender === session.userId;
    const msgtype = content.msgtype || 'm.text';
    let mediaUrl = null;
    if (content.url) mediaUrl = mxcToHttp(content.url, session.accessToken);
    return {
      id: event.event_id || `${Date.now()}_${Math.random()}`,
      sender: event.sender || '',
      senderName: (event.sender || '').split(':')[0].replace('@', ''),
      isMe, msgtype,
      body: content.body || '',
      mediaUrl,
      info: content.info || {},
      ts: event.origin_server_ts || Date.now(),
      duration: content.info?.duration || null,
      filename: content.filename || content.body || '',
      mimeType: content.info?.mimetype || '',
      fileSize: content.info?.size || 0,
      geo: content.geo_uri || content['org.matrix.msc3488.location']?.uri || null,
      isLive: content.is_live || false,
      liveUntil: content.live_until || 0,
      replyToId: content?.['m.relates_to']?.['m.in_reply_to']?.event_id,
      txnId: event.unsigned?.transaction_id,
    };
  }

  // ─── Panel helpers ────────────────────────────────────────────────────────
  const openAttach  = () => { Keyboard.dismiss(); setTimeout(() => setPanel('attach'), Platform.OS === 'ios' ? 50 : 10); };
  const closePanel  = () => { Keyboard.dismiss(); setPanel('none'); };
  const toggleAttach = () => { if (panel === 'attach') closePanel(); else openAttach(); };

  const highlightMessage = (msgId) => {
    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    setHighlightedMsgId(msgId);
    highlightTimeoutRef.current = setTimeout(() => setHighlightedMsgId(null), 3000);
  };

  // ─── Send text ────────────────────────────────────────────────────────────
  async function handleSend() {
    const text = inputText.trim();
    if (!text || sending) return;
    setSending(true); setInputText('');
    const optId = `opt_${Date.now()}`;
    const optimistic = { id: optId, sender: session.userId, senderName: session.username, isMe: true, msgtype: 'm.text', body: text, mediaUrl: null, ts: Date.now() };
    setMessages(prev => [...prev, optimistic]);
    setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 50);
    try {
      if (replyTo) {
        await sendTextMessage(session.accessToken, roomId, text, { txnId: optId, 'm.relates_to': { 'm.in_reply_to': { event_id: replyTo.id } } });
        setReplyTo(null);
      } else {
        await sendTextMessage(session.accessToken, roomId, text, { txnId: optId });
      }
      setMessages(prev => prev.filter(m => m.id !== optId));
    } catch (err) {
      Alert.alert('Send Failed', err.message);
      setMessages(prev => prev.filter(m => m.id !== optId));
      setInputText(text);
    } finally { setSending(false); }
  }

  // ─── Media handlers ───────────────────────────────────────────────────────
  async function handlePickImage() {
    closePanel();
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo access.'); return; }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setUploading(true);
      const mxcUri = await uploadMedia(session.accessToken, asset.uri, 'image/jpeg', asset.fileName || `photo_${Date.now()}.jpg`);
      await sendImageMessage(session.accessToken, roomId, mxcUri, asset.fileName || 'photo.jpg', asset.width, asset.height);
    } catch (err) { Alert.alert('Upload Failed', err.message); }
    finally { setUploading(false); }
  }

  function handleCamera() { closePanel(); setShowCameraChoiceModal(true); }

  async function handleCameraPhoto() {
    setShowCameraChoiceModal(false);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission needed', 'Allow camera access.'); return; }
      const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setUploading(true);
      const filename = `photo_${Date.now()}.jpg`;
      const mxcUri = await uploadMedia(session.accessToken, asset.uri, 'image/jpeg', filename);
      await sendImageMessage(session.accessToken, roomId, mxcUri, filename, asset.width, asset.height);
    } catch (err) { Alert.alert('Upload Failed', err.message); }
    finally { setUploading(false); }
  }

  async function handleCameraVideo() {
    setShowCameraChoiceModal(false);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission needed', 'Allow camera access.'); return; }
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Videos, videoMaxDuration: 120, allowsEditing: true, quality: 0.7 });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setUploading(true);
      const filename = `video_${Date.now()}.mp4`;
      const mxcUri = await uploadMedia(session.accessToken, asset.uri, 'video/mp4', filename);
      await sendVideoMessage(session.accessToken, roomId, mxcUri, filename);
    } catch (err) { Alert.alert('Upload Failed', err.message); }
    finally { setUploading(false); }
  }

  async function handlePickVideo() {
    closePanel();
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo access.'); return; }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Videos, videoMaxDuration: 60 });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setUploading(true);
      const filename = asset.fileName || `video_${Date.now()}.mp4`;
      const mxcUri = await uploadMedia(session.accessToken, asset.uri, 'video/mp4', filename);
      await sendVideoMessage(session.accessToken, roomId, mxcUri, filename);
    } catch (err) { Alert.alert('Upload Failed', err.message); }
    finally { setUploading(false); }
  }

  async function handlePickFile() {
    closePanel();
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const filename = asset.name || `file_${Date.now()}`;
      const mimeType = asset.mimeType || 'application/octet-stream';
      const fileSize = asset.size || 0;
      setUploading(true);
      const mxcUri = await uploadMedia(session.accessToken, asset.uri, mimeType, filename);
      await sendFileMessage(session.accessToken, roomId, mxcUri, filename, mimeType, fileSize);
    } catch (err) { Alert.alert('Upload Failed', err.message); }
    finally { setUploading(false); }
  }

  // ─── Audio recording ──────────────────────────────────────────────────────
  async function startRecording() {
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission needed', 'Allow microphone access.'); return; }
      await recorder.prepareToRecordAsync(); recorder.record(); setIsRecording(true);
    } catch (err) { Alert.alert('Recording Failed', err.message); }
  }

  async function stopRecordingAndSend() {
    if (!recorder) return;
    setIsRecording(false);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      const duration = Math.round(recorder.currentTime || 0);
      if (!uri) return;
      setUploading(true);
      const filename = `voice_${Date.now()}.m4a`;
      const mxcUri = await uploadMedia(session.accessToken, uri, 'audio/m4a', filename);
      await sendAudioMessage(session.accessToken, roomId, mxcUri, filename, duration);
    } catch (err) { Alert.alert('Send Failed', err.message); }
    finally { setUploading(false); }
  }

  // ─── Location ─────────────────────────────────────────────────────────────
  async function handleShareCurrentLocation() {
    setShowLocationModal(false);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission needed', 'Allow location access.'); return; }
      const loc = await Location.getCurrentPositionAsync({});
      await sendLocationMessage(session.accessToken, roomId, loc.coords.latitude, loc.coords.longitude, 'My Current Location');
    } catch (err) { Alert.alert('Error', err.message); }
  }

  async function handleShareLiveLocation(durMs) {
    setShowLiveDurationModal(false);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission needed', 'Allow location access.'); return; }
      const loc = await Location.getCurrentPositionAsync({});
      await sendLiveLocationMessage(session.accessToken, roomId, loc.coords.latitude, loc.coords.longitude, durMs);
    } catch (err) { Alert.alert('Error', err.message); }
  }

  async function handleSharePinLocation() {
    setShowPinModal(false);
    try { await sendLocationMessage(session.accessToken, roomId, mapRegion.latitude, mapRegion.longitude, 'Pinned Location'); }
    catch (err) { Alert.alert('Error', err.message); }
  }

  function handleEmojiSelect(emoji) { setInputText(prev => prev + emoji); setShowEmojiPicker(false); }
  function cancelRecording() { recorder?.stop().catch(() => {}); setIsRecording(false); }
  function togglePlayAudio(msg) { setPlayingId(playingId === msg.id ? null : msg.id); }

  function fmtFileSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function getFileIconName(mimeType) {
    if (!mimeType) return 'file';
    if (mimeType.includes('pdf')) return 'file-text';
    if (mimeType.includes('word') || mimeType.includes('doc')) return 'file-text';
    if (mimeType.includes('sheet') || mimeType.includes('excel') || mimeType.includes('csv')) return 'bar-chart-2';
    if (mimeType.includes('zip') || mimeType.includes('rar')) return 'archive';
    return 'file';
  }

  const attachIconBg = theme.name === 'light' ? '#FFF0E8' : '#3d0909';

  const ATTACH_ITEMS = [
  { key: 'camera',   icon: 'camera',    label: 'Camera',   color: accent, bg: attachIconBg },
  { key: 'gallery',  icon: 'image',     label: 'Gallery',  color: accent, bg: attachIconBg },
  { key: 'video',    icon: 'film',      label: 'Video',    color: accent, bg: attachIconBg},
  { key: 'document', icon: 'paperclip', label: 'Document', color: accent, bg: attachIconBg },
  { key: 'location', icon: 'map-pin',   label: 'Location', color: '#10B981', bg: '#D1FAE5' },
  { key: 'emoji',    icon: 'smile',     label: 'Emoji',    color: '#F59E0B', bg: '#FEF3C7' },
];

  const attachHandlers = {
    camera:   handleCamera,
    gallery:  handlePickImage,
    video:    handlePickVideo,
    document: handlePickFile,
    location: () => { closePanel(); setShowLocationModal(true); },
    emoji:    () => { closePanel(); setShowEmojiPicker(true); },
  };

  // ─────────────────────────────────────────────────────────────────────────
  // renderMessage — all hardcoded blues → theme vars
  // ─────────────────────────────────────────────────────────────────────────
  const renderMessage = ({ item: msg, index }) => {
    const time = new Date(msg.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    const isPlaying = playingId === msg.id;
    const prevMsg = index > 0 ? messages[index - 1] : null;
    const showMeta = !prevMsg || prevMsg.sender !== msg.sender;
    const replyMsg = msg.replyToId ? messages.find(m => m.id === msg.replyToId) : null;
    const msgReactions = reactions[msg.id];
    const isHighlighted = highlightedMsgId === msg.id;
    const isMediaMsg = (msg.msgtype === 'm.image' || msg.msgtype === 'm.video') && !!msg.mediaUrl;

    return (
      <View style={[st.msgRow, msg.isMe && st.msgRowMe]}>
        {!msg.isMe && (
          <View style={st.avatarWrap}>
            {showMeta ? (
              <View style={[st.avatar, { backgroundColor: accentFaint }]}>
                <Text style={[st.avatarTxt, { color: accent }]}>{msg.senderName.charAt(0).toUpperCase()}</Text>
              </View>
            ) : (
              <View style={{ width: 34 }} />
            )}
          </View>
        )}

        <TouchableOpacity
          onLongPress={() => { setSelectedMessage(msg); setShowActionMenu(true); }}
          activeOpacity={0.9}
          style={[
            st.bubble,
            msg.isMe
              ? [st.bubbleMe, { backgroundColor: accent }]
              : [st.bubbleThem, { backgroundColor: surface }],
            isMediaMsg && st.bubbleMedia,
            isHighlighted && st.bubbleHighlighted,
          ]}
        >
          {!msg.isMe && showMeta && (
            <Text style={[st.senderName, isMediaMsg && st.senderNameMedia, { color: accent }]}>
              {msg.senderName}
            </Text>
          )}

          {replyMsg && (
            <View style={isMediaMsg && st.mediaPad}>
              <TouchableOpacity
                style={[st.replyBubble, msg.isMe && st.replyBubbleMe, { borderLeftColor: msg.isMe ? 'rgba(255,255,255,0.6)' : accent }]}
                onPress={() => {
                  const idx = messages.findIndex(m => m.id === msg.replyToId);
                  if (idx !== -1) { flatRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 }); highlightMessage(msg.replyToId); }
                }}
              >
                <Text style={[st.replySender, { color: msg.isMe ? 'rgba(255,255,255,0.9)' : accent }]}>{replyMsg.senderName}</Text>
                <Text style={[st.replyBody, { color: msg.isMe ? 'rgba(255,255,255,0.7)' : textSecondary }]} numberOfLines={1}>{replyMsg.body}</Text>
              </TouchableOpacity>
            </View>
          )}

          {msg.msgtype === 'm.text' && (
            <Text style={[st.msgText, { color: msg.isMe ? '#fff' : textPrimary }]}>{msg.body}</Text>
          )}

          {msg.msgtype === 'm.image' && msg.mediaUrl && (
            <View>
              <TouchableOpacity onPress={() => setFullImage(msg.mediaUrl)} onLongPress={() => { setSelectedMessage(msg); setShowActionMenu(true); }} activeOpacity={0.9}>
                <AuthImage uri={msg.mediaUrl} accessToken={session.accessToken} style={st.msgImage} caption={msg.body !== 'image' ? msg.body : null} />
              </TouchableOpacity>
              <TouchableOpacity style={st.mediaDownloadBtn} onPress={() => downloadMedia(msg.mediaUrl, session.accessToken, msg.body, 'image')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="download-outline" size={15} color="#fff" />
              </TouchableOpacity>
            </View>
          )}

          {msg.msgtype === 'm.video' && msg.mediaUrl && (
            <View style={{ position: 'relative' }}>
              <AuthVideo uri={msg.mediaUrl} accessToken={session.accessToken} filename={msg.body} isMe={msg.isMe} />
              <TouchableOpacity style={st.mediaDownloadBtn} onPress={() => downloadMedia(msg.mediaUrl, session.accessToken, msg.body, 'video')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="download-outline" size={15} color="#fff" />
              </TouchableOpacity>
            </View>
          )}

          {msg.msgtype === 'm.audio' && msg.mediaUrl && (
            <AuthAudio
              uri={msg.mediaUrl}
              accessToken={session.accessToken}
              isPlaying={isPlaying}
              onToggle={() => togglePlayAudio(msg)}
              onFinish={() => setPlayingId(null)}
              isMe={msg.isMe}
              duration={msg.duration}
              onDownload={() => downloadMedia(msg.mediaUrl, session.accessToken, msg.body, 'audio')}
              accent={accent}
              accentFaint={accentFaint}
            />
          )}

          {msg.msgtype === 'm.file' && (
            <View style={[st.fileCard, { backgroundColor: msg.isMe ? 'rgba(255,255,255,0.15)' : accentFaint, borderColor: msg.isMe ? 'rgba(255,255,255,0.2)' : accentMid }]}>
              <View style={[st.fileCardIconCircle, { backgroundColor: msg.isMe ? 'rgba(255,255,255,0.2)' : accentFaint }]}>
                <Feather name={getFileIconName(msg.mimeType)} size={22} color={msg.isMe ? '#fff' : accent} />
              </View>
              <View style={st.fileCardInfo}>
                <Text style={[st.fileCardName, { color: msg.isMe ? '#fff' : textPrimary }]} numberOfLines={2}>{msg.filename || msg.body}</Text>
                <Text style={[st.fileCardMeta, { color: msg.isMe ? 'rgba(255,255,255,0.6)' : textMuted }]}>
                  {msg.mimeType?.split('/').pop()?.toUpperCase() || 'FILE'} · {fmtFileSize(msg.fileSize)}
                </Text>
              </View>
              {msg.mediaUrl && (
                <TouchableOpacity onPress={() => downloadMedia(msg.mediaUrl, session.accessToken, msg.filename || msg.body, 'file')} style={st.fileDownloadBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="download-outline" size={22} color={msg.isMe ? '#fff' : accent} />
                </TouchableOpacity>
              )}
            </View>
          )}

          {msg.msgtype === 'm.location' && (
            <View style={[st.locBubble, { backgroundColor: accentFaint }]}>
              <MapView
                style={st.locMap} liteMode scrollEnabled={false} zoomEnabled={false}
                initialRegion={{
                  latitude: parseFloat(msg.geo?.split(':')[1]?.split(',')[0]) || 0,
                  longitude: parseFloat(msg.geo?.split(':')[1]?.split(',')[1]) || 0,
                  latitudeDelta: 0.01, longitudeDelta: 0.01,
                }}
              >
                <Marker coordinate={{ latitude: parseFloat(msg.geo?.split(':')[1]?.split(',')[0]) || 0, longitude: parseFloat(msg.geo?.split(':')[1]?.split(',')[1]) || 0 }} />
              </MapView>
              <View style={st.locInfo}>
                <Text style={[st.locName, { color: msg.isMe ? '#fff' : textPrimary }]}>{msg.isLive ? 'Live Location' : 'Shared Location'}</Text>
                {msg.isLive && <Text style={[st.locSub, { color: msg.isMe ? 'rgba(255,255,255,0.7)' : textSecondary }]}>{msg.liveUntil > Date.now() ? 'Active' : 'Expired'}</Text>}
              </View>
            </View>
          )}

          <View style={[st.msgFooter, isMediaMsg && st.msgFooterMedia]}>
            {msgReactions && (
              <View style={st.reactionRow}>
                {Object.entries(msgReactions).map(([emoji, users]) => (
                  <TouchableOpacity
                    key={emoji}
                    style={[st.reactionPill, users.includes(session.userId) && { backgroundColor: accentFaint, borderColor: accent, borderWidth: 0.5 }]}
                    onPress={() => handleReaction(msg.id, emoji)}
                  >
                    <Text style={st.reactionEmoji}>{emoji}</Text>
                    <Text style={[st.reactionCount, users.includes(session.userId) && { color: accent }]}>{users.length}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <Text style={[st.msgTime, { color: msg.isMe ? 'rgba(255,255,255,0.65)' : textMuted }]}>{time}</Text>
            {msg.isMe && <Ionicons name="checkmark-done" size={13} color="rgba(255,255,255,0.6)" style={{ marginLeft: 4 }} />}
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  // ─── Patient / incidents ──────────────────────────────────────────────────
  // REPLACE the entire block above with:
useEffect(() => {
  if (!roomId) return;

  AsyncStorage.getItem('TICKET_NAMES').then(raw => {
    if (!raw) return;
    const cache = JSON.parse(raw);
    if (cache[roomId]?.name) {
      setPatientData(cache[roomId]);
      setTitleLocked(true);
    }
  });

  const fetchIncidents = async () => {
    try {
      const res = await fetch(`${SERVER_URL}/incidents`);
      const json = await res.json();
      if (json.success && json.data) {
        const match = json.data.find(
          inc => (inc.matrixRoomId || inc.roomId) === roomId
        );
        if (match) {
          const data = {
            name: match.patientName || 'Unknown',
            address: match.address || '',
          };
          const rawCache = await AsyncStorage.getItem('TICKET_NAMES') || '{}';
          const cache = JSON.parse(rawCache);
          cache[roomId] = data;
          await AsyncStorage.setItem('TICKET_NAMES', JSON.stringify(cache));
          if (!titleLocked) {
            setPatientData(data);
            setTitleLocked(true);
          }
        }
      }
    } catch (err) {
      console.warn('[ChatScreen] fetchIncidents error:', err.message);
    }
  };

  fetchIncidents();
}, [roomId]);

  if (loadingInit) {
    return (
      <View style={[st.loader, { backgroundColor: bg }]}>
        <ActivityIndicator size="large" color={accent} />
        <Text style={[st.loaderTxt, { color: textSecondary }]}>Loading messages…</Text>
      </View>
    );
  }

  const isTicketRoom = currentRoomName?.trim()?.toLowerCase()?.includes('ticket-');
const displayTitle = patientData?.name          // patient name if found
  || (currentRoomName || 'Incident Chat');       // ← always show room name as fallback
                                                 //   so past tickets show "Ticket-abc123"
                                                 //   instead of "Loading"
const subTitle = isTicketRoom
  ? (patientData?.name ? currentRoomName : 'Incident Communication')
  // ↑ if patient name is shown as title, show ticket id as subtitle
  // ↑ if no patient name yet, don't show ticket id as subtitle
  : 'Incident Communication';
  const showAttach = panel === 'attach';

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView style={[st.flex, { backgroundColor: bg }]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>

      {/* Header */}
      {!hideHeader && (
        <View style={[st.header, { backgroundColor: topBar }]}>
          <View style={st.headerTitleWrap}>
            <View style={[st.avatarSmall, { backgroundColor: 'rgba(255,255,255,0.2)', marginRight: 10 }]}>
              <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 13 }}>{getInitials(displayTitle)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={st.headerTitle}>{displayTitle}</Text>
              <Text style={st.headerSub}>{subTitle}</Text>
            </View>
          </View>
          {uploading && <ActivityIndicator size="small" color="#fff" />}
        </View>
      )}

      {/* Pinned banner */}
      {pinnedEvents.length > 0 && (
        <View style={[st.pinnedHeader, { backgroundColor: surface, borderBottomColor: border }]}>
          <Ionicons name="pin" size={16} color={accent} />
          <Text style={[st.pinnedTxt, { color: textPrimary }]} numberOfLines={1}>
            {pinnedEvents.length} Pinned {pinnedEvents.length === 1 ? 'Message' : 'Messages'}
          </Text>
          <TouchableOpacity onPress={() => {
            const idx = messages.findIndex(m => m.id === pinnedEvents[0]);
            if (idx !== -1) { flatRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 }); highlightMessage(pinnedEvents[0]); }
          }}>
            <Text style={[st.pinnedViewBtn, { color: accent }]}>VIEW</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Message list */}
      <FlatList
        ref={flatRef}
        data={messages}
        keyExtractor={m => m.id}
        renderItem={renderMessage}
        contentContainerStyle={st.list}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={closePanel}
        ListEmptyComponent={
          <View style={st.emptyWrap}>
            <Ionicons name="chatbubbles-outline" size={52} color={accentFaint} />
            <Text style={[st.emptyTxt, { color: textSecondary }]}>No messages yet</Text>
            <Text style={[st.emptySub, { color: textMuted }]}>This is your private alert channel</Text>
          </View>
        }
      />

      {/* Recording bar */}
      {isRecording && (
        <View style={[st.recordingBar, { backgroundColor: accentSoft, borderTopColor: accentMid }]}>
          <View style={st.recordingDot} />
          <Text style={[st.recordingTxt, { color: accent }]}>Recording… tap stop to send</Text>
          <TouchableOpacity onPress={cancelRecording} style={st.cancelRecBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={18} color={textMuted} />
          </TouchableOpacity>
        </View>
      )}

      {/* Reply preview */}
      {replyTo && (
        <View style={[st.replyPreview, { backgroundColor: surface, borderTopColor: border, borderLeftColor: accent }]}>
          <View style={{ flex: 1 }}>
            <Text style={[st.replyTitle, { color: accent }]}>Replying to {replyTo.senderName}</Text>
            <Text style={[st.replyText, { color: textSecondary }]} numberOfLines={1}>{replyTo.body}</Text>
          </View>
          <TouchableOpacity onPress={() => setReplyTo(null)}>
            <Ionicons name="close-circle" size={20} color={textMuted} />
          </TouchableOpacity>
        </View>
      )}

      {/* Mention popup */}
      {mentionOpen && (
        <View style={[st.mentionPopup, { backgroundColor: surface, borderTopColor: border }]}>
          {roomMembers.filter(m => m.displayName.toLowerCase().includes(mentionSearch.toLowerCase())).map(m => (
            <TouchableOpacity
              key={m.userId}
              style={[st.mentionItem, { borderBottomColor: borderLight }]}
              onPress={() => {
                const parts = inputText.split('@'); parts.pop();
                setInputText(parts.join('@') + '@' + m.displayName + ' ');
                setMentionOpen(false); inputRef.current?.focus();
              }}
            >
              <View style={[st.mentionAvatar, { backgroundColor: accentFaint }]}>
                <Text style={[st.mentionAvatarTxt, { color: accent }]}>{m.displayName.charAt(0).toUpperCase()}</Text>
              </View>
              <Text style={[st.mentionName, { color: textPrimary }]}>{m.displayName}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Input bar */}
      <View style={[st.whatsappInputBar, { backgroundColor: surfaceAlt }]}>
        <View style={[st.inputContainer, { backgroundColor: surface }]}>
          <TouchableOpacity style={st.innerActionBtn} onPress={() => { closePanel(); setShowEmojiPicker(true); }} disabled={isRecording || uploading}>
            <Feather name="smile" size={24} color={textMuted} />
          </TouchableOpacity>

          {!isRecording && (
            <TextInput
              ref={inputRef}
              style={[st.whatsappTextInput, { color: textPrimary }]}
              placeholder="Message"
              placeholderTextColor={textMuted}
              value={inputText}
              onChangeText={(text) => {
                setInputText(text);
                const lastChar = text[text.length - 1];
                if (lastChar === '@') { setMentionOpen(true); setMentionSearch(''); }
                else if (mentionOpen) {
                  const parts = text.split('@'), lastPart = parts[parts.length - 1];
                  if (lastPart.includes(' ')) setMentionOpen(false); else setMentionSearch(lastPart);
                }
              }}
              onFocus={() => setPanel('keyboard')}
              multiline maxLength={2000}
            />
          )}
          {isRecording && <View style={{ flex: 1 }} />}

          <TouchableOpacity style={st.innerActionBtn} onPress={toggleAttach} disabled={isRecording || uploading}>
            <Feather name="paperclip" size={22} color={textMuted} />
          </TouchableOpacity>

          {!inputText.trim() && (
            <TouchableOpacity style={st.innerActionBtn} onPress={handleCamera} disabled={isRecording || uploading}>
              <Feather name="camera" size={22} color={textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {/* Send / mic button — theme accent */}
        <TouchableOpacity
          style={[st.voiceSendBtn, { backgroundColor: accent }, isRecording && { backgroundColor: '#EF4444' }]}
          onPress={isRecording ? stopRecordingAndSend : (inputText.trim() ? handleSend : startRecording)}
          disabled={uploading}
          activeOpacity={0.8}
        >
          {inputText.trim() ? (
            sending ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="send" size={20} color="#fff" />
          ) : (
            <Feather name={isRecording ? 'square' : 'mic'} size={22} color="#fff" />
          )}
        </TouchableOpacity>
      </View>

      {/* Attach grid */}
      {showAttach && !isRecording && (
        <View style={[st.attachMenu, { backgroundColor: surface, borderTopColor: border }]}>
          <View style={[st.attachHandle, { backgroundColor: border }]} />
          <View style={st.attachGrid}>
            {ATTACH_ITEMS.map(item => (
              <TouchableOpacity key={item.key} style={st.attachCell} onPress={attachHandlers[item.key]} activeOpacity={0.75}>
                <View style={[
                  st.attachItemIcon,
                  { backgroundColor: item.bg, borderWidth: 0 },
                ]}>
                                  <Feather name={item.icon} size={22} color={item.color} />
                </View>
                <Text style={[st.attachItemLabel, { color: textSecondary }]}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Camera choice modal */}
      <Modal visible={showCameraChoiceModal} transparent animationType="fade" onRequestClose={() => setShowCameraChoiceModal(false)}>
        <TouchableOpacity style={st.menuOverlay} activeOpacity={1} onPress={() => setShowCameraChoiceModal(false)}>
          <View style={[camStyle.card, { backgroundColor: surface }]}>
            <View style={[camStyle.handle, { backgroundColor: border }]} />
            <Text style={[camStyle.title, { color: textPrimary }]}>Open Camera</Text>
            <Text style={[camStyle.subtitle, { color: textMuted }]}>What would you like to capture?</Text>
            <View style={camStyle.row}>
              <TouchableOpacity style={camStyle.option} onPress={handleCameraPhoto} activeOpacity={0.8}>
                <View style={[camStyle.optionIcon, { backgroundColor: accentFaint }]}>
                  <Feather name="camera" size={28} color={accent} />
                </View>
                <Text style={[camStyle.optionLabel, { color: textPrimary }]}>Photo</Text>
                <Text style={[camStyle.optionSub, { color: textMuted }]}>Take a picture</Text>
              </TouchableOpacity>
              <View style={[camStyle.divider, { backgroundColor: border }]} />
              <TouchableOpacity style={camStyle.option} onPress={handleCameraVideo} activeOpacity={0.8}>
                <View style={[camStyle.optionIcon, { backgroundColor: '#FEE2E2' }]}>
                  <Feather name="video" size={28} color="#EF4444" />
                </View>
                <Text style={[camStyle.optionLabel, { color: textPrimary }]}>Video</Text>
                <Text style={[camStyle.optionSub, { color: textMuted }]}>Record a clip</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={[camStyle.cancelBtn, { backgroundColor: surfaceAlt2 }]} onPress={() => setShowCameraChoiceModal(false)}>
              <Text style={[camStyle.cancelTxt, { color: textSecondary }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Location modal */}
      <Modal visible={showLocationModal} transparent animationType="fade" onRequestClose={() => setShowLocationModal(false)}>
        <View style={st.locModalBg}>
          <View style={[st.locModalCard, { backgroundColor: surface }]}>
            <TouchableOpacity style={st.locModalClose} onPress={() => setShowLocationModal(false)}>
              <Ionicons name="close-circle" size={24} color={textMuted} />
            </TouchableOpacity>
            <View style={[st.locModalIconOuter, { backgroundColor: accent }]}>
              <Ionicons name="location" size={32} color="#fff" />
            </View>
            <Text style={[st.locModalTitle, { color: textPrimary }]}>What location type do you want to share?</Text>
            {[
              { label: 'My current location', icon: 'M', bg: 'transparent', borderColor: '#10B981', onPress: handleShareCurrentLocation },
              { label: 'My live location',    icon: null, bg: '#8B5CF6',    borderColor: '#8B5CF6', ionIcon: 'wifi', onPress: () => { setShowLocationModal(false); setShowLiveDurationModal(true); } },
              { label: 'Drop a Pin',          icon: null, bg: '#059669',    borderColor: '#059669', ionIcon: 'location', onPress: () => { setShowLocationModal(false); setShowPinModal(true); } },
            ].map((opt, i) => (
              <TouchableOpacity key={i} style={[st.locOptionBtn, { borderColor: border }]} onPress={opt.onPress}>
                <View style={[st.locOptionIcon, { backgroundColor: opt.bg, borderColor: opt.borderColor }]}>
                  {opt.ionIcon ? <Ionicons name={opt.ionIcon} size={18} color="#fff" /> : <Text style={{ color: opt.borderColor, fontWeight: 'bold' }}>{opt.icon}</Text>}
                </View>
                <Text style={[st.locOptionTxt, { color: textSecondary }]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>

      <Modal visible={showLiveDurationModal} transparent animationType="fade" onRequestClose={() => setShowLiveDurationModal(false)}>
        <View style={st.locModalBg}>
          <View style={[st.locModalCard, { backgroundColor: surface }]}>
            <Text style={[st.locModalTitle, { color: textPrimary }]}>Share live location for how long?</Text>
            {[{ label: '15 Minutes', val: 15 * 60 * 1000 }, { label: '1 Hour', val: 60 * 60 * 1000 }, { label: '8 Hours', val: 8 * 60 * 60 * 1000 }].map(dur => (
              <TouchableOpacity key={dur.label} style={[st.locOptionBtn, { borderColor: border }]} onPress={() => handleShareLiveLocation(dur.val)}>
                <Text style={[st.locOptionTxtCenter, { color: textSecondary }]}>{dur.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={[st.locOptionBtn, { marginTop: 10, borderColor: border }]} onPress={() => setShowLiveDurationModal(false)}>
              <Text style={[st.locOptionTxtCenter, { color: '#EF4444' }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showPinModal} transparent animationType="slide" onRequestClose={() => setShowPinModal(false)}>
        <View style={{ flex: 1 }}>
          <MapView style={{ flex: 1 }} initialRegion={mapRegion} onRegionChangeComplete={setMapRegion}>
            <Marker coordinate={mapRegion} />
          </MapView>
          <View style={st.pinToolbar}>
            <TouchableOpacity style={[st.pinCancelBtn, { backgroundColor: textMuted }]} onPress={() => setShowPinModal(false)}>
              <Text style={{ color: '#fff' }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[st.pinConfirmBtn, { backgroundColor: accent }]} onPress={handleSharePinLocation}>
              <Text style={{ color: '#fff', fontWeight: 'bold' }}>Share Pinned Location</Text>
            </TouchableOpacity>
          </View>
          <View style={st.pinCrosshair}><Ionicons name="add" size={30} color="#EF4444" /></View>
        </View>
      </Modal>

      <Modal visible={showEmojiPicker} transparent animationType="fade" onRequestClose={() => setShowEmojiPicker(false)}>
        <TouchableOpacity style={st.menuOverlay} activeOpacity={1} onPress={() => setShowEmojiPicker(false)}>
          <View style={[st.emojiContent, { backgroundColor: surface }]}>
            <Text style={[st.emojiTitle, { color: textPrimary }]}>Select Emoji</Text>
            <View style={st.emojiGrid}>
              {['😀','😂','😍','👍','🔥','🙏','💯','🚀','❤️','✅','❌','⚠️','🚑','🚨','📞','📍','🏥','🏠','🚶','🏃'].map(e => (
                <TouchableOpacity key={e} style={st.emojiItem} onPress={() => handleEmojiSelect(e)}>
                  <Text style={{ fontSize: 28 }}>{e}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Full image lightbox */}
      {fullImage && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setFullImage(null)}>
          <View style={st.fullImageBg}>
            <TouchableOpacity style={st.fullImageClose} onPress={() => setFullImage(null)}>
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>
            <AuthImage uri={fullImage} accessToken={session.accessToken} style={st.fullImage} resizeMode="contain" />
          </View>
        </Modal>
      )}

      {/* Action menu */}
      <Modal visible={showActionMenu} transparent animationType="slide" onRequestClose={() => setShowActionMenu(false)}>
        <TouchableOpacity style={st.menuOverlay} activeOpacity={1} onPress={() => setShowActionMenu(false)}>
          <View style={[st.whatsappActionMenu, { backgroundColor: surface }]}>
            <View style={[st.whatsappReactionRow, { borderBottomColor: borderLight }]}>
              {['👍','❤️','😂','😮','😢','🔥'].map(emoji => (
                <TouchableOpacity key={emoji} style={st.whatsappReactionBtn}
                  onPress={async () => {
                    try { await sendReaction(session.accessToken, roomId, selectedMessage.id, emoji); }
                    catch (err) { Alert.alert('Error', err.message); }
                    setShowActionMenu(false);
                  }}
                >
                  <Text style={{ fontSize: 28 }}>{emoji}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={st.whatsappReactionBtn}>
                <Ionicons name="add-circle-outline" size={30} color={textMuted} />
              </TouchableOpacity>
            </View>
            <View style={st.whatsappActionList}>
              <TouchableOpacity style={st.whatsappActionItem} onPress={() => { setReplyTo(selectedMessage); setShowActionMenu(false); inputRef.current?.focus(); }}>
                <Ionicons name="arrow-undo-outline" size={24} color={accent} />
                <Text style={[st.whatsappActionText, { color: textPrimary }]}>Reply</Text>
              </TouchableOpacity>
              <TouchableOpacity style={st.whatsappActionItem}
                onPress={async () => {
                  try { const nextPins = await pinMessage(session.accessToken, roomId, selectedMessage.id); setPinnedEvents(nextPins); }
                  catch (err) { Alert.alert('Error', err.message); }
                  setShowActionMenu(false);
                }}
              >
                <Ionicons name={pinnedEvents.includes(selectedMessage?.id) ? 'pin-off' : 'pin'} size={24} color={accent} />
                <Text style={[st.whatsappActionText, { color: textPrimary }]}>{pinnedEvents.includes(selectedMessage?.id) ? 'Unpin Message' : 'Pin Message'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={st.whatsappActionItem}
                onPress={async () => {
                  setForwardMsg(selectedMessage); setShowActionMenu(false); setShowForwardModal(true);
                  try {
                    const roomIds = await getJoinedRooms(session.accessToken);
                    const roomDetails = await Promise.all(roomIds.map(async (rid) => {
                      const state = await getRoomState(session.accessToken, rid, 'm.room.name');
                      return { id: rid, name: state?.name || rid };
                    }));
                    setJoinedRooms(roomDetails);
                  } catch (err) { console.warn(err); }
                }}
              >
                <Ionicons name="share-outline" size={24} color={accent} />
                <Text style={[st.whatsappActionText, { color: textPrimary }]}>Forward</Text>
              </TouchableOpacity>
              {selectedMessage?.msgtype === 'm.file' && (
                <TouchableOpacity style={st.whatsappActionItem} onPress={() => { Alert.alert('Download', 'File download started'); setShowActionMenu(false); }}>
                  <Ionicons name="download-outline" size={24} color={accent} />
                  <Text style={[st.whatsappActionText, { color: textPrimary }]}>Download File</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Forward modal */}
      <Modal visible={showForwardModal} transparent animationType="slide" onRequestClose={() => setShowForwardModal(false)}>
        <TouchableOpacity style={st.menuOverlay} activeOpacity={1} onPress={() => setShowForwardModal(false)}>
          <View style={[st.whatsappActionMenu, { backgroundColor: surface }]}>
            <View style={{ padding: 16, borderBottomWidth: 0.5, borderBottomColor: border }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: textPrimary }}>Forward to...</Text>
            </View>
            <ScrollView style={{ maxHeight: 400 }}>
              {joinedRooms.map(r => (
                <TouchableOpacity key={r.id} style={{ padding: 16, borderBottomWidth: 0.5, borderBottomColor: borderLight }}
                  onPress={async () => {
                    try { await forwardMessage(session.accessToken, r.id, forwardMsg); setShowForwardModal(false); Alert.alert('Success', `Forwarded to ${r.name}`); }
                    catch (err) { Alert.alert('Error', err.message); }
                  }}
                >
                  <Text style={{ fontSize: 16, color: textPrimary }}>{r.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={{ padding: 16, alignItems: 'center' }} onPress={() => setShowForwardModal(false)}>
              <Text style={{ fontSize: 16, color: '#EF4444', fontWeight: '600' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AuthImage
// ─────────────────────────────────────────────────────────────────────────────
function AuthImage({ uri, accessToken, style, resizeMode = 'cover' }) {
  if (!uri) return (
    <View style={[style, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#E2E8F0' }]}>
      <Feather name="image" size={24} color="#94A3B8" />
      <Text style={{ fontSize: 10, color: '#64748B', marginTop: 4 }}>Unavailable</Text>
    </View>
  );
  return (
    <ExpoImage
      source={{ uri, headers: { Authorization: `Bearer ${accessToken}` } }}
      style={style}
      contentFit={resizeMode === 'cover' ? 'cover' : 'contain'}
      transition={200}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AuthVideo — thumbnail → fullscreen modal with seek bar + X close
// ─────────────────────────────────────────────────────────────────────────────
function AuthVideo({ uri, accessToken, filename, isMe }) {
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [status, setStatus]   = useState({});
  const [isSeeking, setIsSeeking] = useState(false);
  const playerRef     = useRef(null);
  const fullPlayerRef = useRef(null);
  const positionMs = status?.positionMillis || 0;
  const durationMs = status?.durationMillis || 1;
  const isPlaying  = status?.isPlaying || false;

  function fmtMs(ms) { const s = Math.floor((ms || 0) / 1000); return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`; }

  async function togglePlay() {
    if (!fullPlayerRef.current) return;
    if (isPlaying) { await fullPlayerRef.current.pauseAsync(); }
    else { if (positionMs >= durationMs - 500) await fullPlayerRef.current.setPositionAsync(0); await fullPlayerRef.current.playAsync(); }
  }

  async function handleSeek(val) { if (!fullPlayerRef.current) return; await fullPlayerRef.current.setPositionAsync(val); }

  async function onClose() { try { await fullPlayerRef.current?.pauseAsync(); } catch (_) {} setShowFullscreen(false); }

  function handleStatusUpdate(s) {
    if (isSeeking) return;
    setStatus(s);
    if (s.didJustFinish) fullPlayerRef.current?.setPositionAsync(0).catch(() => {});
  }

  return (
    <>
      <TouchableOpacity activeOpacity={0.85} onPress={() => setShowFullscreen(true)} style={vst.container}>
        <AVVideo ref={playerRef} source={{ uri, headers: { Authorization: `Bearer ${accessToken}` } }} resizeMode={ResizeMode.COVER} isMuted shouldPlay={false} style={vst.video} />
        <View style={vst.playOverlay}>
          <View style={vst.playCircle}><Ionicons name="play" size={22} color="#fff" /></View>
        </View>
        {filename && filename !== 'video' && <Text style={vst.videoLabel} numberOfLines={1}>{filename}</Text>}
      </TouchableOpacity>

      <Modal visible={showFullscreen} transparent={false} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
        <View style={fst.bg}>
          <StatusBar barStyle="light-content" backgroundColor="#000" />
          <TouchableOpacity style={fst.closeBtn} onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <View style={fst.closeBtnInner}><Ionicons name="close" size={24} color="#fff" /></View>
          </TouchableOpacity>
          <AVVideo ref={fullPlayerRef} source={{ uri, headers: { Authorization: `Bearer ${accessToken}` } }} resizeMode={ResizeMode.CONTAIN} shouldPlay onPlaybackStatusUpdate={handleStatusUpdate} style={fst.video} />
          <View style={fst.controls}>
            <Slider style={fst.slider} minimumValue={0} maximumValue={durationMs} value={positionMs}
              onSlidingStart={() => setIsSeeking(true)}
              onSlidingComplete={async (val) => { await handleSeek(val); setIsSeeking(false); }}
              minimumTrackTintColor="#fff" maximumTrackTintColor="rgba(255,255,255,0.35)" thumbTintColor="#fff"
            />
            <View style={fst.timeRow}>
              <Text style={fst.timeTxt}>{fmtMs(positionMs)}</Text>
              <Text style={fst.timeTxt}>{fmtMs(durationMs)}</Text>
            </View>
            <TouchableOpacity style={fst.playBtn} onPress={togglePlay}>
              <Ionicons name={isPlaying ? 'pause' : 'play'} size={32} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AuthAudio — theme-aware via props
// ─────────────────────────────────────────────────────────────────────────────
function AuthAudio({ uri, accessToken, isPlaying, onToggle, onFinish, isMe, duration: initialDuration, onDownload, accent, accentFaint }) {
  const player = useAudioPlayer({ uri, headers: { Authorization: `Bearer ${accessToken}` } });
  const [pos, setPos] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [loadedDuration, setLoadedDuration] = useState(initialDuration || 0);
  const justFinished = useRef(false);

  useEffect(() => { if (player.duration > 0 && !loadedDuration) setLoadedDuration(player.duration); }, [player.duration]);

  useEffect(() => {
    if (isPlaying) { if (justFinished.current) { justFinished.current = false; player.seekTo(0); } player.play(); }
    else { player.pause(); }
  }, [isPlaying, player]);

  useEffect(() => {
    const unsubFinish = player.addListener('playToEnd', () => { justFinished.current = true; setPos(0); onFinish(); });
    const interval = setInterval(() => { if (!isSeeking && isPlaying) setPos(player.currentTime); }, 250);
    return () => { unsubFinish.remove(); clearInterval(interval); };
  }, [player, onFinish, isPlaying, isSeeking]);

  function fmtD(ms) { if (!ms) return '0:00'; const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`; }

  const duration = loadedDuration || player.duration || initialDuration || 0;
  // colours: "me" bubble uses white-on-accent; "them" uses accent-on-light
  const trackActive = isMe ? '#fff' : accent;
  const trackBg     = isMe ? 'rgba(255,255,255,0.3)' : (accentFaint || accent + '22');
  const playBg      = isMe ? 'rgba(255,255,255,0.25)' : (accentFaint || accent + '22');
  const playIcon    = isMe ? '#fff' : accent;

  return (
    <View style={ast.audioBubble}>
      <View style={ast.audioTopRow}>
        <TouchableOpacity style={[ast.audioPlayBtn, { backgroundColor: playBg, borderColor: trackActive + '44' }]} onPress={onToggle} activeOpacity={0.7}>
          <Ionicons name={isPlaying ? 'pause' : 'play'} size={22} color={playIcon} />
        </TouchableOpacity>
        <View style={ast.audioSeekWrap}>
          <Slider style={ast.audioSlider} minimumValue={0} maximumValue={duration > 0 ? duration : 100} value={pos}
            onSlidingStart={() => setIsSeeking(true)}
            onSlidingComplete={(val) => { player.seekTo(val); setPos(val); setIsSeeking(false); }}
            minimumTrackTintColor={trackActive}
            maximumTrackTintColor={trackBg}
            thumbTintColor={trackActive}
          />
        </View>
        {onDownload && (
          <TouchableOpacity onPress={onDownload} style={ast.audioDownloadBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="download-outline" size={18} color={isMe ? 'rgba(255,255,255,0.85)' : accent} />
          </TouchableOpacity>
        )}
      </View>
      <View style={ast.audioMetaRow}>
        <Text style={[ast.audioTimeTxt, { color: isMe ? 'rgba(255,255,255,0.65)' : '#64748B' }]}>
          {fmtD(pos)} / {fmtD(duration)}
        </Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER
// ─────────────────────────────────────────────────────────────────────────────
function getInitials(name = '') { return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2); }

// ─────────────────────────────────────────────────────────────────────────────
// STATIC STYLES  (layout only — colors applied inline via theme)
// ─────────────────────────────────────────────────────────────────────────────

// video thumbnail
const vst = StyleSheet.create({
  container: { width: 260, overflow: 'hidden', borderRadius: 0, backgroundColor: 'transparent', marginBottom: 0 },
  video: { width: 260, height: 195 },
  playOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.25)' },
  playCircle: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.7)' },
  videoLabel: { position: 'absolute', bottom: 6, left: 8, right: 8, fontSize: 11, color: 'rgba(255,255,255,0.85)', fontWeight: '600' },
});

// fullscreen player
const fst = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#000', justifyContent: 'center' },
  closeBtn: { position: 'absolute', top: Platform.OS === 'ios' ? 54 : 32, left: 18, zIndex: 20 },
  closeBtnInner: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  video: { width: '100%', height: '100%' },
  controls: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 16, paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? 38 : 22 },
  slider: { width: '100%', height: 40 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -6, marginBottom: 8, paddingHorizontal: 4 },
  timeTxt: { color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: '600' },
  playBtn: { alignSelf: 'center', width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.35)', marginBottom: 4 },
});

// camera choice
const camStyle = StyleSheet.create({
  card: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 24, paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? 40 : 28 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 20 },
  title: { fontSize: 18, fontWeight: '700', textAlign: 'center', marginBottom: 4 },
  subtitle: { fontSize: 13, textAlign: 'center', marginBottom: 28 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  option: { flex: 1, alignItems: 'center', gap: 10 },
  optionIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  optionLabel: { fontSize: 16, fontWeight: '700' },
  optionSub: { fontSize: 12 },
  divider: { width: 1, height: 80, marginHorizontal: 16 },
  cancelBtn: { alignItems: 'center', paddingVertical: 14, borderRadius: 14 },
  cancelTxt: { fontSize: 15, fontWeight: '600' },
});

// audio bubble
const ast = StyleSheet.create({
  audioBubble: { width: 260, padding: 10 },
  audioTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  audioSeekWrap: { flex: 1, height: 48, justifyContent: 'center' },
  audioSlider: { width: '100%', height: 48 },
  audioMetaRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: -4, marginRight: 4 },
  audioTimeTxt: { fontSize: 10 },
  audioPlayBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  audioDownloadBtn: { paddingLeft: 6, paddingRight: 2, alignItems: 'center', justifyContent: 'center' },
});

// main styles
const st = StyleSheet.create({
  flex: { flex: 1 },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loaderTxt: { fontSize: 14 },

  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 10 },
  headerTitleWrap: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  avatarSmall: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 15, fontWeight: '700', color: '#fff' },
  headerSub: { fontSize: 11, color: 'rgba(255,255,255,0.65)' },

  list: { padding: 14, paddingBottom: 10 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 10 },
  emptyTxt: { fontSize: 16, fontWeight: '600' },
  emptySub: { fontSize: 13, textAlign: 'center', paddingHorizontal: 30 },

  msgRow: { flexDirection: 'row', marginBottom: 4, alignItems: 'flex-end' },
  msgRowMe: { flexDirection: 'row-reverse' },
  avatarWrap: { marginRight: 6 },
  avatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 13, fontWeight: '700' },

  bubble: { maxWidth: '76%', borderRadius: 18, paddingHorizontal: 13, paddingTop: 9, paddingBottom: 7, overflow: 'hidden' },
  bubbleThem: { borderBottomLeftRadius: 4, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  bubbleMe: { borderBottomRightRadius: 4, marginRight: 4 },
  bubbleHighlighted: { borderWidth: 1.5, borderColor: '#FDE047', backgroundColor: '#FEF9C3' },
  bubbleMedia: { paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0 },

  senderName: { fontSize: 11, fontWeight: '700', marginBottom: 4 },
  senderNameMedia: { paddingHorizontal: 13, paddingTop: 9, marginBottom: 4 },
  mediaPad: { paddingHorizontal: 13 },
  msgText: { fontSize: 15, lineHeight: 21 },
  msgImage: { width: 260, height: 195, borderRadius: 0, marginBottom: 0 },

  mediaDownloadBtn: { position: 'absolute', top: 8, right: 8, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.50)', alignItems: 'center', justifyContent: 'center', zIndex: 10 },
  audioDownloadBtn: { paddingLeft: 6, paddingRight: 2, alignItems: 'center', justifyContent: 'center' },
  fileDownloadBtn: { paddingLeft: 8, alignItems: 'center', justifyContent: 'center' },
  msgFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 4 },
  msgFooterMedia: { paddingHorizontal: 10, paddingBottom: 6, marginTop: 0 },
  msgTime: { fontSize: 10 },

  fileCard: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, padding: 12, minWidth: 170, borderWidth: 0.5 },
  fileCardIconCircle: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  fileCardInfo: { flex: 1 },
  fileCardName: { fontSize: 13, fontWeight: '600', lineHeight: 18 },
  fileCardMeta: { fontSize: 11, marginTop: 2 },

  recordingBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1 },
  recordingDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#EF4444' },
  recordingTxt: { flex: 1, fontSize: 13, fontWeight: '600' },
  cancelRecBtn: { padding: 4 },

  attachMenu: { borderTopWidth: 0.5, paddingTop: 8, paddingBottom: Platform.OS === 'ios' ? 28 : 16, paddingHorizontal: 4 },
  attachHandle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: 12 },
  attachGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  attachCell: { width: '33.33%', alignItems: 'center', paddingVertical: 12, gap: 6 },
  attachItemIcon: { 
  width: 56, 
  height: 56, 
  borderRadius: 28, 
  alignItems: 'center', 
  justifyContent: 'center', 
  shadowColor: '#000', 
  shadowOpacity: 0.06, 
  shadowRadius: 4, 
  shadowOffset: { width: 0, height: 2 }, 
  elevation: 2 
},
  attachItemLabel: { fontSize: 11, fontWeight: '600' },

  whatsappInputBar: { flexDirection: 'row', alignItems: 'flex-end', padding: 8, paddingBottom: Platform.OS === 'ios' ? 26 : 12, gap: 6 },
  inputContainer: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', borderRadius: 25, paddingHorizontal: 8, paddingVertical: 4, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 3, elevation: 2 },
  whatsappTextInput: { flex: 1, maxHeight: 120, minHeight: 40, fontSize: 16, paddingHorizontal: 8, paddingVertical: 8 },
  innerActionBtn: { padding: 8 },
  voiceSendBtn: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', shadowOpacity: 0.3, shadowRadius: 6, elevation: 3 },

  fullImageBg: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  fullImageClose: { position: 'absolute', top: 50, right: 20, zIndex: 10, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, padding: 4 },
  fullImage: { width: '100%', height: '80%' },

  locBubble: { width: 260, borderRadius: 12, overflow: 'hidden', marginBottom: 2 },
  locMap: { width: 260, height: 140 },
  locInfo: { padding: 8 },
  locName: { fontSize: 13, fontWeight: '700' },
  locSub: { fontSize: 11 },

  menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },

  locModalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  locModalCard: { width: '85%', borderRadius: 20, padding: 25, alignItems: 'center' },
  locModalClose: { position: 'absolute', top: 15, right: 15 },
  locModalIconOuter: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  locModalTitle: { fontSize: 18, fontWeight: '700', textAlign: 'center', marginBottom: 25, lineHeight: 26 },
  locOptionBtn: { flexDirection: 'row', alignItems: 'center', width: '100%', padding: 12, borderWidth: 1, borderRadius: 12, marginBottom: 12 },
  locOptionIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginRight: 15, borderWidth: 2 },
  locOptionTxt: { fontSize: 15, fontWeight: '500' },
  locOptionTxtCenter: { fontSize: 16, fontWeight: '600', textAlign: 'center', width: '100%' },

  pinToolbar: { position: 'absolute', bottom: 40, left: 20, right: 20, flexDirection: 'row', gap: 10 },
  pinCancelBtn: { flex: 1, padding: 15, borderRadius: 12, alignItems: 'center' },
  pinConfirmBtn: { flex: 2, padding: 15, borderRadius: 12, alignItems: 'center' },
  pinCrosshair: { position: 'absolute', top: '50%', left: '50%', marginTop: -35, marginLeft: -15 },

  emojiContent: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, height: 350 },
  emojiTitle: { fontSize: 16, fontWeight: '700', marginBottom: 15 },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 15, justifyContent: 'center' },
  emojiItem: { width: 50, height: 50, alignItems: 'center', justifyContent: 'center' },

  replyPreview: { flexDirection: 'row', alignItems: 'center', padding: 10, borderTopWidth: 0.5, borderLeftWidth: 4 },
  replyTitle: { fontSize: 11, fontWeight: '700', marginBottom: 2 },
  replyText: { fontSize: 13 },

  mentionPopup: { borderTopWidth: 0.5, maxHeight: 200 },
  mentionItem: { flexDirection: 'row', alignItems: 'center', padding: 10, borderBottomWidth: 0.5 },
  mentionAvatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  mentionAvatarTxt: { fontSize: 12, fontWeight: '700' },
  mentionName: { fontSize: 14, fontWeight: '500' },

  replyBubble: { borderLeftWidth: 3, padding: 6, borderRadius: 4, marginBottom: 6, backgroundColor: 'rgba(0,0,0,0.05)' },
  replyBubbleMe: { backgroundColor: 'rgba(255,255,255,0.15)' },
  replySender: { fontSize: 11, fontWeight: '700', marginBottom: 2 },
  replyBody: { fontSize: 12 },

  reactionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginRight: 8 },
  reactionPill: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1 },
  reactionEmoji: { fontSize: 10 },
  reactionCount: { fontSize: 10, fontWeight: '600', color: '#64748B' },

  pinnedHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 0.5 },
  pinnedTxt: { flex: 1, fontSize: 13, fontWeight: '500' },
  pinnedViewBtn: { fontSize: 12, fontWeight: '700' },

  whatsappActionMenu: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? 34 : 20 },
  whatsappReactionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 0.5 },
  whatsappReactionBtn: { padding: 4 },
  whatsappActionList: { paddingHorizontal: 16, paddingTop: 8 },
  whatsappActionItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 16 },
  whatsappActionText: { fontSize: 16, fontWeight: '400' },
});