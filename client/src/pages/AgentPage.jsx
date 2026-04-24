import React, { useState, useCallback, useRef, useEffect } from 'react';
import MapView from '../components/MapView';
import { createTicketEvent } from '../services/ticketEventsApi';
import {
  MedicineBoxOutlined,
  FireOutlined,
  SafetyOutlined,
  AlertOutlined,
  WarningOutlined,
  ExclamationCircleOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  CheckCircleFilled,
  ExclamationCircleFilled,
  ClockCircleFilled,
  PlusOutlined,
} from '@ant-design/icons';

/* ─── constants ─────────────────────────────────────────────────────────── */

const UNIT_TYPES = [
  {
    key: 'ambulance',
    icon: (
      <MedicineBoxOutlined
        style={{ fontSize: '24px', verticalAlign: 'middle' }}
      />
    ),
    label: 'Ambulance',
    borderColor: '#E53935',
    bgColor: 'rgba(229,57,53,.1)',
  },
  {
    key: 'fire',
    icon: (
      <FireOutlined style={{ fontSize: '24px', verticalAlign: 'middle' }} />
    ),
    label: 'Fire',
    borderColor: '#FF6D00',
    bgColor: 'rgba(255,109,0,.1)',
  },
  {
    key: 'police',
    icon: (
      <SafetyOutlined style={{ fontSize: '24px', verticalAlign: 'middle' }} />
    ),
    label: 'Police',
    borderColor: '#5C9CE5',
    bgColor: 'rgba(21,101,192,.12)',
  },
  {
    key: 'rescue',
    icon: (
      <AlertOutlined style={{ fontSize: '24px', verticalAlign: 'middle' }} />
    ),
    label: 'Rescue',
    borderColor: '#9C27B0',
    bgColor: 'rgba(156,39,176,.1)',
  },
  {
    key: 'hazmat',
    icon: (
      <WarningOutlined style={{ fontSize: '24px', verticalAlign: 'middle' }} />
    ),
    label: 'Hazmat',
    borderColor: '#F57F17',
    bgColor: 'rgba(245,127,23,.1)',
  },
];

const SEVERITIES = [
  {
    key: 'critical',
    icon: (
      <ExclamationCircleOutlined
        style={{ fontSize: '14px', verticalAlign: 'middle', marginRight: 4 }}
      />
    ),
    label: 'Critical',
    color: '#E53935',
    bg: 'rgba(229,57,53,.1)',
  },
  {
    key: 'high',
    icon: (
      <ExclamationCircleOutlined
        style={{ fontSize: '14px', verticalAlign: 'middle', marginRight: 4 }}
      />
    ),
    label: 'High',
    color: '#FF6D00',
    bg: 'rgba(255,109,0,.1)',
  },
  {
    key: 'medium',
    icon: (
      <ClockCircleOutlined
        style={{ fontSize: '14px', verticalAlign: 'middle', marginRight: 4 }}
      />
    ),
    label: 'Medium',
    color: '#F9A825',
    bg: 'rgba(249,168,37,.1)',
  },
  {
    key: 'low',
    icon: (
      <CheckCircleOutlined
        style={{ fontSize: '14px', verticalAlign: 'middle', marginRight: 4 }}
      />
    ),
    label: 'Low',
    color: '#34A853',
    bg: 'rgba(52,168,83,.1)',
  },
];

