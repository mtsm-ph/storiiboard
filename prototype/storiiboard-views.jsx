
// storiiboard-views.jsx (v2) — multi-filter, scene grouping, pitch deck frame picker + Claude

const { useState: useViewState, useRef: useViewRef, useEffect: useViewEffect } = React;

const FRAMES_DATA = [
  { id:'f01', number:'01', scene:'SC 04', title:'Mirror Scene',     image:'uploads/small_NVTE6ECR.jpg', aspectRatio:'16/9',   lens:'35mm',  intExt:'INT', location:'Paris Apt.',     shotType:'MCU',      status:'approved', description:'She studies her reflection, lipstick raised. The window behind frames a Haussmann courtyard. Golden hour spills across the tiles.', crew:[{name:'Sofia Reyes',role:'DIR',initials:'SR'},{name:'James Lau',role:'DP',initials:'JL'}],    camera:'ARRI Alexa 35', format:'4.5K ARRIRAW', lightingType:'Practical + Natural', lightingSetup:'Window key, warm bounce off walls',         frameSize:'2.39:1', composition:'Rule of thirds — subject left, reflection right', timeOfDay:'Golden Hour',       colorPalette:['#E8B4B8','#E8D5B7','#8B6914'], linkedAssets:2, hasLighting:true  },
  { id:'f02', number:'02', scene:'SC 07', title:'Airplane Reverie', image:'uploads/small_LF7JADRW.jpg', aspectRatio:'16/9',   lens:'50mm',  intExt:'INT', location:'Business Class',  shotType:'CU',       status:'planned',  description:'Profile shot. She stares out the window. Noise-cancelling headphones blur the world. Soft blue from the overhead panel.',            crew:[{name:'James Lau',role:'DP',initials:'JL'}],                                               camera:'Sony VENICE 2', format:'8.6K X-OCN XT', lightingType:'Available + LED',     lightingSetup:'Overhead LED, 5600K, -1 stop',               frameSize:'16:9',   composition:'Profile, negative space to right',                 timeOfDay:'Daytime in-flight', colorPalette:['#C3B1E1','#A8C5A0','#6B7FA3'], linkedAssets:0, hasLighting:false },
  { id:'f03', number:'03', scene:'SC 12', title:'The Ceremony',     image:'uploads/small_KDGP7IMR.jpg', aspectRatio:'2.39:1', lens:'14mm',  intExt:'EXT', location:'Desert Plain',    shotType:'Aerial WS',status:'planned',  description:'High overhead. Hundreds of white-robed figures with red fez hats. One woman in black at center. Geometric, graphic, overwhelming.',    crew:[{name:'Sofia Reyes',role:'DIR',initials:'SR'},{name:'Marc Duchamp',role:'GAF',initials:'MD'}], camera:'ARRI Alexa 35', format:'4K',             lightingType:'Natural Sunlight',    lightingSetup:'Overhead sun, ground bounce fill',           frameSize:'2.39:1', composition:'Overhead, centered subject',                       timeOfDay:'Midday',            colorPalette:['#E8D5B7','#CC2200','#F5F0E8'], linkedAssets:3, hasLighting:true  },
  { id:'f04', number:'04', scene:'SC 15', title:'Control Room',     image:'uploads/small_EE2UMJ1P.jpg', aspectRatio:'16/9',   lens:'85mm',  intExt:'INT', location:'Server Room',     shotType:'MS',       status:'shot',     description:'He rests his head on the machine. Teal-green practicals cast deep shadows. Claustrophobic. The hum of servers fills the silence.',   crew:[{name:'James Lau',role:'DP',initials:'JL'},{name:'Elena Kovacs',role:'CLR',initials:'EK'}],    camera:'RED V-RAPTOR',  format:'8K REDCODE',   lightingType:'Practical LED',       lightingSetup:'Server practicals, teal gel, -2 stop',       frameSize:'16:9',   composition:'Low angle, subject centered',                       timeOfDay:'N/A (interior)',    colorPalette:['#2D6B5E','#1A3D35','#C3B1E1'], linkedAssets:1, hasLighting:true  },
  { id:'f05', number:'05', scene:'SC 18', title:'Empty Frame',      image:null,                         aspectRatio:'16/9',   lens:'24mm',  intExt:'EXT', location:'TBD',             shotType:'WS',       status:'planned',  description:'',                                                                                                                                    crew:[],                                                                                         camera:null,            format:null,            lightingType:null,                  lightingSetup:null,                                         frameSize:'16:9',   composition:null,                                               timeOfDay:null,                colorPalette:[],                               linkedAssets:0, hasLighting:false },
  { id:'f06', number:'06', scene:'SC 21', title:'Departure Board',  image:null,                         aspectRatio:'2.39:1', lens:'135mm', intExt:'EXT', location:'Airport',         shotType:'ECU',      status:'planned',  description:'Extreme close-up of a departure board. Letters cascade in mechanical rhythm. The sound design carries this one.',                    crew:[{name:'Sofia Reyes',role:'DIR',initials:'SR'}],                                             camera:'ARRI Alexa 35', format:'4.5K',          lightingType:'Practical',           lightingSetup:'Board self-illuminated, no adds',            frameSize:'2.39:1', composition:'Flat center, macro',                               timeOfDay:'Evening',           colorPalette:['#E8D5B7','#C3B1E1'],           linkedAssets:0, hasLighting:false },
];

// Group frames by scene
const SCENE_GROUPS = [
  { id:'sc04', label:'SC 04', title:'Mirror Scene',     location:'Paris Apt.',    intExt:'INT', frameIds:['f01'] },
  { id:'sc07', label:'SC 07', title:'Airplane Reverie', location:'Business Class',intExt:'INT', frameIds:['f02'] },
  { id:'sc12', label:'SC 12', title:'The Ceremony',     location:'Desert Plain',  intExt:'EXT', frameIds:['f03'] },
  { id:'sc15', label:'SC 15', title:'Control Room',     location:'Server Room',   intExt:'INT', frameIds:['f04'] },
  { id:'sc18', label:'SC 18', title:'Empty Frame',      location:'TBD',           intExt:'EXT', frameIds:['f05'] },
  { id:'sc21', label:'SC 21', title:'Departure Board',  location:'Airport',       intExt:'EXT', frameIds:['f06'] },
];

