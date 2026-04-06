import React, { useEffect, useState, useCallback } from 'react';
import { 
  CheckCircleOutlined, 
  CloseCircleOutlined, 
  ClockCircleOutlined 
} from '@ant-design/icons';
import { getForm } from '../api/api';

const FALLBACK_FORMS = {
  ambulance: { id: null, name: 'Ambulance Dispatch Form', unit_type: 'ambulance', fields: [
    { id: 'f1', type: 'text',     label: 'Patient Name',       placeholder: 'Ravi Kumar',   required: true },
    { id: 'f2', type: 'phone',    label: 'Phone Number',       placeholder: '9876543210',   required: true },
    { id: 'f3', type: 'text',     label: 'Address',            placeholder: '12 Gandhi Nagar', required: true },
    { id: 'f4', type: 'dropdown', label: 'Medical Condition',  placeholder: 'Select…',      required: true,
      options: ['Cardiac Arrest','Chest Pain','Stroke','Accident / Trauma','Breathing Difficulty','Unconscious','Other'] },
    { id: 'f5', type: 'segmented',label: 'Priority',           required: true, options: ['Low','Medium','High','Critical'] },
    { id: 'f6', type: 'text',     label: 'Floor / Block',      placeholder: '2nd Floor',    required: false },
    { id: 'f7', type: 'textarea', label: 'Notes',              placeholder: 'Additional details…', required: false },
  ]},
  fire: { id: null, name: 'Fire Engine Dispatch Form', unit_type: 'fire', fields: [
    { id: 'f1', type: 'text',     label: 'Caller Name',    placeholder: 'Suresh Kumar',  required: true },
    { id: 'f2', type: 'phone',    label: 'Phone Number',   placeholder: '9876543210',    required: true },
    { id: 'f3', type: 'text',     label: 'Incident Address',placeholder: '23 Industrial Area', required: true },
    { id: 'f4', type: 'dropdown', label: 'Fire Type',      placeholder: 'Select…',       required: true,
      options: ['Building Fire','Vehicle Fire','Forest / Wildfire','Industrial Fire','Gas Leak / Explosion','Electrical Fire'] },
    { id: 'f5', type: 'segmented',label: 'Priority',       required: true, options: ['Low','Medium','High','Critical'] },
    { id: 'f6', type: 'radio',    label: 'People Trapped?', required: false,
      options: ['Unknown','None','Yes — people trapped'] },
    { id: 'f7', type: 'textarea', label: 'Notes', required: false },
  ]},
  police: { id: null, name: 'Police Dispatch Form', unit_type: 'police', fields: [
    { id: 'f1', type: 'text',     label: 'Caller Name',    placeholder: 'Meena Devi',    required: true },
    { id: 'f2', type: 'phone',    label: 'Phone Number',   placeholder: '9876543210',    required: true },
    { id: 'f3', type: 'text',     label: 'Incident Address',placeholder: 'Near Bus Stand', required: true },
    { id: 'f4', type: 'dropdown', label: 'Incident Type',  placeholder: 'Select…',       required: true,
      options: ['Theft / Robbery','Assault / Fight','Accident','Domestic Violence','Missing Person','Suspicious Activity'] },
    { id: 'f5', type: 'segmented',label: 'Priority',       required: true, options: ['Low','Medium','High','Critical'] },
    { id: 'f6', type: 'radio',    label: 'Armed?',         required: false,
      options: ['Unknown','No','Yes — armed'] },
    { id: 'f7', type: 'textarea', label: 'Notes', required: false },
  ]},
  rescue: { id: null, name: 'Rescue Dispatch Form', unit_type: 'rescue', fields: [
    { id: 'f1', type: 'text',     label: 'Caller Name',    placeholder: 'Name',          required: true },
    { id: 'f2', type: 'phone',    label: 'Phone Number',   placeholder: '9876543210',    required: true },
    { id: 'f3', type: 'text',     label: 'Incident Address',placeholder: 'Location',     required: true },
    { id: 'f4', type: 'dropdown', label: 'Rescue Type',    placeholder: 'Select…',       required: true,
      options: ['Flood Rescue','Mountain / Cliff','Building Collapse','Vehicle Entrapment','Water Drowning'] },
    { id: 'f5', type: 'number',   label: 'Number of People',placeholder: '3',            required: false },
    { id: 'f6', type: 'segmented',label: 'Priority',       required: true, options: ['Low','Medium','High','Critical'] },
    { id: 'f7', type: 'textarea', label: 'Notes', required: false },
  ]},
  hazmat: { id: null, name: 'Hazmat Dispatch Form', unit_type: 'hazmat', fields: [
    { id: 'f1', type: 'text',     label: 'Caller Name',    placeholder: 'Name',          required: true },
    { id: 'f2', type: 'phone',    label: 'Phone Number',   placeholder: '9876543210',    required: true },
    { id: 'f3', type: 'text',     label: 'Incident Address',placeholder: 'Location',     required: true },
    { id: 'f4', type: 'dropdown', label: 'Hazard Type',    placeholder: 'Select…',       required: true,
      options: ['Chemical Spill','Gas Leak','Radiation','Biological','Industrial Accident'] },
    { id: 'f5', type: 'yesno',   label: 'Evacuation Needed?', required: false },
    { id: 'f6', type: 'segmented',label: 'Priority', required: true, options: ['Low','Medium','High','Critical'] },
    { id: 'f7', type: 'textarea', label: 'Notes', required: false },
  ]},
};

