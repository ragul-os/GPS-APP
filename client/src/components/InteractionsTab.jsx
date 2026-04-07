/**
 * InteractionsTab.jsx — NEW FILE
 * Matrix-powered chat tab for the live-tracking left panel.
 * Only adds new functionality; does not modify any existing component.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  createRoom, joinRoom, sendMessage, getRoomMessages,
  sync, uploadMedia, getRoomMembers,
  sendImageMessage, sendVideoMessage, sendAudioMessage, sendFileMessage,
  downloadMedia,
} from '../services/MatrixService';
import { SYNAPSE_BASE_URL, matrixRoomAlias, MATRIX_MAX_UPLOAD_SIZE } from '../config/apiConfig';
import {
  PaperClipOutlined,
  AudioOutlined,
  StopOutlined,
  SendOutlined,
  HistoryOutlined,
  WarningOutlined,
  LockOutlined,
  MessageOutlined,
  VideoCameraOutlined,
  SoundOutlined,
  CloudUploadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ArrowRightOutlined,
  LoadingOutlined,
  ExclamationCircleFilled,
  EnvironmentOutlined,
  MoreOutlined,
  SmileOutlined,
  CompassOutlined,
  PushpinOutlined,
  FieldTimeOutlined
} from '@ant-design/icons';

// ── Module-level room cache: ticketId → roomId ────────────────────────────────
// Persisted to localStorage so it survives tab switches within the same session.
const CACHE_KEY = 'gps_interactions_room_cache';
function getCachedRoom(ticketId) {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')[ticketId] || null; }
  catch { return null; }
}
function setCachedRoom(ticketId, roomId) {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    c[ticketId] = roomId;
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch { /* ignore */ }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseEvents(events = []) {
  return events
    .filter(e => e.type === 'm.room.message' && e.content?.msgtype)
    .map(e => ({
      id: e.event_id || `local-${e.origin_server_ts}`,
      sender: e.sender || '',
      ts: e.origin_server_ts || Date.now(),
      msgtype: e.content.msgtype,
      body: e.content.body || e.content.info?.name || '',
      url: e.content.url || null,
      geo_uri: e.content.geo_uri || null,
      info: e.content.info || {},
    }));
}
const fmtTime = ts => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtSize = b => !b ? '' : b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
const shortSender = uid => (uid || '').replace(/^@/, '').split(':')[0] || uid;

// ── Quick-reply suggestions ───────────────────────────────────────────────────
const QUICK_REPLIES = ['Unit en route', 'On scene', 'Need backup', 'Patient stabilised', 'Returning to base'];

