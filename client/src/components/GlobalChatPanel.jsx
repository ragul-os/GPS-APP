import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  MessageOutlined, 
  SearchOutlined, 
  SendOutlined, 
  PaperClipOutlined, 
  MoreOutlined, 
  InfoCircleOutlined, 
  CloseOutlined, 
  SmileOutlined,
  DoubleLeftOutlined, 
  DoubleRightOutlined,
  TeamOutlined,
  LoadingOutlined
} from '@ant-design/icons';
import { 
  getAlertHistory, 
  getAgentTickets, 
  SYNAPSE_BASE, 
  getSession 
} from '../services/api';
import InteractionsTab from './InteractionsTab';

// Status styling config
const STATUS_CFG = {
  dispatched: { label: 'Dispatched', color: '#E53935' },
  en_route: { label: 'En Route', color: '#FB8C00' },
  on_action: { label: 'On Scene', color: '#43A047' },
  idle: { label: 'Active', color: '#1A73E8' },
  completed: { label: 'Archived', color: '#8B949E' },
};

// Severity colors
const SEV_COLORS = {
  CRITICAL: '#E53935',
  HIGH: '#FB8C00',
  MEDIUM: '#1A73E8',
  LOW: '#43A047',
};

function pickAlertForTicket(ticket, alertHistory) {
  if (!ticket?.id) return null;
  const ids = ticket.alertIds || [];
  const alerts = alertHistory.filter(
    (a) => a.agentTicketId === ticket.id || ids.includes(a.id)
  );
  if (!alerts.length) return null;
  const rank = { on_action: 4, en_route: 3, dispatched: 2, accepted: 2, pending: 1, completed: 0 };
  alerts.sort(
    (a, b) =>
      (rank[b.status] ?? 0) - (rank[a.status] ?? 0) ||
      (b.createdAt || 0) - (a.createdAt || 0)
  );
  return alerts[0];
}

