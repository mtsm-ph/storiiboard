
// storiiboard-history.jsx — change history panel with moodboard pull

const { useState: useHistState } = React;

const HISTORY_DATA = {
  f01: [
    { id:'h1', user:'Sofia Reyes', initials:'SR', action:'Status changed', field:'Status', from:'Planned', to:'Approved', time:'Today, 14:32', accent:'#A8C5A0' },
    { id:'h2', user:'James Lau',   initials:'JL', action:'Lens updated',   field:'Lens',   from:'50mm',    to:'35mm',    time:'Today, 13:15', accent:'#C3B1E1' },
    { id:'h3', user:'Sofia Reyes', initials:'SR', action:'Description edited', field:'Description', from:'–', to:'She studies her reflection…', time:'Yesterday, 18:44', accent:'#E8D5B7' },
    { id:'h4', user:'Tom Hirsch',  initials:'TH', action:'Location set',   field:'Location', from:'–',    to:'Paris Apt.',  time:'Yesterday, 11:20', accent:'#E8B4B8' },
    { id:'h5', user:'James Lau',   initials:'JL', action:'Shot type changed', field:'Shot Type', from:'CU', to:'MCU',     time:'Apr 22, 09:05',    accent:'#C3B1E1' },
  ],
  f02: [
    { id:'h6', user:'James Lau',   initials:'JL', action:'Format updated', field:'Format', from:'6K', to:'8.6K X-OCN XT', time:'Today, 10:48',     accent:'#C3B1E1' },
    { id:'h7', user:'Tom Hirsch',  initials:'TH', action:'Location updated', field:'Location', from:'First Class', to:'Business Class', time:'Yesterday, 15:30', accent:'#E8B4B8' },
    { id:'h8', user:'Sofia Reyes', initials:'SR', action:'Description edited', field:'Description', from:'–', to:'Profile shot. She stares…', time:'Apr 21, 14:10', accent:'#E8D5B7' },
  ],
  f03: [
    { id:'h9',  user:'Marc Duchamp',initials:'MD', action:'Lighting setup added', field:'Lighting', from:'–', to:'Overhead sun, ground bounce fill', time:'Today, 09:15',  accent:'#E8D5B7' },
    { id:'h10', user:'Sofia Reyes', initials:'SR', action:'Aspect ratio changed', field:'Aspect', from:'16/9', to:'2.39:1', time:'Yesterday, 16:40', accent:'#E8B4B8' },
    { id:'h11', user:'Editor Sync', initials:'▶', action:'Plugin: new cut pushed', field:'Reference', from:'v1', to:'v2 (editor@studio.com)', time:'Today, 08:00', accent:'#E8B4B8', plugin:true },
  ],
  f04: [
    { id:'h12', user:'Elena Kovacs',initials:'EK', action:'Color notes added',  field:'Colorist', from:'–', to:'Teal grade, -2 stop',  time:'Today, 11:55',     accent:'#C3B1E1' },
    { id:'h13', user:'James Lau',   initials:'JL', action:'Camera changed',     field:'Camera',   from:'ARRI', to:'RED V-RAPTOR',      time:'Yesterday, 10:30', accent:'#C3B1E1' },
    { id:'h14', user:'James Lau',   initials:'JL', action:'Status changed',     field:'Status',   from:'Planned', to:'Shot',           time:'Apr 20, 17:00',    accent:'#A8C5A0' },
  ],
  f05: [
    { id:'h15', user:'Sofia Reyes', initials:'SR', action:'Frame created', field:'–', from:'–', to:'–', time:'Apr 20, 09:00', accent:'#A8C5A0' },
  ],
  f06: [
    { id:'h16', user:'Sofia Reyes', initials:'SR', action:'Description edited', field:'Description', from:'–', to:'Extreme close-up of a departure board…', time:'Yesterday, 13:20', accent:'#E8D5B7' },
    { id:'h17', user:'Sofia Reyes', initials:'SR', action:'Aspect ratio set', field:'Aspect', from:'16/9', to:'2.39:1', time:'Apr 21, 10:15', accent:'#E8B4B8' },
  ],
};

const FRAME_TITLES = { f01:'Mirror Scene', f02:'Airplane Reverie', f03:'The Ceremony', f04:'Control Room', f05:'Empty Frame', f06:'Departure Board' };
const FRAME_SCENES = { f01:'SC 04', f02:'SC 07', f03:'SC 12', f04:'SC 15', f05:'SC 18', f06:'SC 21' };

