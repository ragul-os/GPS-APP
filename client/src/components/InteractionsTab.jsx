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
  downloadMedia, getOrCreateDMRoom,
  sendReaction, pinMessage, forwardMessage
} from '../services/MatrixService';
import EmojiPicker from 'emoji-picker-react';
import { SYNAPSE_BASE_URL, matrixRoomAlias, MATRIX_MAX_UPLOAD_SIZE, SYNAPSE_ADMIN_TOKEN } from '../config/apiConfig';
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
  FieldTimeOutlined,
  TeamOutlined,
  DownloadOutlined,
  RollbackOutlined,
  ExportOutlined,
  PushpinFilled
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
function parseEvents(events = [], myUserId) {
  const msgs = events
    .filter(e => e.type === 'm.room.message' && e.content?.msgtype)
    .map(e => ({
      id: e.event_id || `local-${e.origin_server_ts}`,
      sender: e.sender || '',
      ts: e.origin_server_ts || Date.now(),
      msgtype: e.content.msgtype,
      body: e.content.body || e.content.info?.name || '',
      url: e.content.url || null,
      mxc: e.content.url || null, // Keep original mxc for forwarding/downloading
      geo_uri: e.content.geo_uri || null,
      info: e.content.info || {},
      replyToId: e.content?.['m.relates_to']?.['m.in_reply_to']?.event_id,
      txnId: e.unsigned?.transaction_id || null,
    }));

  // Group reactions
  const reactionMap = {};
  events.filter(e => e.type === 'm.reaction').forEach(e => {
    const relate = e.content?.['m.relates_to'];
    if (relate?.rel_type === 'm.annotation' && relate.event_id) {
      const eid = relate.event_id;
      const key = relate.key;
      if (!reactionMap[eid]) reactionMap[eid] = {};
      if (!reactionMap[eid][key]) reactionMap[eid][key] = [];
      if (!reactionMap[eid][key].includes(e.sender)) reactionMap[eid][key].push(e.sender);
    }
  });

  return { msgs, reactionMap };
}
const fmtTime = ts => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtSize = b => !b ? '' : b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
const shortSender = uid => (uid || '').replace(/^@/, '').split(':')[0] || uid;

// ── Quick-reply suggestions ───────────────────────────────────────────────────
const QUICK_REPLIES = ['Unit en route', 'On scene', 'Need backup', 'Patient stabilised', 'Returning to base'];

