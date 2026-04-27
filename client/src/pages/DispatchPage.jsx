import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import MapView from '../components/MapView';
import NearbyResources from '../components/NearbyResources';
import UnitList from '../components/UnitList';
import { sendAlert, assignUnit, getTickets } from '../api/api';
import {
  dispatchTicketEvent,
  closeTicketEvent,
} from '../services/ticketEventsApi';
import { useAuth } from '../context/AuthContext';
import { createRoom, inviteUser } from '../services/MatrixService';
import { matrixUserId } from '../config/apiConfig';
import {
  AimOutlined,
  AlertOutlined,
  ApartmentOutlined,
  ArrowLeftOutlined,
  BarChartOutlined,
  CheckCircleFilled,
  CheckCircleOutlined,
  ClockCircleFilled,
  ClockCircleOutlined,
  CloseCircleOutlined,
  CloseOutlined,
  CompassOutlined,
  DownOutlined,
  EditOutlined,
  EnvironmentOutlined,
  ExclamationCircleFilled,
  FileTextOutlined,
  FireOutlined,
  LoadingOutlined,
  LockOutlined,
  MedicineBoxOutlined,
  NodeIndexOutlined,
  PhoneOutlined,
  PlusOutlined,
  PushpinOutlined,
  ReloadOutlined,
  SafetyOutlined,
  SearchOutlined,
  SendOutlined,
  SettingOutlined,
  UpOutlined,
  WarningOutlined,
  UnorderedListOutlined,
  AppstoreOutlined,
} from '@ant-design/icons';
/* ── Unit config ── */
const UCFG = {
  ambulance: {
    icon: (
      <MedicineBoxOutlined
        style={{ fontSize: '20px', verticalAlign: 'middle' }}
      />
    ),
    label: 'Ambulance',
    color: '#E53935',
    barColor: '#E53935',
    btnCls: {
      background: '#E53935',
      boxShadow: '0 4px 18px rgba(229,57,53,.35)',
    },
  },
  fire: {
    icon: (
      <FireOutlined style={{ fontSize: '20px', verticalAlign: 'middle' }} />
    ),
    label: 'Fire Engine',
    color: '#FF6D00',
    barColor: '#FF6D00',
    btnCls: {
      background: '#FF6D00',
      boxShadow: '0 4px 18px rgba(255,109,0,.3)',
    },
  },
  police: {
    icon: (
      <SafetyOutlined style={{ fontSize: '20px', verticalAlign: 'middle' }} />
    ),
    label: 'Police Unit',
    color: '#1565C0',
    barColor: '#1565C0',
    btnCls: {
      background: '#1565C0',
      boxShadow: '0 4px 18px rgba(21,101,192,.35)',
    },
  },
  rescue: {
    icon: (
      <AlertOutlined style={{ fontSize: '20px', verticalAlign: 'middle' }} />
    ),
    label: 'Rescue',
    color: '#9C27B0',
    barColor: '#9C27B0',
    btnCls: {
      background: '#9C27B0',
      boxShadow: '0 4px 18px rgba(156,39,176,.3)',
    },
  },
  hazmat: {
    icon: (
      <WarningOutlined style={{ fontSize: '20px', verticalAlign: 'middle' }} />
    ),
    label: 'Hazmat',
    color: '#F57F17',
    barColor: '#F57F17',
    btnCls: {
      background: '#F57F17',
      boxShadow: '0 4px 18px rgba(245,127,23,.3)',
    },
  },
};
const SEV_COLORS = {
  critical: '#E53935',
  high: '#FF6D00',
  medium: '#F9A825',
  low: '#34A853',
};
const STATUS_CFG = {
  pending: {
    label: 'Pending',
    icon: (
      <ClockCircleOutlined
        style={{ fontSize: '16px', verticalAlign: 'middle' }}
      />
    ),
    color: '#F9A825',
    bg: 'rgba(249,168,37,.12)',
  },
  dispatched: {
    label: 'Dispatched',
    icon: (
      <NodeIndexOutlined
        style={{ fontSize: '16px', verticalAlign: 'middle' }}
      />
    ),
    color: '#1A73E8',
    bg: 'rgba(26,115,232,.12)',
  },
  completed: {
    label: 'Completed',
    icon: (
      <CheckCircleOutlined
        style={{ fontSize: '16px', verticalAlign: 'middle' }}
      />
    ),
    color: '#34A853',
    bg: 'rgba(52,168,83,.12)',
  },
  rejected: {
    label: 'Rejected',
    icon: (
      <CloseCircleOutlined
        style={{ fontSize: '16px', verticalAlign: 'middle' }}
      />
    ),
    color: '#E53935',
    bg: 'rgba(229,57,53,.12)',
  },
};

/* ── localStorage helpers ── */
function addToHistory(entry) {
  const stored = JSON.parse(localStorage.getItem('alertHistory') || '[]');
  stored.unshift(entry);
  localStorage.setItem('alertHistory', JSON.stringify(stored));
  window.dispatchEvent(new Event('alertHistoryChange'));
}
function saveAgentTickets(tickets) {
  localStorage.setItem('agentTickets', JSON.stringify(tickets));
  window.dispatchEvent(new Event('agentTicketsChange'));
}
function updateAgentTicket(ticketId, patch) {
  const tickets = JSON.parse(localStorage.getItem('agentTickets') || '[]');
  const idx = tickets.findIndex((t) => t.id === ticketId);
  if (idx !== -1) {
    tickets[idx] = { ...tickets[idx], ...patch };
    saveAgentTickets(tickets);
  }
}

/* ── Map DB row → dispatcher ticket shape ── */
function mapDbTicket(r) {
  const d = r.ticket_details || {};
  return {
    id: r.ticket_id,
    vehicleType: d.unit_type || 'ambulance',
    severity: r.priority || d.priority || 'critical',
    name: d.patient_name || d.caller_name || d.name || r.ani || 'Unknown',
    phone: d.phone_number || d.phone || r.ani || '',
    address: d.address || '',
    status: r.ticket_status || 'pending',
    createdAt: new Date(r.created_at).getTime(),
    agentName: r.agent_name || '',
    assignedUnits: r.units || [],
    answers: {
      f1: d.patient_name || d.caller_name || d.name || '',
      f2: d.phone_number || d.phone || r.ani || '',
      f3: d.address || '',
    },
    destination: d.destination || null,
    notes: d.notes || '',
  };
}