const FALLBACK_FORMS = {
  ambulance: [
    {
      id: 'f1',
      type: 'text',
      label: 'Patient Name',
      placeholder: 'Ravi Kumar',
      required: true,
    },
    {
      id: 'f2',
      type: 'phone',
      label: 'Phone Number',
      placeholder: '9876543210',
      required: true,
    },
    {
      id: 'f3',
      type: 'text',
      label: 'Address',
      placeholder: '12 Gandhi Nagar',
      required: true,
    },
    {
      id: 'f4',
      type: 'dropdown',
      label: 'Medical Condition',
      placeholder: 'Select…',
      required: true,
      options: [
        'Cardiac Arrest',
        'Chest Pain',
        'Stroke',
        'Accident / Trauma',
        'Breathing Difficulty',
        'Unconscious',
        'Other',
      ],
    },
    {
      id: 'f5',
      type: 'segmented',
      label: 'Priority',
      required: true,
      options: ['Low', 'Medium', 'High', 'Critical'],
    },
    {
      id: 'f6',
      type: 'text',
      label: 'Floor / Block',
      placeholder: '2nd Floor',
      required: false,
    },
    {
      id: 'f7',
      type: 'textarea',
      label: 'Notes',
      placeholder: 'Additional details…',
      required: false,
    },
  ],
  fire: [
    {
      id: 'f1',
      type: 'text',
      label: 'Caller Name',
      placeholder: 'Suresh Kumar',
      required: true,
    },
    {
      id: 'f2',
      type: 'phone',
      label: 'Phone Number',
      placeholder: '9876543210',
      required: true,
    },
    {
      id: 'f3',
      type: 'text',
      label: 'Incident Address',
      placeholder: '23 Industrial Area',
      required: true,
    },
    {
      id: 'f4',
      type: 'dropdown',
      label: 'Fire Type',
      placeholder: 'Select…',
      required: true,
      options: [
        'Building Fire',
        'Vehicle Fire',
        'Forest / Wildfire',
        'Industrial Fire',
        'Gas Leak / Explosion',
        'Electrical Fire',
      ],
    },
    {
      id: 'f5',
      type: 'segmented',
      label: 'Priority',
      required: true,
      options: ['Low', 'Medium', 'High', 'Critical'],
    },
    {
      id: 'f6',
      type: 'radio',
      label: 'People Trapped?',
      required: false,
      options: ['Unknown', 'None', 'Yes — people trapped'],
    },
    { id: 'f7', type: 'textarea', label: 'Notes', required: false },
  ],
  police: [
    {
      id: 'f1',
      type: 'text',
      label: 'Caller Name',
      placeholder: 'Meena Devi',
      required: true,
    },
    {
      id: 'f2',
      type: 'phone',
      label: 'Phone Number',
      placeholder: '9876543210',
      required: true,
    },
    {
      id: 'f3',
      type: 'text',
      label: 'Incident Address',
      placeholder: 'Near Bus Stand',
      required: true,
    },
    {
      id: 'f4',
      type: 'dropdown',
      label: 'Incident Type',
      placeholder: 'Select…',
      required: true,
      options: [
        'Theft / Robbery',
        'Assault / Fight',
        'Accident',
        'Domestic Violence',
        'Missing Person',
        'Suspicious Activity',
      ],
    },
    {
      id: 'f5',
      type: 'segmented',
      label: 'Priority',
      required: true,
      options: ['Low', 'Medium', 'High', 'Critical'],
    },
    {
      id: 'f6',
      type: 'radio',
      label: 'Armed?',
      required: false,
      options: ['Unknown', 'No', 'Yes — armed'],
    },
    { id: 'f7', type: 'textarea', label: 'Notes', required: false },
  ],
  rescue: [
    {
      id: 'f1',
      type: 'text',
      label: 'Caller Name',
      placeholder: 'Name',
      required: true,
    },
    {
      id: 'f2',
      type: 'phone',
      label: 'Phone Number',
      placeholder: '9876543210',
      required: true,
    },
    {
      id: 'f3',
      type: 'text',
      label: 'Incident Address',
      placeholder: 'Location',
      required: true,
    },
    {
      id: 'f4',
      type: 'dropdown',
      label: 'Rescue Type',
      placeholder: 'Select…',
      required: true,
      options: [
        'Flood Rescue',
        'Mountain / Cliff',
        'Building Collapse',
        'Vehicle Entrapment',
        'Water Drowning',
      ],
    },
    {
      id: 'f5',
      type: 'number',
      label: 'Number of People',
      placeholder: '3',
      required: false,
    },
    {
      id: 'f6',
      type: 'segmented',
      label: 'Priority',
      required: true,
      options: ['Low', 'Medium', 'High', 'Critical'],
    },
    { id: 'f7', type: 'textarea', label: 'Notes', required: false },
  ],
  hazmat: [
    {
      id: 'f1',
      type: 'text',
      label: 'Caller Name',
      placeholder: 'Name',
      required: true,
    },
    {
      id: 'f2',
      type: 'phone',
      label: 'Phone Number',
      placeholder: '9876543210',
      required: true,
    },
    {
      id: 'f3',
      type: 'text',
      label: 'Incident Address',
      placeholder: 'Location',
      required: true,
    },
    {
      id: 'f4',
      type: 'dropdown',
      label: 'Hazard Type',
      placeholder: 'Select…',
      required: true,
      options: [
        'Chemical Spill',
        'Gas Leak',
        'Radiation',
        'Biological',
        'Industrial Accident',
      ],
    },
    { id: 'f5', type: 'yesno', label: 'Evacuation Needed?', required: false },
    {
      id: 'f6',
      type: 'segmented',
      label: 'Priority',
      required: true,
      options: ['Low', 'Medium', 'High', 'Critical'],
    },
    { id: 'f7', type: 'textarea', label: 'Notes', required: false },
  ],
};