const inp = {
  width: '100%', background: '#0D1117', border: '1px solid #30363D',
  color: '#E6EDF3', borderRadius: 9, padding: '9px 12px',
  fontFamily: 'Sora, sans-serif', fontSize: 13, outline: 'none',
};

function Field({ field, value, onChange }) {
  const lbl = (
    <label style={{ display: 'block', fontSize: 11, color: '#8B949E', marginBottom: 4, fontWeight: 600 }}>
      {field.label}
      {field.required && <span style={{ color: '#E53935', marginLeft: 2 }}>*</span>}
    </label>
  );

  if (field.type === 'textarea') {
    return (
      <div style={{ marginBottom: 11 }}>
        {lbl}
        <textarea value={value || ''} onChange={e => onChange(field.id, e.target.value)}
          placeholder={field.placeholder || ''} rows={3}
          style={{ ...inp, resize: 'vertical' }} />
      </div>
    );
  }
  if (field.type === 'dropdown') {
    return (
      <div style={{ marginBottom: 11 }}>
        {lbl}
        <select value={value || ''} onChange={e => onChange(field.id, e.target.value)}
          style={{ ...inp }}>
          <option value="">{field.placeholder || 'Select…'}</option>
          {(field.options || []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    );
  }
  if (field.type === 'segmented') {
    return (
      <div style={{ marginBottom: 11 }}>
        {lbl}
        <div style={{ display: 'flex', gap: 6 }}>
          {(field.options || []).map(o => {
            const active = value === o;
            return (
              <button key={o} type="button" onClick={() => onChange(field.id, o)}
                style={{
                  flex: 1, padding: '7px 4px', borderRadius: 8,
                  border: '1.5px solid', borderColor: active ? '#1A73E8' : '#30363D',
                  background: active ? '#1A73E8' : '#0D1117', color: active ? '#fff' : '#8B949E',
                  cursor: 'pointer', fontFamily: 'Sora, sans-serif', fontSize: 10, fontWeight: 800,
                  textTransform: 'uppercase', transition: 'all .15s',
                }}>
                {o}
              </button>
            );
          })}
        </div>
      </div>
    );
  }
  if (field.type === 'radio') {
    return (
      <div style={{ marginBottom: 11 }}>
        {lbl}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(field.options || []).map(o => (
            <label key={o} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px',
              borderRadius: 8, border: '1px solid #30363D', cursor: 'pointer',
              background: '#0D1117', fontSize: 12, color: '#E6EDF3', fontWeight: 600,
            }}>
              <input type="radio" name={`field_${field.id}`} value={o} checked={value === o}
                onChange={() => onChange(field.id, o)}
                style={{ accentColor: '#1A73E8', width: 15, height: 15 }} />
              {o}
            </label>
          ))}
        </div>
      </div>
    );
  }
  if (field.type === 'yesno') {
    return (
      <div style={{ marginBottom: 11 }}>
        {lbl}
        <div style={{ display: 'flex', gap: 8 }}>
          {['Yes', 'No'].map(o => (
            <label key={o} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
              borderRadius: 8, border: '1px solid #30363D', cursor: 'pointer',
              background: '#0D1117', fontSize: 13, color: '#E6EDF3', fontWeight: 700,
            }}>
              <input type="radio" name={`yesno_${field.id}`} value={o} checked={value === o}
                onChange={() => onChange(field.id, o)}
                style={{ accentColor: o === 'Yes' ? '#34A853' : '#E53935' }} />
              {o === 'Yes' ? <><CheckCircleOutlined style={{ fontSize: '14px', verticalAlign: 'middle', marginRight: 4 }} /> Yes</> : <><CloseCircleOutlined style={{ fontSize: '14px', verticalAlign: 'middle', marginRight: 4 }} /> No</>}
            </label>
          ))}
        </div>
      </div>
    );
  }
  if (field.type === 'checkbox') {
    const vals = Array.isArray(value) ? value : [];
    return (
      <div style={{ marginBottom: 11 }}>
        {lbl}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(field.options || []).map(o => (
            <label key={o} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
              borderRadius: 8, border: '1px solid #30363D', background: '#0D1117',
              fontSize: 12, color: '#E6EDF3', fontWeight: 600, cursor: 'pointer',
            }}>
              <input type="checkbox" value={o} checked={vals.includes(o)}
                onChange={e => {
                  const next = e.target.checked ? [...vals, o] : vals.filter(v => v !== o);
                  onChange(field.id, next);
                }}
                style={{ accentColor: '#1A73E8' }} />
              {o}
            </label>
          ))}
        </div>
      </div>
    );
  }
  // default: text / email / phone / number
  return (
    <div style={{ marginBottom: 11 }}>
      {lbl}
      <input type={field.type === 'number' ? 'number' : 'text'}
        value={value || ''}
        onChange={e => onChange(field.id, e.target.value)}
        placeholder={field.placeholder || ''}
        data-label={field.label}
        style={inp} />
    </div>
  );
}