function shouldListAgentTicket(ticket, primaryAgentTicketId) {
  if (!ticket?.id || ticket.status === 'rejected') return false;
  if (primaryAgentTicketId && ticket.id === primaryAgentTicketId) return true;
  if (['dispatched', 'en_route', 'on_action'].includes(ticket.status)) return true;
  if (ticket.status === 'pending' && (ticket.alertIds || []).length > 0) return true;
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Floating trigger component (bubble)
// ─────────────────────────────────────────────────────────────────────────────
export function ChatTriggerButton({ open, onClick, unread }) {
  return (
    <button
      id="global-chat-trigger"
      onClick={onClick}
      style={{
        position: 'relative',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 52, height: 52, borderRadius: '50%',
        background: open ? 'rgba(26,115,232,.22)' : '#161B22',
        border: `2px solid ${open ? '#1A73E8' : '#30363D'}`,
        color: open ? '#82B4FF' : '#E6EDF3',
        cursor: 'pointer', transition: 'all .25s ease',
        boxShadow: open ? '0 8px 32px rgba(26,115,232,.35)' : '0 4px 12px rgba(0,0,0,.4)',
        pointerEvents: 'auto',
        outline: 'none',
      }}
      onMouseEnter={e => {
        if (!open) {
          e.currentTarget.style.borderColor = '#1A73E8';
          e.currentTarget.style.transform = 'translateY(-2px)';
        }
      }}
      onMouseLeave={e => {
        if (!open) {
          e.currentTarget.style.borderColor = '#30363D';
          e.currentTarget.style.transform = 'translateY(0)';
        }
      }}
    >
      <span style={{ fontSize: 22, display: 'flex' }}><MessageOutlined style={{ verticalAlign: 'middle' }} /></span>
      {unread > 0 && (
        <span style={{
          position: 'absolute', top: -4, right: -4,
          minWidth: 20, height: 20, borderRadius: 10,
          background: '#E53935', color: '#fff',
          fontSize: 10, fontWeight: 900,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 5px', border: '2px solid #0D1117',
          animation: 'livePulse 1.2s infinite',
          zIndex: 10,
          boxShadow: '0 0 10px rgba(229,57,53,.4)',
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
export default function GlobalChatPanel({ open, onClose, onUnreadChange, primaryTicketId, onTicketClick }) {
  const [rooms, setRooms] = useState([]); // [{roomId, name, ticketId, alertObj}]
  const [selectedRoomId, setSelectedRoomId] = useState(null);
  const [sidebarWidth, setSidebarWidth] = useState(250);
  const [unreadMap, setUnreadMap] = useState({});  // roomId → count
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Draggable / Resizable State
  const [panelPos, setPanelPos] = useState({ x: 100, y: 80 });
  const [panelSize, setPanelSize] = useState({ w: 900, h: 620 });
  const isDraggingPanel = useRef(false);
  const dragPanelStart = useRef({ x: 0, y: 0 });
  const isResizingPanel = useRef(false);
  const resizePanelStart = useRef({ x: 0, y: 0, w: 0, h: 0 });

  const abortRef = useRef(null);
  const sinceRef = useRef(null);
  const [isMembersOpen, setIsMembersOpen] = useState(false);
  const selectedRef = useRef(selectedRoomId);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartW = useRef(250);
  const roomsRef = useRef([]);     // stable ref for sync closure
  const prevPrimaryTicketIdRef = useRef(undefined);

  useEffect(() => {
    const handleOutside = () => setIsMembersOpen(false);
    document.addEventListener('click', handleOutside);
    return () => document.removeEventListener('click', handleOutside);
  }, []);

  const totalUnread = Object.values(unreadMap).reduce((a, b) => a + b, 0);
  const selectedRoom = rooms.find(r => r.roomId === selectedRoomId);

  const session = getSession();
  const accessToken = session.accessToken || '';
  const myUserId = session.userId || session.user_id || '';

  // ── Keep selectedRef in sync ──────────────────────────────────────────────
  useEffect(() => { selectedRef.current = selectedRoomId; }, [selectedRoomId]);

  // When live-tracking switches incident (primaryTicketId), make that chat the selected + PRIMARY row.
  useEffect(() => {
    if (!open || !primaryTicketId) return;
    const primaryRoom = rooms.find(r => r.ticketId === primaryTicketId);
    if (!primaryRoom) return;
    const primaryChanged = prevPrimaryTicketIdRef.current !== primaryTicketId;
    prevPrimaryTicketIdRef.current = primaryTicketId;
    const selValid = selectedRoomId && rooms.some(r => r.roomId === selectedRoomId);
    if (primaryChanged || !selValid) {
      if (selectedRoomId !== primaryRoom.roomId) {
        setSelectedRoomId(primaryRoom.roomId);
        selectedRef.current = primaryRoom.roomId;
      }
    }
  }, [open, primaryTicketId, rooms, selectedRoomId]);

  // ── Total unread → propagate to parent ───────────────────────────────────
  useEffect(() => {
    const total = Object.values(unreadMap).reduce((a, b) => a + b, 0);
    onUnreadChange?.(total);
  }, [unreadMap, onUnreadChange]);

  // ── Load Matrix joined rooms + local agent tickets (virtual rows until Matrix join syncs) ──
  const loadRooms = useCallback(async () => {
    if (!accessToken) {
      setRooms([]);
      setLoadingRooms(false);
      return;
    }
    setLoadingRooms(true);
    const alertHistory = getAlertHistory();
    const agentTickets = getAgentTickets();
    const ticketIdsSeen = new Set();
    const list = [];

    try {
      const res = await fetch(`${SYNAPSE_BASE}/_matrix/client/v3/joined_rooms`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const { joined_rooms = [] } = await res.json();
        console.log('[GlobalChatPanel] joined_rooms found:', joined_rooms.length);

        for (const roomId of joined_rooms) {
          try {
            const stRes = await fetch(
              `${SYNAPSE_BASE}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state`,
              { headers: { 'Authorization': `Bearer ${accessToken}` } }
            );

            let roomName = '';
            let members = [];
            if (stRes.ok) {
              const stateEvents = await stRes.json();
              const nameEv = stateEvents.find(e => e.type === 'm.room.name');
              const aliasEv = stateEvents.find(e => e.type === 'm.room.canonical_alias');
              roomName = nameEv?.content?.name || aliasEv?.content?.alias || '';

              members = stateEvents
                .filter(e => e.type === 'm.room.member' && e.content?.membership === 'join')
                .map(e => ({
                  userId: e.state_key,
                  displayName: e.content?.displayname || e.state_key.replace(/^@/, '').split(':')[0],
                  membership: e.content?.membership,
                  isMe: e.state_key === session.userId || e.state_key === session.user_id,
                  online: true // Mock as online for UI, presence not tracked in state
                }));
            }

            console.log(`[GlobalChatPanel] DEBUG: Processing room ${roomId}. Found name: "${roomName}"`);

            const ticketId = roomName.replace(/^Ticket-/, '').replace(/#/, '').split(':')[0] || roomId;

            const alertObj = alertHistory.find(a => a.id === ticketId || a.id === roomId) || null;
            const ticketObj = agentTickets.find(t =>
              t.id === ticketId || t.id === roomId || (t.alertIds || []).includes(ticketId) || (t.alertIds || []).includes(roomId)
            ) || null;

            const resolvedAlert = alertObj || (ticketObj ? pickAlertForTicket(ticketObj, alertHistory) : null);

            if (resolvedAlert) console.log(`[GlobalChatPanel] SUCCESS: Matched alert ${resolvedAlert.name} for ticket ${ticketId}`);
            else if (ticketObj) console.log(`[GlobalChatPanel] SUCCESS: Matched ticket for room ${roomId}`);
            else console.log(`[GlobalChatPanel] WARN: No local ticket match for ${roomId} / ${ticketId}`);

            list.push({
              roomId,
              name: roomName || roomId,
              ticketId,
              alertObj: resolvedAlert,
              ticketObj,
              virtual: false,
              members
            });
            ticketIdsSeen.add(ticketId);
          } catch (e) {
            console.warn('[GlobalChatPanel] Failed to load room details:', roomId, e.message);
          }
        }
      } else {
        console.warn('[GlobalChatPanel] joined_rooms request failed:', res.status);
      }

      for (const t of agentTickets) {
        if (!shouldListAgentTicket(t, primaryTicketId)) continue;
        if (ticketIdsSeen.has(t.id)) continue;
        ticketIdsSeen.add(t.id);
        const alertObj = pickAlertForTicket(t, alertHistory);
        list.push({
          roomId: `virtual:${t.id}`,
          name: `Ticket-${t.id}`,
          ticketId: t.id,
          alertObj,
          ticketObj: t,
          virtual: true,
        });
      }

      list.sort((a, b) => {
        if (primaryTicketId) {
          if (a.ticketId === primaryTicketId) return -1;
          if (b.ticketId === primaryTicketId) return 1;
        }
        const aActive = ['dispatched', 'en_route', 'on_action'].includes(a.alertObj?.status);
        const bActive = ['dispatched', 'en_route', 'on_action'].includes(b.alertObj?.status);
        if (aActive && !bActive) return -1;
        if (!aActive && bActive) return 1;
        return 0;
      });

      setRooms(list);
      roomsRef.current = list;

      const sel = selectedRef.current;
      if (sel?.startsWith?.('virtual:')) {
        const tid = sel.slice('virtual:'.length);
        const real = list.find(r => !r.virtual && r.ticketId === tid);
        if (real) {
          setSelectedRoomId(real.roomId);
          selectedRef.current = real.roomId;
        }
      }

      if (!selectedRef.current && list.length > 0) {
        const initial = list.find(r => r.ticketId === primaryTicketId) || list[0];
        setSelectedRoomId(initial.roomId);
        selectedRef.current = initial.roomId;
      }
    } catch (e) {
      console.error('[GlobalChatPanel] loadRooms error:', e);
    }
    setLoadingRooms(false);
  }, [accessToken, primaryTicketId]);

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
            const trackedRoom = roomsRef.current.find(r => r.roomId === roomId && !r.virtual);
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
    window.addEventListener('matrixTicketRoomReady', refresh);
    return () => {
      window.removeEventListener('alertHistoryChange', refresh);
      window.removeEventListener('agentTicketsChange', refresh);
      window.removeEventListener('matrixTicketRoomReady', refresh);
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

    // Notify parent to sync Live Tracking
    const room = roomsRef.current.find(r => r.roomId === roomId);
    if (room?.ticketId && room.ticketId !== primaryTicketId) {
      const alertId = room.alertObj?.id || room.ticketObj?.alertIds?.[0];
      if (alertId) onTicketClick?.(alertId);
    }
  }, [onTicketClick, primaryTicketId]);

  // ── Panel Draggable Logic ────────────────────────────────────────────────
  const onPanelDragStart = useCallback((e) => {
    if (e.target.closest('button')) return; // ignore buttons
    isDraggingPanel.current = true;
    dragPanelStart.current = { x: e.clientX - panelPos.x, y: e.clientY - panelPos.y };
    const onMove = (ev) => {
      if (!isDraggingPanel.current) return;
      setPanelPos({ x: ev.clientX - dragPanelStart.current.x, y: ev.clientY - dragPanelStart.current.y });
    };
    const onUp = () => {
      isDraggingPanel.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [panelPos]);

  // ── Panel Resizable Logic ────────────────────────────────────────────────
  const onPanelResizeStart = useCallback((e) => {
    e.stopPropagation();
    isResizingPanel.current = true;
    resizePanelStart.current = { x: e.clientX, y: e.clientY, w: panelSize.w, h: panelSize.h };
    const onMove = (ev) => {
      if (!isResizingPanel.current) return;
      const dw = ev.clientX - resizePanelStart.current.x;
      const dh = ev.clientY - resizePanelStart.current.y;
      setPanelSize({ w: Math.max(600, resizePanelStart.current.w + dw), h: Math.max(400, resizePanelStart.current.h + dh) });
    };
    const onUp = () => {
      isResizingPanel.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [panelSize]);

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
    const name = (r.alertObj?.name || r.ticketObj?.name || r.name || '').toLowerCase();
    const addr = (r.alertObj?.address || r.ticketObj?.address || '').toLowerCase();
    const tid = (r.ticketId || '').toLowerCase();
    return name.includes(q) || addr.includes(q) || tid.includes(q);
  });

  if (!open) return null;

  return (
    <div 
      id="chat-modal-root"
      style={{
        position: 'fixed', inset: 0, zIndex: 250,
        display: 'flex', alignItems: 'stretch',
        pointerEvents: 'none',
      }}
    >
      {/* ── Backdrop ── */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute', inset: 0,
          background: 'rgba(0,0,0,.3)',
          pointerEvents: 'auto',
        }}
      />

      {/* ── Draggable/Resizable Panel ── */}
      <div 
        id="chat-modal-panel"
        style={{
          position: 'absolute',
          transform: `translate(${panelPos.x}px, ${panelPos.y}px)`,
          width: panelSize.w,
          height: panelSize.h,
          background: '#0D1117',
          border: '1px solid #30363D',
          borderRadius: 16,
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 24px 64px rgba(0,0,0,.85)',
          pointerEvents: 'auto',
          overflow: 'hidden',
          animation: 'modalPop .2s cubic-bezier(.34,1.56,.64,1)',
        }}
      >
        {/* Panel header (Drag Handle) */}
        <div 
          onMouseDown={onPanelDragStart}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 18px', borderBottom: '1px solid #30363D',
            background: '#161B22', flexShrink: 0,
            cursor: 'grab', userSelect: 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: 'rgba(26,115,232,.15)',
              color: '#1A73E8', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              fontSize: 18,
            }}>
              <MessageOutlined style={{ verticalAlign: 'middle' }} />
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
          <div style={{ display: 'flex', gap: 6, position: 'relative' }}>
            <button
              onClick={e => { e.stopPropagation(); setIsMembersOpen(!isMembersOpen); }}
              style={{
                width: 32, height: 32, borderRadius: 8,
                background: isMembersOpen ? 'rgba(26,115,232,.15)' : 'rgba(139,148,158,.1)',
                border: '1px solid #30363D', color: isMembersOpen ? '#1A73E8' : '#8B949E',
                fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all .15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(26,115,232,.2)'; e.currentTarget.style.color = '#1A73E8'; }}
              onMouseLeave={e => { if (!isMembersOpen) { e.currentTarget.style.background = 'rgba(139,148,158,.1)'; e.currentTarget.style.color = '#8B949E'; } }}
            >
              <TeamOutlined />
            </button>

            {isMembersOpen && (
              <div 
                onClick={e => e.stopPropagation()}
                style={{
                  position: 'absolute', top: 40, right: 0, zIndex: 1000, width: 220,
                  background: '#161B22', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                  display: 'flex', flexDirection: 'column', overflow: 'hidden'
                }}
              >
                <div style={{ padding: '10px 14px', fontSize: 11, fontWeight: 700, color: '#8B949E', letterSpacing: '0.04em' }}>
                  MEMBERS
                </div>
                <div style={{ height: 1, background: 'rgba(255,255,255,0.08)' }} />
                
                <div style={{ maxHeight: 240, overflowY: 'auto', padding: '4px 0' }}>
                  {!selectedRoom || loadingRooms ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
                      <LoadingOutlined spin style={{ color: '#1A73E8', fontSize: 20 }} />
                    </div>
                  ) : (selectedRoom.members || []).map((m, idx) => {
                    const initials = (m.displayName || '').substring(0, 2).toUpperCase();
                    return (
                      <div key={idx} style={{ 
                        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                        cursor: 'default', transition: 'background .15s'
                      }} onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <div style={{ position: 'relative', flexShrink: 0 }}>
                          <div style={{ 
                            width: 32, height: 32, borderRadius: 16, background: '#30363D', 
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 10, fontWeight: 800, color: '#8B949E'
                          }}>
                            {initials}
                          </div>
                          <div style={{ 
                            position: 'absolute', bottom: 0, right: 0, width: 8, height: 8,
                            borderRadius: '50%', background: m.online ? '#34A853' : '#8B949E',
                            border: '1.5px solid #161B22'
                          }} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: '#E6EDF3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {m.displayName}
                            </div>
                            {m.isMe && (
                              <span style={{
                                fontSize: 8, padding: '1px 5px', background: 'rgba(52,168,83,.2)', color: '#34A853',
                                borderRadius: 4, fontWeight: 800, letterSpacing: '0.04em'
                              }}>PRIMARY</span>
                            )}
                          </div>
                          <div style={{ fontSize: 11, color: '#8B949E', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.userId}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

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
              ✕
            </button>
          </div>
        </div>

        {/* Body: sidebar + chat */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0, position: 'relative' }}>
          {/* Sidebar */}
          <div style={{
            width: sidebarCollapsed ? 0 : sidebarWidth, 
            flexShrink: 0,
            background: '#161B22', borderRight: sidebarCollapsed ? 'none' : '1px solid #30363D',
            display: 'flex', flexDirection: 'column', 
            overflow: 'hidden',
            transition: 'width .2s cubic-bezier(.4, 0, .2, 1)',
          }}>
            <div style={{ 
              padding: '10px 14px 8px', borderBottom: '1px solid rgba(48,54,61,.6)', 
              flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' 
            }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#8B949E', textTransform: 'uppercase', letterSpacing: 1 }}>
                Ticket Rooms
              </div>
              <button 
                onClick={() => setSidebarCollapsed(true)}
                style={{ 
                  background: 'rgba(255,255,255,.05)', border: 'none', color: '#8B949E', 
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 24, height: 24, borderRadius: 6, transition: 'all .15s'
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,.1)'; e.currentTarget.style.color = '#E6EDF3'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,.05)'; e.currentTarget.style.color = '#8B949E'; }}
                title="Collapse sidebar"
              >
                <DoubleLeftOutlined style={{ fontSize: '16px' }} />
              </button>
            </div>
            
            <div style={{ padding: '8px 14px', flexShrink: 0 }}>
              <div style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 13, opacity: 0.5, display: 'flex', color: '#8B949E' }}>
                  <SearchOutlined style={{ verticalAlign: 'middle' }} />
                </span>
                <input
                  type="text"
                  placeholder="Search rooms..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  style={{
                    width: '100%', background: '#0D1117', border: '1px solid #30363D', borderRadius: 8,
                    padding: '7px 10px 7px 30px', fontSize: 11, color: '#E6EDF3', outline: 'none',
                  }}
                />
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filteredRooms.map(room => {
                const isSelected = room.roomId === selectedRoomId;
                const isPrimary = room.ticketId === primaryTicketId;
                const unread = unreadMap[room.roomId] || 0;
                const alert = room.alertObj;
                const stCfg = STATUS_CFG[alert?.status] || STATUS_CFG.dispatched;
                const sevColor = SEV_COLORS[alert?.severity] || '#8B949E';
                const initials = (alert?.name || room.ticketObj?.name || room.ticketId).slice(0, 2).toUpperCase();

                return (
                  <React.Fragment key={room.roomId}>
                    <div
                      onClick={() => selectRoom(room.roomId)}
                      style={{
                        position: 'relative', display: 'flex', alignItems: 'center', gap: 10,
                        padding: '12px 12px', cursor: 'pointer', borderBottom: '1px solid rgba(48,54,61,.35)',
                        background: isPrimary ? 'rgba(52,168,83,.08)' : (isSelected ? 'rgba(26,115,232,.1)' : 'transparent'),
                        borderLeft: `3px solid ${isPrimary ? '#34A853' : (isSelected ? '#1A73E8' : 'transparent')}`,
                      }}
                    >
                      {isPrimary && (
                        <div style={{ position: 'absolute', top: 4, right: 8, fontSize: 8, fontWeight: 900, color: '#34A853', textTransform: 'uppercase' }}>Primary</div>
                      )}
                      <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, background: `linear-gradient(135deg, ${sevColor}44, ${sevColor}22)`, border: `1.5px solid ${sevColor}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: sevColor }}>
                        {initials}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: isSelected ? '#82B4FF' : '#E6EDF3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {alert?.name || room.ticketObj?.name || room.ticketId}
                        </div>
                        <div style={{ fontSize: 9, color: '#8B949E', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {alert?.address || room.ticketObj?.address || room.name}
                        </div>
                      </div>
                      {unread > 0 && <div style={{ minWidth: 18, height: 18, borderRadius: 9, background: '#1A73E8', color: '#fff', fontSize: 9, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>{unread}</div>}
                    </div>
                    {isPrimary && rooms.length > 1 && (
                      <div style={{ padding: '4px 12px', background: 'rgba(48,54,61,.2)', borderBottom: '1px solid #30363D', fontSize: 8, fontWeight: 700, color: '#8B949E', display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, height: 1, background: 'rgba(48,54,61,.4)' }} />
                          OTHER CHATS
                          <div style={{ flex: 1, height: 1, background: 'rgba(48,54,61,.4)' }} />
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>

            {/* Sidebar Resizer */}
            {!sidebarCollapsed && (
              <div 
                onMouseDown={onDragStart} 
                style={{ 
                  width: 4, cursor: 'col-resize', background: 'transparent',
                  transition: 'background .2s',
                  zIndex: 2,
                }} 
                onMouseEnter={e => e.target.style.background = '#1A73E888'}
                onMouseLeave={e => e.target.style.background = 'transparent'}
              />
            )}

            {/* Vertical strip if collapsed */}
            {sidebarCollapsed && (
              <div style={{
                width: 32, flexShrink: 0, background: '#0D1117', borderRight: '1px solid #30363D',
                display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 10
              }}>
                <button
                  onClick={() => setSidebarCollapsed(false)}
                  style={{
                    width: 24, height: 24, background: 'rgba(255,255,255,.05)', border: 'none', borderRadius: 6,
                    color: '#8B949E', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', transition: 'all .15s'
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,.1)'; e.currentTarget.style.color = '#E6EDF3'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,.05)'; e.currentTarget.style.color = '#8B949E'; }}
                  title="Expand sidebar"
                >
                  <DoubleRightOutlined style={{ fontSize: '16px' }} />
                </button>
              </div>
            )}

            {/* Chat Area */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
            {!selectedRoom ? (
               <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8B949E' }}>Select a ticket room</div>
            ) : (
               <InteractionsTab key={selectedRoom.ticketId} ticketId={selectedRoom.ticketId} alertObj={selectedRoom.alertObj} />
            )}
          </div>
        </div>

        {/* Resize Handle */}
        <div 
          onMouseDown={onPanelResizeStart}
          style={{
            position: 'absolute', bottom: 0, right: 0, width: 20, height: 20,
            cursor: 'nwse-resize', zIndex: 10, pointerEvents: 'auto',
            background: 'linear-gradient(135deg, transparent 50%, rgba(48,54,61,.5) 50%)',
          }}
        />
      </div>

      <style>{`
        @keyframes modalPop {
          from { transform: translate(${panelPos.x}px, ${panelPos.y}px) scale(.92); opacity: 0; }
          to   { transform: translate(${panelPos.x}px, ${panelPos.y}px) scale(1);   opacity: 1; }
        }
        @keyframes livePulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.1); opacity: 0.8; }
        }
      `}</style>
    </div>
  );
}