const PRESETS = [
  { name: 'Coimbatore Centre', lat: 11.0168, lng: 76.9558 },
  { name: 'Railway Station', lat: 11.0504, lng: 76.985 },
  { name: 'GH Hospital', lat: 11.0178, lng: 76.972 },
  { name: 'Tirupur', lat: 10.9081, lng: 76.9518 },
  { name: 'Medical College', lat: 11.0168, lng: 76.972 },
];

/* ─── helpers ────────────────────────────────────────────────────────────── */
function generateId() {
  return (
    'TICKET-' +
    Date.now() +
    '-' +
    Math.random().toString(36).slice(2, 7).toUpperCase()
  );
}

function saveAgentTicket(ticket) {
  const existing = JSON.parse(localStorage.getItem('agentTickets') || '[]');
  existing.unshift(ticket);
  localStorage.setItem('agentTickets', JSON.stringify(existing));
  window.dispatchEvent(new Event('agentTicketsChange'));
}

/* ─── sub-components ─────────────────────────────────────────────────────── */
function FormField({ field, value, onChange }) {
  const base = {
    width: '100%',
    background: '#0D1117',
    border: '1px solid #30363D',
    color: '#E6EDF3',
    borderRadius: 9,
    padding: '9px 12px',
    fontFamily: 'Sora, sans-serif',
    fontSize: 13,
    outline: 'none',
    boxSizing: 'border-box',
  };

  const handleSegment = (opt) => onChange(field.id, opt);
  const handleRadio = (opt) => onChange(field.id, opt);

  switch (field.type) {
    case 'textarea':
      return (
        <textarea
          value={value || ''}
          onChange={(e) => onChange(field.id, e.target.value)}
          placeholder={field.placeholder || ''}
          rows={3}
          style={{ ...base, resize: 'vertical', minHeight: 60 }}
        />
      );
    case 'dropdown':
      return (
        <select
          value={value || ''}
          onChange={(e) => onChange(field.id, e.target.value)}
          style={base}
        >
          <option value=''>{field.placeholder || 'Select…'}</option>
          {(field.options || []).map((o) => (
            <option
              key={o}
              value={o}
            >
              {o}
            </option>
          ))}
        </select>
      );
    case 'segmented':
      return (
        <div style={{ display: 'flex', gap: 6 }}>
          {(field.options || []).map((o) => (
            <button
              key={o}
              type='button'
              onClick={() => handleSegment(o)}
              style={{
                flex: 1,
                padding: '7px 4px',
                borderRadius: 8,
                cursor: 'pointer',
                fontFamily: 'Sora, sans-serif',
                fontSize: 10,
                fontWeight: 800,
                textTransform: 'uppercase',
                transition: 'all .15s',
                border: '1.5px solid',
                borderColor: value === o ? '#1A73E8' : '#30363D',
                background: value === o ? '#1A73E8' : '#0D1117',
                color: value === o ? '#fff' : '#8B949E',
              }}
            >
              {o}
            </button>
          ))}
        </div>
      );
    case 'radio':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(field.options || []).map((o) => (
            <label
              key={o}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 14px',
                borderRadius: 8,
                cursor: 'pointer',
                border: '1px solid',
                borderColor: value === o ? '#1A73E8' : '#30363D',
                background: value === o ? 'rgba(26,115,232,.1)' : '#0D1117',
                fontSize: 12,
                color: '#E6EDF3',
                fontWeight: 600,
              }}
            >
              <input
                type='radio'
                name={field.id}
                value={o}
                checked={value === o}
                onChange={() => handleRadio(o)}
                style={{ accentColor: '#1A73E8', width: 15, height: 15 }}
              />
              {o}
            </label>
          ))}
        </div>
      );
    case 'yesno':
      return (
        <div style={{ display: 'flex', gap: 8 }}>
          {['Yes', 'No'].map((o) => (
            <label
              key={o}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 16px',
                borderRadius: 8,
                cursor: 'pointer',
                border: '1px solid',
                borderColor:
                  value === o
                    ? o === 'Yes'
                      ? '#34A853'
                      : '#E53935'
                    : '#30363D',
                background:
                  value === o
                    ? o === 'Yes'
                      ? 'rgba(52,168,83,.1)'
                      : 'rgba(229,57,53,.1)'
                    : '#0D1117',
                fontSize: 13,
                fontWeight: 700,
                color: '#E6EDF3',
              }}
            >
              <input
                type='radio'
                name={field.id}
                value={o}
                checked={value === o}
                onChange={() => handleRadio(o)}
                style={{ accentColor: o === 'Yes' ? '#34A853' : '#E53935' }}
              />
              {o === 'Yes' ? (
                <>
                  <CheckCircleOutlined
                    style={{
                      fontSize: '14px',
                      verticalAlign: 'middle',
                      marginRight: 4,
                    }}
                  />{' '}
                  Yes
                </>
              ) : (
                <>
                  <CloseCircleOutlined
                    style={{
                      fontSize: '14px',
                      verticalAlign: 'middle',
                      marginRight: 4,
                    }}
                  />{' '}
                  No
                </>
              )}
            </label>
          ))}
        </div>
      );
    default:
      return (
        <input
          type={
            field.type === 'phone'
              ? 'tel'
              : field.type === 'number'
                ? 'number'
                : 'text'
          }
          value={value || ''}
          onChange={(e) => onChange(field.id, e.target.value)}
          placeholder={field.placeholder || ''}
          style={base}
        />
      );
  }
}

