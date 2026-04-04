/**
 * InteractionsTab.jsx — NEW FILE
 * Matrix-powered chat tab for the live-tracking left panel.
 * Only adds new functionality; does not modify any existing component.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  createRoom, joinRoom, sendMessage, getRoomMessages,
  sync, uploadMedia,
  sendImageMessage, sendVideoMessage, sendAudioMessage, sendFileMessage,
  downloadMedia,
} from '../services/MatrixService';
import { 
  MdAttachFile, MdMic, MdStop, MdSend, MdHistory, 
  MdWarning, MdLock, MdChat, MdMovie, MdMusicNote,
  MdCloudUpload, MdCheckCircle, MdCancel, MdArrowForward
} from 'react-icons/md';
import { AiOutlineLoading3Quarters } from 'react-icons/ai';

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
  const timerRef = useRef(null);

  const sinceRef = useRef(null);
  const abortRef = useRef(null);
  const roomIdRef = useRef(null);     // mirror for closures
  const seenIds = useRef(new Set()); // event_ids we've already rendered
  const pendingTxns = useRef(new Set()); // txnIds of optimistic sends in-flight
  const bottomRef = useRef(null);
  const messagesEndRef = bottomRef;      // alias — both point to the scroll anchor
  const fileInputRef = useRef(null);
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
    return `http://localhost:8008/_matrix/client/v1/media/download/${parts[0]}/${parts[1]}?allow_redirect=true&access_token=${accessToken}`;
  };

  const buildThumbnailUrl = (mxc, w, h) => {
    if (!mxc) return '';
    const parts = mxc.replace('mxc://', '').split('/');
    if (parts.length !== 2) return mxc;
    return `http://localhost:8008/_matrix/client/v1/media/thumbnail/${parts[0]}/${parts[1]}?width=${w}&height=${h}&method=scale&allow_redirect=true&access_token=${accessToken}`;
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
      const fullAlias = `#${safeAlias}:localhost`;
      let rid = null;

      // Step 1: Check local cache first (fastest)
      rid = getCachedRoom(ticketId);
      
      // Step 2: If no cache, resolve by alias from Synapse
      if (!rid) {
        try {
          const aliasRes = await fetch(
            `http://localhost:8008/_matrix/client/v3/directory/room/${encodeURIComponent(fullAlias)}`,
            { headers: { 'Authorization': `Bearer ${accessToken}` } }
          );
          if (aliasRes.ok) {
            const aliasData = await aliasRes.json();
            if (aliasData.room_id) rid = aliasData.room_id;
          }
        } catch {}
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

      // Load history
      await loadHistory(rid);

      // Start sync
      startSync(rid);
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

  async function loadHistory(rid) {
    try {
      // getRoomMessages — HTTP/2 preferred for potentially large payloads
      const res = await getRoomMessages(accessToken, rid, null, 50);
      const events = [...(res.chunk || [])].reverse(); // chunk is newest-first
      const msgs = parseEvents(events).filter(m => {
        if (seenIds.current.has(m.id)) return false;
        seenIds.current.add(m.id);
        return true;
      });
      setMessages(msgs);
    } catch (e) { console.warn('[InteractionsTab] loadHistory:', e.message); }
  }

  // ── Sync loop — HTTP/2 long-polling via native fetch ─────────────────────
  function startSync(rid) {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    // Bug 4 fix — always start sync with null (never use getRoomMessages pagination token)
    let currentSince = null;
    const poll = async () => {
      while (!ctrl.signal.aborted) {
        try {
          // sync() uses native fetch() — HTTP/2 mandatory (browser negotiates automatically)
          const data = await sync(accessToken, currentSince, ctrl.signal);
          if (ctrl.signal.aborted) break;

          // Debug logs to diagnose roomId mismatch
          const joinedRooms = Object.keys(data.rooms?.join || {});
          console.log('[Sync] next_batch:', data.next_batch);
          console.log('[Sync] joined room keys:', joinedRooms);
          console.log('[Sync] our roomId:', rid);
          console.log('[Sync] match found:', joinedRooms.includes(rid));

          if (data.next_batch) currentSince = data.next_batch;

          // Resolve roomId — exact match first.
          // Fallback: scan ALL joined rooms (covers edge case where rid encoding differs).
          // Messages from other rooms are deduped by seenIds so no cross-contamination.
          const roomsToProcess = joinedRooms.includes(rid)
            ? [rid]
            : joinedRooms; // fallback: process all — seenIds prevents cross-room pollution

          if (!joinedRooms.includes(rid) && joinedRooms.length > 0) {
            console.warn('[Sync] Exact roomId not found — scanning all joined rooms as fallback:', joinedRooms);
          }

          const allNewEvents = roomsToProcess.flatMap(rId =>
            data.rooms?.join?.[rId]?.timeline?.events || []
          );

          if (allNewEvents.length) {
            // Filter raw events BEFORE parseEvents so we can read unsigned.transaction_id
            const filtered = allNewEvents.filter(e => {
              // Skip our own optimistic sends — identified by transaction_id in the closure
              if (e.unsigned?.transaction_id && pendingTxns.current.has(e.unsigned.transaction_id)) {
                // The server confirmed our send — register the real event_id and skip (already shown optimistically)
                if (e.event_id) seenIds.current.add(e.event_id);
                return false;
              }
              // Skip duplicates
              if (seenIds.current.has(e.event_id)) return false;
              if (e.event_id) seenIds.current.add(e.event_id);
              // Only render message events
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
                info: e.content.info || {},
              }));
              setMessages(prev => [...prev, ...newMsgs]);
            }
          }
        } catch (e) {
          if (e.name === 'AbortError' || ctrl.signal.aborted) break;
          console.warn('[InteractionsTab] Sync error, retrying in 4s:', e.message);
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

    const sess = JSON.parse(localStorage.getItem('dispatcher') || '{}');
    const senderId = sess.userId || sess.user_id;
    const txnId = 'm' + Date.now() + Math.random().toString(36).slice(2, 7);

    setInputText('');

    // Register txnId so the sync loop can identify and skip the server echo
    pendingTxns.current.add(txnId);

    // Optimistic update — show message immediately with the local txnId
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
      console.log('[InteractionsTab] Sending to room:', roomId, 'msg:', txt);
      const result = await sendMessage(accessToken, roomId, txt);
      console.log('[InteractionsTab] Send success, event_id:', result?.event_id);
      // Register the real server event_id so seenIds can deduplicate it if sync delivers it
      if (result?.event_id) seenIds.current.add(result.event_id);
    } catch (err) {
      console.error('[InteractionsTab] Send failed:', err);
    } finally {
      // Always clean up — whether send succeeded or failed
      pendingTxns.current.delete(txnId);
    }
  };

  // ── File attachment ───────────────────────────────────────────────────────
  const handleFile = useCallback(async e => {
    const file = e.target.files?.[0];
    if (!file || !roomIdRef.current) return;
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
    } catch (e) { console.error('[InteractionsTab] file send:', e); }
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
        <div style={{ fontSize: 16, marginBottom: 4 }}>⚠️</div>
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

    let inner;
    const isImage = msg.msgtype === 'm.image' || msg.info?.mimetype?.startsWith('image/');
    const isMedia = ['m.video', 'm.audio', 'm.file'].includes(msg.msgtype) || isImage;

    if (isMedia && msg.url) {
      const icon = msg.msgtype === 'm.video' ? <MdMovie /> : msg.msgtype === 'm.audio' ? <MdMusicNote /> : <MdAttachFile />;
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
      <div style={{ fontSize: 22, marginBottom: 6, color: '#8B949E' }}><MdLock /></div>
      <div style={st.stateMsg}>Not authenticated — log in to use chat</div>
    </div>
  );
  if (loading) return (
    <div style={st.stateWrap}>
      <div style={{ fontSize: 20, marginBottom: 6, color: '#1A73E8', animation: 'spin 1s linear infinite' }}><AiOutlineLoading3Quarters /></div>
      <div style={st.stateMsg}>Opening chat room…</div>
    </div>
  );
  if (error) return (
    <div style={st.stateWrap}>
      <div style={{ fontSize: 20, marginBottom: 6, color: '#E53935' }}><MdWarning /></div>
      <div style={{ ...st.stateMsg, color: '#E53935' }}>{error}</div>
      <button onClick={initRoom} style={st.retryBtn}>Retry</button>
    </div>
  );

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <div style={st.wrap}>
      {/* Room ID header */}
      <div style={st.roomRow}>
        <span style={{ fontSize: 8, color: '#8B949E', fontFamily: 'JetBrains Mono, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {roomId}
        </span>
        <span style={{ fontSize: 8, fontWeight: 800, color: '#34A853', background: 'rgba(52,168,83,.12)', border: '1px solid rgba(52,168,83,.25)', borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}>LIVE</span>
      </div>

      {/* Message list */}
      <div style={st.msgList}>
        {messages.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#8B949E', fontSize: 10, paddingTop: 24 }}>
            <div style={{ fontSize: 24, marginBottom: 6, opacity: 0.4 }}><MdChat /></div>
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
          <MdCloudUpload style={{ fontSize: 12, color: '#1A73E8' }} />
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{uploadName}</span>
          <span style={{ opacity: 0.6 }}>Uploading…</span>
        </div>
      )}

      {/* Input bar — Bug 1 fix: plain div, no form, direct onClick wiring */}
      <div style={{ padding: '6px 0', borderTop: '1px solid #30363D', display: 'flex', gap: 6, alignItems: 'center' }}>
        <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFile} />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          style={{ width: 28, height: 28, borderRadius: 6, background: '#161B22', border: '1px solid #30363D', color: '#8B949E', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        ><MdAttachFile /></button>

        <button
          type="button"
          onClick={isRecording ? stopRecording : startRecording}
          style={{ 
            width: 28, height: 28, borderRadius: 6, 
            background: isRecording ? 'rgba(229,57,53,0.15)' : '#161B22', 
            border: isRecording ? '1px solid #E53935' : '1px solid #30363D', 
            color: isRecording ? '#E53935' : '#8B949E', 
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            position: 'relative'
          }}
        >
          {isRecording ? <MdStop size={18} /> : <MdMic size={18} />}
          {isRecording && (
            <div style={{
              position: 'absolute', top: -20, left: '50%', transform: 'translateX(-50%)',
              background: '#E53935', color: '#fff', fontSize: 8, fontWeight: 800,
              padding: '2px 6px', borderRadius: 10, whiteSpace: 'nowrap',
              display: 'flex', alignItems: 'center', gap: 3
            }}><MdFiberManualRecord style={{ animation: 'livePulse 1s infinite' }} /> REC {fmtDuration(recordingTime)}</div>
          )}
        </button>

        <input
          type="text"
          value={inputText}
          onChange={e => setInputText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && inputText.trim()) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Type a message..."
          style={{ flex: 1, background: '#161B22', border: '1px solid #30363D', borderRadius: 6, padding: '6px 10px', color: '#E6EDF3', fontSize: 11, fontFamily: 'Sora, sans-serif', outline: 'none' }}
        />

        <button
          type="button"
          onClick={handleSend}
          disabled={!inputText.trim() || !roomId}
          style={{ padding: '0 10px', height: 28, borderRadius: 6, background: inputText.trim() ? '#1A73E8' : '#30363D', border: 'none', color: inputText.trim() ? '#fff' : '#8B949E', cursor: inputText.trim() ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 700, fontFamily: 'Sora, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        ><MdSend /></button>
      </div>

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
                err.innerHTML = '<div style="font-size: 32px; margin-bottom: 8px;">⚠️</div><div style="color: #fff; font-family: Sora; font-size: 14px; text-align: center;">Full resolution media missing on server</div>';
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
    height: 420, marginTop: 8,
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
