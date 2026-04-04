/**
 * GlobalChatPanel — Floating chat overlay for all dispatched ticket rooms.
 *
 * Features:
 * - Trigger button (rendered in LiveTrackingPage topBar) with animated unread badge
 * - Slides in from right side of the screen as a fixed overlay
 * - Resizable left sidebar listing all Ticket-* Matrix rooms with unread counts
 * - Right pane: InteractionsTab for the selected room
 * - Background sync loop to detect incoming messages per room
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import InteractionsTab from './InteractionsTab';
import { MdChat, MdSearch, MdClose } from 'react-icons/md';

const SYNAPSE_BASE = 'http://localhost:8008';
const SEV_COLORS   = { critical: '#E53935', high: '#FF6D00', medium: '#F9A825', low: '#34A853' };
const STATUS_CFG   = {
  pending:    { label: '⏳ Pending',    color: '#F9A825' },
  dispatched: { label: '🚨 Dispatch',  color: '#1A73E8' },
  completed:  { label: '✅ Done',      color: '#34A853' },
  rejected:   { label: '❌ Rejected',  color: '#E53935' },
  en_route:   { label: '🚑 En Route',  color: '#1A73E8' },
  on_action:  { label: '⚡ On Action', color: '#FF6D00' },
  arrived:    { label: '📍 Arrived',   color: '#34A853' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function getSession() {
  try { return JSON.parse(localStorage.getItem('dispatcher') || '{}'); } catch { return {}; }
}
function getAlertHistory() {
  try { return JSON.parse(localStorage.getItem('alertHistory') || '[]'); } catch { return []; }
}
function getAgentTickets() {
  try { return JSON.parse(localStorage.getItem('agentTickets') || '[]'); } catch { return []; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Trigger button — rendered by LiveTrackingPage inside the topBar
// ─────────────────────────────────────────────────────────────────────────────
export function ChatTriggerButton({ open, onClick, unread }) {
  return (
    <button
      id="global-chat-trigger"
      onClick={onClick}
      style={{
        position: 'relative',
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '7px 14px', borderRadius: 9,
        background: open ? 'rgba(26,115,232,.22)' : '#161B22',
        border: `1px solid ${open ? 'rgba(26,115,232,.55)' : '#30363D'}`,
        color: open ? '#82B4FF' : '#E6EDF3',
        fontFamily: 'Sora, sans-serif', fontSize: 12, fontWeight: 700,
        cursor: 'pointer', transition: 'all .2s',
        boxShadow: open ? '0 0 14px rgba(26,115,232,.28)' : 'none',
        pointerEvents: 'auto',
      }}
    >
      <span style={{ fontSize: 14 }}><MdChat /></span>
      Chat
      {unread > 0 && (
        <span style={{
          position: 'absolute', top: -7, right: -7,
          minWidth: 18, height: 18, borderRadius: 9,
          background: '#E53935', color: '#fff',
          fontSize: 9, fontWeight: 800,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 4px', border: '2px solid #0D1117',
          animation: 'livePulse 1.2s infinite',
          zIndex: 10,
        }}>
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main panel component
// ─────────────────────────────────────────────────────────────────────────────
export default function GlobalChatPanel({ open, onClose, onUnreadChange }) {
  const [rooms, setRooms]               = useState([]); // [{roomId, name, ticketId, alertObj}]
  const [selectedRoomId, setSelectedRoomId] = useState(null);
  const [sidebarWidth, setSidebarWidth]     = useState(270);
  const [unreadMap, setUnreadMap]           = useState({});  // roomId → count
  const [loadingRooms, setLoadingRooms]     = useState(false);
  const [searchQuery, setSearchQuery]       = useState('');

  const abortRef          = useRef(null);
  const sinceRef          = useRef(null);
  const selectedRef       = useRef(null);   // mirror of selectedRoomId for closure
  const isDragging        = useRef(false);
  const dragStartX        = useRef(0);
  const dragStartW        = useRef(270);
  const roomsRef          = useRef([]);     // stable ref for sync closure

  const session     = getSession();
  const accessToken = session.accessToken || '';
  const myUserId    = session.userId || session.user_id || '';

  // ── Keep selectedRef in sync ──────────────────────────────────────────────
  useEffect(() => { selectedRef.current = selectedRoomId; }, [selectedRoomId]);

  // ── Total unread → propagate to parent ───────────────────────────────────
  useEffect(() => {
    const total = Object.values(unreadMap).reduce((a, b) => a + b, 0);
    onUnreadChange?.(total);
  }, [unreadMap, onUnreadChange]);

  // ── Load all Ticket-* Matrix rooms ───────────────────────────────────────
  const loadRooms = useCallback(async () => {
    if (!accessToken) return;
    setLoadingRooms(true);
    try {
      const res = await fetch(`${SYNAPSE_BASE}/_matrix/client/v3/joined_rooms`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });
      if (!res.ok) return;
      const { joined_rooms = [] } = await res.json();

      const alertHistory = getAlertHistory();
      const agentTickets = getAgentTickets();
      const list = [];

      for (const roomId of joined_rooms) {
        try {
          // Optimization: Fetch room name ONLY if we don't have a better label
          // and use a very fast state fetch.
          const stRes = await fetch(
            `${SYNAPSE_BASE}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.name`,
            { headers: { 'Authorization': `Bearer ${accessToken}` } }
          );
          let roomName = '';
          if (stRes.ok) {
            const stData = await stRes.json();
            roomName = stData.name || '';
          }

          // If no name found, try to resolve via canonical alias (very common for ticket rooms)
          if (!roomName) {
            const aliasRes = await fetch(
              `${SYNAPSE_BASE}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.canonical_alias`,
              { headers: { 'Authorization': `Bearer ${accessToken}` } }
            );
            if (aliasRes.ok) {
              const aliasData = await aliasRes.json();
              roomName = aliasData.alias || '';
            }
          }

          // If still no name, use roomId as fallback
          if (!roomName) roomName = roomId;
          
          if (!roomName.includes('Ticket-') && !roomId.includes('Ticket-')) continue;

          // "Ticket-TICKET-xxx-yyy" → "TICKET-xxx-yyy"
          const ticketId = roomName.replace(/^Ticket-/, '').replace(/#/, '').split(':')[0] || roomId;

          // Try to find matching alert / ticket
          const alertObj = alertHistory.find(a => a.id === ticketId) || null;
          const ticketObj = agentTickets.find(t =>
            t.id === ticketId || (t.alertIds || []).includes(ticketId)
          ) || null;

          list.push({ roomId, name: roomName, ticketId, alertObj, ticketObj });
        } catch { /* skip rooms we can't read */ }
      }

      // Sort: dispatched/active first, then by creation order
      list.sort((a, b) => {
        const aActive = ['dispatched', 'en_route', 'on_action'].includes(a.alertObj?.status);
        const bActive = ['dispatched', 'en_route', 'on_action'].includes(b.alertObj?.status);
        if (aActive && !bActive) return -1;
        if (!aActive && bActive) return 1;
        return 0;
      });

      setRooms(list);
      roomsRef.current = list;

      // Auto-select first room if none selected
      if (!selectedRef.current && list.length > 0) {
        setSelectedRoomId(list[0].roomId);
        selectedRef.current = list[0].roomId;
      }
    } catch (e) {
      console.error('[GlobalChatPanel] loadRooms error:', e);
    }
    setLoadingRooms(false);
  }, [accessToken]);

  // ── Background sync for unread counts ────────────────────────────────────
  const startSync = useCallback(() => {
    if (!accessToken) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const poll = async () => {
      while (!ctrl.signal.aborted) {
        try {
          const params = new URLSearchParams({ timeout: '20000' });
          if (sinceRef.current) params.set('since', sinceRef.current);

          const res = await fetch(
            `${SYNAPSE_BASE}/_matrix/client/v3/sync?${params}`,
            { headers: { 'Authorization': `Bearer ${accessToken}` }, signal: ctrl.signal }
          );
          if (!res.ok) throw new Error('sync ' + res.status);
          const data = await res.json();
          if (ctrl.signal.aborted) break;

          if (data.next_batch) sinceRef.current = data.next_batch;

          const joinedRooms = data.rooms?.join || {};
          const delta = {};

          for (const [roomId, roomData] of Object.entries(joinedRooms)) {
            // Only count messages from OTHER users in rooms we track
            const trackedRoom = roomsRef.current.find(r => r.roomId === roomId);
            if (!trackedRoom) continue;

            const events = roomData.timeline?.events || [];
            const incoming = events.filter(e =>
              e.type === 'm.room.message' &&
              e.content?.msgtype &&
              e.sender !== myUserId
            );

            // Don't count if this room is currently open AND panel is open
            if (incoming.length > 0 && !(open && selectedRef.current === roomId)) {
              delta[roomId] = (delta[roomId] || 0) + incoming.length;
            }
          }

          if (Object.keys(delta).length > 0) {
            setUnreadMap(prev => {
              const next = { ...prev };
              for (const [rid, count] of Object.entries(delta)) {
                next[rid] = (next[rid] || 0) + count;
              }
              return next;
            });
          }
        } catch (e) {
          if (e.name === 'AbortError' || ctrl.signal.aborted) break;
          await new Promise(r => setTimeout(r, 5000));
        }
      }
    };

    poll();
    return () => ctrl.abort();
  }, [accessToken, myUserId, open]);

  // ── Mount: load rooms + start sync ───────────────────────────────────────
  useEffect(() => {
    if (!accessToken) return;
    loadRooms();
    const cleanup = startSync();
    return () => cleanup?.();
  }, [loadRooms, startSync]);

  // ── Listen for alertHistory/agentTickets changes ──────────────────────────
  useEffect(() => {
    const refresh = () => loadRooms();
    window.addEventListener('alertHistoryChange', refresh);
    window.addEventListener('agentTicketsChange', refresh);
    return () => {
      window.removeEventListener('alertHistoryChange', refresh);
      window.removeEventListener('agentTicketsChange', refresh);
    };
  }, [loadRooms]);

  // ── Clear unread when room is opened ─────────────────────────────────────
  const selectRoom = useCallback((roomId) => {
    setSelectedRoomId(roomId);
    selectedRef.current = roomId;
    setUnreadMap(prev => {
      const next = { ...prev };
      delete next[roomId];
      return next;
    });
  }, []);

  // ── Sidebar resize drag ───────────────────────────────────────────────────
  const onDragStart = useCallback((e) => {
    isDragging.current = true;
    dragStartX.current = e.clientX;
    dragStartW.current = sidebarWidth;
    const onMove = (ev) => {
      if (!isDragging.current) return;
      const delta = ev.clientX - dragStartX.current;
      setSidebarWidth(Math.max(180, Math.min(440, dragStartW.current + delta)));
    };
    const onUp = () => {
      isDragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [sidebarWidth]);

  // ── Derived: search filter ───────────────────────────────────────────────
  const filteredRooms = rooms.filter(r => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const name = (r.alertObj?.name || r.name || '').toLowerCase();
    const addr = (r.alertObj?.address || '').toLowerCase();
    const tid = (r.ticketId || '').toLowerCase();
    return name.includes(q) || addr.includes(q) || tid.includes(q);
  });

  const selectedRoom = rooms.find(r => r.roomId === selectedRoomId);
  const totalUnread  = Object.values(unreadMap).reduce((a, b) => a + b, 0);

  if (!open) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 250,
      display: 'flex', alignItems: 'stretch',
      pointerEvents: 'none',
    }}>
      {/* ── Backdrop ── */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute', inset: 0,
          background: 'rgba(0,0,0,.45)',
          backdropFilter: 'blur(2px)',
          pointerEvents: 'auto',
        }}
      />

      {/* ── Panel ── */}
      <div style={{
        position: 'absolute', top: 0, right: 0, bottom: 0,
        width: 'clamp(560px, 78vw, 1140px)',
        background: '#0D1117',
        borderLeft: '1px solid #30363D',
        borderRadius: '18px 0 0 18px',
        display: 'flex', flexDirection: 'column',
        boxShadow: '-12px 0 60px rgba(0,0,0,.75)',
        pointerEvents: 'auto',
        overflow: 'hidden',
        animation: 'slideInRight .22s cubic-bezier(.22,1,.36,1)',
      }}>

        {/* Panel header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '13px 18px', borderBottom: '1px solid #30363D',
          background: '#161B22', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: 'rgba(26,115,232,.15)',
              color: '#1A73E8', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              fontSize: 18,
            }}>
              <MdChat />
            </div>
            <div>
              <div style={{ fontFamily: 'Sora, sans-serif', fontWeight: 800, fontSize: 14, color: '#E6EDF3' }}>
                Dispatch Chat
              </div>
              <div style={{ fontSize: 10, color: '#8B949E', marginTop: 1 }}>
                {rooms.length} ticket room{rooms.length !== 1 ? 's' : ''}
                {totalUnread > 0 && (
                  <span style={{ marginLeft: 8, color: '#1A73E8', fontWeight: 700 }}>
                    · {totalUnread} unread
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(139,148,158,.1)', border: '1px solid #30363D',
              borderRadius: 8, color: '#8B949E', fontSize: 13, cursor: 'pointer',
              padding: '5px 10px', fontFamily: 'Sora, sans-serif', fontWeight: 700,
              transition: 'all .15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(229,57,53,.15)'; e.currentTarget.style.color = '#E53935'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(139,148,158,.1)'; e.currentTarget.style.color = '#8B949E'; }}
          >
            ✕ Close
          </button>
        </div>

        {/* Body: sidebar + chat */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

          {/* ── Room list sidebar ── */}
          <div style={{
            width: sidebarWidth, flexShrink: 0,
            background: '#161B22',
            borderRight: '1px solid #30363D',
            display: 'flex', flexDirection: 'column',
            overflow: 'hidden',
          }}>
            {/* Sidebar header */}
            <div style={{
              padding: '10px 14px 8px',
              borderBottom: '1px solid rgba(48,54,61,.6)',
              flexShrink: 0,
            }}>
              <div style={{
                fontSize: 9, fontWeight: 700, color: '#8B949E',
                textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3,
              }}>
                Ticket Rooms
              </div>
              <div style={{ fontSize: 10, color: '#8B949E', marginBottom: 10 }}>
                {loadingRooms ? 'Loading…' : `${filteredRooms.length} of ${rooms.length} rooms`}
              </div>

              {/* Search Bar */}
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 13, opacity: 0.5, display: 'flex', color: '#8B949E' }}>
                  <MdSearch />
                </span>
                <input
                  type="text"
                  placeholder="Search rooms..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    background: '#0D1117',
                    border: '1px solid #30363D',
                    borderRadius: 8,
                    padding: '7px 10px 7px 30px',
                    fontSize: 11,
                    color: '#E6EDF3',
                    fontFamily: 'Sora, sans-serif',
                    outline: 'none',
                    transition: 'border-color .15s',
                  }}
                  onFocus={e => e.currentTarget.style.borderColor = '#1A73E8'}
                  onBlur={e => e.currentTarget.style.borderColor = '#30363D'}
                />
              </div>
            </div>

            {/* Room list */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filteredRooms.length === 0 && !loadingRooms && (
                <div style={{
                  padding: '24px 16px', textAlign: 'center',
                  color: '#8B949E', fontSize: 11,
                }}>
                  <div style={{ fontSize: 28, opacity: .2, marginBottom: 8, display: 'flex', justifyContent: 'center' }}>
                    <MdSearch />
                  </div>
                  <div style={{ fontWeight: 700 }}>No matches found</div>
                  <div style={{ opacity: .7, marginTop: 4 }}>Try a different search term</div>
                </div>
              )}
              {filteredRooms.map(room => {
                const isSelected = room.roomId === selectedRoomId;
                const unread     = unreadMap[room.roomId] || 0;
                const alert      = room.alertObj;
                const stCfg      = STATUS_CFG[alert?.status] || STATUS_CFG.dispatched;
                const sevColor   = SEV_COLORS[alert?.severity] || '#8B949E';
                const initials   = (alert?.name || room.ticketId).slice(0, 2).toUpperCase();

                return (
                  <div
                    key={room.roomId}
                    onClick={() => selectRoom(room.roomId)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 12px', cursor: 'pointer',
                      background: isSelected
                        ? 'linear-gradient(90deg, rgba(26,115,232,.18) 0%, rgba(26,115,232,.08) 100%)'
                        : 'transparent',
                      borderLeft: `3px solid ${isSelected ? '#1A73E8' : 'transparent'}`,
                      borderBottom: '1px solid rgba(48,54,61,.35)',
                      transition: 'background .15s',
                    }}
                    onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'rgba(48,54,61,.3)'; }}
                    onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                  >
                    {/* Avatar */}
                    <div style={{
                      width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                      background: `linear-gradient(135deg, ${sevColor}44, ${sevColor}22)`,
                      border: `1.5px solid ${sevColor}55`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 800, color: sevColor,
                      fontFamily: 'Sora, sans-serif',
                    }}>
                      {initials}
                    </div>

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 11, fontWeight: 700,
                        color: isSelected ? '#82B4FF' : '#E6EDF3',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {alert?.name || room.ticketId}
                      </div>
                      <div style={{
                        fontSize: 9, color: '#8B949E', marginTop: 2,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {alert?.address || room.name}
                      </div>
                      {alert && (
                        <div style={{ display: 'flex', gap: 5, marginTop: 3, alignItems: 'center' }}>
                          <span style={{
                            fontSize: 7, fontWeight: 800, textTransform: 'uppercase',
                            padding: '1px 5px', borderRadius: 4,
                            background: `${sevColor}18`, color: sevColor,
                          }}>
                            {alert.severity}
                          </span>
                          <span style={{
                            fontSize: 7, fontWeight: 800,
                            color: stCfg.color, opacity: .85,
                          }}>
                            {stCfg.label}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Unread badge */}
                    {unread > 0 && (
                      <div style={{
                        minWidth: 18, height: 18, borderRadius: 9,
                        background: '#1A73E8', color: '#fff',
                        fontSize: 9, fontWeight: 800, flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: '0 4px', boxShadow: '0 0 8px rgba(26,115,232,.5)',
                        animation: 'livePulse 1.5s infinite',
                      }}>
                        {unread > 99 ? '99+' : unread}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Resize handle ── */}
          <div
            onMouseDown={onDragStart}
            style={{
              width: 5, cursor: 'col-resize', flexShrink: 0,
              background: 'transparent', transition: 'background .2s',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#1A73E8'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          />

          {/* ── Chat area ── */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
            {!selectedRoom ? (
              <div style={{
                flex: 1, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                color: '#8B949E', gap: 12,
              }}>
                <div style={{ fontSize: 52, opacity: .15 }}>💬</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#E6EDF3' }}>Select a ticket room</div>
                <div style={{ fontSize: 11, opacity: .6, textAlign: 'center', maxWidth: 240 }}>
                  Choose a room from the sidebar to view the chat for that dispatched ticket
                </div>
              </div>
            ) : (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {/* Room header */}
                <div style={{
                  padding: '10px 16px', borderBottom: '1px solid #30363D',
                  background: '#161B22', flexShrink: 0,
                  display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  {selectedRoom.alertObj && (
                    <>
                      <div style={{
                        width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                        background: `${SEV_COLORS[selectedRoom.alertObj.severity] || '#8B949E'}22`,
                        border: `1.5px solid ${SEV_COLORS[selectedRoom.alertObj.severity] || '#8B949E'}44`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 14,
                      }}>
                        🚑
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: '#E6EDF3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {selectedRoom.alertObj.name || selectedRoom.ticketId}
                        </div>
                        <div style={{ fontSize: 10, color: '#8B949E', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {selectedRoom.alertObj.address || '—'}
                          {selectedRoom.alertObj.severity && (
                            <span style={{ marginLeft: 6, color: SEV_COLORS[selectedRoom.alertObj.severity] || '#8B949E', fontWeight: 700, textTransform: 'uppercase' }}>
                              · {selectedRoom.alertObj.severity}
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{
                        fontSize: 9, fontWeight: 800, padding: '3px 8px', borderRadius: 6,
                        background: `${STATUS_CFG[selectedRoom.alertObj.status]?.color || '#8B949E'}18`,
                        color: STATUS_CFG[selectedRoom.alertObj.status]?.color || '#8B949E',
                        border: `1px solid ${STATUS_CFG[selectedRoom.alertObj.status]?.color || '#8B949E'}33`,
                        flexShrink: 0,
                      }}>
                        {STATUS_CFG[selectedRoom.alertObj.status]?.label || '—'}
                      </div>
                    </>
                  )}
                  {!selectedRoom.alertObj && (
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#E6EDF3' }}>
                      {selectedRoom.name}
                    </div>
                  )}
                </div>

                {/* InteractionsTab for this room */}
                <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  <InteractionsTab
                    key={selectedRoom.roomId}
                    ticketId={selectedRoom.ticketId}
                    alertObj={selectedRoom.alertObj}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Slide-in animation ── */}
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </div>
  );
}