/* ─── Main AgentPage ─────────────────────────────────────────────────────── */
export default function AgentPage() {
  const [unitType, setUnitType] = useState('ambulance');
  const [severity, setSeverity] = useState('critical');
  const [pickedLat, setPickedLat] = useState(null);
  const [pickedLng, setPickedLng] = useState(null);
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [lastTicket, setLastTicket] = useState(null);
  const [error, setError] = useState('');

  const ucfg = UNIT_TYPES.find((u) => u.key === unitType);
  const fields = FALLBACK_FORMS[unitType] || FALLBACK_FORMS.ambulance;

  const handleLocationPick = useCallback((lat, lng, addr) => {
    setPickedLat(lat);
    setPickedLng(lng);
    if (addr) setAnswers((prev) => ({ ...prev, f3: addr }));
  }, []);

  const handleAnswer = (id, val) =>
    setAnswers((prev) => ({ ...prev, [id]: val }));

  const handleUnitChange = (type) => {
    setUnitType(type);
    setAnswers({});
    setError('');
  };

  const handleSubmit = () => {
    setError('');
    if (!pickedLat || !pickedLng) {
      setError('Please pick a location on the map first.');
      return;
    }
    const missing = fields.filter((f) => f.required && !answers[f.id]);
    if (missing.length) {
      setError(`Please fill in: ${missing.map((f) => f.label).join(', ')}`);
      return;
    }

    const ticket = {
      id: generateId(),
      vehicleType: unitType,
      severity,
      name: answers.f1 || 'Unknown',
      phone: answers.f2 || '',
      address: answers.f3 || `${pickedLat.toFixed(4)}, ${pickedLng.toFixed(4)}`,
      notes: answers.f7 || '',
      destination: { latitude: pickedLat, longitude: pickedLng },
      answers,
      status: 'pending',
      createdAt: Date.now(),
      submittedBy: 'agent',
    };
    saveAgentTicket(ticket);

    // ── Ticket Events audit log (additive, non-blocking) ───────────────────
    const typeField = {
      ambulance: 'medical_condition',
      fire: 'fire_type',
      police: 'incident_type',
      rescue: 'rescue_type',
      hazmat: 'hazard_type',
    }[ticket.vehicleType];
    createTicketEvent({
      ticket_id: ticket.id,
      source_id: 'agent',
      source_name: 'agent',
      ticket_details: {
        unit_type: ticket.vehicleType,
        priority: (ticket.severity || '').toLowerCase(),
        patient_name: ticket.name,
        phone_number: ticket.phone,
        latitude: pickedLat,
        longitude: pickedLng,
        address: ticket.address || null,
        ...(typeField && answers.f4 ? { [typeField]: answers.f4 } : {}),
        notes: ticket.notes,
      },
    }).catch((err) =>
      console.warn(
        '[ticket-events] create failed:',
        err?.response?.data?.error || err.message,
      ),
    );

    setLastTicket(ticket);
    setSubmitted(true);
  };

  const handleReset = () => {
    setSubmitted(false);
    setLastTicket(null);
    setAnswers({});
    setPickedLat(null);
    setPickedLng(null);
    setUnitType('ambulance');
    setSeverity('critical');
    setError('');
  };

  /* ── Submitted confirmation screen ── */
  if (submitted && lastTicket) {
    const cfg = UNIT_TYPES.find((u) => u.key === lastTicket.vehicleType);
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '80vh',
          padding: 24,
        }}
      >
        <div
          style={{
            background: '#161B22',
            border: '1px solid rgba(52,168,83,.4)',
            borderRadius: 20,
            padding: 36,
            maxWidth: 500,
            width: '100%',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 56, marginBottom: 12 }}>
            <CheckCircleOutlined style={{ color: '#34A853' }} />
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: '#34A853',
              marginBottom: 6,
            }}
          >
            Ticket Submitted!
          </div>
          <div style={{ fontSize: 13, color: '#8B949E', marginBottom: 24 }}>
            Your incident has been sent to the dispatcher.
          </div>
          <div
            style={{
              background: '#0D1117',
              border: '1px solid #30363D',
              borderRadius: 12,
              padding: '14px 18px',
              marginBottom: 24,
              textAlign: 'left',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: 12,
              }}
            >
              <span
                style={{ fontSize: 28, display: 'flex', alignItems: 'center' }}
              >
                {cfg?.icon}
              </span>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800 }}>
                  {lastTicket.name}
                </div>
                <div style={{ fontSize: 11, color: '#8B949E' }}>
                  {lastTicket.id}
                </div>
              </div>
            </div>
            {[
              ['Unit Type', cfg?.label],
              ['Priority', lastTicket.severity?.toUpperCase()],
              ['Location', lastTicket.address],
              ['Phone', lastTicket.phone || '—'],
            ].map(([label, val]) => (
              <div
                key={label}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '5px 0',
                  borderBottom: '1px solid rgba(48,54,61,.5)',
                  fontSize: 12,
                }}
              >
                <span style={{ color: '#8B949E', fontWeight: 600 }}>
                  {label}
                </span>
                <span
                  style={{
                    fontWeight: 700,
                    color: '#E6EDF3',
                    maxWidth: 260,
                    textAlign: 'right',
                  }}
                >
                  {val}
                </span>
              </div>
            ))}
          </div>
          <button
            style={{
              ...s.dispatchBtn,
              background: '#1A73E8',
              boxShadow: '0 4px 18px rgba(26,115,232,.35)',
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
            onClick={handleReset}
          >
            <PlusOutlined
              style={{ fontSize: '16px', verticalAlign: 'middle' }}
            />{' '}
            Submit Another Ticket
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={s.pageLayout}>
      {/* Unit type selector */}
      <div style={s.card}>
        <div style={s.cardTitle}>
          <FireOutlined
            style={{
              fontSize: '12px',
              verticalAlign: 'middle',
              marginRight: 6,
            }}
          />{' '}
          Select Emergency Unit Type
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {UNIT_TYPES.map((u) => (
            <button
              key={u.key}
              onClick={() => handleUnitChange(u.key)}
              style={{
                flex: 1,
                padding: '12px 6px',
                borderRadius: 10,
                border: '2px solid',
                cursor: 'pointer',
                textAlign: 'center',
                transition: 'all .18s',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                borderColor: unitType === u.key ? u.borderColor : '#30363D',
                background: unitType === u.key ? u.bgColor : '#0D1117',
              }}
            >
              <span
                style={{ fontSize: 22, display: 'flex', alignItems: 'center' }}
              >
                {u.icon}
              </span>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  color: unitType === u.key ? u.borderColor : '#8B949E',
                  fontFamily: 'Sora, sans-serif',
                }}
              >
                {u.label}
              </div>
            </button>
          ))}
        </div>

        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '1.5px',
            color: '#8B949E',
            marginBottom: 8,
          }}
        >
          Priority Level
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {SEVERITIES.map((sv) => (
            <button
              key={sv.key}
              onClick={() => setSeverity(sv.key)}
              style={{
                flex: 1,
                padding: '8px 4px',
                borderRadius: 8,
                border: '1.5px solid',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                fontSize: 10,
                fontWeight: 800,
                textTransform: 'uppercase',
                fontFamily: 'Sora, sans-serif',
                transition: 'all .15s',
                borderColor: severity === sv.key ? sv.color : '#30363D',
                background: severity === sv.key ? sv.bg : '#0D1117',
                color: severity === sv.key ? sv.color : '#8B949E',
              }}
            >
              {sv.icon}
              {sv.label}
            </button>
          ))}
        </div>
      </div>

      {/* Map */}
      <MapView
        pickedLat={pickedLat}
        pickedLng={pickedLng}
        onLocationPick={handleLocationPick}
        onFindNearest={() => {}}
      />

      {/* Incident Form */}
      <div style={s.card}>
        <div style={s.cardTitle}>
          {ucfg?.icon} {ucfg?.label} — Incident Details
        </div>

        {fields.map((field) => (
          <div
            key={field.id}
            style={{ marginBottom: 12 }}
          >
            <label
              style={{
                display: 'block',
                fontSize: 11,
                color: '#8B949E',
                marginBottom: 4,
                fontWeight: 600,
              }}
            >
              {field.label}
              {field.required && (
                <span style={{ color: '#E53935', marginLeft: 2 }}>*</span>
              )}
            </label>
            <FormField
              field={field}
              value={answers[field.id]}
              onChange={handleAnswer}
            />
          </div>
        ))}

        {/* Lat / Lng readonly */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 12,
            marginTop: 12,
          }}
        >
          <div>
            <label
              style={{
                display: 'block',
                fontSize: 11,
                color: '#8B949E',
                marginBottom: 4,
                fontWeight: 600,
              }}
            >
              Latitude
            </label>
            <input
              readOnly
              value={pickedLat?.toFixed(6) || ''}
              placeholder='11.0168'
              style={{ ...s.input, opacity: 0.7 }}
            />
          </div>
          <div>
            <label
              style={{
                display: 'block',
                fontSize: 11,
                color: '#8B949E',
                marginBottom: 4,
                fontWeight: 600,
              }}
            >
              Longitude
            </label>
            <input
              readOnly
              value={pickedLng?.toFixed(6) || ''}
              placeholder='76.9558'
              style={{ ...s.input, opacity: 0.7 }}
            />
          </div>
        </div>

        {error && (
          <div
            style={{
              background: 'rgba(229,57,53,.1)',
              border: '1px solid rgba(229,57,53,.3)',
              borderRadius: 9,
              padding: '10px 14px',
              marginTop: 12,
              fontSize: 12,
              color: '#EF5350',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <WarningOutlined
              style={{ fontSize: '14px', verticalAlign: 'middle' }}
            />{' '}
            {error}
          </div>
        )}

        <button
          style={{
            ...s.dispatchBtn,
            ...(ucfg && { background: ucfg.borderColor }),
            marginTop: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
          onClick={handleSubmit}
        >
          {ucfg?.icon} SUBMIT INCIDENT TICKET
        </button>
      </div>
    </div>
  );
}

/* ─── styles ─────────────────────────────────────────────────────────────── */
const s = {
  pageLayout: {
    margin: '0',
    padding: '20px 28px',
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
  presetBtn: {
    padding: '4px 11px',
    borderRadius: 14,
    fontSize: 10,
    fontWeight: 600,
    border: '1px solid #30363D',
    background: '#0D1117',
    color: '#8B949E',
    cursor: 'pointer',
    fontFamily: 'Sora, sans-serif',
  },
  input: {
    width: '100%',
    background: '#0D1117',
    border: '1px solid #30363D',
    color: '#E6EDF3',
    borderRadius: 9,
    padding: '9px 12px',
    fontFamily: 'Sora, sans-serif',
    fontSize: 13,
    outline: 'none',
    boxSizing: 'border-box',
  },
  dispatchBtn: {
    width: '100%',
    padding: '12px 18px',
    borderRadius: 11,
    border: 'none',
    color: '#fff',
    fontFamily: 'Sora, sans-serif',
    fontSize: 14,
    fontWeight: 800,
    cursor: 'pointer',
    transition: 'all .15s',
  },
};