/* ── Activity Log ── */
function ActivityLog({ logs }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [logs]);
  const clr = {
    info: '#8B949E',
    ok: '#34A853',
    warn: '#F9A825',
    error: '#E53935',
  };
  const icons = {
    info: <ApartmentOutlined style={{ marginRight: 4 }} />,
    ok: <CheckCircleOutlined style={{ marginRight: 4 }} />,
    warn: <WarningOutlined style={{ marginRight: 4 }} />,
    error: <CloseCircleOutlined style={{ marginRight: 4 }} />,
  };
  return (
    <div
      ref={ref}
      style={{
        background: '#0D1117',
        border: '1px solid #30363D',
        borderRadius: 9,
        padding: 10,
        height: 120,
        overflowY: 'auto',
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
      }}
    >
      {logs.length === 0 && (
        <div style={{ color: '#30363D' }}>No activity yet…</div>
      )}
      {logs.map((l, i) => (
        <div
          key={i}
          style={{
            color: clr[l.type] || '#8B949E',
            marginBottom: 2,
            lineHeight: 1.5,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          {icons[l.type] || icons.info} {l.msg}
        </div>
      ))}
    </div>
  );
}

/* ── Confirm Modal ── */
function ConfirmModal({
  open,
  ticket,
  severity,
  answers,
  pickedLat,
  pickedLng,
  selectedUnitIds,
  allUnits,
  onCancel,
  onConfirm,
  loading,
}) {
  if (!open) return null;
  const cfg = UCFG[ticket?.vehicleType] || UCFG.ambulance;
  return (
    <div
      style={s.overlay}
      onClick={onCancel}
    >
      <div
        style={s.modal}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={s.mHead}>
          <div style={{ fontSize: 32, display: 'flex' }}>{cfg.icon}</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>
              Confirm Dispatch
            </div>
            <div style={{ fontSize: 11, color: '#8B949E', marginTop: 2 }}>
              {selectedUnitIds.length > 0
                ? `${selectedUnitIds.length} unit(s) will be dispatched`
                : 'Will broadcast to ALL available units'}
            </div>
          </div>
        </div>
        <div style={{ padding: '20px 24px' }}>
          {selectedUnitIds.length === 0 ? (
            <div style={s.noUnitWarn}>
              <WarningOutlined
                style={{
                  fontSize: '16px',
                  verticalAlign: 'middle',
                  marginRight: 4,
                }}
              />{' '}
              No units selected — will broadcast to ALL available units.
            </div>
          ) : (
            <div style={{ marginBottom: 14 }}>
              <div
                style={{
                  fontSize: 9,
                  color: '#8B949E',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                  marginBottom: 8,
                }}
              >
                Selected Units ({selectedUnitIds.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {selectedUnitIds.map((uid) => {
                  const unit = allUnits.find((u) => u.id === uid);
                  if (!unit) return null;
                  const ucfg = UCFG[unit.type] || UCFG.ambulance;
                  return (
                    <div
                      key={uid}
                      style={s.unitCard}
                    >
                      <span
                        style={{
                          fontSize: 22,
                          display: 'flex',
                          alignItems: 'center',
                        }}
                      >
                        {ucfg.icon}
                      </span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 800 }}>
                          {unit.name}
                        </div>
                        <div style={{ fontSize: 10, color: '#8B949E' }}>
                          {unit.id}
                        </div>
                      </div>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: 8,
                          fontSize: 10,
                          fontWeight: 800,
                          background: 'rgba(52,168,83,.15)',
                          color: '#34A853',
                        }}
                      >
                        Ready
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}
          >
            <div style={s.detCard}>
              <div style={s.detLabel}>Priority</div>
              <div style={{ ...s.detVal, color: SEV_COLORS[severity] }}>
                {severity?.toUpperCase()}
              </div>
            </div>
            <div style={s.detCard}>
              <div style={s.detLabel}>Units</div>
              <div style={{ ...s.detVal, color: '#82B4FF' }}>
                {selectedUnitIds.length || 'Broadcast'}
              </div>
            </div>
            <div style={{ ...s.detCard, gridColumn: 'span 2' }}>
              <div style={s.detLabel}>Patient / Caller</div>
              <div style={s.detVal}>{answers.f1 || '—'}</div>
            </div>
            <div style={{ ...s.detCard, gridColumn: 'span 2' }}>
              <div style={s.detLabel}>
                <EnvironmentOutlined
                  style={{
                    verticalAlign: 'middle',
                    marginRight: 4,
                    fontSize: '14px',
                  }}
                />{' '}
                Location
              </div>
              <div style={s.detVal}>{answers.f3 || '—'}</div>
            </div>
            <div style={s.detCard}>
              <div style={s.detLabel}>Phone</div>
              <div style={s.detVal}>{answers.f2 || '—'}</div>
            </div>
            <div style={s.detCard}>
              <div style={s.detLabel}>Coordinates</div>
              <div
                style={{
                  ...s.detVal,
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: 10,
                }}
              >
                {pickedLat?.toFixed(5)}, {pickedLng?.toFixed(5)}
              </div>
            </div>
            {answers.f7 && (
              <div style={{ ...s.detCard, gridColumn: 'span 2' }}>
                <div style={s.detLabel}>Notes</div>
                <div style={s.detVal}>{answers.f7}</div>
              </div>
            )}
          </div>
        </div>
        <div style={s.mFoot}>
          <button
            style={s.cancelBtn}
            onClick={onCancel}
          >
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              <CloseOutlined
                style={{ fontSize: '18px', verticalAlign: 'middle' }}
              />{' '}
              Cancel
            </span>
          </button>
          <button
            style={{ ...s.confirmBtn, background: cfg.color }}
            onClick={onConfirm}
            disabled={loading}
          >
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 7,
              }}
            >
              {loading ? (
                <LoadingOutlined
                  style={{ fontSize: '18px', verticalAlign: 'middle' }}
                  spin
                />
              ) : (
                <>{cfg.icon} CONFIRM DISPATCH</>
              )}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Ticket Details Box ── */
function TicketDetailsBox({ ticket, dispatchedUnits }) {
  if (!ticket) return null;
  const cfg = UCFG[ticket.vehicleType] || UCFG.ambulance;
  const t = new Date(ticket.createdAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const answers = ticket.answers || {};
  const stCfg = STATUS_CFG[ticket.status] || STATUS_CFG.pending;
  const rows = [
    ['Caller / Patient', ticket.name],
    ['Phone', ticket.phone || '—'],
    ['Address', ticket.address],
    ticket.destination && [
      'Coordinates',
      `${ticket.destination.latitude?.toFixed(5)}, ${ticket.destination.longitude?.toFixed(5)}`,
    ],
    answers.f4 && ['Incident Type', answers.f4],
    ticket.notes && ['Notes', ticket.notes],
  ].filter(Boolean);
  return (
    <div style={s.ticketBox}>
      <div
        style={{
          height: 4,
          background: cfg.color,
          borderRadius: '14px 14px 0 0',
          margin: '-20px -20px 16px',
        }}
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span
            style={{
              background: 'rgba(249,168,37,.15)',
              color: '#F9A825',
              fontSize: 9,
              fontWeight: 800,
              padding: '2px 7px',
              borderRadius: 5,
              letterSpacing: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <FileTextOutlined
              style={{ fontSize: '10px', verticalAlign: 'middle' }}
            />{' '}
            AGENT TICKET
          </span>
          <span
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 10,
              color: '#8B949E',
            }}
          >
            {t}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 800,
              padding: '2px 9px',
              borderRadius: 7,
              background: `${SEV_COLORS[ticket.severity]}18`,
              color: SEV_COLORS[ticket.severity],
              textTransform: 'uppercase',
            }}
          >
            {ticket.severity}
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 800,
              padding: '2px 9px',
              borderRadius: 7,
              background: stCfg.bg,
              color: stCfg.color,
            }}
          >
            {stCfg.label}
          </span>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 14,
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 11,
            flexShrink: 0,
            background: `${cfg.color}18`,
            border: `1.5px solid ${cfg.color}40`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 20,
          }}
        >
          {cfg.icon}
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800 }}>{ticket.name}</div>
          <div
            style={{
              fontSize: 10,
              color: cfg.color,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: 1,
            }}
          >
            {cfg.label}
          </div>
        </div>
      </div>
      {rows.map(([label, val], i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            padding: '5px 0',
            borderBottom: '1px solid rgba(48,54,61,.5)',
            gap: 8,
          }}
        >
          <span
            style={{
              fontSize: 10,
              color: '#8B949E',
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {label}
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: label === 'Coordinates' ? '#1A73E8' : '#E6EDF3',
              textAlign: 'right',
              wordBreak: 'break-word',
              maxWidth: 200,
              fontFamily:
                label === 'Coordinates'
                  ? 'JetBrains Mono, monospace'
                  : 'inherit',
            }}
          >
            {val}
          </span>
        </div>
      ))}
      {dispatchedUnits?.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div
            style={{
              fontSize: 9,
              color: '#8B949E',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: 1,
              marginBottom: 5,
            }}
          >
            Dispatched Units ({dispatchedUnits.length})
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {dispatchedUnits.map((uid, i) => (
              <span
                key={i}
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '3px 9px',
                  borderRadius: 7,
                  background: 'rgba(26,115,232,.12)',
                  color: '#82B4FF',
                  border: '1px solid rgba(26,115,232,.2)',
                }}
              >
                {uid}
              </span>
            ))}
          </div>
        </div>
      )}
      <div
        style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 9,
          color: '#30363D',
          marginTop: 10,
        }}
      >
        {ticket.id}
      </div>
    </div>
  );
}