// ─────────────────────────────────────────────────────────────────────────────
export default function InteractionsTab({ ticketId, alertObj }) {
  const [messages, setMessages] = useState([]);
  const [roomId, setRoomId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const [lightbox, setLightbox] = useState(null); // full-res URL for lightbox
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const [roomMembers, setRoomMembers] = useState([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const [mentionIndex, setMentionIndex] = useState(0);

  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showLocModal, setShowLocModal] = useState(false);
  const [showLiveDurations, setShowLiveDurations] = useState(false);

  const timerRef = useRef(null);

  const sinceRef = useRef(null);
  const abortRef = useRef(null);
  const roomIdRef = useRef(null);     // mirror for closures
  const seenIds = useRef(new Set()); // event_ids we've already rendered
  const pendingTxns = useRef(new Set()); // txnIds of optimistic sends in-flight
  const bottomRef = useRef(null);
  const messagesEndRef = bottomRef;      // alias — both point to the scroll anchor
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);
  const warned = useRef(false);
  const activeTicketRef = useRef(null); // truly prevent redundant re-init
  const initGenRef = useRef(0); // protect against race conditions in async init

  // Bug 5 fix — session read at top level, available everywhere including render
  const session = JSON.parse(localStorage.getItem('dispatcher') || '{}');
  const accessToken = session.accessToken || '';
  const myUserId = session.userId || session.user_id || '';

  // Fix 9 — Authenticated helpers for media rendering
  const buildMediaUrl = (mxc) => {
    if (!mxc) return '';
    const parts = mxc.replace('mxc://', '').split('/');
    if (parts.length !== 2) return mxc;
    return `${SYNAPSE_BASE_URL}/_matrix/client/v1/media/download/${parts[0]}/${parts[1]}?allow_redirect=true&access_token=${accessToken}`;
  };

  const buildThumbnailUrl = (mxc, w, h) => {
    if (!mxc) return '';
    const parts = mxc.replace('mxc://', '').split('/');
    if (parts.length !== 2) return mxc;
    return `${SYNAPSE_BASE_URL}/_matrix/client/v1/media/thumbnail/${parts[0]}/${parts[1]}?width=${w}&height=${h}&method=scale&allow_redirect=true&access_token=${accessToken}`;
  };

  useEffect(() => {
    if (!ticketId || !accessToken) {
      if (!accessToken && ticketId) setError('Not logged in — please log in again.');
      else setError('No ticket selected.');
      setLoading(false);
      return;
    }

    // Truly prevent re-init if ticket hasn't actually changed
    // This stops "history disappearing" caused by parent re-renders or tab flickering
    if (activeTicketRef.current === ticketId) return;

    activeTicketRef.current = ticketId;
    const currentGen = ++initGenRef.current;

    // Reset state for the NEW ticket
    setMessages([]);
    seenIds.current.clear();
    setRoomId(null);
    roomIdRef.current = null;

    initRoom(currentGen);

    return () => {
      abortRef.current?.abort();
      activeTicketRef.current = null;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [ticketId, accessToken]);

  // Fetch room members for mentions
  useEffect(() => {
    if (!roomId || !accessToken) return;
    const fetchMembers = async () => {
      try {
        const res = await getRoomMembers(accessToken, roomId);
        // getRoomMembers returns raw events, we need to extract join membership
        const members = (res.chunk || [])
          .filter(e => e.type === 'm.room.member' && e.content?.membership === 'join')
          .map(e => ({
            userId: e.state_key,
            displayName: e.content?.displayname || e.state_key.replace(/^@/, '').split(':')[0],
          }));
        setRoomMembers(members);
      } catch (e) {
        console.warn('[InteractionsTab] Failed to fetch members:', e.message);
      }
    };
    fetchMembers();
  }, [roomId, accessToken]);

  // Auto-scroll when new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // -- Room init ---------------------------------------------------------------
  async function initRoom(gen) {
    setLoading(true);
    setError(null);
    try {
      const canonicalRoomName = `Ticket-${ticketId}`;
      const safeAlias = canonicalRoomName.replace(/[^a-zA-Z0-9_\-]/g, '_');
      const fullAlias = matrixRoomAlias(safeAlias);
      let rid = null;

      // Step 1: Check local cache first (fastest)
      rid = getCachedRoom(ticketId);

      // Step 2: If no cache, resolve by alias from Synapse
      if (!rid) {
        try {
          const aliasRes = await fetch(
            `${SYNAPSE_BASE_URL}/_matrix/client/v3/directory/room/${encodeURIComponent(fullAlias)}`,
            { headers: { 'Authorization': `Bearer ${accessToken}` } }
          );
          if (aliasRes.ok) {
            const aliasData = await aliasRes.json();
            if (aliasData.room_id) rid = aliasData.room_id;
          }
        } catch { }
      }

      // Step 3: Only create if NEITHER cache NOR alias found anything
      if (!rid) {
        const result = await createRoom(accessToken, canonicalRoomName);
        rid = result.room_id;
      }

      if (gen !== initGenRef.current) return; // Stale request, ignore

      setCachedRoom(ticketId, rid);
      roomIdRef.current = rid;
      setRoomId(rid);

      // Join (idempotent)
      try { await joinRoom(accessToken, rid); } catch { /* already member */ }

      window.dispatchEvent(new CustomEvent('matrixTicketRoomReady', { detail: { ticketId, roomId: rid } }));

      // Load history
      await loadHistory(rid, gen);

      // Start sync
      startSync(rid, gen);
    } catch (e) {
      console.error('[InteractionsTab] initRoom error:', e);
      setError('Could not open chat: ' + (e.message || 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  // -- Voice Recording ---------------------------------------------------------
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const file = new File([audioBlob], `voice-note-${Date.now()}.webm`, { type: 'audio/webm' });

        setUploading(true);
        setUploadName('Voice message');
        try {
          const up = await uploadMedia(accessToken, file);
          await sendAudioMessage(accessToken, roomId, up.content_uri, {
            name: file.name,
            size: file.size,
            mimetype: file.type,
          });
        } catch (err) {
          console.error('[Voice] Upload failed:', err);
        } finally {
          setUploading(false);
          stream.getTracks().forEach(t => t.stop());
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('[Voice] Permission denied:', err);
      alert('Microphone access denied or not available.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      clearInterval(timerRef.current);
    }
  };

  const fmtDuration = (s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  const filteredMembers = roomMembers.filter(m =>
    m.displayName.toLowerCase().includes(mentionSearch.toLowerCase()) ||
    m.userId.toLowerCase().includes(mentionSearch.toLowerCase())
  );

  const insertMention = (member) => {
    if (!textareaRef.current) return;
    const cursor = textareaRef.current.selectionStart;
    const textBefore = inputText.substring(0, cursor);
    const mentionIdx = textBefore.lastIndexOf('@');
    const textAfter = inputText.substring(cursor);

    setInputText(textBefore.substring(0, mentionIdx) + '@' + member.displayName + ' ' + textAfter);
    setMentionOpen(false);
    // Note: Re-focusing might be needed in a real app, but textarea is usually still focused.
  };

  async function loadHistory(rid, gen) {
    try {
      // getRoomMessages — HTTP/2 preferred for potentially large payloads
      const res = await getRoomMessages(accessToken, rid, null, 50);
      if (gen !== initGenRef.current) return; // Guard against stale history load

      const events = [...(res.chunk || [])].reverse(); // chunk is newest-first
      const msgs = parseEvents(events).filter(m => {
        if (seenIds.current.has(m.id)) return false;
        seenIds.current.add(m.id);
        return true;
      });
      setMessages(msgs);
    } catch (e) {
      if (gen === initGenRef.current) console.warn('[InteractionsTab] loadHistory:', e.message);
    }
  }

  // ── Sync loop — HTTP/2 long-polling via native fetch ─────────────────────
  function startSync(rid, gen) {
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    let currentSince = null;
    const poll = async () => {
      while (!ctrl.signal.aborted) {
        try {
          const data = await sync(accessToken, currentSince, ctrl.signal);
          if (ctrl.signal.aborted) break;
          // One final guard: if the entire component instance (or ticket) switched
          if (gen !== initGenRef.current) break;

          if (data.next_batch) currentSince = data.next_batch;

          // CRITICAL: Filter events by the current room ID to prevent "room bleeding"
          const timelineEvents = data.rooms?.join?.[rid]?.timeline?.events || [];

          if (timelineEvents.length) {
            const filtered = timelineEvents.filter(e => {
              // 1. Skip our own confirm messages (optimistic UI)
              if (e.unsigned?.transaction_id && pendingTxns.current.has(e.unsigned.transaction_id)) {
                if (e.event_id) seenIds.current.add(e.event_id);
                return false;
              }
              // 2. Skip duplicates
              if (seenIds.current.has(e.event_id)) return false;
              if (e.event_id) seenIds.current.add(e.event_id);
              // 3. Only message types
              return e.type === 'm.room.message' && e.content?.msgtype;
            });

            if (filtered.length) {
              const newMsgs = filtered.map(e => ({
                id: e.event_id || `local-${e.origin_server_ts}`,
                sender: e.sender || '',
                ts: e.origin_server_ts || Date.now(),
                msgtype: e.content.msgtype,
                body: e.content.body || '',
                url: e.content.url || null,
                geo_uri: e.content.geo_uri || null,
                info: e.content.info || {},
              }));
              setMessages(prev => [...prev, ...newMsgs]);
            }
          }
        } catch (e) {
          if (e.name === 'AbortError' || ctrl.signal.aborted) break;
          if (gen !== initGenRef.current) break;
          console.warn('[Sync] Retrying in 4s:', e.message);
          await new Promise(r => setTimeout(r, 4000));
        }
      }
    };
    poll();
  }

  // ── Send text — optimistic update + txnId tracking to prevent sync duplicate ──
  const handleSend = async () => {
    const txt = inputText.trim();
    if (!txt || !roomId) return;

    // Clear input IMMEDIATELY to prevent double-sends during async operations
    setInputText('');
    const el = textareaRef.current;
    if (el) el.style.height = '40px';

    const sess = JSON.parse(localStorage.getItem('dispatcher') || '{}');
    const senderId = sess.userId || sess.user_id;

    // Direct Message Logic: Check for mentions
    const mentions = [...txt.matchAll(/@(\S+)/g)];
    let dmSent = false;

    if (mentions.length > 0) {
      for (const match of mentions) {
        const mentionName = match[1];
        // Improved target lookup: check both displayName and userId
        const target = roomMembers.find(m => 
          m.displayName.toLowerCase() === mentionName.toLowerCase() || 
          m.userId.toLowerCase().includes(mentionName.toLowerCase())
        );
        
        if (target && target.userId !== senderId) {
          dmSent = true;
          try {
            console.log('[InteractionsTab] Sending DM to:', target.userId);
            
            // 1. Find existing DM room
            let dmRoomId = null;
            const joinedRes = await fetch(`${SYNAPSE_BASE_URL}/_matrix/client/v3/joined_rooms`, {
              headers: { 'Authorization': `Bearer ${accessToken}` },
            });
            if (joinedRes.ok) {
              const { joined_rooms = [] } = await joinedRes.json();
              // To speed up, we look at the last 20 rooms or specifically for 1:1 DMs
              for (const rid of joined_rooms.slice(-20)) {
                const stRes = await fetch(`${SYNAPSE_BASE_URL}/_matrix/client/v3/rooms/${encodeURIComponent(rid)}/state`, {
                  headers: { 'Authorization': `Bearer ${accessToken}` },
                });
                if (stRes.ok) {
                  const state = await stRes.json();
                  const members = state.filter(e => e.type === 'm.room.member' && e.content?.membership === 'join');
                  if (members.length === 2 && members.some(m => m.state_key === target.userId)) {
                    dmRoomId = rid;
                    break;
                  }
                }
              }
            }

            // 2. Create DM if not found
            if (!dmRoomId) {
              const createRes = await fetch(`${SYNAPSE_BASE_URL}/_matrix/client/v3/createRoom`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${accessToken}`, "Content-Type": "application/json" },
                body: JSON.stringify({ 
                  invite: [target.userId], 
                  is_direct: true, 
                  preset: "trusted_private_chat", 
                  visibility: "private" 
                }),
              });
              if (createRes.ok) {
                const data = await createRes.json();
                dmRoomId = data.room_id;
              }
            }

            // 3. Send the DM
            if (dmRoomId) {
              await sendMessage(accessToken, dmRoomId, txt);
              setMessages(prev => [...prev, {
                id: 'dm-' + Date.now() + Math.random(),
                sender: senderId,
                ts: Date.now(),
                msgtype: 'm.text',
                body: `🔒 Sent DM to ${target.displayName}: ${txt}`,
                url: null,
                info: {},
              }]);
            }
          } catch (err) {
            console.error('[InteractionsTab] DM failed for:', target.userId, err);
          }
        }
      }
    }

    // If we sent at least one DM, we don't send to the room
    if (dmSent) {
      setSending(false);
      return;
    }

    // Standard room send
    const txnId = 'm' + Date.now() + Math.random().toString(36).slice(2, 7);
    pendingTxns.current.add(txnId);

    setMessages(prev => [...prev, {
      id: txnId,
      sender: senderId,
      ts: Date.now(),
      msgtype: 'm.text',
      body: txt,
      url: null,
      info: {},
    }]);

    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);

    try {
      await sendMessage(accessToken, roomId, txt);
    } catch (err) {
      console.error('[InteractionsTab] Room Send failed:', err);
    } finally {
      pendingTxns.current.delete(txnId);
    }
  };

  // ── Send Location ──────────────────────────────────────────────────────────
  const handleSendLocation = (customBody) => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser");
      return;
    }

    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude, longitude } = pos.coords;
      const geoUri = `geo:${latitude},${longitude}`;
      const mapsUrl = `https://www.google.com/maps?q=${latitude},${longitude}`;
      const body = customBody || `Shared a location: ${mapsUrl}`;

      try {
        const sess = JSON.parse(localStorage.getItem('dispatcher') || '{}');
        const senderId = sess.userId || sess.user_id;
        const txnId = 'loc-' + Date.now();
        
        setMessages(prev => [...prev, {
          id: txnId,
          sender: senderId,
          ts: Date.now(),
          msgtype: 'm.location',
          body: body,
          geo_uri: geoUri,
          url: null,
          info: {},
        }]);

        await fetch(`${SYNAPSE_BASE_URL}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`, {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            msgtype: 'm.location',
            body: body,
            geo_uri: geoUri
          })
        });
      } catch (err) {
        console.error('[InteractionsTab] Location send failed:', err);
      }
    }, (err) => {
      alert("Unable to retrieve your location: " + err.message);
    });
  };

  // ── File attachment ───────────────────────────────────────────────────────
  const handleFile = useCallback(async e => {
    const file = e.target.files?.[0];
    if (!file || !roomIdRef.current) return;

    // ── Pre-upload size check ──
    if (file.size > MATRIX_MAX_UPLOAD_SIZE) {
      const limitMB = Math.round(MATRIX_MAX_UPLOAD_SIZE / (1024 * 1024));
      alert(`File too large: ${fmtSize(file.size)}. Max allowed is ${limitMB}MB. To increase this, contact your server admin to update homeserver.yaml.`);
      e.target.value = '';
      return;
    }

    e.target.value = '';
    setUploading(true);
    setUploadName(file.name);
    try {
      // uploadMedia — HTTP/2 preferred for file uploads
      const up = await uploadMedia(accessToken, file);
      const mxc = up.content_uri;
      const mime = file.type || 'application/octet-stream';
      const info = { name: file.name, mimetype: mime, size: file.size };
      if (mime.startsWith('image/')) await sendImageMessage(accessToken, roomIdRef.current, mxc, info);
      else if (mime.startsWith('video/')) await sendVideoMessage(accessToken, roomIdRef.current, mxc, info);
      else if (mime.startsWith('audio/')) await sendAudioMessage(accessToken, roomIdRef.current, mxc, info);
      else await sendFileMessage(accessToken, roomIdRef.current, mxc, file.name, info);
    } catch (e) {
      console.error('[InteractionsTab] file send:', e);
      alert('Upload failed. This may be due to server-side size limits or connection issues.');
    }
    setUploading(false);
    setUploadName('');
  }, [accessToken]);

  // ── Download attachment ───────────────────────────────────────────────────
  const handleDownload = useCallback(async (mxcUrl, filename) => {
    try {
      // downloadMedia — HTTP/2 preferred for file downloads
      const blob = await downloadMedia(accessToken, mxcUrl);
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: filename || 'file' });
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { console.error('[InteractionsTab] download:', e); }
  }, [accessToken]);

  // ── Safe Image Renderer for Missing Server Media ──────────────────────────
  const SafeImage = ({ thumb, full, alt, onOpen }) => {
    const [src, setSrc] = useState(thumb);
    const [failed, setFailed] = useState(false);
    return failed ? (
      <div style={{ padding: '16px 12px', textAlign: 'center', background: 'rgba(0,0,0,0.2)', border: '1px dashed rgba(229,57,53,0.3)', borderRadius: 7, color: '#E53935', fontSize: 9, fontFamily: 'Sora, sans-serif' }}>
        <div style={{ fontSize: 16, marginBottom: 4 }}><WarningOutlined /></div>
        Media missing from server
      </div>
    ) : (
      <img src={src} alt={alt}
        onClick={() => onOpen(full)}
        onError={() => {
          if (src === thumb) setSrc(full);
          else setFailed(true);
        }}
        style={{ maxWidth: '100%', maxHeight: 130, minHeight: 40, minWidth: 60, borderRadius: 7, cursor: 'pointer', display: 'block', objectFit: 'cover' }}
      />
    );
  };

  // ── Message renderer ──────────────────────────────────────────────────────
  function renderMsg(msg) {
    const mine = msg.sender === myUserId;
    const sender = shortSender(msg.sender);
    const time = fmtTime(msg.ts);

    const bubble = {
      maxWidth: '80%', padding: '7px 10px',
      borderRadius: mine ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
      background: mine ? 'rgba(26,115,232,.2)' : 'rgba(48,54,61,.75)',
      border: mine ? '1px solid rgba(26,115,232,.3)' : '1px solid rgba(48,54,61,.9)',
      fontSize: 11, color: '#E6EDF3', fontFamily: 'Sora, sans-serif',
      lineHeight: 1.55, wordBreak: 'break-word',
    };
    const metaRow = {
      fontSize: 8, color: '#8B949E', marginTop: 3, display: 'flex', gap: 5,
      justifyContent: mine ? 'flex-end' : 'flex-start',
    };

    const isImage = msg.msgtype === 'm.image' || msg.info?.mimetype?.startsWith('image/');
    const isMedia = ['m.video', 'm.audio', 'm.file'].includes(msg.msgtype) || isImage;
    const isLocation = msg.msgtype === 'm.location';
    let inner;

    if (isLocation) {
      const g = msg.geo_uri?.replace('geo:', '').split(',') || [12.9716, 80.2425]; // Default to Chennai coords if missing
      const lat = g[0];
      const lng = g[1];
      const embedUrl = `https://maps.google.com/maps?q=${lat},${lng}&z=15&output=embed`;
      const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;

      inner = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 200 }}>
          <div style={{
            background: 'rgba(0,0,0,0.15)', borderRadius: 12, overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.05)',
          }}>
            <div style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.03)' }}>
              <EnvironmentOutlined style={{ fontSize: 16, color: '#1A73E8' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#E6EDF3' }}>Shared Location</div>
                <div style={{ fontSize: 8, opacity: 0.6 }}>{lat}, {lng}</div>
              </div>
              <a 
                href={mapsUrl} target="_blank" rel="noopener noreferrer"
                style={{
                  background: 'rgba(26,115,232,0.2)', border: '1px solid rgba(26,115,232,0.3)',
                  borderRadius: 6, color: '#82B4FF', fontSize: 9, fontWeight: 800,
                  padding: '3px 8px', cursor: 'pointer', textDecoration: 'none'
                }}
              >OPEN</a>
            </div>
            
            {/* Embedded Map Widget */}
            <div style={{ width: '100%', height: 120, background: '#161B22', position: 'relative' }}>
              <iframe
                title="Location Map"
                src={embedUrl}
                width="100%"
                height="100%"
                style={{ border: 0, opacity: 0.85, filter: 'grayscale(0.3) invert(0.9) hue-rotate(180deg)' }} // Dark mode map hack
                loading="lazy"
              ></iframe>
              <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', boxShadow: 'inset 0 0 40px rgba(0,0,0,0.3)' }} />
            </div>
          </div>
          <div style={metaRow}><span>{sender}</span><span>{time}</span></div>
        </div>
      );
    } else if (isMedia && msg.url) {
      const icon = msg.msgtype === 'm.video' ? <VideoCameraOutlined /> : msg.msgtype === 'm.audio' ? <SoundOutlined /> : <PaperClipOutlined />;
      const thumb = isImage ? buildThumbnailUrl(msg.url, 220, 160) : null;
      const full = buildMediaUrl(msg.url);

      inner = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* File block (Element-style) */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'rgba(0,0,0,0.15)', padding: '8px 10px', borderRadius: 8,
            border: '1px solid rgba(255,255,255,0.05)',
          }}>
            <span style={{ fontSize: 16, display: 'flex' }}>{icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#E6EDF3' }}>
                {msg.body || 'attachment'}
              </div>
              {msg.info?.size && (
                <div style={{ fontSize: 8, color: '#8B949E', marginTop: 1 }}>{fmtSize(msg.info.size)}</div>
              )}
            </div>
            <button
              onClick={() => handleDownload(msg.url, msg.body)}
              style={{
                background: 'rgba(26,115,232,0.2)', border: '1px solid rgba(26,115,232,0.3)',
                borderRadius: 6, color: '#82B4FF', fontSize: 10, fontWeight: 800,
                padding: '4px 8px', cursor: 'pointer', transition: 'all .15s'
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(26,115,232,0.34)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(26,115,232,0.2)'}
            >
              DOWNLOAD
            </button>
          </div>

          {/* Image preview (if applicable) */}
          {isImage && (
            <SafeImage
              thumb={thumb}
              full={full}
              alt={msg.body}
              onOpen={setLightbox}
            />
          )}

          {/* Video player */}
          {msg.msgtype === 'm.video' && (
            <video
              src={full}
              controls
              style={{ width: '100%', borderRadius: 8, maxHeight: 180, background: '#000', marginTop: 2 }}
              onError={(e) => {
                e.target.style.display = 'none';
                const err = document.createElement('div');
                err.style.cssText = 'color:#8B949E; font-size:9px; padding:10px; text-align:center; background:rgba(0,0,0,0.2); border-radius:8px; border:1px dashed rgba(255,255,255,0.1);';
                err.innerHTML = 'Movie clip playback unavailable';
                e.target.parentElement.appendChild(err);
              }}
            />
          )}

          {/* Audio player */}
          {msg.msgtype === 'm.audio' && (
            <audio
              src={full}
              controls
              style={{ width: '100%', height: 32, marginTop: 2 }}
              onError={(e) => {
                e.target.style.display = 'none';
                const err = document.createElement('div');
                err.style.cssText = 'color:#8B949E; font-size:9px; padding:8px; text-align:center;';
                err.innerHTML = '🎵 Audio unavailable';
                e.target.parentElement.appendChild(err);
              }}
            />
          )}

          <div style={metaRow}><span>{sender}</span><span>{time}</span></div>
        </div>
      );
    } else {
      inner = (
        <>
          <div style={{ fontSize: 11, lineHeight: 1.6 }}>{msg.body}</div>
          <div style={metaRow}><span>{sender}</span><span>{time}</span></div>
        </>
      );
    }

    return (
      <div key={msg.id} style={{ display: 'flex', flexDirection: mine ? 'row-reverse' : 'row', alignItems: 'flex-end', gap: 5, marginBottom: 8 }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: mine ? '#1A73E8' : '#30363D', flexShrink: 0, marginBottom: 2 }} />
        <div style={bubble}>{inner}</div>
      </div>
    );
  }

  // ── States: auth missing, loading, error ──────────────────────────────────
  if (!accessToken) return (
    <div style={st.stateWrap}>
      <div style={{ fontSize: 22, marginBottom: 6, color: '#8B949E' }}><LockOutlined /></div>
      <div style={st.stateMsg}>Not authenticated — log in to use chat</div>
    </div>
  );
  if (loading) return (
    <div style={st.stateWrap}>
      <div style={{ fontSize: 20, marginBottom: 6, color: '#1A73E8' }}><LoadingOutlined spin /></div>
      <div style={st.stateMsg}>Opening chat room…</div>
    </div>
  );
  if (error) return (
    <div style={st.stateWrap}>
      <div style={{ fontSize: 20, marginBottom: 6, color: '#E53935' }}><WarningOutlined /></div>
      <div style={{ ...st.stateMsg, color: '#E53935' }}>{error}</div>
      <button onClick={initRoom} style={st.retryBtn}>Retry</button>
    </div>
  );

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <div style={st.wrap}>
      {/* Message list */}
      <div style={st.msgList}>
        {messages.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#8B949E', fontSize: 10, paddingTop: 24 }}>
            <div style={{ fontSize: 24, marginBottom: 6, opacity: 0.4 }}><MessageOutlined /></div>
            No messages yet — start the conversation
          </div>
        ) : (
          messages.map(renderMsg)
        )}
        <div ref={bottomRef} />
      </div>

      {/* Quick replies */}
      <div style={st.quickRow}>
        {QUICK_REPLIES.map(q => (
          <button key={q} style={st.chip} onClick={() => setInputText(q)}>{q}</button>
        ))}
      </div>

      {/* Upload progress */}
      {uploading && (
        <div style={st.uploadBanner}>
          <CloudUploadOutlined style={{ fontSize: 12, color: '#1A73E8' }} />
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{uploadName}</span>
          <span style={{ opacity: 0.6 }}>Uploading…</span>
        </div>
      )}

      {/* Input bar */}
      <div style={{ padding: '8px 0', borderTop: '1px solid #30363D', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFile} />

        {/* Textarea container with icons inside/below */}
        <div style={{ position: 'relative', flex: 1, background: '#161B22', border: '1px solid #30363D', borderRadius: 8 }}>
          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={e => {
              const val = e.target.value;
              setInputText(val);
              
              const cursor = e.target.selectionStart;
              const textBefore = val.substring(0, cursor);
              const mentionIdx = textBefore.lastIndexOf('@');
              if (mentionIdx !== -1 && (mentionIdx === 0 || textBefore[mentionIdx - 1] === ' ')) {
                const search = textBefore.substring(mentionIdx + 1);
                if (!search.includes(' ')) {
                  setMentionSearch(search);
                  setMentionOpen(true);
                  setMentionIndex(0);
                } else { setMentionOpen(false); }
              } else { setMentionOpen(false); }

              const el = e.target;
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, 200) + 'px';
            }}
            onKeyDown={e => {
              if (mentionOpen) {
                if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex(prev => (prev + 1) % filteredMembers.length); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex(prev => (prev - 1 + filteredMembers.length) % filteredMembers.length); }
                else if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault();
                  if (filteredMembers[mentionIndex]) insertMention(filteredMembers[mentionIndex]);
                } else if (e.key === 'Escape') setMentionOpen(false);
              } else if (e.key === 'Enter' && !e.shiftKey && inputText.trim()) {
                e.preventDefault();
                handleSend();
                e.target.style.height = '40px';
              }
            }}
            placeholder="Type a message... (Use @ to tag)"
            style={{
              width: '100%', background: 'transparent', border: 'none', padding: '10px 14px',
              color: '#E6EDF3', fontSize: 11, fontFamily: 'Sora, sans-serif', outline: 'none',
              minHeight: 40, maxHeight: 200, height: 40, resize: 'none', overflowY: 'auto',
              lineHeight: 1.5, boxSizing: 'border-box'
            }}
          />

          {/* Bottom Tool Row inside textarea container */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 8px 6px 8px' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <button 
                type="button" 
                onClick={isRecording ? stopRecording : startRecording}
                style={{ background: 'transparent', border: 'none', color: isRecording ? '#E53935' : '#8B949E', cursor: 'pointer', padding: 0, display: 'flex' }}
              >
                {isRecording ? <StopOutlined style={{ fontSize: 16 }} /> : <AudioOutlined style={{ fontSize: 16 }} />}
              </button>
              {isRecording && <span style={{ fontSize: 9, color: '#E53935', fontWeight: 700 }}>{fmtDuration(recordingTime)}</span>}
            </div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <button 
                type="button" 
                onClick={() => { setShowEmojiPicker(!showEmojiPicker); setShowMoreMenu(false); }}
                style={{ background: 'transparent', border: 'none', color: '#8B949E', cursor: 'pointer', padding: 0, display: 'flex' }}
              ><SmileOutlined style={{ fontSize: 18 }} /></button>
              
              <button 
                type="button" 
                onClick={() => fileInputRef.current?.click()}
                style={{ background: 'transparent', border: 'none', color: '#8B949E', cursor: 'pointer', padding: 0, display: 'flex' }}
              ><PaperClipOutlined style={{ fontSize: 18 }} /></button>

              <button 
                type="button" 
                onClick={() => { setShowMoreMenu(!showMoreMenu); setShowEmojiPicker(false); }}
                style={{ background: 'transparent', border: 'none', color: '#8B949E', cursor: 'pointer', padding: 0, display: 'flex' }}
              ><MoreOutlined style={{ fontSize: 18 }} /></button>
            </div>
          </div>

          {/* Mention Popup */}
          {mentionOpen && filteredMembers.length > 0 && (
            <div style={{
              position: 'absolute', bottom: '100%', left: 0, width: '100%',
              background: '#161B22', border: '1px solid #30363D', borderRadius: 8,
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)', marginBottom: 8,
              zIndex: 110, maxHeight: 200, overflowY: 'auto'
            }}>
              {filteredMembers.map((m, i) => (
                <div key={m.userId} onClick={() => insertMention(m)}
                  style={{
                    padding: '8px 12px', cursor: 'pointer', fontSize: 11,
                    background: i === mentionIndex ? 'rgba(26,115,232,0.2)' : 'transparent',
                    color: i === mentionIndex ? '#82B4FF' : '#E6EDF3',
                    display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid rgba(255,255,255,0.05)'
                  }}
                  onMouseEnter={() => setMentionIndex(i)}
                >
                  <div style={{ width: 24, height: 24, borderRadius: 12, background: '#30363D', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 800 }}>
                    {m.displayName.substring(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700 }}>{m.displayName}</div>
                    <div style={{ fontSize: 9, opacity: 0.6 }}>{m.userId}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Emoji Picker */}
          {showEmojiPicker && (
            <div style={{
              position: 'absolute', bottom: '100%', right: 0, 
              background: '#161B22', border: '1px solid #30363D', borderRadius: 12,
              padding: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.5)', marginBottom: 8,
              zIndex: 110, width: 240, display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8
            }}>
              {['😀','😃','😄','😁','😆','😅','😂','🤣','☺️','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬'].map(emoji => (
                <div 
                  key={emoji} 
                  onClick={() => { setInputText(prev => prev + emoji); setShowEmojiPicker(false); }}
                  style={{ fontSize: 18, cursor: 'pointer', textAlign: 'center', padding: 4 }}
                >{emoji}</div>
              ))}
            </div>
          )}

          {/* More Menu */}
          {showMoreMenu && (
            <div style={{
              position: 'absolute', bottom: '100%', right: 0, 
              background: '#161B22', border: '1px solid #30363D', borderRadius: 12,
              overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', marginBottom: 8,
              zIndex: 110, width: 180
            }}>
              <div 
                onClick={() => { setShowLocModal(true); setShowMoreMenu(false); }}
                style={{ padding: '12px 16px', cursor: 'pointer', fontSize: 11, color: '#E6EDF3', display: 'flex', alignItems: 'center', gap: 10 }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <EnvironmentOutlined style={{ color: '#00897b', fontSize: 14 }} /> Location Sharing
              </div>
              <div 
                style={{ padding: '12px 16px', cursor: 'pointer', fontSize: 11, color: '#E6EDF3', display: 'flex', alignItems: 'center', gap: 10, opacity: 0.5 }}
              >
                <PushpinOutlined style={{ fontSize: 14 }} /> Other Options
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={handleSend}
          disabled={!inputText.trim() || !roomId}
          style={{ 
            width: 32, height: 32, borderRadius: 16, 
            background: inputText.trim() ? '#1A73E8' : '#30363D', border: 'none', 
            color: inputText.trim() ? '#fff' : '#8B949E', cursor: inputText.trim() ? 'pointer' : 'not-allowed', 
            display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 6 
          }}
        ><SendOutlined style={{ fontSize: 14 }} /></button>
      </div>

      {/* Location Modal */}
      {showLocModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', 
          zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div style={{
            background: '#fff', width: 320, borderRadius: 16, padding: '24px 20px',
            position: 'relative', color: '#111', fontFamily: 'Sora, sans-serif', textAlign: 'center'
          }}>
            <button 
              onClick={() => { setShowLocModal(false); setShowLiveDurations(false); }}
              style={{ position: 'absolute', top: 12, right: 12, background: '#eee', border: 'none', borderRadius: '50%', width: 24, height: 24, cursor: 'pointer', color: '#666' }}
            >×</button>
            
            <div style={{ width: 64, height: 64, borderRadius: 32, background: '#00796b', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: '#fff' }}>
              <EnvironmentOutlined style={{ fontSize: 32 }} />
            </div>

            <h3 style={{ margin: '0 0 24px', fontSize: 18, fontWeight: 700 }}>What location type do you want to share?</h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <button 
                onClick={() => { handleSendLocation(null); setShowLocModal(false); }}
                style={{ background: '#fff', border: '1px solid #eee', borderRadius: 12, padding: '12px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}
              >
                <div style={{ width: 36, height: 36, borderRadius: 18, border: '2px solid #00796b', color: '#00796b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 900 }}>M</div>
                <span style={{ fontWeight: 600, color: '#333' }}>My current location</span>
              </button>

              <div style={{ position: 'relative' }}>
                <button 
                  onClick={() => setShowLiveDurations(!showLiveDurations)}
                  style={{ background: '#fff', border: '1px solid #eee', borderRadius: 12, padding: '12px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}
                >
                  <div style={{ width: 36, height: 36, borderRadius: 18, background: '#673ab7', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <CompassOutlined style={{ fontSize: 20 }} />
                  </div>
                  <span style={{ fontWeight: 600, color: '#333' }}>My live location</span>
                </button>
                
                {showLiveDurations && (
                  <div style={{
                    marginTop: 8, display: 'flex', justifyContent: 'center', gap: 8,
                    padding: '8px', background: '#f5f5f5', borderRadius: 8
                  }}>
                    {['15m', '1h', '8h'].map(d => (
                      <button 
                        key={d} 
                        onClick={() => {
                          handleSendLocation(`Mock: Share Live Location for ${d}`);
                          setShowLocModal(false);
                          setShowLiveDurations(false);
                        }}
                        style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #ccc', background: '#fff', fontSize: 10, cursor: 'pointer' }}
                      >{d}</button>
                    ))}
                  </div>
                )}
              </div>

              <button 
                onClick={() => {
                   handleSendLocation("Dropped Pin");
                   setShowLocModal(false);
                }}
                style={{ background: '#fff', border: '1px solid #eee', borderRadius: 12, padding: '12px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}
              >
                <div style={{ width: 36, height: 36, borderRadius: 18, background: '#00695c', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <PushpinOutlined style={{ fontSize: 20 }} />
                </div>
                <span style={{ fontWeight: 600, color: '#333' }}>Drop a Pin</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Lightbox */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out' }}
        >
          <img
            src={lightbox}
            alt="Full view"
            onError={(e) => {
              e.target.style.display = 'none';
              const wrap = e.target.parentElement;
              if (wrap && !wrap.querySelector('.lb-err')) {
                const err = document.createElement('div');
                err.className = 'lb-err';
                err.innerHTML = '<div style="font-size: 32px; margin-bottom: 8px;"><svg viewBox="0 0 1024 1024" width="32" height="32" fill="#E53935"><path d="M955.7 856L544.2 163.5c-6.1-10.2-15-18.3-25.7-23.2-10.7-4.8-22.1-7.3-33.6-7.3s-22.9 2.5-33.6 7.3c-10.7 4.9-19.5 13-25.7 23.2L14.4 856c-11.8 19.8-11.8 44.2 0 64s31.7 32 55.4 32h823.1c23.7 0 45.3-13 57.1-32 11.8-19.8 11.8-44.2 0-64zM512 816c-22.1 0-40-17.9-40-40s17.9-40 40-40 40 17.9 40 40-17.9 40-40 40z m40-160c0 4.4-3.6 8-8 8h-64c-4.4 0-8-3.6-8-8V336c0-4.4 3.6-8 8-8h64c4.4 0 8 3.6 8 8v320z"></path></svg></div><div style="color: #fff; font-family: Sora; font-size: 14px; text-align: center;">Full resolution media missing on server</div>';
                wrap.appendChild(err);
              }
            }}
            style={{ maxWidth: '90vw', maxHeight: '90vh', borderRadius: 10, boxShadow: '0 8px 40px rgba(0,0,0,.7)', minWidth: 200, minHeight: 100 }}
          />
        </div>
      )}
    </div>
  );
}

// ── Styles (dark theme — matches existing dashboard palette) ─────────────────
const st = {
  wrap: {
    display: 'flex', flexDirection: 'column',
    height: '100%', padding: '0 12px 12px 12px',
  },
  roomRow: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '4px 0 6px', borderBottom: '1px solid rgba(48,54,61,.6)', marginBottom: 6,
  },
  msgList: {
    flex: 1, overflowY: 'auto', paddingRight: 2,
    scrollbarWidth: 'none', msOverflowStyle: 'none',
  },
  quickRow: {
    display: 'flex', gap: 5, flexWrap: 'wrap', paddingBottom: 7, paddingTop: 4,
    borderTop: '1px solid rgba(48,54,61,.5)',
  },
  chip: {
    fontSize: 9, fontWeight: 700, padding: '3px 8px',
    borderRadius: 20, border: '1px solid rgba(26,115,232,.3)',
    background: 'rgba(26,115,232,.08)', color: '#82B4FF',
    cursor: 'pointer', fontFamily: 'Sora, sans-serif', whiteSpace: 'nowrap',
  },
  uploadBanner: {
    display: 'flex', alignItems: 'center', gap: 6,
    fontSize: 9, color: '#8B949E', background: '#0D1117',
    border: '1px solid #30363D', borderRadius: 7, padding: '5px 9px', marginBottom: 5,
  },
  inputBar: {
    display: 'flex', alignItems: 'center', gap: 5,
    background: '#0D1117', border: '1px solid #30363D',
    borderRadius: 10, padding: '5px 7px',
  },
  attachBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    fontSize: 14, padding: '2px 4px', borderRadius: 5, color: '#8B949E',
    opacity: 0.8,
  },
  textInput: {
    flex: 1, background: 'none', border: 'none', outline: 'none',
    color: '#E6EDF3', fontSize: 11, fontFamily: 'Sora, sans-serif',
    padding: '3px 0',
  },
  sendBtn: {
    background: '#1A73E8', border: 'none', borderRadius: 7,
    color: '#fff', fontSize: 12, fontWeight: 700,
    padding: '4px 10px', cursor: 'pointer', flexShrink: 0, transition: 'opacity .15s',
  },
  stateWrap: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', height: 180, color: '#8B949E', textAlign: 'center',
    marginTop: 8,
  },
  stateMsg: { fontSize: 10, marginBottom: 8 },
  retryBtn: {
    fontSize: 10, fontWeight: 700, padding: '5px 14px', borderRadius: 8,
    border: '1px solid rgba(26,115,232,.3)', background: 'rgba(26,115,232,.1)',
    color: '#82B4FF', cursor: 'pointer', fontFamily: 'Sora, sans-serif',
  },
};
