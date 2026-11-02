
// storiiboard-frames.jsx (v2) — history bubble, lighting link, crew picker

const { useState: useFrameState, useRef: useFrameRef, useEffect: useFrameEffect } = React;

const STATUS_CONFIG = {
  planned:  { label: 'Planned',  color: '#6B7399', bg: 'rgba(107,115,153,0.15)' },
  approved: { label: 'Approved', color: '#A8C5A0', bg: 'rgba(168,197,160,0.15)' },
  shot:     { label: 'Shot',     color: '#C3B1E1', bg: 'rgba(195,177,225,0.15)' },
  cut:      { label: 'Cut',      color: '#E8B4B8', bg: 'rgba(232,180,184,0.15)' },
};

const CREW_DIRECTORY = [
  { name: 'Sofia Reyes',  role: 'DIR', initials: 'SR', dept: 'Direction' },
  { name: 'James Lau',    role: 'DP',  initials: 'JL', dept: 'Camera'    },
  { name: 'Marc Duchamp', role: 'GAF', initials: 'MD', dept: 'Lighting'  },
  { name: 'Elena Kovacs', role: 'CLR', initials: 'EK', dept: 'Post'      },
  { name: 'Tom Hirsch',   role: '1AD', initials: 'TH', dept: 'Production'},
  { name: 'Priya Nair',   role: 'LOC', initials: 'PN', dept: 'Locations' },
];

function SpecChip({ value, accent, dark }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4, padding: '3px 7px', borderRadius: 4,
      background: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
      border: `1px solid ${dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'}`,
      fontFamily: "'DM Mono','Fira Mono',monospace",
      fontSize: 10.5, letterSpacing: '0.04em',
      color: accent || (dark ? '#8A96B4' : '#7A7469'), whiteSpace: 'nowrap',
    }}>{value}</div>
  );
}

function ColorSwatch({ hex }) {
  return <div title={hex} style={{ width: 11, height: 11, borderRadius: 3, background: hex, border: '1px solid rgba(0,0,0,0.15)', flexShrink: 0 }} />;
}