function HistoryPanel({ theme, frameId, onClose, onPullToMoodboard }) {
  const dark = theme === 'dark';
  const [activeFrame, setActiveFrame] = useHistState(frameId || 'f01');
  const [pulledItems, setPulledItems] = useHistState(new Set());

  const c = {
    bg:      dark ? '#141820' : '#F0EDE7',
    panel:   dark ? '#1C1F2A' : '#FFFFFF',
    border:  dark ? '#1E2232' : '#DDD9D1',
    text:    dark ? '#C8C0B4' : '#2A2520',
    muted:   dark ? '#4A5270' : '#9A9589',
    hdr:     dark ? '#111318' : '#EEEAE4',
    tabActive:   dark ? 'rgba(195,177,225,0.12)' : 'rgba(195,177,225,0.2)',
    tabActiveTx: '#C3B1E1',
    hover:   dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
    itemBg:  dark ? '#181C28' : '#FAFAF8',
    amber:   '#E8C07A',
  };

  const history = HISTORY_DATA[activeFrame] || [];

  const pull = (item) => {
    setPulledItems(prev => new Set([...prev, item.id]));
    onPullToMoodboard({
      id: `mood-${item.id}`,
      type: 'text',
      content: `${item.field}: "${item.to}"\n— ${item.user}, ${item.time}\n(${FRAME_SCENES[activeFrame]} ${FRAME_TITLES[activeFrame]})`,
      source: `History · ${FRAME_SCENES[activeFrame]}`,
    });
  };

  return (
    <>
      <div onClick={onClose} style={{ position:'fixed', inset:0, zIndex:300, background:'rgba(0,0,0,0.25)', backdropFilter:'blur(2px)' }} />
      <div style={{
        position:'fixed', right:0, top:0, bottom:0, width:400, zIndex:301,
        background:c.bg, borderLeft:`1px solid ${c.border}`,
        display:'flex', flexDirection:'column', fontFamily:"'DM Sans',sans-serif",
        boxShadow:'-4px 0 32px rgba(0,0,0,0.3)',
        animation:'slideInRight 0.22s cubic-bezier(0.22,1,0.36,1)',
      }}>
        {/* Header */}
        <div style={{ padding:'18px 18px 12px', background:c.hdr, borderBottom:`1px solid ${c.border}`, flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', marginBottom:10 }}>
            <svg width="15" height="15" viewBox="0 0 12 12" fill="none" stroke="#C3B1E1" strokeWidth="1.5" strokeLinecap="round" style={{ marginRight:8 }}>
              <circle cx="6" cy="6" r="4.5"/><path d="M6 3.5v2.5l1.5 1.5"/>
            </svg>
            <div style={{ fontSize:14, fontWeight:600, color:c.text, flex:1 }}>Change History</div>
            <div onClick={onClose} style={{ width:26, height:26, borderRadius:'50%', background:c.border, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', fontSize:14, color:c.muted }}>×</div>
          </div>
          <div style={{ fontSize:11, color:c.muted, marginBottom:10 }}>Click any entry to pull it into the Moodboard.</div>
          {/* Frame tabs */}
          <div style={{ display:'flex', gap:4, overflowX:'auto', paddingBottom:2 }}>
            {Object.entries(FRAME_TITLES).map(([fid, title]) => {
              const active = activeFrame === fid;
              return (
                <div
                  key={fid}
                  onClick={() => setActiveFrame(fid)}
                  style={{
                    padding:'4px 10px', borderRadius:6, cursor:'pointer', flexShrink:0,
                    fontSize:10.5, fontWeight:active?600:400, userSelect:'none',
                    background:active ? c.tabActive : 'transparent',
                    color:active ? c.tabActiveTx : c.muted,
                    border:`1px solid ${active ? 'rgba(195,177,225,0.3)' : 'transparent'}`,
                    transition:'all 0.12s',
                  }}
                >
                  <span style={{ fontFamily:'monospace', fontSize:9, marginRight:4 }}>{FRAME_SCENES[fid]}</span>
                  {title}
                </div>
              );
            })}
          </div>
        </div>

        {/* Scene header */}
        <div style={{ padding:'10px 18px', background:c.panel, borderBottom:`1px solid ${c.border}`, flexShrink:0, display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontFamily:'monospace', fontSize:10, letterSpacing:'0.08em', color:'#C3B1E1' }}>{FRAME_SCENES[activeFrame]}</span>
          <span style={{ fontFamily:"'Playfair Display',serif", fontSize:14, fontWeight:700, color:c.text }}>{FRAME_TITLES[activeFrame]}</span>
          <span style={{ fontSize:11, color:c.muted, marginLeft:'auto' }}>{history.length} entries</span>
        </div>

        {/* History list */}
        <div style={{ flex:1, overflowY:'auto', padding:'10px 12px' }}>
          {history.map((item, i) => {
            const pulled = pulledItems.has(item.id);
            return (
              <div key={item.id}>
                {/* Date grouping */}
                {(i === 0 || item.time.split(',')[0] !== history[i-1].time.split(',')[0]) && (
                  <div style={{ fontSize:9, letterSpacing:'0.1em', textTransform:'uppercase', color:c.muted, fontFamily:'monospace', padding:'6px 6px 4px', marginTop:i===0?0:8 }}>
                    {item.time.split(',')[0]}
                  </div>
                )}
                <div style={{
                  display:'flex', gap:10, padding:'10px 10px', borderRadius:8, marginBottom:3,
                  background:pulled ? (dark?'rgba(168,197,160,0.07)':'rgba(168,197,160,0.1)') : c.itemBg,
                  border:`1px solid ${pulled ? 'rgba(168,197,160,0.2)' : 'transparent'}`,
                  cursor:'pointer', transition:'background 0.14s',
                  position:'relative',
                }}
                onMouseEnter={e => { if (!pulled) e.currentTarget.style.background = c.hover; }}
                onMouseLeave={e => { if (!pulled) e.currentTarget.style.background = c.itemBg; }}
                onClick={() => !pulled && pull(item)}
                >
                  {/* Avatar */}
                  <div style={{
                    width:28, height:28, borderRadius:'50%', flexShrink:0,
                    background:item.plugin ? 'rgba(232,180,184,0.15)' : `${item.accent}22`,
                    display:'flex', alignItems:'center', justifyContent:'center',
                    fontSize:item.initials.length > 2 ? 11 : 9, fontWeight:700, color:item.accent,
                    border:`1px solid ${item.accent}33`,
                  }}>{item.initials}</div>

                  {/* Content */}
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:'flex', alignItems:'baseline', gap:6, marginBottom:2 }}>
                      <span style={{ fontSize:11.5, fontWeight:500, color:c.text }}>{item.user}</span>
                      {item.plugin && <span style={{ fontSize:8.5, color:'#E8B4B8', fontFamily:'monospace', letterSpacing:'0.06em' }}>PLUGIN</span>}
                    </div>
                    <div style={{ fontSize:11, color:c.muted, marginBottom:4 }}>{item.action}</div>
                    <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
                      {item.from !== '–' && (
                        <span style={{ fontSize:10, fontFamily:'monospace', color:dark?'#5A6480':'#9A9589', textDecoration:'line-through', maxWidth:120, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.from}</span>
                      )}
                      {item.from !== '–' && <span style={{ fontSize:10, color:c.muted }}>→</span>}
                      <span style={{ fontSize:10, fontFamily:'monospace', color:item.accent, maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.to}</span>
                    </div>
                    <div style={{ fontSize:9.5, color:c.muted, marginTop:4, opacity:0.7 }}>{item.time.split(',')[1]?.trim()}</div>
                  </div>

                  {/* Pull indicator */}
                  {pulled ? (
                    <div style={{ fontSize:9, color:'#A8C5A0', flexShrink:0, alignSelf:'center', fontFamily:'monospace' }}>↗ Pulled</div>
                  ) : (
                    <div style={{ fontSize:9, color:c.muted, flexShrink:0, alignSelf:'center', opacity:0.5 }}>↗ Board</div>
                  )}
                </div>
              </div>
            );
          })}
          {history.length === 0 && (
            <div style={{ textAlign:'center', padding:'40px 20px', color:c.muted, fontSize:13 }}>No history yet</div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding:'12px 18px', borderTop:`1px solid ${c.border}`, flexShrink:0, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div style={{ fontSize:11, color:c.muted }}>{pulledItems.size > 0 ? `${pulledItems.size} item${pulledItems.size!==1?'s':''} pulled to Moodboard` : 'Click any entry to pull to Moodboard'}</div>
          {pulledItems.size > 0 && (
            <div style={{ fontSize:11, color:'#E8B4B8', cursor:'pointer', padding:'4px 10px', borderRadius:6, border:'1px solid rgba(232,180,184,0.3)' }}
              onClick={() => setPulledItems(new Set())}>Clear pulls</div>
          )}
        </div>
      </div>
      <style>{`@keyframes slideInRight { from { transform:translateX(24px); opacity:0; } to { transform:translateX(0); opacity:1; } }`}</style>
    </>
  );
}

Object.assign(window, { HistoryPanel });
