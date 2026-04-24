
// storiiboard-producer.jsx — Producer Mode side panel
// Venue/location booking + key staff checklist per scene

const { useState: useProdState } = React;

function ProducerPanel({ theme, scene, scenes, onUpdateScene, onClose }) {
  const dark = theme === 'dark';
  const [activeSceneId, setActiveSceneId] = useProdState(scene ? scene.id : (scenes[0] && scenes[0].id));
  const [addingStaff, setAddingStaff] = useProdState(false);
  const [newStaffName, setNewStaffName] = useProdState('');
  const [newStaffRole, setNewStaffRole] = useProdState('');

  const c = {
    bg:          dark ? '#141820' : '#F0EDE7',
    card:        dark ? '#1C1F2A' : '#FFFFFF',
    border:      dark ? '#1E2232' : '#DDD9D1',
    text:        dark ? '#C8C0B4' : '#2A2520',
    muted:       dark ? '#4A5270' : '#9A9589',
    input:       dark ? '#0F1118' : '#F5F2EE',
    inputBorder: dark ? '#2A2E3E' : '#D5D1CA',
    accent:      '#E8B4B8',
    accentBg:    dark ? 'rgba(232,180,184,0.1)' : 'rgba(232,180,184,0.15)',
    green:       '#A8C5A0',
    greenBg:     dark ? 'rgba(168,197,160,0.1)' : 'rgba(168,197,160,0.15)',
  };

  const activeScene = scenes.find(s => s.id === activeSceneId) || null;

  const updateVenue = (field, value) => {
    if (!activeScene) return;
    const venue = { ...(activeScene.venue || { name: '', address: '', status: 'TBD' }), [field]: value };
    onUpdateScene(activeScene.id, { venue });
  };

  const addStaff = () => {
    if (!newStaffName.trim() || !activeScene) return;
    const entry = { id: 'st_' + Date.now(), name: newStaffName.trim(), role: newStaffRole.trim() || 'Crew', confirmed: false };
    onUpdateScene(activeScene.id, { staffChecklist: [...(activeScene.staffChecklist || []), entry] });
    setNewStaffName(''); setNewStaffRole(''); setAddingStaff(false);
  };

  const toggleStaff = (staffId) => {
    if (!activeScene) return;
    onUpdateScene(activeScene.id, {
      staffChecklist: activeScene.staffChecklist.map(s => s.id === staffId ? { ...s, confirmed: !s.confirmed } : s),
    });
  };

  const removeStaff = (staffId) => {
    if (!activeScene) return;
    onUpdateScene(activeScene.id, { staffChecklist: activeScene.staffChecklist.filter(s => s.id !== staffId) });
  };

  const updateShootDate = (date) => {
    if (!activeScene) return;
    onUpdateScene(activeScene.id, { shootDate: date || null });
  };

  const inputStyle = { width: '100%', padding: '7px 10px', borderRadius: 6, fontSize: 12, background: c.input, border: `1px solid ${c.inputBorder}`, color: c.text, fontFamily: "'DM Sans',sans-serif", outline: 'none', boxSizing: 'border-box' };

  const VENUE_STATUSES = ['TBD', 'Confirmed', 'Cancelled'];
  const statusColor = { TBD: '#E8D5B7', Confirmed: '#A8C5A0', Cancelled: '#E87070' };

  return (
    <div style={{
      width: 300, flexShrink: 0, background: c.bg, borderLeft: `1px solid ${c.border}`,
      display: 'flex', flexDirection: 'column', fontFamily: "'DM Sans',sans-serif",
      overflow: 'hidden', animation: 'slideInRight 0.2s ease',
    }}>
      {/* Header */}
      <div style={{ padding: '16px 16px 12px', borderBottom: `1px solid ${c.border}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <div style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: c.accentBg, color: c.accent, letterSpacing: '0.08em' }}>PRODUCER</div>
          <div style={{ flex: 1, fontSize: 13, fontWeight: 600, color: c.text }}>Production Details</div>
          <div onClick={onClose} style={{ cursor: 'pointer', fontSize: 17, color: c.muted, lineHeight: 1 }}>×</div>
        </div>
        {/* Scene selector */}
        <div style={{ display: 'flex', gap: 4, overflowX: 'auto', paddingBottom: 2 }}>
          {scenes.map(s => (
            <div
              key={s.id}
              onClick={() => setActiveSceneId(s.id)}
              style={{
                padding: '3px 9px', borderRadius: 5, cursor: 'pointer', fontSize: 10.5, fontWeight: 500, flexShrink: 0,
                fontFamily: 'monospace', letterSpacing: '0.04em',
                background: activeSceneId === s.id ? c.accentBg : (dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'),
                color: activeSceneId === s.id ? c.accent : c.muted,
                border: `1px solid ${activeSceneId === s.id ? 'rgba(232,180,184,0.35)' : 'transparent'}`,
              }}
            >{s.label}</div>
          ))}
        </div>
      </div>

      {activeScene ? (
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>

          {/* Scene info */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: c.text, marginBottom: 2 }}>{activeScene.title}</div>
            <div style={{ fontSize: 11.5, color: c.muted }}>{activeScene.location}</div>
          </div>

          {/* Shoot Date */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 9.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: c.muted, marginBottom: 7 }}>Shoot Date</div>
            <input
              type="date"
              value={activeScene.shootDate || ''}
              onChange={e => updateShootDate(e.target.value)}
              style={{ ...inputStyle, colorScheme: dark ? 'dark' : 'light' }}
            />
          </div>

          {/* Venue / Location */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 9.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: c.muted, marginBottom: 7 }}>Venue / Location</div>
            <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, padding: '12px' }}>
              <input
                value={activeScene.venue?.name || ''}
                onChange={e => updateVenue('name', e.target.value)}
                placeholder="Venue name…"
                style={{ ...inputStyle, marginBottom: 6 }}
              />
              <input
                value={activeScene.venue?.address || ''}
                onChange={e => updateVenue('address', e.target.value)}
                placeholder="Address…"
                style={{ ...inputStyle, marginBottom: 8 }}
              />
              <div style={{ fontSize: 10.5, color: c.muted, marginBottom: 5 }}>Booking status</div>
              <div style={{ display: 'flex', gap: 5 }}>
                {VENUE_STATUSES.map(st => (
                  <div
                    key={st}
                    onClick={() => updateVenue('status', st)}
                    style={{
                      flex: 1, padding: '5px', borderRadius: 5, cursor: 'pointer', fontSize: 10.5,
                      textAlign: 'center', fontWeight: 500,
                      background: activeScene.venue?.status === st ? `${statusColor[st]}22` : (dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)'),
                      border: `1px solid ${activeScene.venue?.status === st ? statusColor[st] + '55' : c.border}`,
                      color: activeScene.venue?.status === st ? statusColor[st] : c.muted,
                      transition: 'all 0.12s',
                    }}
                  >{st}</div>
                ))}
              </div>
            </div>
          </div>

          {/* Key Staff Checklist */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 9.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', color: c.muted, marginBottom: 7 }}>Key Staff</div>
            <div style={{ background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, overflow: 'hidden' }}>
              {(!activeScene.staffChecklist || activeScene.staffChecklist.length === 0) && !addingStaff && (
                <div style={{ padding: '14px', fontSize: 11.5, color: c.muted, textAlign: 'center' }}>No staff added yet</div>
              )}
              {activeScene.staffChecklist && activeScene.staffChecklist.map(staff => (
                <div key={staff.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderBottom: `1px solid ${c.border}` }}>
                  <div
                    onClick={() => toggleStaff(staff.id)}
                    style={{
                      width: 16, height: 16, borderRadius: 4, flexShrink: 0, cursor: 'pointer',
                      background: staff.confirmed ? c.greenBg : 'transparent',
                      border: `1.5px solid ${staff.confirmed ? c.green : c.inputBorder}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'all 0.15s',
                    }}
                  >
                    {staff.confirmed && <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke={c.green} strokeWidth="1.8" strokeLinecap="round"><path d="M2 5l2.5 2.5L8 3"/></svg>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: staff.confirmed ? c.text : c.muted, fontWeight: staff.confirmed ? 500 : 400 }}>{staff.name}</div>
                    <div style={{ fontSize: 10, color: c.muted }}>{staff.role}</div>
                  </div>
                  <div
                    onClick={() => removeStaff(staff.id)}
                    style={{ fontSize: 14, color: c.muted, cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
                    title="Remove"
                  >×</div>
                </div>
              ))}
              {addingStaff && (
                <div style={{ padding: '10px 12px', borderBottom: `1px solid ${c.border}` }}>
                  <input
                    autoFocus
                    value={newStaffName}
                    onChange={e => setNewStaffName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') addStaff(); if (e.key === 'Escape') setAddingStaff(false); }}
                    placeholder="Name…"
                    style={{ ...inputStyle, marginBottom: 5 }}
                  />
                  <input
                    value={newStaffRole}
                    onChange={e => setNewStaffRole(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') addStaff(); if (e.key === 'Escape') setAddingStaff(false); }}
                    placeholder="Role…"
                    style={{ ...inputStyle, marginBottom: 7 }}
                  />
                  <div style={{ display: 'flex', gap: 5 }}>
                    <div onClick={addStaff} style={{ flex: 1, padding: '5px', borderRadius: 5, cursor: 'pointer', fontSize: 11.5, textAlign: 'center', background: c.accentBg, color: c.accent, border: `1px solid rgba(232,180,184,0.3)` }}>Add</div>
                    <div onClick={() => setAddingStaff(false)} style={{ padding: '5px 10px', borderRadius: 5, cursor: 'pointer', fontSize: 11.5, color: c.muted }}>Cancel</div>
                  </div>
                </div>
              )}
              <div
                onClick={() => setAddingStaff(true)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 12px', cursor: 'pointer', color: c.muted, fontSize: 11.5 }}
                onMouseEnter={e => { e.currentTarget.style.color = c.accent; }}
                onMouseLeave={e => { e.currentTarget.style.color = c.muted; }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M6 2v8M2 6h8"/></svg>
                Add staff member
              </div>
            </div>
          </div>

          {/* Summary stats */}
          {activeScene.staffChecklist && activeScene.staffChecklist.length > 0 && (
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1, padding: '8px 10px', borderRadius: 7, background: c.greenBg, border: `1px solid rgba(168,197,160,0.3)` }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: c.green }}>{activeScene.staffChecklist.filter(s => s.confirmed).length}</div>
                <div style={{ fontSize: 9.5, color: c.muted }}>Confirmed</div>
              </div>
              <div style={{ flex: 1, padding: '8px 10px', borderRadius: 7, background: dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)', border: `1px solid ${c.border}` }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: c.text }}>{activeScene.staffChecklist.filter(s => !s.confirmed).length}</div>
                <div style={{ fontSize: 9.5, color: c.muted }}>Pending</div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: c.muted, fontSize: 13 }}>
          No scenes in this project yet.
        </div>
      )}
    </div>
  );
}

Object.assign(window, { ProducerPanel });
