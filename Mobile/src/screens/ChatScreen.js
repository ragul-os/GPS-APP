import Slider from '@react-native-community/slider';
import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useAudioPlayer, AudioModule } from 'expo-audio';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import MapView, { Marker } from 'react-native-maps';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { DISPATCH_ROOM_ID, useAuth } from '../context/AuthContext';
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
} from '../services/matrixService';

export default function ChatScreen({ roomId: propRoomId, roomLabel, hideHeader = false }) {
  const { session } = useAuth();

  const roomId = (propRoomId && propRoomId.trim() !== '') ? propRoomId : DISPATCH_ROOM_ID;
  const isDispatchRoom = roomId === DISPATCH_ROOM_ID;

  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loadingInit, setLoadingInit] = useState(true);
  const [recording, setRecording] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [playingId, setPlayingId] = useState(null);
  const [showAttach, setShowAttach] = useState(false);
  const [fullImage, setFullImage] = useState(null);
  const [showLocationModal, setShowLocationModal] = useState(false);
  const [showLiveDurationModal, setShowLiveDurationModal] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [mapRegion, setMapRegion] = useState({ latitude: 12.9716, longitude: 77.5946, latitudeDelta: 0.01, longitudeDelta: 0.01 });

  const flatRef = useRef(null);
  const syncActive = useRef(true);
  const soundRef = useRef(null);
  const roomIdRef = useRef(roomId);

  useEffect(() => { roomIdRef.current = roomId; }, [roomId]);

  useEffect(() => {
    syncActive.current = true;
    setMessages([]);
    setLoadingInit(true);
    loadMessages();
    return () => {
      syncActive.current = false;
    };
  }, [roomId]);

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

  const startSync = useCallback(async () => {
    let since = null;
    try {
      const initial = await syncMatrix(session.accessToken, null, 0);
      since = initial.next_batch;
    } catch { }

    while (syncActive.current) {
      try {
        const data = await syncMatrix(session.accessToken, since, 10000);
        since = data.next_batch;
        const cur = roomIdRef.current;
        const roomData = data.rooms?.join?.[cur];
        if (roomData?.timeline?.events) {
          const newMsgs = roomData.timeline.events.filter(e => e.type === 'm.room.message').map(parseEvent);
          if (newMsgs.length > 0) {
            setMessages(prev => {
              const ids = new Set(prev.map(m => m.id));
              const incoming = newMsgs.filter(m => !ids.has(m.id));
              if (!incoming.length) return prev;
              const filtered = prev.filter(p => {
                if (!p.id.startsWith('opt_')) return true;
                return !incoming.some(i => i.body === p.body && i.sender === p.sender);
              });
              return [...filtered, ...incoming];
            });
            setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
          }
        }
      } catch {
        if (syncActive.current) await new Promise(r => setTimeout(r, 3000));
      }
    }
  }, [session.accessToken, roomId]);

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
      geo: content.geo_uri || content["org.matrix.msc3488.location"]?.uri || null,
      isLive: content.is_live || false,
      liveUntil: content.live_until || 0,
    };
  }

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
      await sendTextMessage(session.accessToken, roomId, text);
      setMessages(prev => prev.filter(m => m.id !== optId));
    } catch (err) {
      Alert.alert('Send Failed', err.message);
      setMessages(prev => prev.filter(m => m.id !== optId));
      setInputText(text);
    } finally {
      setSending(false);
    }
  }

  async function handlePickImage() {
    setShowAttach(false);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo access.'); return; }
      const result = await ImagePicker.launchImageLibraryAsync({ 
        mediaTypes: ImagePicker.MediaType.Images, 
        quality: 0.8 
      });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setUploading(true);
      const mxcUri = await uploadMedia(session.accessToken, asset.uri, 'image/jpeg', asset.fileName || `photo_${Date.now()}.jpg`);
      await sendImageMessage(session.accessToken, roomId, mxcUri, asset.fileName || 'photo.jpg', asset.width, asset.height);
    } catch (err) { Alert.alert('Upload Failed', err.message); }
    finally { setUploading(false); }
  }

  async function handleCamera() {
    setShowAttach(false);
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

  async function handlePickVideo() {
    setShowAttach(false);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission needed', 'Allow photo access.'); return; }
      const result = await ImagePicker.launchImageLibraryAsync({ 
        mediaTypes: ImagePicker.MediaType.Videos, 
        videoMaxDuration: 60 
      });
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
    setShowAttach(false);
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

  async function startRecording() {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission needed', 'Allow microphone access.'); return; }
      
      const audioRecorder = new AudioModule.Recording();
      await audioRecorder.prepare({
        android: {
          extension: '.m4a',
          outputFormat: AudioModule.AndroidOutputFormat.MPEG_4,
          audioEncoder: AudioModule.AndroidAudioEncoder.AAC,
        },
        ios: {
          extension: '.m4a',
          outputFormat: AudioModule.IOSOutputFormat.MPEG4AAC,
          audioQuality: AudioModule.IOSAudioQuality.HIGH,
        },
      });
      audioRecorder.start();
      setRecording(audioRecorder);
      setIsRecording(true);
    } catch (err) { Alert.alert('Recording Failed', err.message); }
  }

  async function stopRecordingAndSend() {
    if (!recording) return;
    setIsRecording(false);
    try {
      await recording.stop();
      const uri = recording.getURI();
      const status = recording.getStatus();
      const duration = Math.round(status.durationMillis || 0);
      setRecording(null);
      if (!uri) return;
      setUploading(true);
      const filename = `voice_${Date.now()}.m4a`;
      const mxcUri = await uploadMedia(session.accessToken, uri, 'audio/m4a', filename);
      await sendAudioMessage(session.accessToken, roomId, mxcUri, filename, duration);
    } catch (err) { Alert.alert('Send Failed', err.message); setRecording(null); }
    finally { setUploading(false); }
  }

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
    try {
      await sendLocationMessage(session.accessToken, roomId, mapRegion.latitude, mapRegion.longitude, 'Pinned Location');
    } catch (err) { Alert.alert('Error', err.message); }
  }

  function handleEmojiSelect(emoji) {
    setInputText(prev => prev + emoji);
    setShowEmojiPicker(false);
  }

  function cancelRecording() {
    recording?.stopAndUnloadAsync().catch(() => { });
    setRecording(null);
    setIsRecording(false);
  }

  function togglePlayAudio(msg) {
    if (playingId === msg.id) {
      setPlayingId(null);
    } else {
      setPlayingId(msg.id);
    }
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

  const renderMessage = ({ item: msg, index }) => {
    const time = new Date(msg.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    const isPlaying = playingId === msg.id;
    const prevMsg = index > 0 ? messages[index - 1] : null;
    const showMeta = !prevMsg || prevMsg.sender !== msg.sender;

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

        <View style={[styles.bubble, msg.isMe ? styles.bubbleMe : styles.bubbleThem]}>
          {!msg.isMe && showMeta && (
            <Text style={styles.senderName}>{msg.senderName}</Text>
          )}

          {msg.msgtype === 'm.text' && (
            <Text style={[styles.msgText, msg.isMe && styles.msgTextMe]}>{msg.body}</Text>
          )}

          {msg.msgtype === 'm.image' && msg.mediaUrl && (
            <TouchableOpacity onPress={() => setFullImage(msg.mediaUrl)} activeOpacity={0.9}>
              <AuthImage
                uri={msg.mediaUrl}
                accessToken={session.accessToken}
                style={styles.msgImage}
                caption={msg.body !== 'image' ? msg.body : null}
              />
            </TouchableOpacity>
          )}

          {msg.msgtype === 'm.video' && msg.mediaUrl && (
            <AuthVideo
              uri={msg.mediaUrl}
              accessToken={session.accessToken}
              filename={msg.body}
              isMe={msg.isMe}
            />
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
                <Marker
                  coordinate={{
                    latitude: parseFloat(msg.geo?.split(':')[1]?.split(',')[0]) || 0,
                    longitude: parseFloat(msg.geo?.split(':')[1]?.split(',')[1]) || 0,
                  }}
                />
              </MapView>
              <View style={styles.locInfo}>
                <Text style={[styles.locName, msg.isMe && { color: '#fff' }]}>{msg.isLive ? 'Live Location' : 'Shared Location'}</Text>
                {msg.isLive && (
                  <Text style={[styles.locSub, msg.isMe && { color: 'rgba(255,255,255,0.7)' }]}>
                    {msg.liveUntil > Date.now() ? 'Active' : 'Expired'}
                  </Text>
                )}
              </View>
            </View>
          )}

          <View style={styles.msgFooter}>
            <Text style={[styles.msgTime, msg.isMe && styles.msgTimeMe]}>{time}</Text>
            {msg.isMe && <Ionicons name="checkmark-done" size={13} color="rgba(219,234,254,0.7)" style={{ marginLeft: 4 }} />}
          </View>
        </View>
      </View>
    );
  };

  if (loadingInit) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color="#1E40AF" />
        <Text style={styles.loaderTxt}>Loading messages…</Text>
      </View>
    );
  }

  const AttachMenu = () => (
    <View style={styles.attachMenu}>
      {[
        { icon: 'camera', label: 'Camera', onPress: handleCamera, lib: 'Feather', color: '#1E40AF' },
        { icon: 'image', label: 'Gallery', onPress: handlePickImage, lib: 'Feather', color: '#3B82F6' },
        { icon: 'video', label: 'Video', onPress: handlePickVideo, lib: 'Feather', color: '#8B5CF6' },
        { icon: 'paperclip', label: 'Document', onPress: handlePickFile, lib: 'Feather', color: '#6366F1' },
        { icon: 'map-pin', label: 'Location', onPress: () => { setShowAttach(false); setShowLocationModal(true); }, lib: 'Feather', color: '#10B981' },
        { icon: 'smile', label: 'Emoji', onPress: () => { setShowAttach(false); setShowEmojiPicker(true); }, lib: 'Feather', color: '#F59E0B' },
      ].map(item => (
        <TouchableOpacity
          key={item.label}
          style={styles.attachItem}
          onPress={item.onPress}
          activeOpacity={0.75}
        >
          <View style={[styles.attachItemIcon, { borderColor: item.color + '33' }]}>
            <Feather name={item.icon} size={22} color={item.color} />
          </View>
          <Text style={styles.attachItemLabel}>{item.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );

  const headerTitle = roomLabel || (isDispatchRoom ? 'Dispatch Chat' : 'Alert Chat');

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 20}
    >
      {!hideHeader && (
        <View style={styles.header}>
          <View style={[styles.headerStatusDot, !isDispatchRoom && { backgroundColor: '#F59E0B' }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>{headerTitle}</Text>
            <Text style={styles.headerSub}>
              {isDispatchRoom ? 'Emergency Control Channel' : 'Incident Communication'}
            </Text>
          </View>
          {uploading && <ActivityIndicator size="small" color="#fff" />}
        </View>
      )}

      <FlatList
        ref={flatRef}
        data={messages}
        keyExtractor={m => m.id}
        renderItem={renderMessage}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: false })}
        showsVerticalScrollIndicator={false}
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

      {isRecording && (
        <View style={styles.recordingBar}>
          <View style={styles.recordingDot} />
          <Text style={styles.recordingTxt}>Recording… tap stop to send</Text>
          <TouchableOpacity onPress={cancelRecording} style={styles.cancelRecBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={18} color="#94A3B8" />
          </TouchableOpacity>
        </View>
      )}
      {showAttach && !isRecording && <AttachMenu />}

      <View style={styles.inputBar}>
        <TouchableOpacity
          style={[styles.iconActionBtn, showAttach && styles.iconActionBtnActive]}
          onPress={() => setShowAttach(v => !v)}
          disabled={isRecording || uploading}
          activeOpacity={0.7}
        >
          <Feather name={showAttach ? 'x' : 'more-horizontal'} size={24} color={showAttach ? '#1E40AF' : '#64748B'} />
        </TouchableOpacity>

        {!isRecording && (
          <TextInput
            style={styles.textInput}
            placeholder="Type a message…"
            placeholderTextColor="#94A3B8"
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={2000}
          />
        )}
        {isRecording && <View style={{ flex: 1 }} />}

        <TouchableOpacity
          style={[styles.iconActionBtn, isRecording && styles.iconActionBtnRec]}
          onPress={isRecording ? stopRecordingAndSend : startRecording}
          disabled={uploading}
          activeOpacity={0.7}
        >
          <Feather name={isRecording ? 'square' : 'mic'} size={20} color={isRecording ? '#EF4444' : '#64748B'} />
        </TouchableOpacity>

        {!isRecording && (
          <TouchableOpacity
            style={[styles.sendBtn, (!inputText.trim() || sending) && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!inputText.trim() || sending}
            activeOpacity={0.8}
          >
            {sending
              ? <ActivityIndicator size="small" color="#fff" />
              : <Ionicons name="send" size={18} color="#fff" />
            }
          </TouchableOpacity>
        )}
      </View>

      <Modal visible={false} transparent animationType="slide" onRequestClose={() => setShowMoreMenu(false)}>
        <TouchableOpacity style={styles.menuOverlay} activeOpacity={1} onPress={() => setShowMoreMenu(false)}>
          <View style={styles.menuContent}>
            <TouchableOpacity style={styles.menuItem} onPress={() => { setShowMoreMenu(false); setShowLocationModal(true); }}>
              <View style={[styles.menuIconBox, { backgroundColor: '#10B981' }]}>
                <Ionicons name="location" size={24} color="#fff" />
              </View>
              <Text style={styles.menuLabel}>Share Location</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.menuItem} onPress={() => { setShowMoreMenu(false); setShowEmojiPicker(true); }}>
              <View style={[styles.menuIconBox, { backgroundColor: '#F59E0B' }]}>
                <Ionicons name="happy" size={24} color="#fff" />
              </View>
              <Text style={styles.menuLabel}>Emojis</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

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
          <MapView
            style={{ flex: 1 }}
            initialRegion={mapRegion}
            onRegionChangeComplete={setMapRegion}
          >
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
              {['😀', '😂', '😍', '👍', '🔥', '🙏', '💯', '🚀', '❤️', '✅', '❌', '⚠️', '🚑', '🚨', '📞', '📍', '🏥', '🏠', '🚶', '🏃'].map(e => (
                <TouchableOpacity key={e} style={styles.emojiItem} onPress={() => handleEmojiSelect(e)}>
                  <Text style={{ fontSize: 28 }}>{e}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {fullImage && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setFullImage(null)}>
          <View style={styles.fullImageBg}>
            <TouchableOpacity style={styles.fullImageClose} onPress={() => setFullImage(null)}>
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>
            <AuthImage 
              uri={fullImage} 
              accessToken={session.accessToken} 
              style={styles.fullImage} 
              resizeMode="contain" 
            />
          </View>
        </Modal>
      )}
    </KeyboardAvoidingView>
  );
}

function AuthImage({ uri, accessToken, style, resizeMode = 'cover' }) {
  const [src, setSrc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!uri) return;
    let cancelled = false;
    setLoading(true); setError(false); setSrc(null);
    fetch(uri, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(res => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.blob(); })
      .then(blob => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      }))
      .then(dataUri => { if (!cancelled) setSrc(dataUri); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [uri, accessToken]);

  if (loading) return (
    <View style={[style, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#DBEAFE' }]}>
      <ActivityIndicator color="#1E40AF" size="small" />
    </View>
  );
  if (error || !src) return (
    <View style={[style, { alignItems: 'center', justifyContent: 'center', backgroundColor: '#DBEAFE' }]}>
      <Feather name="image" size={24} color="#94A3B8" />
      <Text style={{ fontSize: 10, color: '#64748B', marginTop: 4 }}>Unavailable</Text>
    </View>
  );
  return <Image source={{ uri: src }} style={style} resizeMode={resizeMode} />;
}

function AuthVideo({ uri, accessToken, filename, isMe }) {
  const player = useVideoPlayer({ uri, headers: { Authorization: `Bearer ${accessToken}` } }, (p) => {
    p.loop = false;
  });

  return (
    <View style={[videoStyles.container, isMe && videoStyles.containerMe]}>
      <VideoView
        player={player}
        style={videoStyles.video}
        allowsFullscreen
        allowsPictureInPicture
      />
      <View style={videoStyles.info}>
        <Text style={[videoStyles.name, isMe && { color: '#DBEAFE' }]} numberOfLines={1}>
          {filename || 'Video'}
        </Text>
      </View>
    </View>
  );
}

function AuthAudio({ uri, accessToken, isPlaying, onToggle, onFinish, isMe, duration: initialDuration }) {
  const player = useAudioPlayer({ uri, headers: { Authorization: `Bearer ${accessToken}` } });
  const [pos, setPos] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);

  useEffect(() => {
    if (isPlaying) {
      player.play();
    } else {
      player.pause();
    }
  }, [isPlaying, player]);

  useEffect(() => {
    const unsubFinish = player.addListener('playToEnd', () => {
      onFinish();
      setPos(0);
    });

    const interval = setInterval(() => {
      if (!isSeeking && isPlaying) {
        setPos(player.currentTime);
      }
    }, 500);

    return () => {
      unsubFinish.remove();
      clearInterval(interval);
    };
  }, [player, onFinish, isPlaying, isSeeking]);

  function fmtDuration(ms) {
    if (!ms) return '0:00';
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  }

  const duration = initialDuration || player.duration || 0;

  return (
    <View style={[styles.audioBubble, isMe ? styles.audioBubbleMe : styles.audioBubbleThem]}>
      <View style={styles.audioTopRow}>
        <TouchableOpacity
          style={[styles.audioPlayBtn, isPlaying && (isMe ? styles.audioPlayBtnActiveMe : styles.audioPlayBtnActive)]}
          onPress={onToggle}
          activeOpacity={0.7}
        >
          <Ionicons
            name={isPlaying ? 'pause' : 'play'}
            size={18}
            color={isPlaying ? '#fff' : '#1E40AF'}
          />
        </TouchableOpacity>
        
        <View style={styles.audioSeekWrap}>
          <Slider
            style={styles.audioSlider}
            minimumValue={0}
            maximumValue={duration}
            value={pos}
            onSlidingStart={() => setIsSeeking(true)}
            onSlidingComplete={(val) => {
              player.seekTo(val);
              setPos(val);
              setIsSeeking(false);
            }}
            minimumTrackTintColor={isMe ? '#DBEAFE' : '#1E40AF'}
            maximumTrackTintColor={isMe ? 'rgba(219,234,254,0.3)' : 'rgba(30,64,175,0.1)'}
            thumbTintColor={isMe ? '#fff' : '#1E40AF'}
          />
        </View>
      </View>
      
      <View style={styles.audioMetaRow}>
        <Text style={[styles.audioTimeTxt, isMe && styles.audioTimeTxtMe]}>
          {fmtDuration(pos)} / {fmtDuration(duration)}
        </Text>
      </View>
    </View>
  );
}

const videoStyles = StyleSheet.create({
  container: { width: 220, overflow: 'hidden', borderRadius: 12, backgroundColor: '#DBEAFE', marginBottom: 2 },
  containerMe: { backgroundColor: 'rgba(255,255,255,0.1)' },
  video: { width: 220, height: 165 },
  info: { padding: 8, paddingBottom: 6 },
  name: { fontSize: 12, color: '#1E3A8A', fontWeight: '600' },
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
  headerStatusDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#22C55E' },
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

  senderName: { fontSize: 11, color: '#1E40AF', fontWeight: '700', marginBottom: 4 },
  msgText: { fontSize: 15, color: '#0F172A', lineHeight: 21 },
  msgTextMe: { color: '#EFF6FF' },
  msgImage: { width: 210, height: 158, borderRadius: 12, marginBottom: 4 },
  msgFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 4 },
  msgTime: { fontSize: 10, color: '#94A3B8' },
  msgTimeMe: { color: 'rgba(219,234,254,0.7)' },

  audioBubble: { width: 220, padding: 8 },
  audioBubbleMe: {},
  audioBubbleThem: {},
  audioTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  audioSeekWrap: { flex: 1, height: 40, justifyContent: 'center' },
  audioSlider: { width: '100%', height: 40 },
  audioMetaRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: -4, marginRight: 4 },
  audioTimeTxt: { fontSize: 10, color: '#64748B' },
  audioTimeTxtMe: { color: 'rgba(219,234,254,0.75)' },

  audioPlayBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#DBEAFE', alignItems: 'center', justifyContent: 'center' },
  audioPlayBtnActive: { backgroundColor: '#1E40AF' },
  audioPlayBtnActiveMe: { backgroundColor: 'rgba(255,255,255,0.3)' },

  fileCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#EFF6FF', borderRadius: 12, padding: 12, minWidth: 170,
    borderWidth: 0.5, borderColor: '#BFDBFE',
  },
  fileCardMe: { backgroundColor: 'rgba(255,255,255,0.15)', borderColor: 'rgba(255,255,255,0.2)' },
  fileCardIconCircle: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#DBEAFE', alignItems: 'center', justifyContent: 'center' },
  fileCardInfo: { flex: 1 },
  fileCardName: { fontSize: 13, fontWeight: '600', color: '#1E3A8A', lineHeight: 18 },
  fileCardMeta: { fontSize: 11, color: '#64748B', marginTop: 2 },

  recordingBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#FFF7ED', paddingHorizontal: 16, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: '#FED7AA',
  },
  recordingDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#EF4444' },
  recordingTxt: { flex: 1, fontSize: 13, color: '#92400E', fontWeight: '600' },
  cancelRecBtn: { padding: 4 },

  attachMenu: {
    flexDirection: 'row',
    backgroundColor: '#fff', borderTopWidth: 0.5, borderTopColor: '#E2E8F0',
    paddingVertical: 16, paddingHorizontal: 8, justifyContent: 'space-around',
  },
  attachItem: { alignItems: 'center', gap: 6 },
  attachItemIcon: {
    width: 54, height: 54, borderRadius: 27,
    backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center',
    borderWidth: 0.5, borderColor: '#BFDBFE',
  },
  attachItemLabel: { fontSize: 11, color: '#64748B', fontWeight: '600' },

  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end',
    backgroundColor: '#fff', borderTopWidth: 0.5, borderTopColor: '#E2E8F0',
    padding: 10, paddingHorizontal: 10,
    paddingBottom: Platform.OS === 'ios' ? 26 : 12,
    gap: 8,
  },
  iconActionBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F1F5F9',
  },
  iconActionBtnActive: { backgroundColor: '#DBEAFE' },
  iconActionBtnRec: { backgroundColor: '#FEE2E2' },

  textInput: {
    flex: 1,
    backgroundColor: '#F8FAFF',
    borderWidth: 0.5, borderColor: '#CBD5E1',
    borderRadius: 22,
    paddingHorizontal: 16, paddingVertical: 10,
    color: '#0F172A', fontSize: 15,
    maxHeight: 100,
  },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#1E40AF', alignItems: 'center', justifyContent: 'center', shadowColor: '#1E40AF', shadowOpacity: 0.3, shadowRadius: 6, elevation: 3 },
  sendBtnDisabled: { opacity: 0.4 },

  fullImageBg: { flex: 1, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' },
  fullImageClose: { position: 'absolute', top: 50, right: 20, zIndex: 10, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 20, padding: 4 },
  fullImage: { width: '100%', height: '80%' },

  locBubble: { width: 220, borderRadius: 12, overflow: 'hidden', backgroundColor: '#DBEAFE', marginBottom: 2 },
  locMap: { width: 220, height: 140 },
  locInfo: { padding: 8 },
  locName: { fontSize: 13, fontWeight: '700', color: '#1E3A8A' },
  locSub: { fontSize: 11, color: '#64748B' },

  menuOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  menuContent: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 40 },
  menuItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 15, gap: 15 },
  menuIconBox: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  menuLabel: { fontSize: 16, color: '#1E293B', fontWeight: '600' },

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
});