/* ── Ticket Switcher Strip ── */
function TicketSwitcherStrip({ tickets, activeTicketId, onSelect }) {
  if (!tickets || tickets.length === 0) return null;
  return (
    <div style={s.stripWrap}>
      <div
        style={{
          fontSize: 9,
          color: '#8B949E',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: 1,
          flexShrink: 0,
          marginRight: 10,
        }}
      >
        Tickets ({tickets.length}):
      </div>
      <div style={s.stripScroll}>
        {tickets.map((ticket) => {
          const cfg = UCFG[ticket.vehicleType] || UCFG.ambulance;
          const stCfg = STATUS_CFG[ticket.status] || STATUS_CFG.pending;
          const isAct = ticket.id === activeTicketId;
          return (
            <button
              key={ticket.id}
              onClick={() => onSelect(ticket)}
              title={ticket.name + ' — ' + ticket.address}
              style={{
                ...s.stripPill,
                ...(isAct
                  ? {
                      borderColor: cfg.color,
                      background: `${cfg.color}18`,
                      color: cfg.color,
                    }
                  : {}),
              }}
            >
              <span style={{ fontSize: 13 }}>{cfg.icon}</span>
              <span
                style={{
                  fontWeight: 800,
                  fontSize: 11,
                  maxWidth: 90,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {ticket.name}
              </span>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  padding: '1px 6px',
                  borderRadius: 5,
                  background: stCfg.bg,
                  color: stCfg.color,
                  flexShrink: 0,
                }}
              >
                {ticket.status}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Ticket List Screen ── */
function TicketListScreen({ onSelectTicket }) {
  const [agentTickets, setAgentTickets] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState('card'); // 'card' or 'list'

  const loadFromDb = useCallback(async () => {
    try {
      const res = await getTickets();
      setAgentTickets((res.data?.tickets || []).map(mapDbTicket));
    } catch (err) {
      console.error('[DispatchPage] failed to load tickets:', err.message);
    }
  }, []);

  useEffect(() => {
    loadFromDb();
    // Also refresh when a local event fires (e.g. after dispatching)
    window.addEventListener('agentTicketsChange', loadFromDb);
    return () => window.removeEventListener('agentTicketsChange', loadFromDb);
  }, [loadFromDb]);

  const pendingCount = agentTickets.filter(
    (t) => t.status === 'pending',
  ).length;

  const filteredTickets = agentTickets.filter((t) => {
    const matchesStatus = statusFilter === 'all' || t.status === statusFilter;
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      !searchQuery ||
      t.name.toLowerCase().includes(q) ||
      t.address.toLowerCase().includes(q) ||
      t.id.toLowerCase().includes(q);
    return matchesStatus && matchesSearch;
  });

  return (
    <div style={s.page}>
      <div style={s.mainBody}>
        <div
          style={{
            fontSize: 19,
            fontWeight: 800,
            marginBottom: 4,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <NodeIndexOutlined
            style={{
              color: '#E53935',
              fontSize: '20px',
              verticalAlign: 'middle',
            }}
          />{' '}
          Incoming Tickets
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 12, color: '#8B949E' }}>
            Select a ticket to open the dispatch screen
          </span>
          {pendingCount > 0 && (
            <span
              style={{
                background: 'rgba(249,168,37,.15)',
                color: '#F9A825',
                fontSize: 10,
                fontWeight: 800,
                padding: '2px 8px',
                borderRadius: 6,
              }}
            >
              {pendingCount} pending
            </span>
          )}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          marginBottom: 18,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          <span
            onClick={() => setStatusFilter('all')}
            style={{
              cursor: 'pointer',
              padding: '3px 11px',
              borderRadius: 8,
              background: statusFilter === 'all' ? '#1A73E8' : '#30363D',
              color: '#fff',
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            All
          </span>
          {Object.entries(STATUS_CFG).map(([key, cfg]) => (
            <span
              key={key}
              onClick={() => setStatusFilter(key)}
              style={{
                cursor: 'pointer',
                fontSize: 10,
                fontWeight: 700,
                padding: '3px 11px',
                borderRadius: 8,
                background: statusFilter === key ? cfg.color : cfg.bg,
                color: statusFilter === key ? '#fff' : cfg.color,
              }}
            >
              {cfg.label}
            </span>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ position: 'relative' }}>
            <SearchOutlined
              style={{
                position: 'absolute',
                left: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                color: '#8B949E',
                fontSize: 14,
              }}
            />
            <input
              type='text'
              placeholder='Search tickets...'
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                background: '#0D1117',
                border: '1px solid #30363D',
                borderRadius: 8,
                color: '#E6EDF3',
                padding: '6px 12px 6px 32px',
                fontSize: 12,
                width: 220,
                outline: 'none',
              }}
            />
          </div>
          <div
            style={{
              display: 'flex',
              background: '#0D1117',
              borderRadius: 8,
              padding: 2,
              border: '1px solid #30363D',
            }}
          >
            <button
              onClick={() => setViewMode('card')}
              style={{
                ...s.viewBtn,
                ...(viewMode === 'card' ? s.viewBtnActive : {}),
              }}
            >
              <AppstoreOutlined />
            </button>
            <button
              onClick={() => setViewMode('list')}
              style={{
                ...s.viewBtn,
                ...(viewMode === 'list' ? s.viewBtnActive : {}),
              }}
            >
              <UnorderedListOutlined />
            </button>
          </div>
        </div>
      </div>

      {filteredTickets.length === 0 ? (
        <div style={s.empty}>
          <div style={s.emptyIcon}>
            <FileTextOutlined style={{ fontSize: '48px', opacity: 0.2 }} />
          </div>
          <div style={s.emptyMsg}>No agent tickets yet</div>
          <div style={s.emptySub}>
            Tickets submitted by field agents appear here
          </div>
        </div>
      ) : (
        <div style={viewMode === 'card' ? s.grid : s.listStack}>
          {filteredTickets.map((ticket) => {
            const cfg = UCFG[ticket.vehicleType] || UCFG.ambulance;
            const t = new Date(ticket.createdAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            });
            const stCfg = STATUS_CFG[ticket.status] || STATUS_CFG.pending;
            const isPending = ticket.status === 'pending';
            const unitCount = (ticket.assignedUnits || []).length;
            const sev = { color: SEV_COLORS[ticket.severity] || '#8B949E' };

            if (viewMode === 'list') {
              return (
                <div
                  key={ticket.id}
                  style={s.listItem}
                  onClick={() => onSelectTicket(ticket)}
                >
                  <div style={{ ...s.listBar, background: cfg.barColor }} />
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        background: `${cfg.color}15`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 16,
                      }}
                    >
                      {cfg.icon}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 800,
                          color: '#E6EDF3',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {ticket.name}
                      </div>
                      <div
                        style={{
                          fontSize: 10,
                          color: '#8B949E',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {ticket.address}
                      </div>
                    </div>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 16,
                      flexShrink: 0,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-end',
                        gap: 2,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 800,
                          padding: '2px 7px',
                          borderRadius: 5,
                          background: stCfg.bg,
                          color: stCfg.color,
                        }}
                      >
                        {stCfg.label}
                      </span>
                      <span
                        style={{
                          fontSize: 9,
                          color: '#8B949E',
                          fontFamily: 'JetBrains Mono, monospace',
                        }}
                      >
                        {t}
                      </span>
                    </div>
                    <div style={{ width: 80, textAlign: 'right' }}>
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 800,
                          color: sev.color,
                        }}
                      >
                        {ticket.severity?.toUpperCase()}
                      </span>
                    </div>
                    <div style={{ width: 100, textAlign: 'right' }}>
                      {unitCount > 0 ? (
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 700,
                            color: '#82B4FF',
                          }}
                        >
                          {unitCount} Unit{unitCount > 1 ? 's' : ''}
                        </span>
                      ) : (
                        <span style={{ fontSize: 9, color: '#30363D' }}>
                          No units
                        </span>
                      )}
                    </div>
                    <button style={s.listOpenBtn}>
                      {isPending ? 'Dispatch' : 'Open'}
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={ticket.id}
                style={{
                  ...s.ticket,
                  ...(isPending
                    ? {
                        border: '1px solid rgba(249,168,37,.4)',
                        boxShadow: '0 0 0 2px rgba(249,168,37,.08)',
                      }
                    : {}),
                }}
                onClick={() => onSelectTicket(ticket)}
              >
                <div style={{ ...s.ticketBar, background: cfg.barColor }} />
                <div
                  style={{
                    display: 'inline-block',
                    fontSize: 9,
                    fontWeight: 800,
                    padding: '2px 8px',
                    borderRadius: 5,
                    letterSpacing: 0.5,
                    marginBottom: 8,
                    background: stCfg.bg,
                    color: stCfg.color,
                  }}
                >
                  {stCfg.label}
                </div>
                {isPending && <div style={s.newBadge}>NEW</div>}
                <div style={s.ticketInner}>
                  <div style={s.ticketTop}>
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      <span
                        style={{
                          fontSize: 18,
                          display: 'flex',
                          alignItems: 'center',
                        }}
                      >
                        {cfg.icon}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 800,
                          letterSpacing: '.6px',
                          textTransform: 'uppercase',
                          color: cfg.barColor,
                        }}
                      >
                        {cfg.label}
                      </span>
                    </div>
                    <span
                      style={{
                        fontFamily: 'JetBrains Mono, monospace',
                        fontSize: 10,
                        color: '#8B949E',
                      }}
                    >
                      {t}
                    </span>
                  </div>
                  <div style={s.ticketName}>{ticket.name}</div>
                  <div style={s.ticketAddr}>
                    <EnvironmentOutlined
                      style={{
                        marginRight: 4,
                        fontSize: '12px',
                        verticalAlign: 'middle',
                      }}
                    />{' '}
                    {ticket.address}
                  </div>
                  <div style={s.detailsRow}>
                    {ticket.phone && (
                      <span
                        style={{
                          ...s.detailChip,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <PhoneOutlined style={{ fontSize: '10px' }} />{' '}
                        {ticket.phone}
                      </span>
                    )}
                    <span
                      style={{
                        ...s.detailChip,
                        color: sev.color,
                        borderColor: `${sev.color}40`,
                        background: `${sev.color}15`,
                      }}
                    >
                      {ticket.severity?.toUpperCase()}
                    </span>
                    {unitCount > 0 && (
                      <span
                        style={{
                          ...s.detailChip,
                          color: '#82B4FF',
                          borderColor: 'rgba(26,115,232,.3)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <MedicineBoxOutlined style={{ fontSize: '12px' }} />{' '}
                        {unitCount} unit{unitCount > 1 ? 's' : ''} dispatched
                      </span>
                    )}
                  </div>
                  {ticket.destination && (
                    <div
                      style={{
                        fontFamily: 'JetBrains Mono, monospace',
                        fontSize: 10,
                        color: '#1A73E8',
                        marginBottom: 5,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <AimOutlined style={{ fontSize: '10px' }} />{' '}
                      {ticket.destination.latitude?.toFixed(5)},{' '}
                      {ticket.destination.longitude?.toFixed(5)}
                    </div>
                  )}
                  {ticket.notes && (
                    <div
                      style={{
                        ...s.notesRow,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <FileTextOutlined style={{ fontSize: '10px' }} />{' '}
                      {ticket.notes}
                    </div>
                  )}
                  <div style={s.ticketFooter}>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 800,
                        padding: '2px 8px',
                        borderRadius: 7,
                        textTransform: 'uppercase',
                        background: `${SEV_COLORS[ticket.severity] || '#8B949E'}18`,
                        color: SEV_COLORS[ticket.severity] || '#8B949E',
                      }}
                    >
                      {ticket.severity || 'medium'}
                    </span>
                    <button
                      style={{
                        ...s.openBtn,
                        ...(isPending
                          ? {
                              background: 'rgba(249,168,37,.1)',
                              border: '1px solid rgba(249,168,37,.3)',
                              color: '#F9A825',
                            }
                          : {}),
                      }}
                    >
                      {isPending ? 'Dispatch →' : 'Open →'}
                    </button>
                  </div>
                  <div
                    style={{
                      fontFamily: 'JetBrains Mono, monospace',
                      fontSize: 9,
                      color: '#30363D',
                      marginTop: 8,
                    }}
                  >
                    {ticket.id}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════
   INLINE UNIT SELECTOR
   Renders directly inside the left column, beside the form.
   No separate "Select Units" box — this IS the online units panel.
   Data comes from unitList (populated by UnitList's onUnitListChange).
══════════════════════════════════════════════════ */
function InlineUnitSelector({ units, selectedUnitIds, onToggleUnit }) {
  const onlineUnits = units.filter((u) => u.isOnline);

  return (
    <div style={s.inlineUnitWrap}>
      {/* Header */}
      <div style={s.inlineUnitHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 800,
              color: '#E6EDF3',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <ApartmentOutlined
              style={{ fontSize: '14px', verticalAlign: 'middle' }}
            />{' '}
            Online Units
          </span>
          <span
            style={{
              fontSize: 9,
              fontWeight: 800,
              padding: '1px 7px',
              borderRadius: 9,
              background: 'rgba(52,168,83,.15)',
              color: '#34A853',
            }}
          >
            {onlineUnits.length} online
          </span>
        </div>
        {selectedUnitIds.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#82B4FF' }}>
              {selectedUnitIds.length} selected
            </span>
            <button
              style={s.clearSelBtn}
              onClick={() =>
                selectedUnitIds.slice().forEach((id) => onToggleUnit(id))
              }
            >
              Clear
            </button>
          </div>
        )}
      </div>

      <div
        style={{
          fontSize: 10,
          color: '#8B949E',
          marginBottom: 10,
          lineHeight: 1.5,
        }}
      >
        Click to select · multiple units dispatched together · leave none to
        broadcast all
      </div>

      {onlineUnits.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '22px 10px',
            color: '#8B949E',
          }}
        >
          <div style={{ fontSize: 28, marginBottom: 7 }}>
            <WifiOutlined style={{ opacity: 0.2 }} />
          </div>
          <div style={{ fontSize: 11, fontWeight: 700 }}>No units online</div>
          <div style={{ fontSize: 10, opacity: 0.6, marginTop: 3 }}>
            Add mock units from the panel on the right →
          </div>
        </div>
      ) : (
        /* Scrollable list so it matches form height */
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            overflowY: 'auto',
            maxHeight: 340,
          }}
        >
          {onlineUnits.map((u) => {
            const isSel = selectedUnitIds.includes(u.id);
            const isBusy = u.status === 'busy';
            const ucfg = UCFG[u.type] || UCFG.ambulance;
            return (
              <div
                key={u.id}
                onClick={() => !isBusy && onToggleUnit(u.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  background: isSel ? `${ucfg.color}12` : '#0D1117',
                  border: `2px solid ${isSel ? ucfg.color : '#30363D'}`,
                  borderRadius: 10,
                  padding: '9px 11px',
                  cursor: isBusy ? 'not-allowed' : 'pointer',
                  opacity: isBusy ? 0.55 : 1,
                  transition: 'all .15s',
                  userSelect: 'none',
                  boxShadow: isSel ? `0 0 0 1px ${ucfg.color}25` : 'none',
                  flexShrink: 0,
                }}
              >
                {/* Visual checkbox */}
                <div
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 4,
                    flexShrink: 0,
                    border: `2px solid ${isSel ? ucfg.color : '#30363D'}`,
                    background: isSel ? ucfg.color : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all .15s',
                  }}
                >
                  {isSel && (
                    <span
                      style={{
                        fontSize: 9,
                        color: '#fff',
                        fontWeight: 900,
                        lineHeight: 1,
                      }}
                    >
                      ✓
                    </span>
                  )}
                </div>

                <span style={{ fontSize: 20, flexShrink: 0 }}>{ucfg.icon}</span>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 800,
                        color: '#E6EDF3',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {u.name}
                    </span>
                    {u._isMock && (
                      <span
                        style={{
                          fontSize: 7,
                          background: 'rgba(249,168,37,.15)',
                          color: '#F9A825',
                          padding: '1px 4px',
                          borderRadius: 3,
                          flexShrink: 0,
                        }}
                      >
                        MOCK
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 9, color: '#8B949E', marginTop: 1 }}>
                    {u.id}
                    {u.distanceM != null &&
                      ` · 📍 ${u.distanceM >= 1000 ? (u.distanceM / 1000).toFixed(1) + ' km' : u.distanceM + ' m'}`}
                  </div>
                </div>

                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 800,
                    padding: '2px 7px',
                    borderRadius: 6,
                    flexShrink: 0,
                    background: isBusy
                      ? 'rgba(249,168,37,.15)'
                      : 'rgba(52,168,83,.15)',
                    color: isBusy ? '#F9A825' : '#34A853',
                  }}
                >
                  {isBusy ? 'Busy' : 'Available'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════
   Main DispatchPage
══════════════════════════════════════════════════ */
export default function DispatchPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const incomingTicket = location.state?.agentTicket || null;

  const [selectedTicket, setSelectedTicket] = useState(incomingTicket);
  const [agentTicket, setAgentTicket] = useState(incomingTicket);
  const [severity, setSeverity] = useState(
    incomingTicket?.severity || 'critical',
  );
  const [pickedLat, setPickedLat] = useState(
    incomingTicket?.destination?.latitude || null,
  );
  const [pickedLng, setPickedLng] = useState(
    incomingTicket?.destination?.longitude || null,
  );
  const [answers, setAnswers] = useState(
    incomingTicket?.answers ||
      (incomingTicket
        ? {
            f1: incomingTicket.name,
            f2: incomingTicket.phone,
            f3: incomingTicket.address,
            f7: incomingTicket.notes,
          }
        : {}),
  );
  const [selectedUnitIds, setSelectedUnitIds] = useState([]);
  const [unitList, setUnitList] = useState([]);
  const [unitRefreshTick, setUnitRefreshTick] = useState(0);
  const [showResources, setShowResources] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [lastAlertIds, setLastAlertIds] = useState([]);
  const [statusBox, setStatusBox] = useState({
    type: 'waiting',
    icon: (
      <ClockCircleOutlined
        style={{ fontSize: '16px', verticalAlign: 'middle' }}
      />
    ),
    text: 'No alert sent yet',
  });
  const [logs, setLogs] = useState([]);
  const [allTickets, setAllTickets] = useState([]);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await getTickets();
        const all = (res.data?.tickets || []).map(mapDbTicket);
        setAllTickets(all);
        // If the currently open ticket was updated externally (e.g. from LiveTracking),
        // sync its status into local state so dispatch button + badge update live.
        if (agentTicket?.id) {
          const fresh = all.find((t) => t.id === agentTicket.id);
          if (fresh && fresh.status !== agentTicket.status) {
            setAgentTicket(fresh);
            setSelectedTicket(fresh);
            if (fresh.status === 'completed') {
              setStatusBox({
                type: 'accepted',
                icon: (
                  <CheckCircleOutlined
                    style={{ fontSize: '16px', verticalAlign: 'middle' }}
                  />
                ),
                text: 'All units completed — ticket auto-closed',
              });
              addLog('Ticket marked completed by live tracking', 'ok');
            }
          }
        }
      } catch (err) {
        console.error('[DispatchPage] sync error:', err.message);
      }
    };
    load();
    window.addEventListener('agentTicketsChange', load);
    return () => window.removeEventListener('agentTicketsChange', load);
  }, [agentTicket?.id]); // re-subscribe when active ticket changes

  useEffect(() => {
    if (location.state?.agentTicket) loadTicket(location.state.agentTicket);
  }, [location.state]);

  const addLog = (msg, type = 'info') => {
    const ts = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev.slice(-100), { msg: `[${ts}] ${msg}`, type }]);
  };

  function loadTicket(t) {
    setSelectedTicket(t);
    setAgentTicket(t);
    setSeverity(t.severity || 'critical');
    setPickedLat(t.destination?.latitude || null);
    setPickedLng(t.destination?.longitude || null);
    setAnswers(
      t.answers || { f1: t.name, f2: t.phone, f3: t.address, f7: t.notes },
    );
    setSelectedUnitIds([]);
    setLastAlertIds([]);
    setStatusBox({
      type: 'waiting',
      icon: (
        <ClockCircleOutlined
          style={{ fontSize: '16px', verticalAlign: 'middle' }}
        />
      ),
      text: 'No alert sent yet',
    });
    setLogs([]);
    setShowResources(false);
    addLog(`FileTextOutlined Ticket loaded: ${t.name}`, 'warn');
  }

  function handleBackToList() {
    setSelectedTicket(null);
    setAgentTicket(null);
    setSeverity('critical');
    setPickedLat(null);
    setPickedLng(null);
    setAnswers({});
    setSelectedUnitIds([]);
    setShowResources(false);
    setLogs([]);
    setLastAlertIds([]);
    setStatusBox({
      type: 'waiting',
      icon: (
        <ClockCircleOutlined
          style={{ fontSize: '16px', verticalAlign: 'middle' }}
        />
      ),
      text: 'No alert sent yet',
    });
    navigate('/dispatch', { replace: true });
  }

  function handleToggleUnit(id) {
    setSelectedUnitIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  const handleLocationPick = useCallback((lat, lng, addr) => {
    setPickedLat(lat);
    setPickedLng(lng);
    if (addr) setAnswers((prev) => ({ ...prev, f3: addr }));
  }, []);

  const openModal = () => {
    if (!pickedLat || !pickedLng) {
      alert('No location set — cannot dispatch.');
      return;
    }
    setShowModal(true);
  };
  const { dispatcher } = useAuth();

  /*  const handleDispatch = async () => {
     setDispatching(true);
     addLog(`🚨 Dispatching ${selectedUnitIds.length > 0 ? selectedUnitIds.length + ' unit(s)' : 'broadcast'}…`, 'warn');
     const ids = [];
     try {
       const vehicleType = agentTicket?.vehicleType || 'ambulance';
       const base = {
         patientName: answers.f1 || 'Unknown',
         patientPhone: answers.f2 || '',
         address: answers.f3 || `${pickedLat?.toFixed(4)}, ${pickedLng?.toFixed(4)}`,
         notes: answers.f7 || '',
         destination: { latitude: pickedLat, longitude: pickedLng },
         vehicleType, severity, answers,
       };
 
       // ── Matrix room creation (non-blocking — won't stop dispatch if Matrix is offline) ──
       let roomId = null;
       if (dispatcher?.accessToken && agentTicket?.id) {
         try {
           const room = await createRoom(dispatcher.accessToken, `Ticket-${agentTicket.id}`);
           roomId = room.room_id;
           addLog(`Matrix room created: ${roomId}`, 'ok');
         } catch (matrixErr) {
           addLog(`Matrix room creation skipped: ${matrixErr.message}`, 'warn');
         }
       }
 
       if (selectedUnitIds.length === 0) {
         const res = await sendAlert(base);
         ids.push(res.data.id);
         addToHistory({ ...buildEntry(res.data.id, null, vehicleType), status: 'pending' });
         addLog('Broadcast to all units', 'warn');
       } else {
         for (const unitId of selectedUnitIds) {
           // ── Matrix invite (non-blocking) ──
           if (roomId && dispatcher?.accessToken) {
             const matrixInviteeId = matrixUserId('matrixuser');
             try {
               await inviteUser(dispatcher.accessToken, roomId, matrixInviteeId);
               addLog(`Matrix invite sent: ${matrixInviteeId}`, 'ok');
             } catch (err) {
               addLog(`Matrix invite skipped for ${unitId}`, 'warn');
             }
           }
 
           const res = await assignUnit({ ...base, unitId });
           ids.push(res.data.id);
           const unit = unitList.find(u => u.id === unitId);
           addToHistory({
             ...buildEntry(res.data.id, unitId, unit?.type || vehicleType),
             status: 'pending'
           });
           addLog(`Assigned → ${unit?.name || unitId}`, 'ok');
         }
       }
 
       if (agentTicket?.id) {
         updateAgentTicket(agentTicket.id, {
           status: 'dispatched',
           assignedUnits: [...(agentTicket.assignedUnits || []), ...selectedUnitIds],
           alertIds: [...(agentTicket.alertIds || []), ...ids],
         });
         const fresh = getAgentTickets().find(t => t.id === agentTicket.id);
         if (fresh) { setAgentTicket(fresh); setSelectedTicket(fresh); }
       }
       setLastAlertIds(ids);
       setStatusBox({ type: 'pending', icon: <NodeIndexOutlined style={{ fontSize: '16px', verticalAlign: 'middle' }} />, text: `${ids.length} alert(s) sent — waiting for units…` });
       addLog(`Done — ${ids.length} alert(s) sent`, 'ok');
       setShowModal(false); setSelectedUnitIds([]);
     } catch (e) {
       addLog('Failed: ' + (e.response?.data?.error || e.message), 'error');
     }
     setDispatching(false);
   }; */

  const handleDispatch = async () => {
    setDispatching(true);
    addLog(
      `🚨 Dispatching ${selectedUnitIds.length > 0 ? selectedUnitIds.length + ' unit(s)' : 'broadcast'}…`,
      'warn',
    );
    const ids = [];

    try {
      const vehicleType = agentTicket?.vehicleType || 'ambulance';

      // ── STEP 1: Build dynamic invite list from selected unit IDs ──
      const inviteUserIds = selectedUnitIds.map((id) => {
        const unit = unitList.find((u) => u.id === id);
        return `@${unit?.name || id}:localhost`; // ← unit.name = "sushma", not "AMB-N0AIDZ"
      });

      // ── STEP 2: Kick off Matrix room creation (runs concurrently with dispatch) ──
      const roomPromise =
        dispatcher?.accessToken && agentTicket?.id
          ? createRoom(
              dispatcher.accessToken,
              `Ticket-${agentTicket.id}`,
              inviteUserIds,
            )
              .then((room) => {
                addLog(`✅ Matrix room created: ${room.room_id}`, 'ok');
                return room.room_id;
              })
              .catch((err) => {
                addLog(
                  `⚠️ Matrix room creation skipped: ${err.message}`,
                  'warn',
                );
                return null;
              })
          : Promise.resolve(null);

      // ── STEP 3: Await roomId so assignment payload carries it ──
      const roomId = await roomPromise;

      // ── STEP 4: Build base payload with roomId ──
      const base = {
        patientName: answers.f1 || 'Unknown',
        patientPhone: answers.f2 || '',
        address:
          answers.f3 || `${pickedLat?.toFixed(4)}, ${pickedLng?.toFixed(4)}`,
        notes: answers.f7 || '',
        destination: { latitude: pickedLat, longitude: pickedLng },
        vehicleType,
        severity,
        answers,
        agentTicketId: agentTicket?.id || '',
        roomId: roomId || '',
        matrixRoomId: roomId || '',
      };

      // ── STEP 5: Dispatch (parallel for multi-unit) ──
      if (selectedUnitIds.length === 0) {
        const res = await sendAlert(base);
        ids.push(res.data.id);
        addToHistory({
          ...buildEntry(res.data.id, null, vehicleType),
          status: 'pending',
        });
        addLog('📡 Broadcast to all units', 'warn');
      } else {
        const results = await Promise.all(
          selectedUnitIds.map((unitId) =>
            assignUnit({ ...base, unitId })
              .then((res) => ({ unitId, res }))
              .catch((err) => ({ unitId, err })),
          ),
        );
        for (const { unitId, res, err } of results) {
          const unit = unitList.find((u) => u.id === unitId);
          if (err) {
            addLog(
              `❌ Assign failed → ${unit?.name || unitId}: ${err.response?.data?.error || err.message}`,
              'error',
            );
            continue;
          }
          ids.push(res.data.id);
          addToHistory({
            ...buildEntry(res.data.id, unitId, unit?.type || vehicleType),
            status: 'pending',
          });
          addLog(`🎯 Assigned → ${unit?.name || unitId}`, 'ok');
        }

        // ── Ticket Events audit log (additive, non-blocking) ──────────────
        if (agentTicket?.id) {
          const successfulUnitIds = results
            .filter((r) => !r.err)
            .map((r) => r.unitId);
          if (successfulUnitIds.length > 0) {
            dispatchTicketEvent(agentTicket.id, {
              source_id: dispatcher?.username || 'dispatcher',
              source_name:
                dispatcher?.displayName || dispatcher?.username || 'dispatcher',
              unit_id: successfulUnitIds,
              unit_details: successfulUnitIds.map((uid) => {
                const u = unitList.find((x) => x.id === uid);
                return {
                  unit_id: uid,
                  name: u?.name || uid,
                  type: u?.type || vehicleType,
                };
              }),
              room_details: roomId ? { room_id: roomId } : null,
            }).catch((err) =>
              addLog(
                `⚠️ ticket-events dispatch failed: ${err?.response?.data?.error || err.message}`,
                'warn',
              ),
            );
          }
        }
      }

      // ── STEP 6: Update local ticket ──
      if (agentTicket?.id) {
        updateAgentTicket(agentTicket.id, {
          status: 'dispatched',
          assignedUnits: [
            ...(agentTicket.assignedUnits || []),
            ...selectedUnitIds,
          ],
          alertIds: [...(agentTicket.alertIds || []), ...ids],
          roomId,
        });
        const fresh = getAgentTickets().find((t) => t.id === agentTicket.id);
        if (fresh) {
          setAgentTicket(fresh);
          setSelectedTicket(fresh);
        }
      }

      setLastAlertIds(ids);
      setStatusBox({
        type: 'pending',
        icon: '📡',
        text: `${ids.length} alert(s) sent — waiting for units…`,
      });
      addLog(`✅ Done — ${ids.length} alert(s) sent`, 'ok');
      setShowModal(false);
      setSelectedUnitIds([]);
      // Force the unit list to re-fetch immediately so status changes to Busy
      setUnitRefreshTick((t) => t + 1);
    } catch (e) {
      addLog('❌ Failed: ' + (e.response?.data?.error || e.message), 'error');
    }

    setDispatching(false);
  };

  function buildEntry(id, unitId, vehicleType) {
    return {
      id,
      vehicleType: vehicleType || agentTicket?.vehicleType || 'ambulance',
      severity,
      name: answers.f1 || 'Unknown',
      phone: answers.f2 || '',
      address:
        answers.f3 || `${pickedLat?.toFixed(4)}, ${pickedLng?.toFixed(4)}`,
      notes: answers.f7 || '',
      destination: { latitude: pickedLat, longitude: pickedLng },
      createdAt: Date.now(),
      assignedUnit: unitId,
      agentTicketId: agentTicket?.id || null,
    };
  }

  function handleMarkCompleted() {
    if (!agentTicket?.id) return;
    updateAgentTicket(agentTicket.id, { status: 'completed' });
    const fresh = getAgentTickets().find((t) => t.id === agentTicket.id);
    if (fresh) {
      setAgentTicket(fresh);
      setSelectedTicket(fresh);
    }

    // ── Ticket Events audit log (CLOSED, additive, non-blocking) ────────────
    closeTicketEvent(agentTicket.id, {
      source_id: dispatcher?.username || 'dispatcher',
      source_name:
        dispatcher?.displayName || dispatcher?.username || 'dispatcher',
      remarks: 'marked completed by dispatcher',
    }).catch((err) =>
      addLog(
        `⚠️ ticket-events close failed: ${err?.response?.data?.error || err.message}`,
        'warn',
      ),
    );

    setStatusBox({
      type: 'accepted',
      icon: (
        <CheckCircleOutlined
          style={{ fontSize: '16px', verticalAlign: 'middle' }}
        />
      ),
      text: 'All units completed — ticket closed',
    });
    addLog('Ticket marked as completed', 'ok');
  }

  const statusColors = {
    waiting: '#8B949E',
    pending: '#F9A825',
    accepted: '#34A853',
    rejected: '#E53935',
  };
  const dispatchedUnits = agentTicket?.assignedUnits || [];
  const ticketStatus = agentTicket?.status || 'pending';
  const cfg = UCFG[agentTicket?.vehicleType] || UCFG.ambulance;
  const stCfg = STATUS_CFG[ticketStatus] || STATUS_CFG.pending;

  if (!selectedTicket) return <TicketListScreen onSelectTicket={loadTicket} />;

  return (
    <div>
      <TicketSwitcherStrip
        tickets={allTickets}
        activeTicketId={selectedTicket.id}
        onSelect={loadTicket}
      />

      <div style={s.outerLayout}>
        {/* ══════════ LEFT COLUMN ══════════ */}
        <div>
          {/* Toolbar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 14,
            }}
          >
            <button
              style={s.backBtn}
              onClick={handleBackToList}
            >
              <ArrowLeftOutlined
                style={{ fontSize: '12px', verticalAlign: 'middle' }}
              />{' '}
              All Tickets
            </button>
            <div style={{ flex: 1 }} />
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                padding: '4px 12px',
                borderRadius: 8,
                background: `${SEV_COLORS[severity]}18`,
                color: SEV_COLORS[severity],
                textTransform: 'uppercase',
              }}
            >
              {severity}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 800,
                padding: '4px 12px',
                borderRadius: 8,
                background: stCfg.bg,
                color: stCfg.color,
              }}
            >
              {stCfg.label}
            </span>
          </div>

          {/* MAP — full width of left column */}
          <MapView
            pickedLat={pickedLat}
            pickedLng={pickedLng}
            onLocationPick={undefined}
            locationLocked={true}
          />
          {/* Nearby Resources — full width, collapsible */}
          <div style={{ marginBottom: 14 }}>
            <button
              style={{
                ...s.toggleResBtn,
                ...(pickedLat ? s.toggleResBtnEnabled : {}),
                ...(showResources ? s.toggleResBtnActive : {}),
              }}
              disabled={!pickedLat}
              onClick={() => setShowResources((v) => !v)}
            >
              <PushpinOutlined
                style={{ fontSize: '16px', verticalAlign: 'middle' }}
              />
              <span>
                {showResources
                  ? 'Hide Nearby Resources'
                  : 'View Nearby Resources & Units'}
              </span>
              <DownOutlined
                style={{
                  fontSize: '11px',
                  transition: 'transform .3s',
                  transform: showResources ? 'rotate(180deg)' : 'none',
                  verticalAlign: 'middle',
                }}
              />
            </button>
          </div>
          {showResources && pickedLat && (
            <NearbyResources
              pickedLat={pickedLat}
              pickedLng={pickedLng}
              onSelectUnit={(id) => id && handleToggleUnit(id)}
              selectedUnitId={selectedUnitIds[0] || null}
            />
          )}

          {/* ── BELOW MAP: Form (left) + Online Units (right) ── */}
          <div style={s.belowMapGrid}>
            {/* Incident Form + Dispatch */}
            <div style={s.card}>
              <div style={s.cardTitle}>
                {cfg.icon} {agentTicket?.name} — Ready to Dispatch
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 8,
                  marginBottom: 16,
                }}
              >
                <div style={s.summaryField}>
                  <div style={s.summaryLabel}>Patient / Caller</div>
                  <div style={s.summaryVal}>{answers.f1 || '—'}</div>
                </div>
                <div style={s.summaryField}>
                  <div style={s.summaryLabel}>Phone</div>
                  <div style={s.summaryVal}>{answers.f2 || '—'}</div>
                </div>
                <div style={s.summaryField}>
                  <div style={s.summaryLabel}>Address</div>
                  <div style={s.summaryVal}>{answers.f3 || '—'}</div>
                </div>
                <div style={s.summaryField}>
                  <div style={s.summaryLabel}>Coordinates</div>
                  <div
                    style={{
                      ...s.summaryVal,
                      fontFamily: 'JetBrains Mono, monospace',
                      color: '#1A73E8',
                    }}
                  >
                    {pickedLat
                      ? `${pickedLat.toFixed(6)}, ${pickedLng.toFixed(6)}`
                      : '—'}
                  </div>
                </div>
                {answers.f7 && (
                  <div style={{ ...s.summaryField, gridColumn: 'span 2' }}>
                    <div style={s.summaryLabel}>Notes</div>
                    <div style={s.summaryVal}>{answers.f7}</div>
                  </div>
                )}
              </div>

              {/* Selected unit chips */}
              {selectedUnitIds.length > 0 && (
                <div style={s.selUnitsSummary}>
                  <div
                    style={{
                      fontSize: 9,
                      color: '#82B4FF',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: 1,
                      marginBottom: 7,
                    }}
                  >
                    {selectedUnitIds.length} Unit(s) Selected
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {selectedUnitIds.map((uid) => {
                      const unit = unitList.find((u) => u.id === uid);
                      const ucfg = unit
                        ? UCFG[unit.type] || UCFG.ambulance
                        : UCFG.ambulance;
                      return (
                        <span
                          key={uid}
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '3px 9px',
                            borderRadius: 7,
                            background: `${ucfg.color}18`,
                            color: ucfg.color,
                            border: `1px solid ${ucfg.color}30`,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          {ucfg.icon} {unit?.name || uid}
                          <CloseOutlined
                            style={{
                              cursor: 'pointer',
                              color: '#8B949E',
                              marginLeft: 2,
                              fontSize: '10px',
                            }}
                            onClick={() => handleToggleUnit(uid)}
                          />
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Dispatch button */}
              <button
                style={{
                  ...s.dispatchBtn,
                  ...cfg.btnCls,
                  opacity:
                    dispatching || ticketStatus === 'completed' ? 0.5 : 1,
                  cursor: ticketStatus === 'completed' ? 'default' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
                onClick={openModal}
                disabled={dispatching || ticketStatus === 'completed'}
              >
                {ticketStatus === 'completed' ? (
                  <>
                    <CheckCircleOutlined
                      style={{ fontSize: '16px', verticalAlign: 'middle' }}
                    />{' '}
                    Ticket Already Completed
                  </>
                ) : (
                  <>
                    <SendOutlined
                      style={{ fontSize: '16px', verticalAlign: 'middle' }}
                    />{' '}
                    DISPATCH
                    {selectedUnitIds.length > 0
                      ? ` ${selectedUnitIds.length} UNIT(S)`
                      : ' (BROADCAST)'}
                  </>
                )}
              </button>

              {ticketStatus === 'dispatched' && (
                <button
                  style={s.completedBtn}
                  onClick={handleMarkCompleted}
                >
                  <CheckCircleOutlined
                    style={{
                      fontSize: '14px',
                      verticalAlign: 'middle',
                      marginRight: 6,
                    }}
                  />{' '}
                  All Units Done — Mark Ticket Completed
                </button>
              )}
            </div>

            {/* Inline Online Units — same height as form, no separate box */}
            {/* <InlineUnitSelector
              units={unitList}
              selectedUnitIds={selectedUnitIds}
              onToggleUnit={handleToggleUnit}
            /> */}
          </div>
        </div>

        {/* ══════════ RIGHT COLUMN ══════════ */}
        <div>
          {/* Dispatch status */}
          <div style={s.card}>
            <div style={s.cardTitle}>
              <NodeIndexOutlined
                style={{
                  fontSize: '12px',
                  verticalAlign: 'middle',
                  marginRight: 6,
                }}
              />{' '}
              Dispatch Status
            </div>
            <div
              style={{
                ...s.statusBox,
                background: `${statusColors[statusBox.type] || '#8B949E'}18`,
                color: statusColors[statusBox.type] || '#8B949E',
              }}
            >
              <span>{statusBox.icon}</span>
              <span>{statusBox.text}</span>
            </div>
            {lastAlertIds.length > 0 && (
              <>
                <div style={s.label}>Alert IDs</div>
                <div
                  style={{
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: 10,
                    color: '#1A73E8',
                    marginBottom: 11,
                    lineHeight: 1.8,
                  }}
                >
                  {lastAlertIds.map((id, i) => (
                    <div key={i}>{id}</div>
                  ))}
                </div>
              </>
            )}
            <button
              style={{
                ...s.btn,
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
              onClick={() => navigate('/alerts')}
            >
              <BarChartOutlined
                style={{ fontSize: '14px', verticalAlign: 'middle' }}
              />{' '}
              View Monitoring
            </button>
          </div>

          {/* Ticket details */}
          <TicketDetailsBox
            ticket={agentTicket}
            dispatchedUnits={dispatchedUnits}
          />

          {/* Activity Log */}
          <div style={s.card}>
            <div style={s.cardTitle}>
              <ApartmentOutlined
                style={{
                  fontSize: '12px',
                  verticalAlign: 'middle',
                  marginRight: 6,
                }}
              />{' '}
              Activity Log
            </div>
            <ActivityLog logs={logs} />
          </div>

          {/* UnitList — mock panel + registry (right side, for managing mock units) */}
          <UnitList
            pickedLat={pickedLat}
            pickedLng={pickedLng}
            selectedUnitIds={selectedUnitIds}
            onToggleUnit={handleToggleUnit}
            onUnitListChange={setUnitList}
            refreshTrigger={unitRefreshTick}
          />
        </div>
      </div>

      <ConfirmModal
        open={showModal}
        ticket={agentTicket}
        severity={severity}
        answers={answers}
        pickedLat={pickedLat}
        pickedLng={pickedLng}
        selectedUnitIds={selectedUnitIds}
        allUnits={unitList}
        loading={dispatching}
        onCancel={() => setShowModal(false)}
        onConfirm={handleDispatch}
      />
    </div>
  );
}

/* ══════════════════════════════════════════════════
   Styles
══════════════════════════════════════════════════ */
const s = {
  page: { padding: '20px 28px', maxWidth: 1200, margin: '0 auto' },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))',
    gap: 12,
  },
  empty: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '60px 20px',
    color: '#8B949E',
    textAlign: 'center',
    gap: 10,
  },
  emptyIcon: { fontSize: 48, opacity: 0.2 },
  emptyMsg: { fontSize: 14, fontWeight: 700 },
  emptySub: { fontSize: 11, opacity: 0.6 },

  ticket: {
    background: '#161B22',
    border: '1px solid #30363D',
    borderRadius: 13,
    padding: '14px 16px',
    cursor: 'pointer',
    transition: 'all .2s',
    position: 'relative',
    overflow: 'hidden',
  },
  ticketBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    borderRadius: '13px 0 0 13px',
  },
  newBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    background: 'rgba(249,168,37,.2)',
    color: '#F9A825',
    fontSize: 9,
    fontWeight: 800,
    padding: '2px 6px',
    borderRadius: 5,
    letterSpacing: 1,
  },
  ticketInner: { paddingLeft: 6 },
  ticketTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 7,
  },
  ticketName: {
    fontSize: 15,
    fontWeight: 800,
    marginBottom: 3,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  ticketAddr: {
    fontSize: 11,
    color: '#8B949E',
    marginBottom: 5,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  detailsRow: { display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 5 },
  detailChip: {
    fontSize: 10,
    color: '#8B949E',
    background: '#0D1117',
    border: '1px solid #30363D',
    borderRadius: 6,
    padding: '2px 7px',
  },
  notesRow: {
    fontSize: 10,
    color: '#8B949E',
    background: '#0D1117',
    borderRadius: 6,
    padding: '5px 8px',
    marginBottom: 6,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  ticketFooter: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  openBtn: {
    fontSize: 10,
    fontWeight: 700,
    color: '#1A73E8',
    background: 'rgba(26,115,232,.1)',
    border: '1px solid rgba(26,115,232,.2)',
    borderRadius: 7,
    padding: '4px 10px',
    cursor: 'pointer',
    fontFamily: 'Sora, sans-serif',
    flexShrink: 0,
  },

  stripWrap: {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 28px',
    background: '#0D1117',
    borderBottom: '1px solid #30363D',
    position: 'sticky',
    top: 0,
    zIndex: 40,
  },
  stripScroll: {
    display: 'flex',
    gap: 7,
    overflowX: 'auto',
    flex: 1,
    scrollbarWidth: 'none',
    msOverflowStyle: 'none',
    paddingBottom: 2,
  },
  stripPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    flexShrink: 0,
    padding: '5px 11px',
    borderRadius: 20,
    border: '1.5px solid #30363D',
    background: '#161B22',
    color: '#8B949E',
    cursor: 'pointer',
    fontFamily: 'Sora, sans-serif',
    fontSize: 11,
    fontWeight: 600,
    transition: 'all .15s',
    whiteSpace: 'nowrap',
  },

  /* Outer: left wide | right 420px */
  outerLayout: {
    display: 'grid',
    gridTemplateColumns: '1fr 420px',
    gap: 20,
    padding: '20px 28px',
    maxWidth: 1900,
    margin: '0 auto',
  },

  /* Below map: form col | unit selector col — equal halves */
  belowMapGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr ',
    gap: 14,
    alignItems: 'start',
  },

  card: {
    background: '#161B22',
    border: '1px solid #30363D',
    borderRadius: 14,
    padding: 20,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '1.5px',
    color: '#8B949E',
    marginBottom: 14,
  },

  backBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 14px',
    borderRadius: 9,
    border: '1px solid #30363D',
    background: '#0D1117',
    color: '#8B949E',
    cursor: 'pointer',
    fontFamily: 'Sora, sans-serif',
    fontSize: 12,
    fontWeight: 700,
  },

  summaryField: {
    background: '#0D1117',
    border: '1px solid #30363D',
    borderRadius: 9,
    padding: '9px 12px',
  },
  summaryLabel: {
    fontSize: 9,
    color: '#8B949E',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: 4,
  },
  summaryVal: {
    fontSize: 12,
    fontWeight: 700,
    color: '#E6EDF3',
    wordBreak: 'break-word',
  },
  selUnitsSummary: {
    background: 'rgba(26,115,232,.06)',
    border: '1px solid rgba(26,115,232,.2)',
    borderRadius: 10,
    padding: '10px 12px',
    marginBottom: 12,
  },

  dispatchBtn: {
    width: '100%',
    padding: '13px 18px',
    borderRadius: 11,
    border: 'none',
    color: '#fff',
    fontFamily: 'Sora, sans-serif',
    fontSize: 14,
    fontWeight: 800,
    transition: 'all .15s',
  },
  completedBtn: {
    width: '100%',
    marginTop: 8,
    padding: '10px 18px',
    borderRadius: 11,
    border: '1px solid rgba(52,168,83,.4)',
    background: 'rgba(52,168,83,.1)',
    color: '#34A853',
    fontFamily: 'Sora, sans-serif',
    fontSize: 12,
    fontWeight: 800,
    cursor: 'pointer',
    transition: 'all .15s',
  },

  /* Inline unit selector */
  inlineUnitWrap: {
    background: '#161B22',
    border: '1px solid #30363D',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  inlineUnitHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  clearSelBtn: {
    fontSize: 10,
    fontWeight: 700,
    padding: '3px 10px',
    borderRadius: 7,
    border: '1px solid #30363D',
    background: '#0D1117',
    color: '#8B949E',
    cursor: 'pointer',
    fontFamily: 'Sora, sans-serif',
  },

  toggleResBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 18px',
    borderRadius: 11,
    border: '2px solid #30363D',
    background: '#0D1117',
    color: '#8B949E',
    fontFamily: 'Sora, sans-serif',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'not-allowed',
    transition: 'all .2s',
    opacity: 0.45,
    marginBottom: 0,
    width: '100%',
  },
  toggleResBtnEnabled: {
    borderColor: 'rgba(26,115,232,.5)',
    background: 'rgba(26,115,232,.08)',
    color: '#82B4FF',
    cursor: 'pointer',
    opacity: 1,
  },
  toggleResBtnActive: {
    borderColor: '#34A853',
    background: 'rgba(52,168,83,.1)',
    color: '#69F0AE',
  },

  statusBox: {
    padding: '11px 14px',
    borderRadius: 11,
    marginBottom: 11,
    fontSize: 13,
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    fontSize: 10,
    fontWeight: 700,
    color: '#8B949E',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 7,
  },
  btn: {
    padding: '6px 14px',
    fontSize: 12,
    borderRadius: 8,
    border: '1px solid #30363D',
    background: '#0D1117',
    color: '#8B949E',
    cursor: 'pointer',
    fontFamily: 'Sora, sans-serif',
  },

  ticketBox: {
    background: '#161B22',
    border: '1px solid rgba(249,168,37,.3)',
    borderRadius: 14,
    padding: 20,
    marginBottom: 16,
    boxShadow: '0 0 0 1px rgba(249,168,37,.08)',
  },

  overlay: {
    position: 'fixed',
    inset: 0,
    zIndex: 200,
    background: 'rgba(0,0,0,.75)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backdropFilter: 'blur(6px)',
  },
  modal: {
    background: '#161B22',
    border: '1px solid #30363D',
    borderRadius: 20,
    width: 540,
    maxWidth: '95vw',
    maxHeight: '90vh',
    overflowY: 'auto',
  },
  mHead: {
    padding: '20px 24px 16px',
    borderBottom: '1px solid #30363D',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  unitCard: {
    background: '#0D1117',
    border: '1px solid rgba(52,168,83,.25)',
    borderRadius: 10,
    padding: '10px 14px',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 6,
  },
  noUnitWarn: {
    background: 'rgba(249,168,37,.08)',
    border: '1px solid rgba(249,168,37,.25)',
    borderRadius: 10,
    padding: '10px 14px',
    marginBottom: 16,
    fontSize: 12,
    color: '#F9A825',
  },
  detCard: {
    background: '#0D1117',
    border: '1px solid #30363D',
    borderRadius: 10,
    padding: '10px 12px',
  },
  detLabel: {
    fontSize: 9,
    color: '#8B949E',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '.7px',
    marginBottom: 3,
  },
  detVal: {
    fontSize: 13,
    fontWeight: 700,
    color: '#E6EDF3',
    wordBreak: 'break-word',
  },
  mFoot: {
    padding: '16px 24px 20px',
    borderTop: '1px solid #30363D',
    display: 'flex',
    gap: 10,
    alignItems: 'center',
  },
  cancelBtn: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    border: '1px solid #30363D',
    background: '#0D1117',
    color: '#8B949E',
    fontFamily: 'Sora, sans-serif',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'all .2s',
  },
  confirmBtn: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    border: 'none',
    color: '#fff',
    fontFamily: 'Sora, sans-serif',
    fontSize: 13,
    fontWeight: 800,
    cursor: 'pointer',
    transition: 'all .2s',
  },

  /* List View Styles */
  listStack: { display: 'flex', flexDirection: 'column', gap: 8 },
  listItem: {
    background: '#161B22',
    border: '1px solid #30363D',
    borderRadius: 10,
    padding: '10px 16px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
    transition: 'all .15s',
  },
  listBar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3 },
  listOpenBtn: {
    background: 'rgba(26,115,232,.1)',
    border: '1px solid rgba(26,115,232,.2)',
    color: '#1A73E8',
    borderRadius: 6,
    padding: '4px 12px',
    fontSize: 10,
    fontWeight: 700,
    cursor: 'pointer',
    fontFamily: 'Sora, sans-serif',
  },

  viewBtn: {
    background: 'transparent',
    border: 'none',
    color: '#8B949E',
    width: 28,
    height: 28,
    borderRadius: 6,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontSize: 14,
    transition: 'all .15s',
  },
  viewBtnActive: { background: '#30363D', color: '#fff' },
};