const FILTER_GROUPS = [
  { label:'Interior/Exterior', chips:['INT','EXT'] },
  { label:'Status',            chips:['Approved','Planned','Shot'] },
  { label:'Scene',             chips:['SC 04','SC 07','SC 12','SC 15','SC 18','SC 21'] },
  { label:'Shot Type',         chips:['WS','MS','CU','MCU','ECU','Aerial'] },
];

const ASSET_CATEGORIES = ['All Assets','References','Locations','Lookbooks','Wardrobe','Props','LUTs / Color','Scripts','Music / Sound','Storyboards','Call Sheets'];
const ASSETS_DATA = [
  { id:'a1', title:'Paris Apartment Refs',  category:'References',  tags:['warm','interior','Paris'],  scenes:3, type:'JPG Collection', thumb:'uploads/small_NVTE6ECR.jpg' },
  { id:'a2', title:'Desert Location Scout', category:'Locations',   tags:['EXT','desert','day'],       scenes:1, type:'JPEG × 24',     thumb:'uploads/small_KDGP7IMR.jpg' },
  { id:'a3', title:'Blue Hour Lookbook',    category:'Lookbooks',   tags:['cool','blue','travel'],     scenes:2, type:'PDF',           thumb:'uploads/small_LF7JADRW.jpg' },
  { id:'a4', title:'Industrial Color Ref',  category:'LUTs / Color',tags:['teal','dark','server'],     scenes:1, type:'PNG + CUBE',    thumb:'uploads/small_EE2UMJ1P.jpg' },
  { id:'a5', title:'Fragrance Wardrobe Deck',category:'Wardrobe',   tags:['white','black','costume'],  scenes:5, type:'PDF',           thumb:null },
  { id:'a6', title:'Scene 04 Script Pages', category:'Scripts',     tags:['SC 04','final'],            scenes:1, type:'PDF',           thumb:null },
  { id:'a7', title:'Opening Score Draft',   category:'Music / Sound',tags:['orchestral','draft'],      scenes:0, type:'WAV',           thumb:null },
];
const CREW_DATA = [
  { name:'Sofia Reyes',  role:'Director',              dept:'Direction', initials:'SR', scenes:6, gradient:'linear-gradient(135deg,#C3B1E1,#E8B4B8)' },
  { name:'James Lau',    role:'Director of Photography',dept:'Camera',   initials:'JL', scenes:5, gradient:'linear-gradient(135deg,#A8C5A0,#C3B1E1)' },
  { name:'Marc Duchamp', role:'Gaffer',                dept:'Lighting',  initials:'MD', scenes:2, gradient:'linear-gradient(135deg,#E8D5B7,#E8B4B8)' },
  { name:'Elena Kovacs', role:'Colorist',              dept:'Post',      initials:'EK', scenes:1, gradient:'linear-gradient(135deg,#C3B1E1,#A8C5A0)' },
  { name:'Tom Hirsch',   role:'1st AD',                dept:'Production',initials:'TH', scenes:4, gradient:'linear-gradient(135deg,#E8B4B8,#E8D5B7)' },
  { name:'Priya Nair',   role:'Location Manager',      dept:'Locations', initials:'PN', scenes:3, gradient:'linear-gradient(135deg,#A8C5A0,#E8D5B7)' },
];

const PLUGIN_DATA = [
  { id:'claude-ai',   name:'Claude AI',        icon:'◆', desc:'Summarize shot notes, generate pitch deck copy, and co-write director\'s statements using Claude AI.', perms:['Read frame descriptions','Read project metadata','Write pitch deck content'],        active:false, badge:null,        accent:'#C3B1E1' },
  { id:'editor-sync', name:'Editor Sync',      icon:'▶', desc:'Push new editor cuts from Premiere, DaVinci Resolve, or Avid to any shot in Storiiboard.',             perms:['Read project frames','Write frame references','Trigger notifications'],               active:true,  badge:'2 new cuts', accent:'#E8B4B8' },
  { id:'frame-io',    name:'Frame.io Bridge',  icon:'⬡', desc:'Sync review comments and approval states from Frame.io directly into the approval queue.',              perms:['Read comments','Write status'],                                                        active:false, badge:null,        accent:'#A8C5A0' },
  { id:'shot-grid',   name:'ShotGrid Link',    icon:'◈', desc:'Pull scheduling data and shooting days from Autodesk ShotGrid into the filter bar.',                    perms:['Read schedule','Read crew'],                                                          active:false, badge:null,        accent:'#E8D5B7' },
];

// ── Pitch Deck Generator (with Claude) ───────────────────────────────────────