// Crew dropdown picker
function CrewPicker({ dark, crew, setCrew, onClose }) {
  const [search, setSearch] = useFrameState('');
  const ref = useFrameRef(null);

  useFrameEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const hasMember = (name) => crew.some(c => c.name === name);
  const toggle = (member) => {
    if (hasMember(member.name)) setCrew(prev => prev.filter(c => c.name !== member.name));
    else setCrew(prev => [...prev, member]);
  };

  const filtered = CREW_DIRECTORY.filter(m =>
    m.name.toLowerCase().includes(search.toLowerCase()) ||
    m.role.toLowerCase().includes(search.toLowerCase())
  );

  const c = {
    bg: dark ? '#1E2232' : '#FFFFFF', border: dark ? '#2A2E3E' : '#DDD9D1',
    text: dark ? '#C8C0B4' : '#2A2520', muted: dark ? '#4A5270' : '#9A9589',
    hover: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
    input: dark ? '#141820' : '#F5F2EE', activeRow: dark ? 'rgba(168,197,160,0.1)' : 'rgba(168,197,160,0.15)',
  };

  return (
    <div ref={ref} onClick={e => e.stopPropagation()} style={{
      position: 'absolute', bottom: '100%', left: 0, zIndex: 500, width: 240,
      background: c.bg, border: `1px solid ${c.border}`, borderRadius: 10,
      boxShadow: '0 8px 28px rgba(0,0,0,0.35)', marginBottom: 4, overflow: 'hidden',
    }}>
      <div style={{ padding: '10px 10px 6px' }}>
        <input
          autoFocus
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search crew…"
          style={{
            width: '100%', background: c.input, border: 'none', outline: 'none',
            borderRadius: 6, padding: '6px 10px', fontSize: 12, color: c.text,
            fontFamily: "'DM Sans',sans-serif",
          }}
        />
      </div>
      <div style={{ maxHeight: 200, overflowY: 'auto' }}>
        {filtered.map(m => {
          const active = hasMember(m.name);
          return (
            <div
              key={m.name}
              onClick={() => toggle(m)}
              style={{
                display: 'flex', alignItems: 'center', gap: 9, padding: '7px 12px',
                cursor: 'pointer', background: active ? c.activeRow : 'transparent',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = c.hover; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = active ? c.activeRow : 'transparent'; }}
            >
              <div style={{
                width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                background: 'linear-gradient(135deg,#C3B1E1,#A8C5A0)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9, fontWeight: 700, color: '#fff',
              }}>{m.initials}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: c.text, fontWeight: 500 }}>{m.name}</div>
                <div style={{ fontSize: 10, color: c.muted }}>{m.dept}</div>
              </div>
              <div style={{
                fontSize: 9, fontFamily: 'monospace', padding: '2px 5px', borderRadius: 4,
                background: active ? 'rgba(168,197,160,0.2)' : 'rgba(255,255,255,0.05)',
                color: active ? '#A8C5A0' : c.muted, letterSpacing: '0.05em',
              }}>{m.role}</div>
              {active && <div style={{ color: '#A8C5A0', fontSize: 12 }}>✓</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Mini history bubble on each card
function HistoryBubble({ dark, frameId, onOpenHistory }) {
  return (
    <div
      onClick={e => { e.stopPropagation(); onOpenHistory(frameId); }}
      title="View change history"
      style={{
        width: 22, height: 22, borderRadius: '50%', cursor: 'pointer',
        background: dark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.8)',
        backdropFilter: 'blur(6px)', border: dark ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(0,0,0,0.1)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'background 0.14s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = dark ? 'rgba(195,177,225,0.25)' : 'rgba(195,177,225,0.4)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = dark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.8)'; }}
    >
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke={dark ? '#C3B1E1' : '#8A7AAE'} strokeWidth="1.5" strokeLinecap="round">
        <circle cx="6" cy="6" r="4.5"/>
        <path d="M6 3.5v2.5l1.5 1.5"/>
      </svg>
    </div>
  );
}

function FrameCard({ frame, theme, pitchMode, onExpand, expanded, onOpenHistory, claudeEnabled }) {
  const dark = theme === 'dark';
  const [advOpen, setAdvOpen] = useFrameState(false);
  const [localStatus, setLocalStatus] = useFrameState(frame.status);
  const [descValue, setDescValue] = useFrameState(frame.description || '');
  const [crew, setCrew] = useFrameState(frame.crew || []);
  const [crewPickerOpen, setCrewPickerOpen] = useFrameState(false);

  const c = {
    card:    dark ? '#1C1F2A' : '#FFFFFF',
    border:  dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)',
    text:    dark ? '#C8C0B4' : '#2A2520',
    muted:   dark ? '#4A5270' : '#9A9589',
    divider: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)',
    imgBg:   dark ? '#0F111A' : '#E8E4DC',
    imgStripe: dark ? '#141820' : '#DDD9D1',
    advBg:   dark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.03)',
  };

  const statusCfg = STATUS_CONFIG[localStatus] || STATUS_CONFIG.planned;
  const ar = frame.aspectRatio === '2.39:1' ? 2.39 : 16/9;
  const paddingTop = `${(1/ar)*100}%`;
  const intExtColor = frame.intExt === 'INT' ? (dark ? '#C3B1E1' : '#8A7AAE') : (dark ? '#A8C5A0' : '#5A8A50');

  if (pitchMode) {
    return (
      <div style={{
        background: c.card, border: `1px solid ${c.border}`, borderRadius: 10,
        overflow: 'hidden', fontFamily: "'DM Sans',sans-serif",
        boxShadow: dark ? '0 2px 12px rgba(0,0,0,0.4)' : '0 2px 12px rgba(0,0,0,0.08)',
      }}>
        <div style={{ position: 'relative', paddingTop, background: c.imgBg, overflow: 'hidden' }}>
          {frame.image
            ? <img src={frame.image} alt={frame.title} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            : <div style={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                backgroundImage: `repeating-linear-gradient(45deg,${c.imgStripe} 0,${c.imgStripe} 1px,transparent 1px,transparent 8px)`,
              }}>
                <span style={{ fontSize: 9, color: c.muted, fontFamily: 'monospace', opacity: 0.7 }}>FRAME PENDING</span>
              </div>
          }
          <div style={{
            position: 'absolute', top: 8, left: 8, background: 'rgba(0,0,0,0.55)',
            backdropFilter: 'blur(6px)', color: '#fff', fontSize: 9,
            fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.08em',
            padding: '3px 7px', borderRadius: 4,
          }}>{frame.scene} · {String(frame.number).padStart(2,'0')}</div>
        </div>
        <div style={{ padding: '14px 16px 16px' }}>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 15, fontWeight: 600, color: c.text, marginBottom: 6 }}>{frame.title}</div>
          {frame.description && <div style={{ fontSize: 12.5, color: c.muted, lineHeight: 1.55 }}>{frame.description}</div>}
          <div style={{ marginTop: 10, fontSize: 9, color: c.muted, letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: 'monospace' }}>
            Parfum No. 7 — TVC · Storiiboard
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={onExpand}
      style={{
        background: c.card, border: `1px solid ${expanded ? (dark ? 'rgba(195,177,225,0.4)' : '#C3B1E1') : c.border}`,
        borderRadius: 10, overflow: 'visible', fontFamily: "'DM Sans',sans-serif", cursor: 'pointer',
        boxShadow: dark ? '0 2px 16px rgba(0,0,0,0.35)' : '0 2px 12px rgba(0,0,0,0.07)',
        transition: 'box-shadow 0.15s, border-color 0.15s', position: 'relative',
      }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = dark ? '0 4px 28px rgba(0,0,0,0.5)' : '0 4px 20px rgba(0,0,0,0.12)'; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = dark ? '0 2px 16px rgba(0,0,0,0.35)' : '0 2px 12px rgba(0,0,0,0.07)'; }}
    >
      {/* Image */}
      <div style={{ position: 'relative', paddingTop, background: c.imgBg, overflow: 'hidden', borderRadius: '10px 10px 0 0' }}>
        {frame.image
          ? <img src={frame.image} alt={frame.title} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
          : <div style={{
              position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8,
              backgroundImage: `repeating-linear-gradient(45deg,${c.imgStripe} 0,${c.imgStripe} 1px,transparent 1px,transparent 9px)`,
            }}>
              <span style={{ fontSize: 9, color: c.muted, fontFamily: 'monospace', opacity: 0.6, textAlign: 'center' }}>FRAME<br/>PENDING</span>
            </div>
        }
        {/* Frame + scene badge */}
        <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', gap: 5 }}>
          <div style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', color: '#EDE8E2', fontSize: 9, fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.08em', padding: '3px 7px', borderRadius: 4 }}>{String(frame.number).padStart(2,'0')}</div>
          <div style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', color: '#9AA0B8', fontSize: 9, fontFamily: 'monospace', letterSpacing: '0.06em', padding: '3px 7px', borderRadius: 4 }}>{frame.scene}</div>
        </div>
        {/* Top-right: history bubble + lighting link */}
        <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 5, alignItems: 'center' }}>
          {frame.hasLighting && (
            <div
              onClick={e => { e.stopPropagation(); }}
              title="View lighting setup"
              style={{
                padding: '3px 7px', borderRadius: 4, cursor: 'pointer',
                background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)',
                fontSize: 9, color: '#E8D5B7', fontFamily: 'monospace', letterSpacing: '0.05em',
                border: '1px solid rgba(232,213,183,0.25)',
              }}
            >⚡ Setup</div>
          )}
          <HistoryBubble dark={dark} frameId={frame.id} onOpenHistory={onOpenHistory} />
        </div>
        {/* Aspect ratio */}
        <div style={{ position: 'absolute', bottom: 8, right: 8, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)', color: '#7A8098', fontSize: 9, fontFamily: 'monospace', padding: '2px 6px', borderRadius: 3 }}>{frame.aspectRatio}</div>
      </div>

      {/* Quick spec row */}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center', padding: '10px 12px 8px', borderBottom: `1px solid ${c.divider}` }}>
        <SpecChip value={frame.lens} dark={dark} />
        <SpecChip value={frame.intExt} accent={intExtColor} dark={dark} />
        <SpecChip value={frame.location} dark={dark} />
        <SpecChip value={frame.shotType} accent={dark ? '#E8D5B7' : '#8A7458'} dark={dark} />
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: statusCfg.color }} />
          <span style={{ fontSize: 9.5, color: statusCfg.color, fontWeight: 500, letterSpacing: '0.04em' }}>{statusCfg.label}</span>
        </div>
      </div>

      {/* Title + description */}
      <div style={{ padding: '10px 12px 8px' }}>
        <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 14, fontWeight: 600, color: c.text, marginBottom: 6, letterSpacing: '-0.01em' }}>{frame.title}</div>
        <textarea
          value={descValue} onChange={e => { e.stopPropagation(); setDescValue(e.target.value); }}
          onClick={e => e.stopPropagation()} placeholder="Add shot description…" rows={2}
          style={{ width: '100%', resize: 'none', border: 'none', outline: 'none', background: 'transparent', fontFamily: "'DM Sans',sans-serif", fontSize: 12, lineHeight: 1.55, color: c.muted, padding: 0, boxSizing: 'border-box' }}
        />
      </div>

      {/* Advanced specs */}
      <div style={{ borderTop: `1px solid ${c.divider}` }}>
        <div onClick={e => { e.stopPropagation(); setAdvOpen(o => !o); }} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', cursor: 'pointer', fontSize: 10.5, color: c.muted, letterSpacing: '0.04em', userSelect: 'none' }}>
          <span style={{ transform: advOpen ? 'rotate(0)' : 'rotate(-90deg)', display: 'flex', transition: 'transform 0.18s' }}>
            <SbIcons.ChevDown />
          </span>
          Advanced Specs
        </div>
        {advOpen && (
          <div style={{ background: c.advBg, padding: '10px 12px 12px' }} onClick={e => e.stopPropagation()}>
            {[['Camera',frame.camera],['Format',frame.format],['Lighting',frame.lightingType],['Setup',frame.lightingSetup],['Frame',frame.frameSize],['Comp.',frame.composition],['Time',frame.timeOfDay]].filter(([,v])=>v).map(([k,v])=>(
              <div key={k} style={{ display: 'flex', gap: 8, marginBottom: 5, fontSize: 11 }}>
                <span style={{ color: c.muted, fontFamily: 'monospace', fontSize: 9.5, letterSpacing: '0.06em', textTransform: 'uppercase', width: 48, flexShrink: 0, paddingTop: 1 }}>{k}</span>
                <span style={{ color: c.text }}>{v}</span>
              </div>
            ))}
            {frame.colorPalette?.length > 0 && (
              <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'center' }}>
                <span style={{ color: c.muted, fontFamily: 'monospace', fontSize: 9.5, letterSpacing: '0.06em', textTransform: 'uppercase', width: 48, flexShrink: 0 }}>Color</span>
                <div style={{ display: 'flex', gap: 4 }}>{frame.colorPalette.map(col => <ColorSwatch key={col} hex={col} />)}</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Linked assets */}
      {frame.linkedAssets > 0 && (
        <div style={{ borderTop: `1px solid ${c.divider}`, padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: c.muted, fontFamily: 'monospace' }}>Assets</div>
          {Array.from({ length: Math.min(frame.linkedAssets, 4) }).map((_, i) => (
            <div key={i} style={{ width: 26, height: 20, borderRadius: 4, background: dark ? 'rgba(168,197,160,0.12)' : 'rgba(168,197,160,0.2)', border: `1px solid ${dark ? 'rgba(168,197,160,0.2)' : 'rgba(168,197,160,0.35)'}` }} />
          ))}
          <span style={{ fontSize: 10, color: '#A8C5A0', marginLeft: 2 }}>{frame.linkedAssets} linked</span>
        </div>
      )}

      {/* Crew + status */}
      <div style={{ borderTop: `1px solid ${c.divider}`, padding: '8px 12px', display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center', position: 'relative' }}>
        {crew.map((cr, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px 3px 3px', borderRadius: 20, background: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', border: `1px solid ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}` }}>
            <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'linear-gradient(135deg,#C3B1E1,#A8C5A0)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, color: '#fff' }}>{cr.initials}</div>
            <span style={{ fontSize: 10.5, color: dark ? '#A8B0C8' : '#6A6460' }}>{cr.name}</span>
            <span style={{ fontSize: 9, color: dark ? '#4A5270' : '#B0A8A0' }}>{cr.role}</span>
          </div>
        ))}
        <div
          onClick={e => { e.stopPropagation(); setCrewPickerOpen(o => !o); }}
          style={{
            padding: '3px 8px', borderRadius: 20, cursor: 'pointer', fontSize: 10.5,
            border: `1px dashed ${dark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'}`,
            color: c.muted, transition: 'border-color 0.12s, color 0.12s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#A8C5A0'; e.currentTarget.style.color = '#A8C5A0'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = dark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)'; e.currentTarget.style.color = c.muted; }}
        >+ Crew</div>
        {crewPickerOpen && <CrewPicker dark={dark} crew={crew} setCrew={setCrew} onClose={() => setCrewPickerOpen(false)} />}
        <div style={{ marginLeft: 'auto' }}>
          <select
            value={localStatus} onChange={e => { e.stopPropagation(); setLocalStatus(e.target.value); }} onClick={e => e.stopPropagation()}
            style={{ background: statusCfg.bg, color: statusCfg.color, border: 'none', outline: 'none', borderRadius: 5, fontSize: 10, fontWeight: 600, padding: '3px 6px', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif" }}
          >
            {Object.entries(STATUS_CONFIG).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { FrameCard });