// ─────────────────────────────────────────────────────────────────────────────
export default function InteractionsTab({ ticketId, alertObj, initialRoomId }) {
  const [messages, setMessages] = useState([]);
  const [roomId, setRoomId] = useState(initialRoomId || null);
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
  const [showMembersList, setShowMembersList] = useState(false);
  const [dmLoading, setDmLoading] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [forwardMsg, setForwardMsg] = useState(null);
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [reactionTarget, setReactionTarget] = useState(null); // { eventId, rect }
  const [hoveredMsgId, setHoveredMsgId] = useState(null);
  const [reactions, setReactions] = useState({}); // eventId -> { emoji: [users] }
  const [pinnedEvents, setPinnedEvents] = useState([]);
  const [joinedRooms, setJoinedRooms] = useState([]); // for forwarding

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
      let rid = initialRoomId;

      if (!rid) {
        const patientName = alertObj?.name || alertObj?.patientName || '';
        const canonicalRoomName = patientName ? patientName : `Ticket-${ticketId}`;
        const safeAlias = canonicalRoomName.replace(/[^a-zA-Z0-9_\-]/g, '_');
        const fullAlias = matrixRoomAlias(safeAlias);

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
      }

      if (gen !== initGenRef.current) return; // Stale request, ignore

      if (ticketId) setCachedRoom(ticketId, rid);
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
        const txnId = 'v' + Date.now() + Math.random().toString(36).slice(2, 5);
        pendingTxns.current.add(txnId);
        try {
          const up = await uploadMedia(accessToken, file);
          await sendAudioMessage(accessToken, roomId, up.content_uri, {
            name: file.name,
            size: file.size,
            mimetype: file.type,
          }, txnId);
        } catch (err) {
          console.error('[Voice] Upload failed:', err);
        } finally {
          pendingTxns.current.delete(txnId);
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

  const handleMemberClick = async (member) => {
    if (member.userId === myUserId || dmLoading) return;
    setDmLoading(true);
    setShowMembersList(false);
    try {
      const dmRoomId = await getOrCreateDMRoom(accessToken, myUserId, member.userId);
      if (dmRoomId) {
        // Dispatch event so GlobalChatPanel can switch to this room
        window.dispatchEvent(new CustomEvent('matrixSwitchRoom', { detail: { roomId: dmRoomId } }));
      }
    } catch (err) {
      console.error('[DM] Failed to open DM:', err);
      alert('Failed to open direct message: ' + err.message);
    } finally {
      setDmLoading(false);
    }
  };

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
      const res = await getRoomMessages(accessToken, rid, null, 50);
      if (gen !== initGenRef.current) return;

      const events = [...(res.chunk || [])].reverse();
      const { msgs, reactionMap } = parseEvents(events, myUserId);

      const filteredMsgs = msgs.filter(m => {
        if (seenIds.current.has(m.id)) return false;
        seenIds.current.add(m.id);
        return true;
      });

      setMessages(filteredMsgs);
      setReactions(prev => ({ ...prev, ...reactionMap }));
    } catch (e) {
      if (gen === initGenRef.current) console.warn('[InteractionsTab] loadHistory:', e.message);
    }
  }

  const handlePin = async (eventId) => {
    if (!roomId || !accessToken) return;
    try {
      const nextPinned = await pinMessage(accessToken, roomId, eventId);
      setPinnedEvents(nextPinned);
    } catch (err) {
      console.error('[Pin] failed:', err);
    }
  };

  const handleReaction = async (eventId, emoji) => {
    if (!roomId || !accessToken) return;
    try {
      await sendReaction(accessToken, roomId, eventId, emoji);
    } catch (err) {
      console.error('[Reaction] failed:', err);
    }
  };

  const handleForward = async (msg) => {
    setForwardMsg(msg);
    setShowForwardModal(true);
    // Fetch rooms for forwarding
    try {
      const roomIds = await getJoinedRooms(accessToken);
      const roomDetails = await Promise.all(roomIds.map(async (rid) => {
        const name = await getRoomName(accessToken, rid);
        return { id: rid, name };
      }));
      setJoinedRooms(roomDetails);
    } catch (e) {
      console.warn('[Forward] Failed to fetch rooms:', e);
    }
  };

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
          const roomData = data.rooms?.join?.[rid];
          const timelineEvents = roomData?.timeline?.events || [];

          // Sync pinned events
          const stateEvents = roomData?.state?.events || [];
          const pinEvent = stateEvents.find(e => e.type === 'm.room.pinned_events');
          if (pinEvent) setPinnedEvents(pinEvent.content?.pinned || []);

          if (timelineEvents.length) {
            const { msgs: newMsgs, reactionMap } = parseEvents(timelineEvents, myUserId);
            const msgsToRender = newMsgs.filter(m => {
              if (seenIds.current.has(m.id)) return false;
              if (m.id) seenIds.current.add(m.id);
              return true;
            });

            if (msgsToRender.length || Object.keys(reactionMap).length) {
              setReactions(prev => {
                const next = { ...prev };
                Object.keys(reactionMap).forEach(eid => {
                  next[eid] = { ...(next[eid] || {}), ...reactionMap[eid] };
                });
                return next;
              });

              if (msgsToRender.length) {
                setMessages(prev => {
                  const incomingTxnIds = new Set(msgsToRender.map(m => m.txnId).filter(Boolean));
                  const filteredPrev = prev.filter(m => !incomingTxnIds.has(m.id));
                  return [...filteredPrev, ...msgsToRender];
                });
              }
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

  // ── Send text ─────────────────────────────────────────────────────────────
  const handleSend = async () => {
    const txt = inputText.trim();
    if (!txt || !roomId) return;

    // Clear input IMMEDIATELY
    setInputText('');
    const el = textareaRef.current;
    if (el) el.style.height = '40px';

    const sess = JSON.parse(localStorage.getItem('dispatcher') || '{}');
    const senderId = sess.userId || sess.user_id;

    // Standard room send (DMs no longer triggered by @mention)
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
      if (replyTo) {
        await sendMessage(accessToken, roomId, txt, txnId, {
          'm.relates_to': {
            'm.in_reply_to': {
              event_id: replyTo.id
            }
          }
        });
        setReplyTo(null);
      } else {
        await sendMessage(accessToken, roomId, txt, txnId);
      }
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
        const txnId = 'loc-' + Date.now() + Math.random().toString(36).slice(2, 5);

        pendingTxns.current.add(txnId);
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
      } finally {
        pendingTxns.current.delete(txnId);
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
    const txnId = 'f' + Date.now() + Math.random().toString(36).slice(2, 5);
    pendingTxns.current.add(txnId);
    try {
      // uploadMedia — HTTP/2 preferred for file uploads
      const up = await uploadMedia(accessToken, file);
      const mxc = up.content_uri;
      const mime = file.type || 'application/octet-stream';
      const info = { name: file.name, mimetype: mime, size: file.size };
      if (mime.startsWith('image/')) await sendImageMessage(accessToken, roomIdRef.current, mxc, info, txnId);
      else if (mime.startsWith('video/')) await sendVideoMessage(accessToken, roomIdRef.current, mxc, info, txnId);
      else if (mime.startsWith('audio/')) await sendAudioMessage(accessToken, roomIdRef.current, mxc, info, txnId);
      else await sendFileMessage(accessToken, roomIdRef.current, mxc, file.name, info, txnId);
    } catch (e) {
      console.error('[InteractionsTab] file send:', e);
      alert('Upload failed. This may be due to server-side size limits or connection issues.');
    } finally {
      pendingTxns.current.delete(txnId);
      setUploading(false);
      setUploadName('');
    }
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
        style={{ maxWidth: '100%', maxHeight: 400, minHeight: 40, minWidth: 60, borderRadius: 7, cursor: 'pointer', display: 'block', objectFit: 'cover' }}
      />
    );
  };

  // ── Message renderer ──────────────────────────────────────────────────────
  function renderMsg(msg) {
    const mine = msg.sender === myUserId;
    const sender = shortSender(msg.sender);
    const time = fmtTime(msg.ts);
    const isHovered = hoveredMsgId === msg.id;
    const isPinned = pinnedEvents.includes(msg.id);

    const isImage = msg.msgtype === 'm.image' || msg.info?.mimetype?.startsWith('image/');
    const isMedia = ['m.video', 'm.audio', 'm.file'].includes(msg.msgtype) || isImage;
    const isLocation = msg.msgtype === 'm.location';

    const bubble = {
      maxWidth: '80%', padding: '7px 10px',
      borderRadius: mine ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
      background: mine ? 'rgba(26,115,232,.2)' : 'rgba(48,54,61,.75)',
      border: mine ? '1px solid rgba(26,115,232,.3)' : '1px solid rgba(48,54,61,.9)',
      fontSize: 11, color: '#E6EDF3', fontFamily: 'Sora, sans-serif',
      lineHeight: 1.55, wordBreak: 'break-word',
      position: 'relative',
      minWidth: isMedia ? 300 : 'auto'
    };
    const metaRow = {
      fontSize: 8, color: '#8B949E', marginTop: 3, display: 'flex', gap: 5,
      justifyContent: mine ? 'flex-end' : 'flex-start',
    };
    let inner;

    // Actions Menu (Element style)
    const renderActions = () => (
      <div style={{
        position: 'absolute', top: -30, right: mine ? 0 : 'auto', left: mine ? 'auto' : 0,
        display: 'flex', gap: 4, background: '#161B22', border: '1px solid #30363D',
        borderRadius: 8, padding: '2px 4px', boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        zIndex: 10, opacity: isHovered ? 1 : 0, visibility: isHovered ? 'visible' : 'hidden',
        transition: 'all 0.15s ease'
      }}>
        {isMedia && (
          <button onClick={() => handleDownload(msg.mxc, msg.body)} style={st.actionBtn} title="Download">
            <DownloadOutlined />
          </button>
        )}
        <button onClick={() => setReplyTo(msg)} style={st.actionBtn} title="Reply">
          <RollbackOutlined />
        </button>
        <button
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setReactionTarget({ eventId: msg.id, rect });
          }}
          style={st.actionBtn}
          title="React"
        >
          <SmileOutlined />
        </button>
        <button onClick={() => handlePin(msg.id)} style={st.actionBtn} title={isPinned ? "Unpin" : "Pin"}>
          {isPinned ? <PushpinFilled style={{ color: '#1A73E8' }} /> : <PushpinOutlined />}
        </button>
        <button
          onClick={() => {
            setForwardMsg(msg);
            setShowForwardModal(true);
          }}
          style={st.actionBtn}
          title="Forward"
        >
          <ExportOutlined />
        </button>
      </div>
    );

    const replyMsg = msg.replyToId ? messages.find(m => m.id === msg.replyToId) : null;

    const renderReplyTag = () => replyMsg && (
      <div
        onClick={() => {
          const el = document.getElementById(`msg-${msg.replyToId}`);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }}
        style={{
          background: mine ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)',
          borderLeft: mine ? '3px solid #DBEAFE' : '3px solid #1A73E8',
          padding: '4px 8px', borderRadius: 4, marginBottom: 6, cursor: 'pointer',
          fontSize: 9, opacity: 0.9
        }}
      >
        <div style={{ fontWeight: 700, color: mine ? '#DBEAFE' : '#82B4FF' }}>{shortSender(replyMsg.sender)}</div>
        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: mine ? 'rgba(255,255,255,0.8)' : 'inherit' }}>{replyMsg.body}</div>
      </div>
    );

    const renderReactions = () => {
      const msgReactions = reactions[msg.id];
      if (!msgReactions) return null;
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
          {Object.entries(msgReactions).map(([emoji, users]) => {
            const hasReacted = users.includes(myUserId);
            const userList = users.map(u => shortSender(u)).join(', ');
            return (
              <div
                key={emoji}
                title={`Reacted by: ${userList}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleReaction(msg.id, emoji); // This will toggle on server
                }}
                style={{
                  background: hasReacted ? 'rgba(26,115,232,0.2)' : 'rgba(255,255,255,0.1)',
                  border: hasReacted ? '1px solid rgba(26,115,232,0.4)' : '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 12, padding: '1px 6px', fontSize: 10, display: 'flex', alignItems: 'center', gap: 3,
                  cursor: 'pointer', transition: 'all 0.2s'
                }}
              >
                <span>{emoji}</span>
                <span style={{ fontSize: 9, fontWeight: 700, opacity: 0.7 }}>{users.length}</span>
              </div>
            );
          })}
        </div>
      );
    };

    if (isLocation) {
      const g = msg.geo_uri?.replace('geo:', '').split(',') || [12.9716, 80.2425]; // Default to Chennai coords if missing
      const lat = g[0];
      const lng = g[1];
      const embedUrl = `https://maps.google.com/maps?q=${lat},${lng}&z=15&output=embed`;
      const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;

      inner = (
        <div id={`msg-${msg.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 200 }}>
          {renderActions()}
          {renderReplyTag()}
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
          {renderReactions()}
          <div style={metaRow}><span>{sender}</span><span>{time}</span></div>
        </div>
      );
    } else if (isMedia && msg.url) {
      const icon = msg.msgtype === 'm.video' ? <VideoCameraOutlined /> : msg.msgtype === 'm.audio' ? <SoundOutlined /> : <PaperClipOutlined />;
      const thumb = isImage ? buildThumbnailUrl(msg.url, 220, 160) : null;
      const full = buildMediaUrl(msg.url);

      inner = (
        <div id={`msg-${msg.id}`} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {renderActions()}
          {renderReplyTag()}
          {/* File block (show ONLY for documents) */}
          {msg.msgtype === 'm.file' && (
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
            </div>
          )}

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
              style={{ width: '100%', borderRadius: 8, maxHeight: 350, background: '#000', marginTop: 2 }}
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
              style={{ width: '100%', height: 44, marginTop: 2, minWidth: 250 }}
              onError={(e) => {
                e.target.style.display = 'none';
                const err = document.createElement('div');
                err.style.cssText = 'color:#8B949E; font-size:9px; padding:8px; text-align:center;';
                err.innerHTML = '🎵 Audio unavailable';
                e.target.parentElement.appendChild(err);
              }}
            />
          )}

          {renderReactions()}
          <div style={metaRow}><span>{sender}</span><span>{time}</span></div>
        </div>
      );
    } else {
      inner = (
        <div id={`msg-${msg.id}`}>
          {renderActions()}
          {renderReplyTag()}
          <div style={{ fontSize: 11, lineHeight: 1.6 }}>{msg.body}</div>
          {renderReactions()}
          <div style={metaRow}><span>{sender}</span><span>{time}</span></div>
        </div>
      );
    }

    return (
      <div
        key={msg.id}
        onMouseEnter={() => setHoveredMsgId(msg.id)}
        onMouseLeave={() => setHoveredMsgId(null)}
        style={{ display: 'flex', flexDirection: mine ? 'row-reverse' : 'row', alignItems: 'flex-end', gap: 5, marginBottom: 12 }}
      >
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
      {dmLoading && (
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(13,17,23,0.6)', zIndex: 1000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <LoadingOutlined style={{ fontSize: 24, color: '#1A73E8' }} spin />
          <div style={{ fontSize: 11, color: '#82B4FF', fontWeight: 700 }}>Opening Direct Message...</div>
        </div>
      )}

      {/* Message list */}
      <div style={st.msgList}>
        {pinnedEvents.length > 0 && (
          <div style={{
            position: 'sticky', top: 0, zIndex: 5, background: 'rgba(13,17,23,0.95)',
            borderBottom: '1px solid #30363D', padding: '6px 12px', marginBottom: 12,
            display: 'flex', alignItems: 'center', gap: 10, borderRadius: '0 0 12px 12px'
          }}>
            <PushpinFilled style={{ color: '#1A73E8', fontSize: 14 }} />
            <div style={{ flex: 1, fontSize: 10, color: '#E6EDF3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {pinnedEvents.length} Pinned {pinnedEvents.length === 1 ? 'Message' : 'Messages'}
            </div>
            <button
              onClick={() => {
                const firstPinId = pinnedEvents[0];
                const el = document.getElementById(`msg-${firstPinId}`);
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}
              style={{ background: 'none', border: 'none', color: '#82B4FF', fontSize: 9, fontWeight: 700, cursor: 'pointer' }}
            >VIEW</button>
          </div>
        )}
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

      {/* Reply Preview */}
      {replyTo && (
        <div style={{
          padding: '8px 12px', background: 'rgba(26,115,232,0.1)', borderLeft: '4px solid #1A73E8',
          marginBottom: 8, borderRadius: '4px 8px 8px 4px', display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', animation: 'fadeIn 0.2s ease'
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#82B4FF', marginBottom: 2 }}>Replying to {shortSender(replyTo.sender)}</div>
            <div style={{ fontSize: 10, color: '#E6EDF3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{replyTo.body}</div>
          </div>
          <button onClick={() => setReplyTo(null)} style={{ background: 'none', border: 'none', color: '#8B949E', cursor: 'pointer', padding: 4 }}>
            <CloseCircleOutlined style={{ fontSize: 14 }} />
          </button>
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
                    <div style={{
                      fontWeight: 700,
                      color: m.userId === myUserId ? '#34A853' : 'inherit'
                    }}>
                      {m.displayName} {m.userId === myUserId && '(You)'}
                    </div>
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
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)', marginBottom: 8,
              zIndex: 110
            }}>
              <EmojiPicker
                theme="dark"
                onEmojiClick={(emojiData) => {
                  setInputText(prev => prev + emojiData.emoji);
                  setShowEmojiPicker(false);
                }}
                width={300}
                height={400}
                lazyLoadEmojis={true}
                searchPlaceHolder="Search emojis..."
              />
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

      {/* Reaction Picker Overlay */}
      {reactionTarget && (
        <div
          onClick={() => setReactionTarget(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 10000 }}
        >
          <div style={{
            position: 'absolute', top: reactionTarget.rect.top - 40, left: reactionTarget.rect.left,
            background: '#161B22', border: '1px solid #30363D', borderRadius: 20,
            padding: '4px 8px', display: 'flex', gap: 6, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            animation: 'dropdownSlide 0.2s ease'
          }}>
            {['👍', '❤️', '😂', '😮', '😢', '🔥'].map(emoji => (
              <button
                key={emoji}
                onClick={(e) => {
                  e.stopPropagation();
                  handleReaction(reactionTarget.eventId, emoji);
                  setReactionTarget(null);
                }}
                style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', padding: '2px 4px' }}
              >{emoji}</button>
            ))}
          </div>
        </div>
      )}

      {/* Forward Modal */}
      {showForwardModal && forwardMsg && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div
            onClick={() => setShowForwardModal(false)}
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)' }}
          />
          <div style={{
            position: 'relative', width: 340, background: '#161B22', border: '1px solid #30363D',
            borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column',
            boxShadow: '0 24px 64px rgba(0,0,0,0.8)', animation: 'modalPop .2s ease'
          }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #30363D', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#E6EDF3' }}>Forward Message</div>
              <button onClick={() => setShowForwardModal(false)} style={{ background: 'none', border: 'none', color: '#8B949E', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>

            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: 11, color: '#8B949E' }}>Forwarding: <span style={{ color: '#E6EDF3' }}>{forwardMsg.body}</span></div>
              <div style={{ height: 1, background: '#30363D' }} />
              <div style={{ fontSize: 11, color: '#1A73E8', fontWeight: 700 }}>Select a room to forward:</div>
              <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                {joinedRooms.length > 0 ? joinedRooms.map(r => (
                  <button
                    key={r.id}
                    onClick={async () => {
                      try {
                        await forwardMessage(accessToken, r.id, forwardMsg);
                        setShowForwardModal(false);
                        alert(`Forwarded to ${r.name}`);
                      } catch (e) { alert('Forward failed'); }
                    }}
                    style={{
                      padding: '10px 12px', background: 'rgba(26,115,232,0.1)', border: '1px solid #1A73E8',
                      borderRadius: 8, color: '#82B4FF', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                      textAlign: 'left'
                    }}
                  >{r.name}</button>
                )) : (
                  <div style={{ fontSize: 10, color: '#8B949E', textAlign: 'center', padding: 10 }}>Loading rooms...</div>
                )}
              </div>
            </div>
          </div>
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
  actionBtn: {
    background: 'none', border: 'none', color: '#8B949E', cursor: 'pointer',
    padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 14, transition: 'all 0.1s ease', borderRadius: 4,
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