function PitchDeckGenerator({ theme, selectedFrames, frames, claudeEnabled, onClose }) {
  const dark = theme === 'dark';
  const [generating, setGenerating] = useViewState(false);
  const [result, setResult] = useViewState('');
  const [error, setError] = useViewState('');

  const c = {
    bg: dark ? '#1C1F2A' : '#FFFFFF', border: dark ? '#2A2E3E' : '#DDD9D1',
    text: dark ? '#C8C0B4' : '#2A2520', muted: dark ? '#4A5270' : '#9A9589',
    input: dark ? '#141820' : '#F5F2EE',
  };

  const selectedData = frames.filter(f => selectedFrames.has(f.id));

  const generate = async () => {
    setGenerating(true); setError(''); setResult('');
    try {
      const prompt = `You are a cinematic pitch deck writer for high-end film and commercial production.

Write compelling, atmospheric pitch deck copy for the following storyboard frames from "Parfum No. 7 — TVC":

${selectedData.map(f => `Frame ${f.number} — ${f.title} (${f.scene})
Shot: ${f.shotType} | ${f.intExt} | ${f.location} | ${f.lens}
Description: ${f.description || 'No description yet'}
Mood/Palette: ${f.colorPalette?.join(', ') || 'N/A'}
Time of Day: ${f.timeOfDay || 'N/A'}`).join('\n\n')}

Write a short, evocative director's statement (3-4 sentences) followed by a one-line caption for each frame. Use a cinematic, editorial tone — sparse, precise, atmospheric. No marketing clichés.`;

      const text = await window.claude.complete({ messages: [{ role: 'user', content: prompt }] });
      setResult(text);
    } catch (e) {
      setError('Could not connect to Claude. Check your connection and try again.');
    }
    setGenerating(false);
  };

  return (
    <>
      <div onClick={onClose} style={{ position:'fixed', inset:0, zIndex:800, background:'rgba(0,0,0,0.5)', backdropFilter:'blur(4px)' }} />
      <div style={{
        position:'fixed', top:'50%', left:'50%', transform:'translate(-50%,-50%)',
        zIndex:801, width:560, maxHeight:'80vh', background:c.bg,
        border:`1px solid ${c.border}`, borderRadius:14,
        boxShadow:'0 24px 64px rgba(0,0,0,0.5)', display:'flex', flexDirection:'column',
        fontFamily:"'DM Sans',sans-serif", overflow:'hidden',
      }}>
        <div style={{ padding:'20px 22px 16px', borderBottom:`1px solid ${c.border}`, flexShrink:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:6 }}>
            <div style={{ fontSize:18, color:'#C3B1E1' }}>◆</div>
            <div style={{ fontFamily:"'Playfair Display',serif", fontSize:17, fontWeight:700, color:c.text }}>Generate Pitch Deck</div>
            <div onClick={onClose} style={{ marginLeft:'auto', cursor:'pointer', fontSize:18, color:c.muted }}>×</div>
          </div>
          <div style={{ fontSize:12, color:c.muted }}>
            {selectedData.length} frame{selectedData.length !== 1 ? 's' : ''} selected — Claude will write atmospheric director's notes and frame captions.
          </div>
        </div>

        {/* Selected frames preview */}
        <div style={{ padding:'14px 22px', borderBottom:`1px solid ${c.border}`, flexShrink:0 }}>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {selectedData.map(f => (
              <div key={f.id} style={{
                padding:'4px 10px', borderRadius:6, fontSize:11,
                background:dark?'rgba(195,177,225,0.1)':'rgba(195,177,225,0.15)',
                color:'#C3B1E1', fontFamily:'monospace', letterSpacing:'0.04em',
              }}>{f.scene} · {f.title}</div>
            ))}
          </div>
        </div>

        {/* Output */}
        <div style={{ flex:1, overflowY:'auto', padding:'16px 22px' }}>
          {!result && !generating && !error && (
            <div style={{ color:c.muted, fontSize:13, lineHeight:1.6 }}>
              Claude will craft a director's statement and per-frame captions based on your selected shots. The output appears here and can be copied directly into your pitch deck.
            </div>
          )}
          {generating && (
            <div style={{ display:'flex', alignItems:'center', gap:10, color:'#C3B1E1' }}>
              <div style={{ width:16, height:16, borderRadius:'50%', border:'2px solid #C3B1E1', borderTopColor:'transparent', animation:'spin 0.8s linear infinite' }} />
              <span style={{ fontSize:13 }}>Claude is writing…</span>
            </div>
          )}
          {result && (
            <div style={{ fontSize:13, color:c.text, lineHeight:1.75, whiteSpace:'pre-wrap' }}>{result}</div>
          )}
          {error && <div style={{ fontSize:13, color:'#E8B4B8' }}>{error}</div>}
        </div>

        <div style={{ padding:'14px 22px', borderTop:`1px solid ${c.border}`, flexShrink:0, display:'flex', gap:10 }}>
          {!result ? (
            <div
              onClick={!generating ? generate : undefined}
              style={{
                flex:1, padding:'10px', borderRadius:8, cursor: generating ? 'default' : 'pointer',
                background: generating ? (dark?'rgba(195,177,225,0.1)':'rgba(195,177,225,0.15)') : 'linear-gradient(135deg,#C3B1E1,#E8B4B8)',
                color: generating ? '#C3B1E1' : '#fff',
                fontSize:13, fontWeight:600, textAlign:'center', transition:'opacity 0.15s',
              }}
            >
              {generating ? 'Generating…' : '◆ Generate with Claude'}
            </div>
          ) : (
            <>
              <div onClick={() => navigator.clipboard?.writeText(result)} style={{ flex:1, padding:'10px', borderRadius:8, cursor:'pointer', background:dark?'rgba(255,255,255,0.05)':'rgba(0,0,0,0.05)', color:c.text, fontSize:13, textAlign:'center' }}>Copy</div>
              <div onClick={generate} style={{ flex:1, padding:'10px', borderRadius:8, cursor:'pointer', background:'linear-gradient(135deg,#C3B1E1,#E8B4B8)', color:'#fff', fontSize:13, fontWeight:600, textAlign:'center' }}>Regenerate</div>
            </>
          )}
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}

// ── Storyboard View ───────────────────────────────────────────────────────────

function StoryboardView({ theme, mode, onOpenHistory, claudeEnabled, activeScene }) {
  const dark = theme === 'dark';
  const [activeFilters, setActiveFilters] = useViewState(new Set());
  const [expandedFrame, setExpandedFrame] = useViewState(null);
  const [selectedFrames, setSelectedFrames] = useViewState(new Set());
  const [showGenerator, setShowGenerator] = useViewState(false);
  const [scenes, setScenes] = useViewState(SCENE_GROUPS);

  const c = {
    border:      dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)',
    chipActive:  dark ? '#E8B4B8' : '#E8B4B8',
    chipActiveTx:'#3A1518',
    chipInactive:dark ? '#1C1F2A' : '#E2DED8',
    chipInactiveTx: dark ? '#6B7399' : '#7A7469',
    sectionHdr:  dark ? '#141820' : '#EEEAE4',
    sectionBorder: dark ? '#1C1F2A' : '#E0DCD4',
    sceneLabel:  dark ? '#8090B0' : '#8A8078',
    bg:          dark ? '#111318' : '#F8F6F2',
    sceneDivider:dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)',
  };

  const toggleFilter = (chip) => {
    setActiveFilters(prev => {
      const next = new Set(prev);
      if (next.has(chip)) next.delete(chip); else next.add(chip);
      return next;
    });
  };

  const frameMatchesFilters = (f) => {
    if (activeFilters.size === 0) return true;
    const checks = [];
    if (activeFilters.has('INT') || activeFilters.has('EXT')) checks.push(activeFilters.has(f.intExt));
    if (activeFilters.has('Approved')) checks.push(f.status === 'approved');
    if (activeFilters.has('Planned'))  checks.push(f.status === 'planned');
    if (activeFilters.has('Shot'))     checks.push(f.status === 'shot');
    ['SC 04','SC 07','SC 12','SC 15','SC 18','SC 21'].forEach(sc => { if (activeFilters.has(sc)) checks.push(f.scene === sc); });
    ['WS','MS','CU','MCU','ECU','Aerial'].forEach(st => { if (activeFilters.has(st)) checks.push(f.shotType === st || f.shotType.includes(st)); });
    return checks.length === 0 || checks.some(Boolean);
  };

  const toggleFrameSelect = (id) => {
    setSelectedFrames(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', position:'relative' }}>
      {/* Filter bar */}
      <div style={{ borderBottom:`1px solid ${c.border}`, background:c.bg, flexShrink:0, overflowX:'auto' }}>
        <div style={{ display:'flex', alignItems:'flex-start', gap:16, padding:'10px 24px' }}>
          {FILTER_GROUPS.map(group => (
            <div key={group.label} style={{ display:'flex', flexDirection:'column', gap:5, flexShrink:0 }}>
              <div style={{ fontSize:8.5, letterSpacing:'0.1em', textTransform:'uppercase', color:c.sceneLabel, fontFamily:'monospace', paddingLeft:1 }}>{group.label}</div>
              <div style={{ display:'flex', gap:4 }}>
                {group.chips.map(chip => {
                  const active = activeFilters.has(chip);
                  return (
                    <div key={chip} onClick={() => toggleFilter(chip)} style={{
                      padding:'4px 10px', borderRadius:16, cursor:'pointer', fontSize:11,
                      fontWeight: active ? 600 : 400, whiteSpace:'nowrap', userSelect:'none',
                      background: active ? c.chipActive : c.chipInactive,
                      color: active ? c.chipActiveTx : c.chipInactiveTx,
                      border:`1px solid ${active ? 'transparent' : c.border}`,
                      transition:'all 0.12s',
                    }}>{chip}</div>
                  );
                })}
              </div>
            </div>
          ))}
          {activeFilters.size > 0 && (
            <div onClick={() => setActiveFilters(new Set())} style={{ alignSelf:'flex-end', padding:'4px 12px', borderRadius:16, cursor:'pointer', fontSize:11, color:c.sceneLabel, border:`1px solid ${c.border}`, flexShrink:0, marginBottom:1 }}>
              Clear ×
            </div>
          )}
        </div>
      </div>

      {/* Main scroll area */}
      <div style={{ flex:1, overflowY:'auto', padding:'0 0 100px', background:c.bg }}>
        {mode === 'pitchdeck' ? (
          /* Pitch deck — 2-up clean grid with frame selection */
          <div style={{ padding:'28px' }}>
            {selectedFrames.size > 0 && (
              <div style={{ marginBottom:18, padding:'10px 16px', borderRadius:9, background:dark?'rgba(195,177,225,0.1)':'rgba(195,177,225,0.15)', border:`1px solid rgba(195,177,225,0.25)`, display:'flex', alignItems:'center', gap:12 }}>
                <span style={{ fontSize:12, color:'#C3B1E1', flex:1 }}>{selectedFrames.size} frame{selectedFrames.size!==1?'s':''} selected for pitch deck</span>
                <div onClick={() => setSelectedFrames(new Set())} style={{ fontSize:11, color:'#C3B1E1', cursor:'pointer', opacity:0.7 }}>Deselect all</div>
                {claudeEnabled && (
                  <div onClick={() => setShowGenerator(true)} style={{ padding:'6px 14px', borderRadius:7, cursor:'pointer', background:'linear-gradient(135deg,#C3B1E1,#E8B4B8)', color:'#fff', fontSize:12, fontWeight:600 }}>◆ Generate with Claude</div>
                )}
              </div>
            )}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(340px,1fr))', gap:20 }}>
              {FRAMES_DATA.filter(frameMatchesFilters).map(f => (
                <div key={f.id} style={{ position:'relative' }}>
                  {/* Selection checkbox */}
                  <div
                    onClick={() => toggleFrameSelect(f.id)}
                    style={{
                      position:'absolute', top:10, left:10, zIndex:10,
                      width:22, height:22, borderRadius:6, cursor:'pointer',
                      background: selectedFrames.has(f.id) ? 'rgba(195,177,225,0.9)' : 'rgba(0,0,0,0.45)',
                      backdropFilter:'blur(6px)',
                      border:`1.5px solid ${selectedFrames.has(f.id) ? '#C3B1E1' : 'rgba(255,255,255,0.3)'}`,
                      display:'flex', alignItems:'center', justifyContent:'center',
                      fontSize:12, color:'#fff', transition:'all 0.14s',
                    }}
                  >{selectedFrames.has(f.id) ? '✓' : ''}</div>
                  <FrameCard frame={f} theme={theme} pitchMode={true} onOpenHistory={onOpenHistory} />
                </div>
              ))}
            </div>
            {!claudeEnabled && selectedFrames.size > 0 && (
              <div style={{ marginTop:16, padding:'12px 16px', borderRadius:9, background:dark?'rgba(255,255,255,0.03)':'rgba(0,0,0,0.04)', border:`1px solid ${c.border}`, fontSize:12, color:c.sceneLabel, textAlign:'center' }}>
                Enable the Claude AI plugin in Settings to generate pitch deck copy from selected frames.
              </div>
            )}
          </div>
        ) : (
          /* Storyboard — scene-grouped layout */
          scenes.map((group, gi) => {
            const groupFrames = FRAMES_DATA.filter(f => group.frameIds.includes(f.id) && frameMatchesFilters(f));
            if (groupFrames.length === 0 && activeFilters.size > 0) return null;
            return (
              <div key={group.id}>
                {/* Scene header */}
                <div style={{
                  position:'sticky', top:0, zIndex:50,
                  background:c.sectionHdr, borderBottom:`1px solid ${c.sectionBorder}`,
                  padding:'8px 28px', display:'flex', alignItems:'center', gap:12,
                }}>
                  <span style={{ fontFamily:"'DM Mono','Fira Mono',monospace", fontSize:10, letterSpacing:'0.1em', color:dark?'#5A6480':'#9A9589', fontWeight:500 }}>{group.label}</span>
                  <div style={{ width:1, height:14, background:c.sectionBorder }} />
                  <span style={{ fontFamily:"'Playfair Display',serif", fontSize:14, fontWeight:700, color:dark?'#D8D0C8':'#2A2520', letterSpacing:'-0.01em' }}>{group.title}</span>
                  <span style={{ fontSize:11, color:dark?'#4A5270':'#9A9589' }}>{group.location}</span>
                  <span style={{
                    fontSize:9, fontFamily:'monospace', padding:'2px 7px', borderRadius:4,
                    background:group.intExt==='INT'?(dark?'rgba(195,177,225,0.1)':'rgba(195,177,225,0.15)'):(dark?'rgba(168,197,160,0.1)':'rgba(168,197,160,0.15)'),
                    color:group.intExt==='INT'?'#C3B1E1':'#A8C5A0', letterSpacing:'0.06em',
                  }}>{group.intExt}</span>
                  <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center' }}>
                    <span style={{ fontSize:10, color:dark?'#4A5270':'#9A9589' }}>{groupFrames.length} shot{groupFrames.length!==1?'s':''}</span>
                    <div style={{
                      padding:'3px 10px', borderRadius:5, cursor:'pointer', fontSize:10,
                      border:`1px dashed ${dark?'rgba(255,255,255,0.15)':'rgba(0,0,0,0.15)'}`,
                      color:dark?'#4A5270':'#9A9589',
                    }}
                    onMouseEnter={e=>{e.currentTarget.style.borderColor='#A8C5A0';e.currentTarget.style.color='#A8C5A0';}}
                    onMouseLeave={e=>{e.currentTarget.style.borderColor=dark?'rgba(255,255,255,0.15)':'rgba(0,0,0,0.15)';e.currentTarget.style.color=dark?'#4A5270':'#9A9589';}}
                    >+ Add Shot</div>
                  </div>
                </div>

                {/* Frames */}
                <div style={{ padding:'20px 28px 24px', borderBottom:`1px solid ${c.sceneDivider}` }}>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))', gap:16 }}>
                    {groupFrames.map(f => (
                      <FrameCard
                        key={f.id} frame={f} theme={theme} pitchMode={false}
                        expanded={expandedFrame===f.id}
                        onExpand={()=>setExpandedFrame(id=>id===f.id?null:f.id)}
                        onOpenHistory={onOpenHistory}
                        claudeEnabled={claudeEnabled}
                      />
                    ))}
                    {/* Add frame card */}
                    <div style={{
                      border:`1.5px dashed ${dark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.1)'}`,
                      borderRadius:10, minHeight:180, display:'flex', flexDirection:'column',
                      alignItems:'center', justifyContent:'center', gap:7, cursor:'pointer',
                      color:dark?'#3A3E54':'#B0A8A0', transition:'border-color 0.15s, color 0.15s',
                    }}
                    onMouseEnter={e=>{e.currentTarget.style.borderColor=dark?'rgba(168,197,160,0.3)':'rgba(168,197,160,0.5)';e.currentTarget.style.color='#A8C5A0';}}
                    onMouseLeave={e=>{e.currentTarget.style.borderColor=dark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.1)';e.currentTarget.style.color=dark?'#3A3E54':'#B0A8A0';}}>
                      <div style={{ fontSize:20 }}>+</div>
                      <div style={{ fontSize:11, fontFamily:"'DM Sans',sans-serif", letterSpacing:'0.04em' }}>Add Frame</div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Pitch deck bottom bar */}
      {mode === 'pitchdeck' && selectedFrames.size > 0 && (
        <div style={{
          position:'absolute', bottom:20, left:'50%', transform:'translateX(-50%)',
          background:dark?'#1C1F2A':'#FFFFFF', border:`1px solid ${c.border}`,
          borderRadius:12, padding:'10px 20px', display:'flex', alignItems:'center', gap:14,
          boxShadow:'0 8px 32px rgba(0,0,0,0.4)', zIndex:200,
        }}>
          <span style={{ fontSize:13, color:dark?'#C8C0B4':'#2A2520', fontFamily:"'DM Sans',sans-serif" }}>
            {selectedFrames.size} frame{selectedFrames.size!==1?'s':''} selected
          </span>
          <div style={{ width:1, height:20, background:c.border }} />
          <div onClick={()=>setSelectedFrames(new Set())} style={{ fontSize:12, color:dark?'#6B7399':'#9A9589', cursor:'pointer' }}>Clear</div>
          {claudeEnabled
            ? <div onClick={()=>setShowGenerator(true)} style={{ padding:'7px 16px', borderRadius:8, cursor:'pointer', background:'linear-gradient(135deg,#C3B1E1,#E8B4B8)', color:'#fff', fontSize:12, fontWeight:600 }}>◆ Generate with Claude</div>
            : <div style={{ fontSize:11, color:'#C3B1E1', fontStyle:'italic' }}>Enable Claude AI in Settings to generate</div>
          }
        </div>
      )}

      {showGenerator && (
        <PitchDeckGenerator
          theme={theme} selectedFrames={selectedFrames}
          frames={FRAMES_DATA} claudeEnabled={claudeEnabled}
          onClose={() => setShowGenerator(false)}
        />
      )}
    </div>
  );
}

// ── Assets View ───────────────────────────────────────────────────────────────

function AssetsView({ theme, assets, onAddAssets }) {
  const dark = theme === 'dark';
  const [activeCategory, setActiveCategory] = useViewState('All Assets');
  const [selectedAsset, setSelectedAsset] = useViewState(null);
  const [dragOver, setDragOver] = useViewState(false);
  const fileInputRef = useViewRef(null);

  const c = {
    rail:dark?'#141720':'#EEEAE4', railBorder:dark?'#1C1F2A':'#DDD9D1',
    content:dark?'#111318':'#F8F6F2', card:dark?'#1C1F2A':'#FFFFFF',
    border:dark?'rgba(255,255,255,0.07)':'rgba(0,0,0,0.08)',
    text:dark?'#C8C0B4':'#2A2520', muted:dark?'#4A5270':'#9A9589',
    activeNav:dark?'rgba(168,197,160,0.12)':'rgba(168,197,160,0.2)',
    activeNavTx:dark?'#A8C5A0':'#4A7A44',
  };

  const detectCategory = (file) => {
    if (file.type.startsWith('image/')) return 'References';
    if (file.type === 'application/pdf') return 'Scripts';
    if (file.type.startsWith('video/')) return 'References';
    if (file.type.startsWith('audio/')) return 'Music / Sound';
    return 'References';
  };

  const processFiles = (fileList) => {
    const newAssets = Array.from(fileList).map(f => ({
      id: 'u' + Date.now() + Math.random().toString(36).slice(2),
      title: f.name.replace(/\.[^.]+$/, ''),
      category: detectCategory(f),
      tags: [],
      scenes: 0,
      type: f.name.split('.').pop().toUpperCase(),
      thumb: f.type.startsWith('image/') ? URL.createObjectURL(f) : null,
    }));
    if (newAssets.length > 0) onAddAssets(newAssets);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    processFiles(e.dataTransfer.files);
  };

  const filtered = activeCategory === 'All Assets' ? assets : assets.filter(a => a.category === activeCategory);
  const selAsset = assets.find(a => a.id === selectedAsset);

  return (
    <div style={{ display:'flex', height:'100%', overflow:'hidden' }}>
      <div style={{ width:180, flexShrink:0, background:c.rail, borderRight:`1px solid ${c.railBorder}`, padding:'20px 10px', overflowY:'auto', fontFamily:"'DM Sans',sans-serif" }}>
        <div style={{ fontSize:9, fontWeight:600, letterSpacing:'0.12em', textTransform:'uppercase', color:c.muted, padding:'0 8px', marginBottom:8 }}>Category</div>
        {ASSET_CATEGORIES.map(cat => {
          const active = activeCategory === cat;
          return <div key={cat} onClick={() => setActiveCategory(cat)} style={{ padding:'6px 9px', borderRadius:6, cursor:'pointer', fontSize:12.5, marginBottom:1, background:active?c.activeNav:'transparent', color:active?c.activeNavTx:c.muted, fontWeight:active?500:400, transition:'all 0.12s', userSelect:'none' }}>{cat}</div>;
        })}
      </div>
      <div style={{ flex:1, background:c.content, overflowY:'auto', padding:'24px', display:'flex', flexDirection:'column' }}>
        {/* Drop zone */}
        <div
          onDragEnter={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={e => { e.preventDefault(); if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); }}
          onDragOver={e => e.preventDefault()}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current && fileInputRef.current.click()}
          style={{
            border: `1.5px dashed ${dragOver ? '#A8C5A0' : (dark?'rgba(255,255,255,0.1)':'rgba(0,0,0,0.12)')}`,
            borderRadius: 10, padding: '20px 18px', textAlign: 'center', marginBottom: 24,
            cursor: 'pointer', color: dragOver ? '#A8C5A0' : c.muted, fontSize: 12,
            fontFamily: "'DM Sans',sans-serif", transition: 'all 0.15s',
            background: dragOver ? (dark?'rgba(168,197,160,0.07)':'rgba(168,197,160,0.1)') : 'transparent',
          }}
        >
          <div style={{ marginBottom: 4, fontSize: 20 }}>{dragOver ? '↓' : '↑'}</div>
          {dragOver ? 'Drop to upload' : (<>Drop files here or <span style={{ color:'#A8C5A0', textDecoration:'underline' }}>browse to upload</span></>)}
        </div>
        <input
          ref={fileInputRef} type="file" multiple accept="image/*,video/*,audio/*,.pdf,.cube"
          style={{ display:'none' }}
          onChange={e => { processFiles(e.target.files); e.target.value = ''; }}
        />

        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:14 }}>
          {filtered.map(asset => (
            <div key={asset.id} onClick={() => setSelectedAsset(asset.id === selectedAsset ? null : asset.id)} style={{ background:c.card, border:`1px solid ${selectedAsset===asset.id?'#A8C5A0':c.border}`, borderRadius:9, overflow:'hidden', cursor:'pointer', boxShadow:dark?'0 2px 10px rgba(0,0,0,0.3)':'0 2px 8px rgba(0,0,0,0.06)', fontFamily:"'DM Sans',sans-serif" }}>
              <div style={{ height:120, background:dark?'#0F111A':'#E8E4DC', overflow:'hidden', position:'relative' }}>
                {asset.thumb ? <img src={asset.thumb} alt={asset.title} style={{ width:'100%', height:'100%', objectFit:'cover' }}/> : <div style={{ width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center', backgroundImage:`repeating-linear-gradient(45deg,${dark?'#141820':'#DDD9D1'} 0,${dark?'#141820':'#DDD9D1'} 1px,transparent 1px,transparent 9px)` }}><span style={{ fontSize:9, color:c.muted, fontFamily:'monospace', opacity:0.6 }}>{asset.type}</span></div>}
                <div style={{ position:'absolute', top:6, right:6, background:'rgba(0,0,0,0.55)', color:'#A8C5A0', fontSize:8, fontFamily:'monospace', padding:'2px 6px', borderRadius:3 }}>{asset.scenes} scene{asset.scenes!==1?'s':''}</div>
              </div>
              <div style={{ padding:'10px 11px 11px' }}>
                <div style={{ fontSize:12.5, fontWeight:500, color:c.text, marginBottom:4, lineHeight:1.3 }}>{asset.title}</div>
                <div style={{ fontSize:10, color:c.muted, marginBottom:6 }}>{asset.type}</div>
                <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>{asset.tags.slice(0,3).map(t => <span key={t} style={{ fontSize:9, padding:'2px 6px', borderRadius:4, background:dark?'rgba(195,177,225,0.1)':'rgba(195,177,225,0.2)', color:dark?'#C3B1E1':'#7A6AAE', fontFamily:'monospace' }}>{t}</span>)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {selAsset && (
        <div style={{ width:280, flexShrink:0, background:dark?'#1C1F2A':'#FFFFFF', borderLeft:`1px solid ${c.railBorder}`, padding:'20px', overflowY:'auto', fontFamily:"'DM Sans',sans-serif", display:'flex', flexDirection:'column', gap:14 }}>
          <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between' }}>
            <div style={{ fontSize:14, fontWeight:600, color:c.text, lineHeight:1.3, flex:1 }}>{selAsset.title}</div>
            <div onClick={() => setSelectedAsset(null)} style={{ cursor:'pointer', color:c.muted, fontSize:16, marginLeft:8 }}>×</div>
          </div>
          {selAsset.thumb && <img src={selAsset.thumb} alt="" style={{ width:'100%', borderRadius:8, objectFit:'cover', aspectRatio:'16/9' }}/>}
          {[['Category',selAsset.category],['Type',selAsset.type],['Linked',`${selAsset.scenes} scenes`],['Uploader','Sofia Reyes'],['Date',new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})]].map(([k,v]) => (
            <div key={k}><div style={{ fontSize:9, color:c.muted, textTransform:'uppercase', letterSpacing:'0.1em', fontFamily:'monospace', marginBottom:3 }}>{k}</div><div style={{ fontSize:12.5, color:c.text }}>{v}</div></div>
          ))}
          <div style={{ padding:'10px 12px', borderRadius:8, background:dark?'rgba(168,197,160,0.08)':'rgba(168,197,160,0.15)', border:`1px solid ${dark?'rgba(168,197,160,0.2)':'rgba(168,197,160,0.3)'}`, fontSize:12, color:'#A8C5A0', cursor:'pointer', textAlign:'center' }}>Link to scene or shot →</div>
        </div>
      )}
    </div>
  );
}

// ── Crew View ─────────────────────────────────────────────────────────────────

function CrewView({ theme }) {
  const dark = theme === 'dark';
  const c = { bg:dark?'#111318':'#F8F6F2', card:dark?'#1C1F2A':'#FFFFFF', border:dark?'rgba(255,255,255,0.07)':'rgba(0,0,0,0.08)', text:dark?'#C8C0B4':'#2A2520', muted:dark?'#4A5270':'#9A9589' };
  return (
    <div style={{ background:c.bg, flex:1, padding:'28px', overflowY:'auto', fontFamily:"'DM Sans',sans-serif" }}>
      <div style={{ fontSize:9, letterSpacing:'0.1em', textTransform:'uppercase', color:c.muted, marginBottom:20, fontFamily:'monospace' }}>Parfum No. 7 — TVC · {CREW_DATA.length} crew members</div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))', gap:14 }}>
        {CREW_DATA.map(cr=>(
          <div key={cr.name} style={{ background:c.card, border:`1px solid ${c.border}`, borderRadius:10, padding:'18px', cursor:'pointer', boxShadow:dark?'0 2px 10px rgba(0,0,0,0.3)':'0 2px 8px rgba(0,0,0,0.06)' }}>
            <div style={{ width:44, height:44, borderRadius:'50%', background:cr.gradient, display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, fontWeight:700, color:'#fff', marginBottom:12 }}>{cr.initials}</div>
            <div style={{ fontSize:14, fontWeight:600, color:c.text, marginBottom:3 }}>{cr.name}</div>
            <div style={{ fontSize:12, color:c.muted, marginBottom:10 }}>{cr.role}</div>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <span style={{ fontSize:9, padding:'2px 7px', borderRadius:4, fontFamily:'monospace', background:dark?'rgba(168,197,160,0.1)':'rgba(168,197,160,0.2)', color:dark?'#A8C5A0':'#4A7A44', letterSpacing:'0.05em' }}>{cr.dept}</span>
              <span style={{ fontSize:10, color:c.muted }}>{cr.scenes} scenes</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Settings View ─────────────────────────────────────────────────────────────

function SettingsView({ theme, onClaudeToggle, claudeEnabled }) {
  const dark = theme === 'dark';
  const [plugins, setPlugins] = useViewState(
    Object.fromEntries(PLUGIN_DATA.map(p => [p.id, p.id === 'claude-ai' ? claudeEnabled : p.active]))
  );
  const c = { bg:dark?'#111318':'#F8F6F2', card:dark?'#1C1F2A':'#FFFFFF', border:dark?'rgba(255,255,255,0.07)':'rgba(0,0,0,0.08)', text:dark?'#C8C0B4':'#2A2520', muted:dark?'#4A5270':'#9A9589', trackOn:'#A8C5A0', trackOff:dark?'#2A2E3E':'#DDD9D1' };
  const togglePlugin = (id, val) => {
    setPlugins(prev => ({ ...prev, [id]: val }));
    if (id === 'claude-ai') onClaudeToggle(val);
  };
  return (
    <div style={{ background:c.bg, flex:1, padding:'28px', overflowY:'auto', fontFamily:"'DM Sans',sans-serif" }}>
      <div style={{ maxWidth:640 }}>
        <div style={{ fontSize:9, letterSpacing:'0.12em', textTransform:'uppercase', color:c.muted, marginBottom:18, fontFamily:'monospace' }}>Settings · Integrations</div>
        {PLUGIN_DATA.map(plugin => {
          const on = plugins[plugin.id];
          return (
            <div key={plugin.id} style={{ background:c.card, border:`1px solid ${plugin.id==='claude-ai'&&on?'rgba(195,177,225,0.35)':c.border}`, borderRadius:10, padding:'18px 20px', marginBottom:12, display:'flex', gap:16, alignItems:'flex-start' }}>
              <div style={{ width:40, height:40, borderRadius:10, flexShrink:0, background:dark?`${plugin.accent}15`:`${plugin.accent}25`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, color:plugin.accent }}>{plugin.icon}</div>
              <div style={{ flex:1 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                  <span style={{ fontSize:14, fontWeight:600, color:c.text }}>{plugin.name}</span>
                  {plugin.badge && <span style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:8, background:dark?`${plugin.accent}20`:`${plugin.accent}30`, color:plugin.accent, letterSpacing:'0.05em' }}>{plugin.badge}</span>}
                  {plugin.id==='claude-ai' && <span style={{ fontSize:9, padding:'2px 7px', borderRadius:5, background:dark?'rgba(195,177,225,0.1)':'rgba(195,177,225,0.2)', color:'#C3B1E1', fontFamily:'monospace' }}>AI</span>}
                </div>
                <div style={{ fontSize:12.5, color:c.muted, marginBottom:10, lineHeight:1.5 }}>{plugin.desc}</div>
                <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>{plugin.perms.map(p=><span key={p} style={{ fontSize:9.5, padding:'2px 7px', borderRadius:4, fontFamily:'monospace', background:dark?'rgba(255,255,255,0.04)':'rgba(0,0,0,0.05)', color:c.muted, letterSpacing:'0.03em' }}>{p}</span>)}</div>
              </div>
              <div onClick={()=>togglePlugin(plugin.id, !on)} style={{ width:38, height:22, borderRadius:11, cursor:'pointer', background:on?c.trackOn:c.trackOff, position:'relative', flexShrink:0, transition:'background 0.2s' }}>
                <div style={{ position:'absolute', top:3, left:on?19:3, width:16, height:16, borderRadius:'50%', background:'#fff', transition:'left 0.2s', boxShadow:'0 1px 4px rgba(0,0,0,0.2)' }} />
              </div>
            </div>
          );
        })}
        <div style={{ marginTop:24, padding:'14px 18px', borderRadius:10, border:`1px solid ${c.border}`, background:c.card, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div>
            <div style={{ fontSize:13, fontWeight:500, color:c.text, marginBottom:3 }}>Developer Documentation</div>
            <div style={{ fontSize:12, color:c.muted }}>Build custom integrations with the Storiiboard Plugin SDK.</div>
          </div>
          <div style={{ fontSize:11.5, color:'#C3B1E1', padding:'6px 14px', border:'1px solid rgba(195,177,225,0.3)', borderRadius:7, cursor:'pointer', whiteSpace:'nowrap' }}>View Docs →</div>
        </div>
      </div>
    </div>
  );
}

// ── Moodboard View (project-level) ────────────────────────────────────────────

function MoodboardView({ theme, moodboardItems, onAddItem }) {
  const dark = theme === 'dark';
  const c = { bg:dark?'#111318':'#F8F6F2', card:dark?'#1C1F2A':'#FFFFFF', border:dark?'rgba(255,255,255,0.07)':'rgba(0,0,0,0.08)', text:dark?'#C8C0B4':'#2A2520', muted:dark?'#4A5270':'#9A9589' };
  const allImages = ['uploads/small_NVTE6ECR.jpg','uploads/small_LF7JADRW.jpg','uploads/small_KDGP7IMR.jpg','uploads/small_EE2UMJ1P.jpg'];
  const boardItems = [...moodboardItems, ...allImages.map((img,i) => ({ type:'image', content:img, source:'Storyboard ref', id:`default-${i}` }))];
  return (
    <div style={{ flex:1, background:c.bg, padding:'28px', overflowY:'auto', fontFamily:"'DM Sans',sans-serif" }}>
      <div style={{ display:'flex', alignItems:'baseline', gap:12, marginBottom:24 }}>
        <div style={{ fontFamily:"'Playfair Display',serif", fontSize:18, fontWeight:700, color:dark?'#F0EAE2':'#1A1714', letterSpacing:'-0.02em' }}>Moodboard</div>
        <div style={{ fontSize:11, color:c.muted }}>Parfum No. 7 — TVC</div>
        <div style={{ marginLeft:'auto', padding:'6px 14px', borderRadius:7, cursor:'pointer', border:`1px dashed ${dark?'rgba(255,255,255,0.15)':'rgba(0,0,0,0.15)'}`, color:c.muted, fontSize:11 }}>+ Add Reference</div>
      </div>
      <div style={{ columns:'3 200px', gap:14 }}>
        {boardItems.map((item, i) => (
          <div key={item.id||i} style={{ breakInside:'avoid', marginBottom:14 }}>
            {item.type==='image' || (typeof item.content === 'string' && item.content.includes('.')) ? (
              <div style={{ borderRadius:10, overflow:'hidden', border:`1px solid ${c.border}`, boxShadow:dark?'0 2px 12px rgba(0,0,0,0.3)':'0 2px 8px rgba(0,0,0,0.08)' }}>
                <img src={item.content} alt="" style={{ width:'100%', display:'block', objectFit:'cover' }}/>
                <div style={{ padding:'6px 10px', fontSize:9.5, color:c.muted, fontFamily:'monospace', letterSpacing:'0.04em', borderTop:`1px solid ${c.border}` }}>{item.source}</div>
              </div>
            ) : (
              <div style={{ background:c.card, borderRadius:10, padding:'14px', border:`1px solid ${c.border}`, fontSize:12, color:c.text, lineHeight:1.6 }}>{item.content}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { StoryboardView, AssetsView, CrewView, SettingsView, MoodboardView, FRAMES_DATA });