export default function IncidentForm({ unitType, pickedLat, pickedLng, answers, onAnswerChange, onFormDefChange }) {
  const [formDef, setFormDef] = useState(null);
  const [loading, setLoading] = useState(false);

  const loadForm = useCallback(async (type) => {
    setLoading(true);
    try {
      const res  = await getForm(type);
      const data = res.data?.data;
      if (data) {
        data.fields = typeof data.fields === 'string' ? JSON.parse(data.fields) : data.fields;
        setFormDef(data);
        onFormDefChange?.(data);
        return;
      }
    } catch { }
    const fb = FALLBACK_FORMS[type] || FALLBACK_FORMS.ambulance;
    setFormDef(fb);
    onFormDefChange?.(fb);
    setLoading(false);
  }, [onFormDefChange]);

  useEffect(() => { loadForm(unitType); }, [unitType, loadForm]);

  const fields = formDef?.fields || [];

  return (
    <div>
      {loading && (
        <div style={{ textAlign: 'center', padding: 20, color: '#8B949E' }}>
          <div style={{ fontSize: 24, marginBottom: 6 }}><ClockCircleOutlined spin /></div>
          <div style={{ fontSize: 12 }}>Loading form fields…</div>
        </div>
      )}
      {fields.map(f => (
        <Field key={f.id} field={f} value={answers[f.id]} onChange={(id, val) => onAnswerChange(id, val)} />
      ))}

      {/* Coordinates (read-only from map) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
        <div>
          <label style={{ display: 'block', fontSize: 11, color: '#8B949E', marginBottom: 4, fontWeight: 600 }}>Latitude</label>
          <input type="number" readOnly value={pickedLat || ''} style={{ ...inp, opacity: .7 }} placeholder="11.0168" />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 11, color: '#8B949E', marginBottom: 4, fontWeight: 600 }}>Longitude</label>
          <input type="number" readOnly value={pickedLng || ''} style={{ ...inp, opacity: .7 }} placeholder="76.9558" />
        </div>
      </div>
    </div>
  );
}