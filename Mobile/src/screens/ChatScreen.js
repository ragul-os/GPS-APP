/**
 * ChatScreen.js
 *
 * ✅ NEW ADDITIONS vs original:
 *  1. handleRecordVideo()      — opens system camera in video mode (long press → record)
 *  2. VideoNoteModal component — circular in-app recorder (like WhatsApp video note)
 *  3. handleVideoNoteSend()    — uploads & sends video note
 *  4. Circular bubble renderer — videos with body starting "vidnote:" show as circles
 *  5. Two new ATTACH_ITEMS     — "Record" (red) and "Video Note" (purple)
 *  6. Detailed console.log()   — every action logged for debugging
 *
 * NEW IMPORTS NEEDED (run these if not already installed):
 *   npx expo install expo-camera
 *   npx expo install react-native-svg
 */

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTS  (✅ NEW lines marked)
// ─────────────────────────────────────────────────────────────────────────────
import Slider from '@react-native-community/slider';
import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Video as AVVideo } from 'expo-av';
import {
  useAudioPlayer,
  useAudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
} from 'expo-audio';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera'; // ✅ NEW
import Svg, { Circle } from 'react-native-svg'; // ✅ NEW  (for progress ring)
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Image as ExpoImage } from 'expo-image';
import * as Location from 'expo-location';
import MapView, { Marker } from 'react-native-maps';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
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
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DISPATCH_ROOM_ID, useAuth } from '../context/AuthContext';
import { SERVER_URL } from '../config';
import {
  getRoomMessages,
  joinRoom,
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
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function ChatScreen({ roomId: propRoomId, roomLabel, hideHeader = false }) {
  const { session } = useAuth();

  const roomId = (propRoomId && propRoomId.trim() !== '') ? propRoomId : DISPATCH_ROOM_ID;
  const isDispatchRoom = roomId === DISPATCH_ROOM_ID;

  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loadingInit, setLoadingInit] = useState(true);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [isRecording, setIsRecording] = useState(false);
  const [playingId, setPlayingId] = useState(null);
  const [fullImage, setFullImage] = useState(null);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [showLiveDurationModal, setShowLiveDurationModal] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const [roomMembers, setRoomMembers] = useState([]);
  const [currentRoomName, setCurrentRoomName] = useState(roomLabel || '');
  const [mapRegion, setMapRegion] = useState({
    latitude: 12.9716, longitude: 77.5946,
    latitudeDelta: 0.01, longitudeDelta: 0.01,
  });

  const [panel, setPanel] = useState('none');

  // ✅ NEW — video note modal state
  const [showVideoNote, setShowVideoNote] = useState(false);

  const flatRef = useRef(null);
  const syncActive = useRef(true);
  const soundRef = useRef(null);
  const roomIdRef = useRef(roomId);
  const inputRef = useRef(null);

  const [reactions, setReactions] = useState({});
  const [pinnedEvents, setPinnedEvents] = useState([]);
  const [joinedRooms, setJoinedRooms] = useState([]);
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [forwardMsg, setForwardMsg] = useState(null);
  const [highlightedMsgId, setHighlightedMsgId] = useState(null);
  const highlightTimeoutRef = useRef(null);
  const [patientData, setPatientData] = useState(null);

  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);

  // ─── Keyboard listeners ────────────────────────────────────────────────────
  useEffect(() => {
    const showEv = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEv = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = () => {
      setPanel('keyboard');
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 150);
    };
    const onHide = () => {
      setPanel(prev => (prev === 'keyboard' ? 'none' : prev));
    };
    const s1 = Keyboard.addListener(showEv, onShow);
    const s2 = Keyboard.addListener(hideEv, onHide);
    return () => { s1.remove(); s2.remove(); };
  }, []);

  // ─── Room init ────────────────────────────────────────────────────────────
  useEffect(() => {
    syncActive.current = true;
    setMessages([]);
    setLoadingInit(true);
    loadMessages();
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
      } catch (err) {
        console.warn('[ChatScreen] fetchData error:', err.message);
      }
    };
    fetchData();
  }, [roomId, session.accessToken, roomLabel]);

  // ─── Reactions ────────────────────────────────────────────────────────────
  const handleReaction = async (eventId, emoji) => {
    try {
      await sendReaction(session.accessToken, roomId, eventId, emoji);
    } catch (err) {
      console.warn('[Reaction] failed:', err.message);
    }
  };

  // ─── Load messages ────────────────────────────────────────────────────────
  const loadMessages = async () => {
    try {
      await new Promise(r => setTimeout(r, 300));
      const data = await getRoomMessages(session.accessToken, roomId, null, 80);
      applyMessages(data.chunk || []);
      startSync();
    } catch (err) {
      console.warn('[ChatScreen] loadMessages error:', err.message);
    } finally {
      setLoadingInit(false);
    }
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
      console.log('🚀 [SYNC] Initial sync start...');
      const initial = await syncMatrix(session.accessToken, null, 0);
      since = initial.next_batch;
      const joinData = initial.rooms?.join?.[roomIdRef.current];
      const pinEvent = joinData?.state?.events?.find(e => e.type === 'm.room.pinned_events');
      if (pinEvent) setPinnedEvents(pinEvent.content?.pinned || []);
      console.log('✅ [SYNC] Initial sync done');
    } catch (err) {
      console.warn('❌ [SYNC] Initial sync failed:', err.message);
    }

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
                const eid = relate.event_id;
                const key = relate.key;
                if (!newReactions[eid]) newReactions[eid] = {};
                if (!newReactions[eid][key]) newReactions[eid][key] = [];
                if (!newReactions[eid][key].includes(e.sender)) newReactions[eid][key].push(e.sender);
              }
            });
            if (Object.keys(newReactions).length > 0) {
              setReactions(prev => {
                const next = { ...prev };
                Object.keys(newReactions).forEach(eid => {
                  next[eid] = { ...(next[eid] || {}), ...newReactions[eid] };
                });
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
      } catch (err) {
        if (syncActive.current) await new Promise(r => setTimeout(r, 3000));
      }
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
  const openAttach = () => {
    Keyboard.dismiss();
    setTimeout(() => setPanel('attach'), Platform.OS === 'ios' ? 50 : 10);
  };
  const closePanel = () => {
    Keyboard.dismiss();
    setPanel('none');
  };
  const toggleAttach = () => {
    if (panel === 'attach') closePanel();
    else openAttach();
  };

  const highlightMessage = (msgId) => {
    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current);
    setHighlightedMsgId(msgId);
    highlightTimeoutRef.current = setTimeout(() => setHighlightedMsgId(null), 3000);
  };

  // ─── Send text ────────────────────────────────────────────────────────────
  async function handleSend() {
    const text = inputText.trim();
    if (!text || sending) return;
    setSending(true);
    setInputText('');
    const optId = `opt_${Date.now()}`;
    const optimistic = {
      id: optId, sender: session.userId, senderName: session.username, isMe: true,
      msgtype: 'm.text', body: text, mediaUrl: null, ts: Date.now(),
    };
    setMessages(prev => [...prev, optimistic]);
    setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 50);
    try {
      if (replyTo) {
        await sendTextMessage(session.accessToken, roomId, text, {
          txnId: optId,
          'm.relates_to': { 'm.in_reply_to': { event_id: replyTo.id } },
        });
        setReplyTo(null);
      } else {
        await sendTextMessage(session.accessToken, roomId, text, { txnId: optId });
      }
      setMessages(prev => prev.filter(m => m.id !== optId));
    } catch (err) {
      Alert.alert('Send Failed', err.message);
      setMessages(prev => prev.filter(m => m.id !== optId));
      setInputText(text);
    } finally {
      setSending(false);
    }
  }

  // ─── Pick image ───────────────────────────────────────────────────────────
  async function handlePickImage() {
    closePanel();
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo access.'); return; }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setUploading(true);
      const mxcUri = await uploadMedia(session.accessToken, asset.uri, 'image/jpeg', asset.fileName || `photo_${Date.now()}.jpg`);
      await sendImageMessage(session.accessToken, roomId, mxcUri, asset.fileName || 'photo.jpg', asset.width, asset.height);
    } catch (err) {
      Alert.alert('Upload Failed', err.message);
    } finally {
      setUploading(false);
    }
  }

  // ─── Camera photo ─────────────────────────────────────────────────────────
  async function handleCamera() {
    closePanel();
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
    } catch (err) {
      Alert.alert('Upload Failed', err.message);
    } finally {
      setUploading(false);
    }
  }

  // ─── Pick video from gallery ───────────────────────────────────────────────
  async function handlePickVideo() {
    closePanel();
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo access.'); return; }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        videoMaxDuration: 60,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setUploading(true);
      const filename = asset.fileName || `video_${Date.now()}.mp4`;
      const mxcUri = await uploadMedia(session.accessToken, asset.uri, 'video/mp4', filename);
      await sendVideoMessage(session.accessToken, roomId, mxcUri, filename);
    } catch (err) {
      Alert.alert('Upload Failed', err.message);
    } finally {
      setUploading(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ✅ NEW — handleRecordVideo
  // Opens the SYSTEM CAMERA in video mode (like WhatsApp camera → hold record)
  // allowsEditing:true gives the user a preview/trim screen before sending
  // ─────────────────────────────────────────────────────────────────────────
  async function handleRecordVideo() {
    console.log('📹 [RecordVideo] Opening system camera in video mode...');
    closePanel();
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        console.warn('📹 [RecordVideo] Camera permission denied');
        Alert.alert('Permission needed', 'Allow camera access.');
        return;
      }

      console.log('📹 [RecordVideo] Launching camera...');
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        videoMaxDuration: 120,    // 2 minutes max
        allowsEditing: true,      // shows trim/preview screen before sending
        quality: 0.7,
      });

      if (result.canceled) {
        console.log('📹 [RecordVideo] User cancelled');
        return;
      }
      if (!result.assets?.[0]) {
        console.warn('📹 [RecordVideo] No asset returned');
        return;
      }

      const asset = result.assets[0];
      console.log('📹 [RecordVideo] Got video asset:', {
        uri: asset.uri,
        duration: asset.duration,
        fileSize: asset.fileSize,
      });

      setUploading(true);
      const filename = `video_${Date.now()}.mp4`;
      console.log('📹 [RecordVideo] Uploading as:', filename);

      const mxcUri = await uploadMedia(session.accessToken, asset.uri, 'video/mp4', filename);
      console.log('📹 [RecordVideo] Upload done, mxcUri:', mxcUri);

      await sendVideoMessage(session.accessToken, roomId, mxcUri, filename);
      console.log('📹 [RecordVideo] ✅ Video sent successfully');
    } catch (err) {
      console.error('📹 [RecordVideo] ❌ Error:', err.message);
      Alert.alert('Upload Failed', err.message);
    } finally {
      setUploading(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ✅ NEW — handleVideoNoteSend
  // Called by VideoNoteModal when the user stops recording.
  // Uploads the video and sends it with "vidnote:" prefix so the bubble
  // knows to render it as a circle.
  // ─────────────────────────────────────────────────────────────────────────
  async function handleVideoNoteSend(uri) {
    console.log('🔵 [VideoNote] Received recorded URI:', uri);
    setShowVideoNote(false);

    if (!uri) {
      console.warn('🔵 [VideoNote] No URI received, aborting');
      return;
    }

    try {
      setUploading(true);
      const filename = `vnote_${Date.now()}.mp4`;
      console.log('🔵 [VideoNote] Uploading as:', filename);

      const mxcUri = await uploadMedia(session.accessToken, uri, 'video/mp4', filename);
      console.log('🔵 [VideoNote] Upload done, mxcUri:', mxcUri);

      // "vidnote:" prefix tells the bubble renderer to show a circle
      await sendVideoMessage(session.accessToken, roomId, mxcUri, `vidnote:${filename}`);
      console.log('🔵 [VideoNote] ✅ Video note sent successfully');
    } catch (err) {
      console.error('🔵 [VideoNote] ❌ Error:', err.message);
      Alert.alert('Upload Failed', err.message);
    } finally {
      setUploading(false);
    }
  }

  // ─── Pick file ────────────────────────────────────────────────────────────
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
    } catch (err) {
      Alert.alert('Upload Failed', err.message);
    } finally {
      setUploading(false);
    }
  }

  // ─── Audio recording ──────────────────────────────────────────────────────
  async function startRecording() {
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission needed', 'Allow microphone access.'); return; }
      await recorder.prepareToRecordAsync();
      recorder.record();
      setIsRecording(true);
    } catch (err) {
      Alert.alert('Recording Failed', err.message);
    }
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
    } catch (err) {
      Alert.alert('Send Failed', err.message);
    } finally {
      setUploading(false);
    }
  }

  // ─── Location ─────────────────────────────────────────────────────────────
  async function handleShareCurrentLocation() {
    setShowLocationModal(false);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission needed', 'Allow location access.'); return; }
      const loc = await Location.getCurrentPositionAsync({});
      await sendLocationMessage(session.accessToken, roomId, loc.coords.latitude, loc.coords.longitude, 'My Current Location');
    } catch (err) {
      Alert.alert('Error', err.message);
    }
  }

  async function handleShareLiveLocation(durMs) {
    setShowLiveDurationModal(false);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission needed', 'Allow location access.'); return; }
      const loc = await Location.getCurrentPositionAsync({});
      await sendLiveLocationMessage(session.accessToken, roomId, loc.coords.latitude, loc.coords.longitude, durMs);
    } catch (err) {
      Alert.alert('Error', err.message);
    }
  }

  async function handleSharePinLocation() {
    setShowPinModal(false);
    try {
      await sendLocationMessage(session.accessToken, roomId, mapRegion.latitude, mapRegion.longitude, 'Pinned Location');
    } catch (err) {
      Alert.alert('Error', err.message);
    }
  }

  // ─── Misc helpers ─────────────────────────────────────────────────────────
  function handleEmojiSelect(emoji) {
    setInputText(prev => prev + emoji);
    setShowEmojiPicker(false);
  }

  function cancelRecording() {
    recorder?.stop().catch(() => { });
    setIsRecording(false);
  }

  function togglePlayAudio(msg) {
    setPlayingId(playingId === msg.id ? null : msg.id);
  }

  function fmtDuration(ms) {
    if (!ms) return '';
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  }

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

  // ─────────────────────────────────────────────────────────────────────────
  // ✅ CHANGED — ATTACH_ITEMS
  // Added 'video_cam' (Record Video via system camera)
  // Added 'vidnote'   (Video Note — circular in-app recorder)
  // ─────────────────────────────────────────────────────────────────────────
  const ATTACH_ITEMS = [
    { key: 'camera',    icon: 'camera',    label: 'Camera',     color: '#1E40AF', bg: '#DBEAFE' },
    { key: 'video_cam', icon: 'video',     label: 'Record',     color: '#EF4444', bg: '#FEE2E2' }, // ✅ NEW
    { key: 'vidnote',   icon: 'aperture',  label: 'Video Note', color: '#8B5CF6', bg: '#EDE9FE' }, // ✅ NEW
    { key: 'gallery',   icon: 'image',     label: 'Gallery',    color: '#3B82F6', bg: '#EFF6FF' },
    { key: 'video',     icon: 'film',      label: 'Video',      color: '#6366F1', bg: '#E0E7FF' },
    { key: 'document',  icon: 'paperclip', label: 'Document',   color: '#6366F1', bg: '#E0E7FF' },
    { key: 'location',  icon: 'map-pin',   label: 'Location',   color: '#10B981', bg: '#D1FAE5' },
    { key: 'emoji',     icon: 'smile',     label: 'Emoji',      color: '#F59E0B', bg: '#FEF3C7' },
  ];

  // ─────────────────────────────────────────────────────────────────────────
  // ✅ CHANGED — attachHandlers
  // Added handlers for 'video_cam' and 'vidnote'
  // ─────────────────────────────────────────────────────────────────────────
  const attachHandlers = {
    camera:    handleCamera,
    video_cam: handleRecordVideo,                              // ✅ NEW
    vidnote:   () => { closePanel(); setShowVideoNote(true); }, // ✅ NEW
    gallery:   handlePickImage,
    video:     handlePickVideo,
    document:  handlePickFile,
    location:  () => { closePanel(); setShowLocationModal(true); },
    emoji:     () => { closePanel(); setShowEmojiPicker(true); },
  };

  // ─────────────────────────────────────────────────────────────────────────
  // renderMessage
  // ✅ CHANGED — m.video block now checks for "vidnote:" prefix
  //             to show a circular bubble instead of the normal video player
  // ─────────────────────────────────────────────────────────────────────────
  const renderMessage = ({ item: msg, index }) => {
    const time = new Date(msg.ts).toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', hour12: true,
    });
    const isPlaying = playingId === msg.id;
    const prevMsg = index > 0 ? messages[index - 1] : null;
    const showMeta = !prevMsg || prevMsg.sender !== msg.sender;
    const replyMsg = msg.replyToId ? messages.find(m => m.id === msg.replyToId) : null;
    const msgReactions = reactions[msg.id];
    const isHighlighted = highlightedMsgId === msg.id;

    // ✅ NEW — detect video note by body prefix
    const isVideoNote = msg.msgtype === 'm.video' && msg.body?.startsWith('vidnote:');

    return (
      <View style={[styles.msgRow, msg.isMe && styles.msgRowMe]}>
        {!msg.isMe && (
          <View style={styles.avatarWrap}>
            {showMeta ? (
              <View style={styles.avatar}>
                <Text style={styles.avatarTxt}>{msg.senderName.charAt(0).toUpperCase()}</Text>
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
            styles.bubble,
            msg.isMe ? styles.bubbleMe : styles.bubbleThem,
            isHighlighted && styles.bubbleHighlighted,
            // ✅ NEW — transparent bg for video note so circle looks clean
            isVideoNote && styles.bubbleVideoNote,
          ]}
        >
          {!msg.isMe && showMeta && (
            <Text style={styles.senderName}>{msg.senderName}</Text>
          )}

          {replyMsg && (
            <TouchableOpacity
              style={[styles.replyBubble, msg.isMe && styles.replyBubbleMe]}
              onPress={() => {
                const idx = messages.findIndex(m => m.id === msg.replyToId);
                if (idx !== -1) {
                  flatRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
                  highlightMessage(msg.replyToId);
                }
              }}
            >
              <Text style={[styles.replySender, msg.isMe && styles.replySenderMe]}>{replyMsg.senderName}</Text>
              <Text style={[styles.replyBody, msg.isMe && styles.replyBodyMe]} numberOfLines={1}>{replyMsg.body}</Text>
            </TouchableOpacity>
          )}

          {msg.msgtype === 'm.text' && (
            <Text style={[styles.msgText, msg.isMe && styles.msgTextMe]}>{msg.body}</Text>
          )}

          {msg.msgtype === 'm.image' && msg.mediaUrl && (
            <TouchableOpacity
              onPress={() => setFullImage(msg.mediaUrl)}
              onLongPress={() => { setSelectedMessage(msg); setShowActionMenu(true); }}
              activeOpacity={0.9}
            >
              <AuthImage
                uri={msg.mediaUrl}
                accessToken={session.accessToken}
                style={styles.msgImage}
                caption={msg.body !== 'image' ? msg.body : null}
              />
            </TouchableOpacity>
          )}

          {/* ─────────────────────────────────────────────────────────────
              ✅ CHANGED — m.video rendering
              If body starts with "vidnote:" → show circular bubble
              Otherwise → show normal rectangular video player
          ──────────────────────────────────────────────────────────────── */}
          {msg.msgtype === 'm.video' && msg.mediaUrl && (
            isVideoNote ? (
              // ✅ NEW — Circular video note bubble
              <View style={circleVideoStyles.wrap}>
                <AVVideo
                  source={{
                    uri: msg.mediaUrl,
                    headers: { Authorization: `Bearer ${session.accessToken}` },
                  }}
                  useNativeControls
                  resizeMode="cover"
                  style={circleVideoStyles.video}
                />
                {/* Small label below circle */}
                <Text style={circleVideoStyles.label}>Video note</Text>
              </View>
            ) : (
              // Normal video player (unchanged)
              <AuthVideo
                uri={msg.mediaUrl}
                accessToken={session.accessToken}
                filename={msg.body}
                isMe={msg.isMe}
              />
            )
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
            />
          )}

          {msg.msgtype === 'm.file' && (
            <View style={[styles.fileCard, msg.isMe && styles.fileCardMe]}>
              <View style={styles.fileCardIconCircle}>
                <Feather name={getFileIconName(msg.mimeType)} size={22} color={msg.isMe ? '#DBEAFE' : '#1E40AF'} />
              </View>
              <View style={styles.fileCardInfo}>
                <Text style={[styles.fileCardName, msg.isMe && { color: '#DBEAFE' }]} numberOfLines={2}>
                  {msg.filename || msg.body}
                </Text>
                <Text style={[styles.fileCardMeta, msg.isMe && { color: 'rgba(219,234,254,0.65)' }]}>
                  {msg.mimeType?.split('/').pop()?.toUpperCase() || 'FILE'} · {fmtFileSize(msg.fileSize)}
                </Text>
              </View>
            </View>
          )}

          {msg.msgtype === 'm.location' && (
            <View style={styles.locBubble}>
              <MapView
                style={styles.locMap}
                liteMode
                initialRegion={{
                  latitude: parseFloat(msg.geo?.split(':')[1]?.split(',')[0]) || 0,
                  longitude: parseFloat(msg.geo?.split(':')[1]?.split(',')[1]) || 0,
                  latitudeDelta: 0.01,
                  longitudeDelta: 0.01,
                }}
                scrollEnabled={false}
                zoomEnabled={false}
              >
                <Marker coordinate={{
                  latitude: parseFloat(msg.geo?.split(':')[1]?.split(',')[0]) || 0,
                  longitude: parseFloat(msg.geo?.split(':')[1]?.split(',')[1]) || 0,
                }} />
              </MapView>
              <View style={styles.locInfo}>
                <Text style={[styles.locName, msg.isMe && { color: '#fff' }]}>
                  {msg.isLive ? 'Live Location' : 'Shared Location'}
                </Text>
                {msg.isLive && (
                  <Text style={[styles.locSub, msg.isMe && { color: 'rgba(255,255,255,0.7)' }]}>
                    {msg.liveUntil > Date.now() ? 'Active' : 'Expired'}
                  </Text>
                )}
              </View>
            </View>
          )}

          <View style={styles.msgFooter}>
            {msgReactions && (
              <View style={styles.reactionRow}>
                {Object.entries(msgReactions).map(([emoji, users]) => (
                  <TouchableOpacity
                    key={emoji}
                    style={[styles.reactionPill, users.includes(session.userId) && styles.reactionPillActive]}
                    onPress={() => handleReaction(msg.id, emoji)}
                  >
                    <Text style={styles.reactionEmoji}>{emoji}</Text>
                    <Text style={[styles.reactionCount, users.includes(session.userId) && { color: '#1E40AF' }]}>{users.length}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <Text style={[styles.msgTime, msg.isMe && styles.msgTimeMe]}>{time}</Text>
            {msg.isMe && <Ionicons name="checkmark-done" size={13} color="rgba(219,234,254,0.7)" style={{ marginLeft: 4 }} />}
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  // ─── Patient / incidents ──────────────────────────────────────────────────
  const fetchIncidents = async () => {
    try {
      const res = await fetch(`${SERVER_URL}/incidents`);
      const json = await res.json();
      if (json.success && json.data) {
        const match = json.data.find(inc => (inc.matrixRoomId || inc.roomId) === roomId);
        if (match) {
          const data = { name: match.patientName || 'Unknown', address: match.address || '' };
          setPatientData(data);
          const rawCache = await AsyncStorage.getItem('TICKET_NAMES') || '{}';
          const cache = JSON.parse(rawCache);
          cache[roomId] = data;
          await AsyncStorage.setItem('TICKET_NAMES', JSON.stringify(cache));
        }
      }
    } catch (err) {
      console.warn('[ChatScreen] fetchIncidents error:', err.message);
    }
  };

  useEffect(() => {
    if (roomId) {
      AsyncStorage.getItem('TICKET_NAMES').then(raw => {
        if (raw) {
          const cache = JSON.parse(raw);
          if (cache[roomId]) setPatientData(cache[roomId]);
        }
      });
      fetchIncidents();
    }
  }, [roomId]);

  // ─── Loading screen ───────────────────────────────────────────────────────
  if (loadingInit) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color="#1E40AF" />
        <Text style={styles.loaderTxt}>Loading messages…</Text>
      </View>
    );
  }

  const displayTitle = patientData?.name ||
    (currentRoomName?.trim()?.toLowerCase()?.includes('ticket-')
      ? 'Incident Chat'
      : (currentRoomName || (isDispatchRoom ? 'Dispatch Chat' : 'Alert Chat')));

  const subTitle = currentRoomName?.trim()?.toLowerCase()?.includes('ticket-')
    ? currentRoomName
    : (isDispatchRoom ? 'Emergency Control Channel' : 'Incident Communication');

  const showAttach = panel === 'attach';

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      {!hideHeader && (
        <View style={styles.header}>
          <View style={styles.headerTitleWrap}>
            <View style={[styles.avatarSmall, { backgroundColor: '#fff', marginRight: 10 }]}>
              <Text style={{ color: '#1E40AF', fontWeight: 'bold', fontSize: 13 }}>
                {getInitials(displayTitle)}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>{displayTitle}</Text>
              <Text style={styles.headerSub}>{subTitle}</Text>
            </View>
          </View>
          {uploading && <ActivityIndicator size="small" color="#fff" />}
        </View>
      )}

      {/* Pinned banner */}
      {pinnedEvents.length > 0 && (
        <View style={styles.pinnedHeader}>
          <Ionicons name="pin" size={16} color="#1E40AF" />
          <Text style={styles.pinnedTxt} numberOfLines={1}>
            {pinnedEvents.length} Pinned {pinnedEvents.length === 1 ? 'Message' : 'Messages'}
          </Text>
          <TouchableOpacity onPress={() => {
            const idx = messages.findIndex(m => m.id === pinnedEvents[0]);
            if (idx !== -1) {
              flatRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
              highlightMessage(pinnedEvents[0]);
            }
          }}>
            <Text style={styles.pinnedViewBtn}>VIEW</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Message list */}
      <FlatList
        ref={flatRef}
        data={messages}
        keyExtractor={m => m.id}
        renderItem={renderMessage}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={closePanel}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Ionicons name="chatbubbles-outline" size={52} color="#BFDBFE" />
            <Text style={styles.emptyTxt}>No messages yet</Text>
            <Text style={styles.emptySub}>
              {isDispatchRoom
                ? 'Start the conversation with your dispatcher'
                : 'This is your private alert channel'}
            </Text>
          </View>
        }
      />

      {/* Recording bar */}
      {isRecording && (
        <View style={styles.recordingBar}>
          <View style={styles.recordingDot} />
          <Text style={styles.recordingTxt}>Recording… tap stop to send</Text>
          <TouchableOpacity onPress={cancelRecording} style={styles.cancelRecBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={18} color="#94A3B8" />
          </TouchableOpacity>
        </View>
      )}

      {/* Reply preview */}
      {replyTo && (
        <View style={styles.replyPreview}>
          <View style={{ flex: 1 }}>
            <Text style={styles.replyTitle}>Replying to {replyTo.senderName}</Text>
            <Text style={styles.replyText} numberOfLines={1}>{replyTo.body}</Text>
          </View>
          <TouchableOpacity onPress={() => setReplyTo(null)}>
            <Ionicons name="close-circle" size={20} color="#64748B" />
          </TouchableOpacity>
        </View>
      )}

      {/* Mention popup */}
      {mentionOpen && (
        <View style={styles.mentionPopup}>
          {roomMembers
            .filter(m => m.displayName.toLowerCase().includes(mentionSearch.toLowerCase()))
            .map(m => (
              <TouchableOpacity
                key={m.userId}
                style={styles.mentionItem}
                onPress={() => {
                  const parts = inputText.split('@');
                  parts.pop();
                  setInputText(parts.join('@') + '@' + m.displayName + ' ');
                  setMentionOpen(false);
                  inputRef.current?.focus();
                }}
              >
                <View style={styles.mentionAvatar}>
                  <Text style={styles.mentionAvatarTxt}>{m.displayName.charAt(0).toUpperCase()}</Text>
                </View>
                <Text style={styles.mentionName}>{m.displayName}</Text>
              </TouchableOpacity>
            ))}
        </View>
      )}

      {/* Input bar */}
      <View style={styles.whatsappInputBar}>
        <View style={styles.inputContainer}>
          <TouchableOpacity
            style={styles.innerActionBtn}
            onPress={() => { closePanel(); setShowEmojiPicker(true); }}
            disabled={isRecording || uploading}
          >
            <Feather name="smile" size={24} color="#64748B" />
          </TouchableOpacity>

          {!isRecording && (
            <TextInput
              ref={inputRef}
              style={styles.whatsappTextInput}
              placeholder="Message"
              placeholderTextColor="#94A3B8"
              value={inputText}
              onChangeText={(text) => {
                setInputText(text);
                const lastChar = text[text.length - 1];
                if (lastChar === '@') {
                  setMentionOpen(true);
                  setMentionSearch('');
                } else if (mentionOpen) {
                  const parts = text.split('@');
                  const lastPart = parts[parts.length - 1];
                  if (lastPart.includes(' ')) setMentionOpen(false);
                  else setMentionSearch(lastPart);
                }
              }}
              onFocus={() => setPanel('keyboard')}
              multiline
              maxLength={2000}
            />
          )}
          {isRecording && <View style={{ flex: 1 }} />}

          <TouchableOpacity
            style={styles.innerActionBtn}
            onPress={toggleAttach}
            disabled={isRecording || uploading}
          >
            <Feather name="paperclip" size={22} color="#64748B" />
          </TouchableOpacity>

          {!inputText.trim() && (
            <TouchableOpacity
              style={styles.innerActionBtn}
              onPress={handleCamera}
              disabled={isRecording || uploading}
            >
              <Feather name="camera" size={22} color="#64748B" />
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          style={[styles.voiceSendBtn, isRecording && styles.voiceSendBtnRec]}
          onPress={isRecording ? stopRecordingAndSend : (inputText.trim() ? handleSend : startRecording)}
          disabled={uploading}
          activeOpacity={0.8}
        >
          {inputText.trim() ? (
            sending
              ? <ActivityIndicator size="small" color="#fff" />
              : <Ionicons name="send" size={20} color="#fff" />
          ) : (
            <Feather name={isRecording ? 'square' : 'mic'} size={22} color="#fff" />
          )}
        </TouchableOpacity>
      </View>

      {/* Attach grid */}
      {showAttach && !isRecording && (
        <View style={styles.attachMenu}>
          <View style={styles.attachHandle} />
          <View style={styles.attachGrid}>
            {ATTACH_ITEMS.map(item => (
              <TouchableOpacity
                key={item.key}
                style={styles.attachCell}
                onPress={attachHandlers[item.key]}
                activeOpacity={0.75}
              >
                <View style={[styles.attachItemIcon, { backgroundColor: item.bg, borderColor: item.color + '33' }]}>
                  <Feather name={item.icon} size={22} color={item.color} />
                </View>
                <Text style={styles.attachItemLabel}>{item.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* ───────────────────────────────────────────────────────────────────
          ✅ NEW — VideoNoteModal
          Place this INSIDE the KeyboardAvoidingView, alongside other Modals
      ──────────────────────────────────────────────────────────────────── */}
      <VideoNoteModal
        visible={showVideoNote}
        onClose={() => {
          console.log('🔵 [VideoNote] Modal closed without sending');
          setShowVideoNote(false);
        }}
        onSend={handleVideoNoteSend}
      />

      {/* Location modal */}
      <Modal visible={showLocationModal} transparent animationType="fade" onRequestClose={() => setShowLocationModal(false)}>
        <View style={styles.locModalBg}>
          <View style={styles.locModalCard}>
            <TouchableOpacity style={styles.locModalClose} onPress={() => setShowLocationModal(false)}>
              <Ionicons name="close-circle" size={24} color="#CBD5E1" />
            </TouchableOpacity>
            <View style={styles.locModalIconOuter}>
              <View style={styles.locModalIconInner}>
                <Ionicons name="location" size={32} color="#fff" />
              </View>
            </View>
            <Text style={styles.locModalTitle}>What location type do you want to share?</Text>
            <TouchableOpacity style={styles.locOptionBtn} onPress={handleShareCurrentLocation}>
              <View style={[styles.locOptionIcon, { borderColor: '#10B981' }]}>
                <Text style={{ color: '#10B981', fontWeight: 'bold' }}>M</Text>
              </View>
              <Text style={styles.locOptionTxt}>My current location</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.locOptionBtn} onPress={() => { setShowLocationModal(false); setShowLiveDurationModal(true); }}>
              <View style={[styles.locOptionIcon, { backgroundColor: '#8B5CF6' }]}>
                <Ionicons name="wifi" size={18} color="#fff" />
              </View>
              <Text style={styles.locOptionTxt}>My live location</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.locOptionBtn} onPress={() => { setShowLocationModal(false); setShowPinModal(true); }}>
              <View style={[styles.locOptionIcon, { backgroundColor: '#059669' }]}>
                <Ionicons name="location" size={18} color="#fff" />
              </View>
              <Text style={styles.locOptionTxt}>Drop a Pin</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showLiveDurationModal} transparent animationType="fade" onRequestClose={() => setShowLiveDurationModal(false)}>
        <View style={styles.locModalBg}>
          <View style={styles.locModalCard}>
            <Text style={styles.locModalTitle}>Share live location for how long?</Text>
            {[
              { label: '15 Minutes', val: 15 * 60 * 1000 },
              { label: '1 Hour', val: 60 * 60 * 1000 },
              { label: '8 Hours', val: 8 * 60 * 60 * 1000 },
            ].map(dur => (
              <TouchableOpacity key={dur.label} style={styles.locOptionBtn} onPress={() => handleShareLiveLocation(dur.val)}>
                <Text style={styles.locOptionTxtCenter}>{dur.label}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={[styles.locOptionBtn, { marginTop: 10 }]} onPress={() => setShowLiveDurationModal(false)}>
              <Text style={[styles.locOptionTxtCenter, { color: '#EF4444' }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showPinModal} transparent animationType="slide" onRequestClose={() => setShowPinModal(false)}>
        <View style={{ flex: 1 }}>
          <MapView style={{ flex: 1 }} initialRegion={mapRegion} onRegionChangeComplete={setMapRegion}>
            <Marker coordinate={mapRegion} />
          </MapView>
          <View style={styles.pinToolbar}>
            <TouchableOpacity style={styles.pinCancelBtn} onPress={() => setShowPinModal(false)}>
              <Text style={{ color: '#fff' }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.pinConfirmBtn} onPress={handleSharePinLocation}>
              <Text style={{ color: '#fff', fontWeight: 'bold' }}>Share Pinned Location</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.pinCrosshair}>
            <Ionicons name="add" size={30} color="#EF4444" />
          </View>
        </View>
      </Modal>

      <Modal visible={showEmojiPicker} transparent animationType="fade" onRequestClose={() => setShowEmojiPicker(false)}>
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setShowEmojiPicker(false)}>
          <View style={styles.emojiContent}>
            <Text style={styles.emojiTitle}>Select Emoji</Text>
            <View style={styles.emojiGrid}>
              {['😀','😂','😍','👍','🔥','🙏','💯','🚀','❤️','✅','❌','⚠️','🚑','🚨','📞','📍','🏥','🏠','🚶','🏃'].map(e => (
                <TouchableOpacity key={e} style={styles.emojiItem} onPress={() => handleEmojiSelect(e)}>
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
          <View style={styles.fullImageBg}>
            <TouchableOpacity style={styles.fullImageClose} onPress={() => setFullImage(null)}>
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>
            <AuthImage uri={fullImage} accessToken={session.accessToken} style={styles.fullImage} resizeMode="contain" />
          </View>
        </Modal>
      )}

      {/* Action menu */}
      <Modal visible={showActionMenu} transparent animationType="slide" onRequestClose={() => setShowActionMenu(false)}>
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setShowActionMenu(false)}>
          <View style={styles.whatsappActionMenu}>
            <View style={styles.whatsappReactionRow}>
              {['👍','❤️','😂','😮','😢','🔥'].map(emoji => (
                <TouchableOpacity
                  key={emoji}
                  style={styles.whatsappReactionBtn}
                  onPress={async () => {
                    try {
                      await sendReaction(session.accessToken, roomId, selectedMessage.id, emoji);
                    } catch (err) { Alert.alert('Error', err.message); }
                    setShowActionMenu(false);
                  }}
                >
                  <Text style={{ fontSize: 28 }}>{emoji}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.whatsappReactionBtn}>
                <Ionicons name="add-circle-outline" size={30} color="#64748B" />
              </TouchableOpacity>
            </View>

            <View style={styles.whatsappActionList}>
              <TouchableOpacity
                style={styles.whatsappActionItem}
                onPress={() => { setReplyTo(selectedMessage); setShowActionMenu(false); inputRef.current?.focus(); }}
              >
                <Ionicons name="arrow-undo-outline" size={24} color="#1E40AF" />
                <Text style={styles.whatsappActionText}>Reply</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.whatsappActionItem}
                onPress={async () => {
                  try {
                    const nextPins = await pinMessage(session.accessToken, roomId, selectedMessage.id);
                    setPinnedEvents(nextPins);
                  } catch (err) { Alert.alert('Error', err.message); }
                  setShowActionMenu(false);
                }}
              >
                <Ionicons name={pinnedEvents.includes(selectedMessage?.id) ? 'pin-off' : 'pin'} size={24} color="#1E40AF" />
                <Text style={styles.whatsappActionText}>
                  {pinnedEvents.includes(selectedMessage?.id) ? 'Unpin Message' : 'Pin Message'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.whatsappActionItem}
                onPress={async () => {
                  setForwardMsg(selectedMessage);
                  setShowActionMenu(false);
                  setShowForwardModal(true);
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
                <Ionicons name="share-outline" size={24} color="#1E40AF" />
                <Text style={styles.whatsappActionText}>Forward</Text>
              </TouchableOpacity>

              {selectedMessage?.msgtype === 'm.file' && (
                <TouchableOpacity
                  style={styles.whatsappActionItem}
                  onPress={() => { Alert.alert('Download', 'File download started'); setShowActionMenu(false); }}
                >
                  <Ionicons name="download-outline" size={24} color="#1E40AF" />
                  <Text style={styles.whatsappActionText}>Download File</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Forward modal */}
      <Modal visible={showForwardModal} transparent animationType="slide" onRequestClose={() => setShowForwardModal(false)}>
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setShowForwardModal(false)}>
          <View style={styles.whatsappActionMenu}>
            <View style={{ padding: 16, borderBottomWidth: 0.5, borderBottomColor: '#E2E8F0' }}>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#0F172A' }}>Forward to...</Text>
            </View>
            <ScrollView style={{ maxHeight: 400 }}>
              {joinedRooms.map(r => (
                <TouchableOpacity
                  key={r.id}
                  style={{ padding: 16, borderBottomWidth: 0.5, borderBottomColor: '#F1F5F9' }}
                  onPress={async () => {
                    try {
                      await forwardMessage(session.accessToken, r.id, forwardMsg);
                      setShowForwardModal(false);
                      Alert.alert('Success', `Forwarded to ${r.name}`);
                    } catch (err) { Alert.alert('Error', err.message); }
                  }}
                >
                  <Text style={{ fontSize: 16, color: '#0F172A' }}>{r.name}</Text>
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
// ✅ NEW — VideoNoteModal
// A circular in-app camera recorder. Works exactly like WhatsApp video notes:
//   • Shows circular live preview
//   • Tap record button to start
//   • Tap again (or release) to stop & send
//   • Red progress ring counts up to 60 seconds
//
// WHERE TO PLACE THIS: At the bottom of the file, after the ChatScreen export,
// alongside AuthImage / AuthVideo / AuthAudio components.
// ─────────────────────────────────────────────────────────────────────────────
function VideoNoteModal({ visible, onClose, onSend }) {
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const [micPerm, requestMicPerm] = useMicrophonePermissions();
  const [isRecording, setIsRecording] = useState(false);
  const [progress, setProgress] = useState(0);
  const cameraRef = useRef(null);
  const timerRef = useRef(null);
  const MAX_DURATION = 60; // seconds
  const CIRCLE_SIZE = 220;
  const RADIUS = (CIRCLE_SIZE - 8) / 2;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

  // Request permissions when modal opens
  useEffect(() => {
    if (visible) {
      console.log('🔵 [VideoNoteModal] Opened — requesting permissions...');
      requestCamPerm().then(r => console.log('🔵 [VideoNoteModal] Camera perm:', r.status));
      requestMicPerm().then(r => console.log('🔵 [VideoNoteModal] Mic perm:', r.status));
      setProgress(0);
      setIsRecording(false);
    }
    return () => {
      clearInterval(timerRef.current);
    };
  }, [visible]);

  async function startRecording() {
    if (!cameraRef.current) {
      console.warn('🔵 [VideoNoteModal] Camera ref not ready');
      return;
    }
    if (!camPerm?.granted || !micPerm?.granted) {
      console.warn('🔵 [VideoNoteModal] Permissions not granted');
      Alert.alert('Permission needed', 'Allow camera and microphone access.');
      return;
    }

    console.log('🔵 [VideoNoteModal] Starting recording...');
    setIsRecording(true);
    setProgress(0);

    let elapsed = 0;
    timerRef.current = setInterval(() => {
      elapsed += 0.1;
      const p = elapsed / MAX_DURATION;
      setProgress(p);
      if (elapsed >= MAX_DURATION) {
        console.log('🔵 [VideoNoteModal] Max duration reached, stopping...');
        stopRecording();
      }
    }, 100);

    try {
      // recordAsync resolves when stopRecording() is called
      const video = await cameraRef.current.recordAsync({ maxDuration: MAX_DURATION });
      console.log('🔵 [VideoNoteModal] Recording done. URI:', video?.uri);
      if (video?.uri) {
        onSend(video.uri);
      }
    } catch (err) {
      console.error('🔵 [VideoNoteModal] recordAsync error:', err.message);
      // Don't show alert — user may have just cancelled
    }
  }

  async function stopRecording() {
    console.log('🔵 [VideoNoteModal] stopRecording called');
    clearInterval(timerRef.current);
    setIsRecording(false);
    try {
      cameraRef.current?.stopRecording();
    } catch (err) {
      console.warn('🔵 [VideoNoteModal] stopRecording error:', err.message);
    }
    onClose();
  }

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={vidNoteStyles.overlay}>
        <View style={vidNoteStyles.container}>

          {/* ── Circular camera preview with progress ring ── */}
          <View style={vidNoteStyles.circleWrap}>
            {camPerm?.granted && micPerm?.granted ? (
              <CameraView
                ref={cameraRef}
                style={vidNoteStyles.camera}
                facing="front"
                mode="video"
              />
            ) : (
              <View style={[vidNoteStyles.camera, vidNoteStyles.permPlaceholder]}>
                <Ionicons name="camera-outline" size={32} color="#94A3B8" />
                <Text style={vidNoteStyles.permText}>Camera permission needed</Text>
              </View>
            )}

            {/* Progress ring using react-native-svg */}
            {isRecording && (
              <Svg
                style={StyleSheet.absoluteFill}
                width={CIRCLE_SIZE}
                height={CIRCLE_SIZE}
              >
                {/* Background ring */}
                <Circle
                  cx={CIRCLE_SIZE / 2}
                  cy={CIRCLE_SIZE / 2}
                  r={RADIUS}
                  stroke="rgba(255,255,255,0.2)"
                  strokeWidth={4}
                  fill="none"
                />
                {/* Progress ring */}
                <Circle
                  cx={CIRCLE_SIZE / 2}
                  cy={CIRCLE_SIZE / 2}
                  r={RADIUS}
                  stroke="#EF4444"
                  strokeWidth={4}
                  fill="none"
                  strokeDasharray={CIRCUMFERENCE}
                  strokeDashoffset={CIRCUMFERENCE * (1 - progress)}
                  strokeLinecap="round"
                  transform={`rotate(-90 ${CIRCLE_SIZE / 2} ${CIRCLE_SIZE / 2})`}
                />
              </Svg>
            )}

            {/* Recording indicator dot */}
            {isRecording && (
              <View style={vidNoteStyles.recIndicator}>
                <View style={vidNoteStyles.recDotSmall} />
              </View>
            )}
          </View>

          {/* Duration text */}
          {isRecording && (
            <Text style={vidNoteStyles.durationText}>
              {Math.min(Math.round(progress * MAX_DURATION), MAX_DURATION)}s / {MAX_DURATION}s
            </Text>
          )}

          {/* Record / Stop button */}
          <TouchableOpacity
            style={[
              vidNoteStyles.recordBtn,
              isRecording && vidNoteStyles.recordBtnActive,
            ]}
            onPress={isRecording ? stopRecording : startRecording}
            activeOpacity={0.8}
          >
            {isRecording
              ? <View style={vidNoteStyles.stopIcon} />
              : <View style={vidNoteStyles.recDot} />
            }
          </TouchableOpacity>

          <Text style={vidNoteStyles.hint}>
            {isRecording ? 'Tap to stop & send' : 'Tap to record'}
          </Text>

          {/* Cancel button */}
          <TouchableOpacity onPress={onClose} style={vidNoteStyles.cancelBtn}>
            <Ionicons name="close" size={22} color="#94A3B8" />
            <Text style={vidNoteStyles.cancelTxt}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH COMPONENTS (unchanged from original)
// ─────────────────────────────────────────────────────────────────────────────
function AuthImage({ uri, accessToken, style, resizeMode = 'cover' }) {
  if (!uri) return (
    <View style={[style, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#DBEAFE' }]}>
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

function AuthVideo({ uri, accessToken, filename, isMe }) {
  return (
    <View style={[videoStyles.container, isMe && videoStyles.containerMe]}>
      <AVVideo
        source={{ uri, headers: { Authorization: `Bearer ${accessToken}` } }}
        useNativeControls
        resizeMode="contain"
        isLooping={false}
        style={videoStyles.video}
      />
    </View>
  );
}

function AuthAudio({ uri, accessToken, isPlaying, onToggle, onFinish, isMe, duration: initialDuration }) {
  const player = useAudioPlayer({
    uri,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const [pos, setPos] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);
  const [loadedDuration, setLoadedDuration] = useState(initialDuration || 0);

  useEffect(() => {
    if (player.duration > 0 && !loadedDuration) setLoadedDuration(player.duration);
  }, [player.duration]);

  useEffect(() => {
    if (isPlaying) player.play();
    else player.pause();
  }, [isPlaying, player]);

  useEffect(() => {
    const unsubFinish = player.addListener('playToEnd', () => { onFinish(); setPos(0); });
    const interval = setInterval(() => {
      if (!isSeeking && isPlaying) setPos(player.currentTime);
    }, 500);
    return () => { unsubFinish.remove(); clearInterval(interval); };
  }, [player, onFinish, isPlaying, isSeeking]);

  function fmtD(ms) {
    if (!ms) return '0:00';
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  }

  const duration = loadedDuration || player.duration || initialDuration || 0;

  return (
    <View style={[styles.audioBubble, isMe ? styles.audioBubbleMe : styles.audioBubbleThem]}>
      <View style={styles.audioTopRow}>
        <TouchableOpacity
          style={[styles.audioPlayBtn, isPlaying && (isMe ? styles.audioPlayBtnActiveMe : styles.audioPlayBtnActive)]}
          onPress={onToggle}
          activeOpacity={0.7}
        >
          <Ionicons name={isPlaying ? 'pause' : 'play'} size={22} color={isPlaying ? '#fff' : '#1E40AF'} />
        </TouchableOpacity>
        <View style={styles.audioSeekWrap}>
          <Slider
            style={styles.audioSlider}
            minimumValue={0}
            maximumValue={duration > 0 ? duration : 100}
            value={pos}
            onSlidingStart={() => setIsSeeking(true)}
            onSlidingComplete={(val) => { player.seekTo(val); setPos(val); setIsSeeking(false); }}
            minimumTrackTintColor={isMe ? '#DBEAFE' : '#1E40AF'}
            maximumTrackTintColor={isMe ? 'rgba(219,234,254,0.3)' : 'rgba(30,64,175,0.1)'}
            thumbTintColor={isMe ? '#fff' : '#1E40AF'}
          />
        </View>
      </View>
      <View style={styles.audioMetaRow}>
        <Text style={[styles.audioTimeTxt, isMe && styles.audioTimeTxtMe]}>
          {fmtD(pos)} / {fmtD(duration)}
        </Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER
// ─────────────────────────────────────────────────────────────────────────────
function getInitials(name = '') {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────
const videoStyles = StyleSheet.create({
  container: { width: 260, overflow: 'hidden', borderRadius: 12, backgroundColor: '#DBEAFE', marginBottom: 2 },
  containerMe: { backgroundColor: 'rgba(255,255,255,0.1)' },
  video: { width: 260, height: 195 },
});

// ✅ NEW — Circular video note bubble styles
const circleVideoStyles = StyleSheet.create({
  wrap: {
    width: 160,
    height: 160,
    borderRadius: 80,
    overflow: 'hidden',
    backgroundColor: '#0F172A',
    marginBottom: 4,
  },
  video: { width: 160, height: 160 },
  label: {
    fontSize: 11,
    color: '#94A3B8',
    textAlign: 'center',
    marginTop: 4,
  },
});

// ✅ NEW — VideoNoteModal styles
const vidNoteStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.82)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: { alignItems: 'center', gap: 18 },
  circleWrap: {
    width: 220,
    height: 220,
    borderRadius: 110,
    overflow: 'hidden',
    backgroundColor: '#1E293B',
  },
  camera: { width: 220, height: 220 },
  permPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  permText: { color: '#94A3B8', fontSize: 12, textAlign: 'center', paddingHorizontal: 20 },
  recIndicator: {
    position: 'absolute',
    top: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  recDotSmall: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
  },
  durationText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    marginTop: -8,
  },
  recordBtn: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#EF4444',
  },
  recordBtnActive: { backgroundColor: '#FEE2E2' },
  recDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#EF4444',
  },
  stopIcon: {
    width: 22,
    height: 22,
    borderRadius: 5,
    backgroundColor: '#EF4444',
  },
  hint: { color: 'rgba(255,255,255,0.7)', fontSize: 13 },
  cancelBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10 },
  cancelTxt: { color: '#94A3B8', fontSize: 14 },
});

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#EEF2F7' },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8FAFF', gap: 12 },
  loaderTxt: { color: '#64748B', fontSize: 14 },

  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1E40AF',
    paddingHorizontal: 16, paddingVertical: 14, gap: 10,
  },
  headerTitleWrap: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  avatarSmall: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 15, fontWeight: '700', color: '#fff' },
  headerSub: { fontSize: 11, color: 'rgba(255,255,255,0.65)' },

  list: { padding: 14, paddingBottom: 10 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 10 },
  emptyTxt: { fontSize: 16, color: '#475569', fontWeight: '600' },
  emptySub: { fontSize: 13, color: '#94A3B8', textAlign: 'center', paddingHorizontal: 30 },

  msgRow: { flexDirection: 'row', marginBottom: 4, alignItems: 'flex-end' },
  msgRowMe: { flexDirection: 'row-reverse' },
  avatarWrap: { marginRight: 6 },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#DBEAFE', alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { color: '#1E40AF', fontSize: 13, fontWeight: '700' },

  bubble: { maxWidth: '76%', borderRadius: 18, paddingHorizontal: 13, paddingTop: 9, paddingBottom: 7 },
  bubbleThem: { backgroundColor: '#fff', borderBottomLeftRadius: 4, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  bubbleMe: { backgroundColor: '#1E40AF', borderBottomRightRadius: 4, marginRight: 4 },
  bubbleHighlighted: { backgroundColor: '#FEF9C3', borderColor: '#FDE047', borderWidth: 1 },
  // ✅ NEW — transparent background for video note bubble
  bubbleVideoNote: { backgroundColor: 'transparent', paddingHorizontal: 4, paddingVertical: 4 },

  senderName: { fontSize: 11, color: '#1E40AF', fontWeight: '700', marginBottom: 4 },
  msgText: { fontSize: 15, color: '#0F172A', lineHeight: 21 },
  msgTextMe: { color: '#EFF6FF' },
  msgImage: { width: 260, height: 195, borderRadius: 12, marginBottom: 4 },
  msgFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 4 },
  msgTime: { fontSize: 10, color: '#94A3B8' },
  msgTimeMe: { color: 'rgba(219,234,254,0.7)' },

  audioBubble: { width: 260, padding: 10 },
  audioBubbleMe: {},
  audioBubbleThem: {},
  audioTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  audioSeekWrap: { flex: 1, height: 48, justifyContent: 'center' },
  audioSlider: { width: '100%', height: 48 },
  audioMetaRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: -4, marginRight: 4 },
  audioTimeTxt: { fontSize: 10, color: '#64748B' },
  audioTimeTxtMe: { color: 'rgba(219,234,254,0.75)' },
  audioPlayBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#DBEAFE', alignItems: 'center', justifyContent: 'center' },
  audioPlayBtnActive: { backgroundColor: '#1E40AF' },
  audioPlayBtnActiveMe: { backgroundColor: 'rgba(255,255,255,0.3)' },

  fileCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#EFF6FF', borderRadius: 12, padding: 12, minWidth: 170, borderWidth: 0.5, borderColor: '#BFDBFE' },
  fileCardMe: { backgroundColor: 'rgba(255,255,255,0.15)', borderColor: 'rgba(255,255,255,0.2)' },
  fileCardIconCircle: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#DBEAFE', alignItems: 'center', justifyContent: 'center' },
  fileCardInfo: { flex: 1 },
  fileCardName: { fontSize: 13, fontWeight: '600', color: '#1E3A8A', lineHeight: 18 },
  fileCardMeta: { fontSize: 11, color: '#64748B', marginTop: 2 },

  recordingBar: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#FFF7ED', paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#FED7AA' },
  recordingDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#EF4444' },
  recordingTxt: { flex: 1, fontSize: 13, color: '#92400E', fontWeight: '600' },
  cancelRecBtn: { padding: 4 },

  attachMenu: { backgroundColor: '#fff', borderTopWidth: 0.5, borderTopColor: '#E2E8F0', paddingTop: 8, paddingBottom: Platform.OS === 'ios' ? 28 : 16, paddingHorizontal: 4 },
  attachHandle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: '#CBD5E1', marginBottom: 12 },
  attachGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  attachCell: { width: '33.33%', alignItems: 'center', paddingVertical: 12, gap: 6 },
  attachItemIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', borderWidth: 0.5, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  attachItemLabel: { fontSize: 11, color: '#64748B', fontWeight: '600' },

  whatsappInputBar: { flexDirection: 'row', alignItems: 'flex-end', padding: 8, paddingBottom: Platform.OS === 'ios' ? 26 : 12, gap: 6 },
  inputContainer: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', backgroundColor: '#fff', borderRadius: 25, paddingHorizontal: 8, paddingVertical: 4, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 3, elevation: 2 },
  whatsappTextInput: { flex: 1, maxHeight: 120, minHeight: 40, fontSize: 16, color: '#0F172A', paddingHorizontal: 8, paddingVertical: 8 },
  innerActionBtn: { padding: 8 },
  voiceSendBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#1E40AF', alignItems: 'center', justifyContent: 'center', shadowColor: '#1E40AF', shadowOpacity: 0.3, shadowRadius: 6, elevation: 3 },
  voiceSendBtnRec: { backgroundColor: '#EF4444' },

  fullImageBg: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  fullImageClose: { position: 'absolute', top: 50, right: 20, zIndex: 10, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, padding: 4 },
  fullImage: { width: '100%', height: '80%' },

  locBubble: { width: 260, borderRadius: 12, overflow: 'hidden', backgroundColor: '#DBEAFE', marginBottom: 2 },
  locMap: { width: 260, height: 140 },
  locInfo: { padding: 8 },
  locName: { fontSize: 13, fontWeight: '700', color: '#1E3A8A' },
  locSub: { fontSize: 11, color: '#64748B' },

  menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },

  locModalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  locModalCard: { backgroundColor: '#fff', width: '85%', borderRadius: 20, padding: 25, alignItems: 'center' },
  locModalClose: { position: 'absolute', top: 15, right: 15 },
  locModalIconOuter: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#047857', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  locModalIconInner: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#047857', alignItems: 'center', justifyContent: 'center' },
  locModalTitle: { fontSize: 18, fontWeight: '700', color: '#1E293B', textAlign: 'center', marginBottom: 25, lineHeight: 26 },
  locOptionBtn: { flexDirection: 'row', alignItems: 'center', width: '100%', padding: 12, borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, marginBottom: 12 },
  locOptionIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginRight: 15, borderWidth: 2, borderColor: 'transparent' },
  locOptionTxt: { fontSize: 15, color: '#475569', fontWeight: '500' },
  locOptionTxtCenter: { fontSize: 16, color: '#475569', fontWeight: '600', textAlign: 'center', width: '100%' },

  pinToolbar: { position: 'absolute', bottom: 40, left: 20, right: 20, flexDirection: 'row', gap: 10 },
  pinCancelBtn: { flex: 1, backgroundColor: '#64748B', padding: 15, borderRadius: 12, alignItems: 'center' },
  pinConfirmBtn: { flex: 2, backgroundColor: '#10B981', padding: 15, borderRadius: 12, alignItems: 'center' },
  pinCrosshair: { position: 'absolute', top: '50%', left: '50%', marginTop: -35, marginLeft: -15 },

  emojiContent: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, height: 350 },
  emojiTitle: { fontSize: 16, fontWeight: '700', color: '#1E293B', marginBottom: 15 },
  emojiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 15, justifyContent: 'center' },
  emojiItem: { width: 50, height: 50, alignItems: 'center', justifyContent: 'center' },

  replyPreview: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 10, borderTopWidth: 0.5, borderTopColor: '#E2E8F0', borderLeftWidth: 4, borderLeftColor: '#1E40AF' },
  replyTitle: { fontSize: 11, fontWeight: '700', color: '#1E40AF', marginBottom: 2 },
  replyText: { fontSize: 13, color: '#64748B' },

  mentionPopup: { backgroundColor: '#fff', borderTopWidth: 0.5, borderTopColor: '#E2E8F0', maxHeight: 200 },
  mentionItem: { flexDirection: 'row', alignItems: 'center', padding: 10, borderBottomWidth: 0.5, borderBottomColor: '#F1F5F9' },
  mentionAvatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#DBEAFE', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  mentionAvatarTxt: { color: '#1E40AF', fontSize: 12, fontWeight: '700' },
  mentionName: { fontSize: 14, color: '#0F172A', fontWeight: '500' },

  replyBubble: { backgroundColor: 'rgba(0,0,0,0.05)', borderLeftWidth: 3, borderLeftColor: '#1E40AF', padding: 6, borderRadius: 4, marginBottom: 6 },
  replySender: { fontSize: 11, fontWeight: '700', color: '#1E40AF', marginBottom: 2 },
  replyBody: { fontSize: 12, color: '#475569' },
  replyBubbleMe: { backgroundColor: 'rgba(255,255,255,0.15)', borderLeftColor: '#DBEAFE' },
  replySenderMe: { color: '#DBEAFE' },
  replyBodyMe: { color: 'rgba(219,234,254,0.8)' },

  reactionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginRight: 8 },
  reactionPill: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1 },
  reactionPillActive: { backgroundColor: '#DBEAFE', borderColor: '#1E40AF', borderWidth: 0.5 },
  reactionEmoji: { fontSize: 10 },
  reactionCount: { fontSize: 10, fontWeight: '600', color: '#64748B' },

  pinnedHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: '#E2E8F0' },
  pinnedTxt: { flex: 1, fontSize: 13, color: '#1E293B', fontWeight: '500' },
  pinnedViewBtn: { fontSize: 12, fontWeight: '700', color: '#1E40AF' },

  whatsappActionMenu: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 12, paddingBottom: Platform.OS === 'ios' ? 34 : 20 },
  whatsappReactionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: '#F1F5F9' },
  whatsappReactionBtn: { padding: 4 },
  whatsappActionList: { paddingHorizontal: 16, paddingTop: 8 },
  whatsappActionItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 16 },
  whatsappActionText: { fontSize: 16, color: '#0F172A', fontWeight: '400' },
});