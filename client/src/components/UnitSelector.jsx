import React from 'react';
import { 
  MedicineBoxOutlined, 
  FireOutlined, 
  SafetyOutlined, 
  AlertOutlined, 
  WarningOutlined, 
  ExclamationCircleOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined
} from '@ant-design/icons';

const UNIT_TYPES = [
  { key: 'ambulance', icon: <MedicineBoxOutlined style={{ fontSize: '22px', verticalAlign: 'middle' }} />, label: 'Ambulance', borderColor: '#E53935', bgColor: 'rgba(229,57,53,.07)' },
  { key: 'fire',      icon: <FireOutlined style={{ fontSize: '22px', verticalAlign: 'middle' }} />, label: 'Fire',      borderColor: '#FF6D00', bgColor: 'rgba(255,109,0,.07)' },
  { key: 'police',    icon: <SafetyOutlined style={{ fontSize: '22px', verticalAlign: 'middle' }} />, label: 'Police',    borderColor: '#5C9CE5', bgColor: 'rgba(21,101,192,.1)' },
  { key: 'rescue',    icon: <AlertOutlined style={{ fontSize: '22px', verticalAlign: 'middle' }} />, label: 'Rescue',    borderColor: '#9C27B0', bgColor: 'rgba(156,39,176,.07)' },
  { key: 'hazmat',    icon: <WarningOutlined style={{ fontSize: '22px', verticalAlign: 'middle' }} />,  label: 'Hazmat',    borderColor: '#F57F17', bgColor: 'rgba(245,127,23,.07)' },
];

const SEVERITIES = [
  { key: 'critical', icon: <ExclamationCircleOutlined style={{ fontSize: '12px', verticalAlign: 'middle', marginRight: 4 }} />, label: 'Critical', activeColor: '#E53935', activeBg: 'rgba(229,57,53,.1)' },
  { key: 'high',     icon: <ExclamationCircleOutlined style={{ fontSize: '12px', verticalAlign: 'middle', marginRight: 4 }} />, label: 'High',     activeColor: '#FF6D00', activeBg: 'rgba(255,109,0,.1)' },
  { key: 'medium',   icon: <ClockCircleOutlined style={{ fontSize: '12px', verticalAlign: 'middle', marginRight: 4 }} />, label: 'Medium',   activeColor: '#F9A825', activeBg: 'rgba(249,168,37,.1)' },
  { key: 'low',      icon: <CheckCircleOutlined style={{ fontSize: '12px', verticalAlign: 'middle', marginRight: 4 }} />, label: 'Low',      activeColor: '#34A853', activeBg: 'rgba(52,168,83,.1)' },
];

export default function UnitSelector({ unitType, severity, onUnitChange, onSeverityChange }) {
  return (
    <div style={s.card}>
      <div style={s.cardTitle}><FireOutlined style={{ fontSize: '12px', verticalAlign: 'middle', marginRight: 6 }} /> Select Emergency Unit Type</div>
      <div style={s.unitGrid}>
        {UNIT_TYPES.map(u => {
          const active = unitType === u.key;
          return (
            <button
              key={u.key}
              onClick={() => onUnitChange(u.key)}
              style={{
                ...s.uBtn,
                borderColor:  active ? u.borderColor : '#30363D',
                background:   active ? u.bgColor : '#0D1117',
              }}
            >
              <span style={s.uIcon}>{u.icon}</span>
              <div style={{ ...s.uLabel, color: active ? u.borderColor : '#8B949E' }}>{u.label}</div>
            </button>
          );
        })}
      </div>

      <div style={{ ...s.cardTitle, marginBottom: 7 }}>Priority Level</div>
      <div style={s.sevRow}>
        {SEVERITIES.map(sv => {
          const active = severity === sv.key;
          return (
            <button
              key={sv.key}
              onClick={() => onSeverityChange(sv.key)}
              style={{
                ...s.sevBtn,
                borderColor: active ? sv.activeColor : '#30363D',
                background:  active ? sv.activeBg   : '#0D1117',
                color:       active ? sv.activeColor : '#8B949E',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {sv.icon} {sv.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const s = {
  card: {
    background: '#161B22', border: '1px solid #30363D',
    borderRadius: 14, padding: 20, marginBottom: 16,
  },
  cardTitle: {
    fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '1.5px', color: '#8B949E', marginBottom: 14,
  },
  unitGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8, marginBottom: 14,
  },
  uBtn: {
    padding: '11px 6px', borderRadius: 10, border: '2px solid',
    cursor: 'pointer', textAlign: 'center', transition: 'all .18s',
  },
  uIcon: { fontSize: 22, display: 'block', marginBottom: 3 },
  uLabel: {
    fontSize: 10, fontWeight: 800, letterSpacing: '.4px',
    textTransform: 'uppercase', fontFamily: 'Sora, sans-serif',
  },
  sevRow: { display: 'flex', gap: 6 },
  sevBtn: {
    flex: 1, padding: '7px 4px', borderRadius: 8, border: '1.5px solid',
    cursor: 'pointer', textAlign: 'center', fontSize: 10,
    fontWeight: 800, textTransform: 'uppercase', transition: 'all .15s',
    fontFamily: 'Sora, sans-serif',
  },
};