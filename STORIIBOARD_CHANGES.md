# Storiiboard — Core Features Implementation

Apply this to your Mac project by telling Claude Code:
> "Apply all file changes in STORIIBOARD_CHANGES.md to my storiiboard project."

## What changed

| File | Status | Change |
|------|--------|--------|
| `index.html` | Modified | State lifted; New Project modal; CalendarView & ProducerPanel wired |
| `storiiboard-sidebar.jsx` | Rewritten | Calendar nav, Team in project nav, compact project list, Add Scene form, Producer toggle |
| `storiiboard-views.jsx` | Modified | AssetsView now accepts props + full HTML5 drag-and-drop |
| `storiiboard-calendar.jsx` | **NEW** | Monthly calendar with scene scheduling and producer mode |
| `storiiboard-producer.jsx` | **NEW** | Producer side panel: venue booking + staff checklist per scene |

## Unchanged files (do not touch)
- `storiiboard-frames.jsx`
- `storiiboard-notifications.jsx`
- `storiiboard-history.jsx`
- `uploads/` folder

---

## File: `index.html` — Replace entire file

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Storiiboard — Production Suite</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,400&family=DM+Mono:wght@400;500&family=Playfair+Display:ital,wght@0,700;1,700&display=swap" rel="stylesheet" />

  <script src="https://unpkg.com/react@18.3.1/umd/react.development.js" integrity="sha384-hD6/rw4ppMLGNu3tX5cjIb+uRZ7UkRJ6BPkLpg4hAu/6onKUg4lLsHAs9EBPT82L" crossorigin="anonymous"></script>
  <script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.development.js" integrity="sha384-u6aeetuaXnQ38mYT8rp6sbXaQe3NL9t+IBXmnYxwkUI2Hw4bsp2Wvmx4yRQF1uAm" crossorigin="anonymous"></script>
  <script src="https://unpkg.com/@babel/standalone@7.29.0/babel.min.js" integrity="sha384-m08KidiNqLdpJqLq95G/LEi8Qvjl/xUYll3QILypMoQ65QorJ9Lvtp2RXYGBFj1y" crossorigin="anonymous"></script>

  <script type="text/babel" src="storiiboard-sidebar.jsx"></script>
  <script type="text/babel" src="storiiboard-frames.jsx"></script>
  <script type="text/babel" src="storiiboard-views.jsx"></script>
  <script type="text/babel" src="storiiboard-notifications.jsx"></script>
  <script type="text/babel" src="storiiboard-history.jsx"></script>
  <script type="text/babel" src="storiiboard-calendar.jsx"></script>
  <script type="text/babel" src="storiiboard-producer.jsx"></script>

  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body, #root { width: 100%; height: 100%; overflow: hidden; }
    body { font-family: 'DM Sans', sans-serif; -webkit-font-smoothing: antialiased; }
    ::-webkit-scrollbar { width: 5px; height: 5px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.18); border-radius: 10px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(128,128,128,0.3); }
    textarea { resize: none; } select { appearance: none; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
  </style>
</head>
<body>

<!-- Grain overlay -->
<svg style="position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9000;opacity:1" xmlns="http://www.w3.org/2000/svg">
  <filter id="grain-f">
    <feTurbulence type="fractalNoise" baseFrequency="0.72 0.68" numOctaves="4" seed="9" stitchTiles="stitch" result="noise"/>
    <feColorMatrix type="saturate" values="0" in="noise" result="gray"/>
    <feBlend in="SourceGraphic" in2="gray" mode="overlay"/>
  </filter>
  <rect width="100%" height="100%" filter="url(#grain-f)" opacity="0.036"/>
</svg>

<div id="root"></div>

<script type="text/babel">
const { useState, useEffect, useRef } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "theme": "dark",
  "density": "compact"
}/*EDITMODE-END*/;

const LIVE_USERS = [
  { initials:'SR', name:'Sofia Reyes',  role:'Director', gradient:'linear-gradient(135deg,#C3B1E1,#E8B4B8)', status:'online' },
  { initials:'JL', name:'James Lau',    role:'DP',        gradient:'linear-gradient(135deg,#A8C5A0,#C3B1E1)', status:'online' },
  { initials:'TH', name:'Tom Hirsch',   role:'1st AD',    gradient:'linear-gradient(135deg,#E8B4B8,#E8D5B7)', status:'idle'   },
];

const INITIAL_PROJECTS = [
  { id:'p1', title:'Parfum No. 7', client:'Maison Duvall', type:'TVC · 60s',        frames:6,  status:'active',   gradient:'linear-gradient(135deg,#E8B4B8,#C3B1E1)', month:'APR 2026' },
  { id:'p2', title:'Open Water',   client:'independent',   type:'Short Film',        frames:42, status:'draft',    gradient:'linear-gradient(135deg,#A8C5A0,#C3B1E1)', month:'MAY 2026' },
  { id:'p3', title:'Momentum',     client:'Atlas Sports',  type:'Brand Film · 2min', frames:18, status:'archived', gradient:'linear-gradient(135deg,#E8D5B7,#A8C5A0)', month:'FEB 2026' },
];

const INITIAL_SCENES = [
  { id:'sc04', label:'SC 04', title:'Mirror Scene',     location:'Paris Apt.',     frameIds:['f01'], shootDate:'2026-05-14', venue:null, staffChecklist:[] },
  { id:'sc07', label:'SC 07', title:'Airplane Reverie', location:'Business Class', frameIds:['f02'], shootDate:'2026-05-16', venue:null, staffChecklist:[] },
  { id:'sc12', label:'SC 12', title:'The Ceremony',     location:'Desert Plain',   frameIds:['f03'], shootDate:'2026-05-20', venue:null, staffChecklist:[] },
  { id:'sc15', label:'SC 15', title:'Control Room',     location:'Server Room',    frameIds:['f04'], shootDate:'2026-05-21', venue:null, staffChecklist:[] },
  { id:'sc18', label:'SC 18', title:'Empty Frame',      location:'TBD',            frameIds:['f05'], shootDate:null,         venue:null, staffChecklist:[] },
  { id:'sc21', label:'SC 21', title:'Departure Board',  location:'Airport',        frameIds:['f06'], shootDate:'2026-05-23', venue:null, staffChecklist:[] },
];

const INITIAL_ASSETS = [
  { id:'a1', title:'Paris Apartment Refs',   category:'References',   tags:['warm','interior','Paris'], scenes:3, type:'JPG Collection', thumb:'uploads/small_NVTE6ECR.jpg' },
  { id:'a2', title:'Desert Location Scout',  category:'Locations',    tags:['EXT','desert','day'],      scenes:1, type:'JPEG × 24',      thumb:'uploads/small_KDGP7IMR.jpg' },
  { id:'a3', title:'Blue Hour Lookbook',     category:'Lookbooks',    tags:['cool','blue','travel'],    scenes:2, type:'PDF',            thumb:'uploads/small_LF7JADRW.jpg' },
  { id:'a4', title:'Industrial Color Ref',   category:'LUTs / Color', tags:['teal','dark','server'],    scenes:1, type:'PNG + CUBE',     thumb:'uploads/small_EE2UMJ1P.jpg' },
  { id:'a5', title:'Fragrance Wardrobe Deck',category:'Wardrobe',     tags:['white','black','costume'], scenes:5, type:'PDF',            thumb:null },
  { id:'a6', title:'Scene 04 Script Pages',  category:'Scripts',      tags:['SC 04','final'],           scenes:1, type:'PDF',            thumb:null },
  { id:'a7', title:'Opening Score Draft',    category:'Music / Sound',tags:['orchestral','draft'],      scenes:0, type:'WAV',            thumb:null },
];

// ── Lighting Setup (2D floor plan) ───────────────────────────────────────────

function LightingView({ theme, activeScene }) {
  const dark = theme === 'dark';
  const c = {
    bg:dark?'#111318':'#F8F6F2', canvas:dark?'#1C1F2A':'#FFFFFF',
    border:dark?'rgba(255,255,255,0.07)':'rgba(0,0,0,0.08)',
    grid:dark?'rgba(255,255,255,0.04)':'rgba(0,0,0,0.05)',
    text:dark?'#C8C0B4':'#2A2520', muted:dark?'#4A5270':'#9A9589',
  };
  const LIGHTS = [
    {x:30,y:35,type:'Key',   color:'#E8D5B7',label:'12K HMI'},
    {x:68,y:28,type:'Fill',  color:'#C3B1E1',label:'4K LED'},
    {x:15,y:60,type:'Prac.', color:'#A8C5A0',label:'Gooseneck'},
  ];
  const sceneLabels = { sc04:'SC 04 — Paris Apartment', sc07:'SC 07 — Business Class', sc12:'SC 12 — Desert Plain', sc15:'SC 15 — Server Room', sc18:'SC 18 — TBD', sc21:'SC 21 — Airport' };
  const sceneLabel = sceneLabels[activeScene] || 'SC 04 — Paris Apartment';

  return (
    <div style={{ flex:1, background:c.bg, padding:28, fontFamily:"'DM Sans',sans-serif", overflowY:'auto' }}>
      <div style={{ marginBottom:18, display:'flex', alignItems:'center', gap:12 }}>
        <div style={{ fontSize:9, letterSpacing:'0.1em', textTransform:'uppercase', color:c.muted, fontFamily:'monospace' }}>
          Setup · {sceneLabel}
        </div>
        <div style={{ marginLeft:'auto', display:'flex', gap:8 }}>
          {['+ Fixture','+ Camera','+ Actor'].map(l=>(
            <div key={l} style={{ padding:'5px 12px', borderRadius:7, fontSize:11, cursor:'pointer', border:`1px solid ${c.border}`, color:c.muted }}>{l}</div>
          ))}
          <div style={{ padding:'5px 12px', borderRadius:7, fontSize:11, cursor:'pointer', background:dark?'rgba(232,213,183,0.1)':'rgba(232,213,183,0.2)', border:'1px solid rgba(232,213,183,0.3)', color:'#E8D5B7' }}>↓ Export PDF</div>
        </div>
      </div>
      {/* Scene selector */}
      <div style={{ display:'flex', gap:6, marginBottom:16, flexWrap:'wrap' }}>
        {Object.entries(sceneLabels).map(([id,lbl])=>(
          <div key={id} style={{ padding:'4px 10px', borderRadius:5, fontSize:10.5, cursor:'pointer', fontFamily:'monospace', background:activeScene===id?(dark?'rgba(232,213,183,0.12)':'rgba(232,213,183,0.2)'):(dark?'rgba(255,255,255,0.04)':'rgba(0,0,0,0.04)'), color:activeScene===id?'#E8D5B7':c.muted, border:`1px solid ${activeScene===id?'rgba(232,213,183,0.3)':c.border}` }}>{lbl.split('—')[0].trim()}</div>
        ))}
      </div>
      <div style={{ width:'100%', aspectRatio:'16/8', background:c.canvas, borderRadius:12, border:`1px solid ${c.border}`, position:'relative', overflow:'hidden', backgroundImage:`linear-gradient(${c.grid} 1px,transparent 1px),linear-gradient(90deg,${c.grid} 1px,transparent 1px)`, backgroundSize:'40px 40px' }}>
        <svg style={{ position:'absolute', inset:0, width:'100%', height:'100%' }}>
          <rect x="10%" y="10%" width="80%" height="80%" fill="none" stroke={dark?'rgba(255,255,255,0.1)':'rgba(0,0,0,0.1)'} strokeWidth="2" strokeDasharray="8 4" rx="4"/>
        </svg>
        {LIGHTS.map(l=>(
          <div key={l.type} style={{ position:'absolute', left:`${l.x}%`, top:`${l.y}%`, transform:'translate(-50%,-50%)', display:'flex', flexDirection:'column', alignItems:'center', gap:4, cursor:'pointer' }}>
            <div style={{ width:28, height:28, borderRadius:6, background:`${l.color}22`, border:`2px solid ${l.color}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:12 }}>☀</div>
            <div style={{ background:dark?'rgba(0,0,0,0.65)':'rgba(255,255,255,0.9)', backdropFilter:'blur(4px)', padding:'2px 6px', borderRadius:4, fontSize:8.5, color:l.color, fontFamily:'monospace', whiteSpace:'nowrap' }}>{l.type} · {l.label}</div>
          </div>
        ))}
        {/* Camera */}
        <div style={{ position:'absolute', left:'50%', top:'70%', transform:'translate(-50%,-50%)' }}>
          <div style={{ width:32, height:32, borderRadius:'50%', background:dark?'rgba(195,177,225,0.15)':'rgba(195,177,225,0.25)', border:'2px solid #C3B1E1', display:'flex', alignItems:'center', justifyContent:'center', fontSize:14 }}>⊙</div>
          <svg style={{ position:'absolute', top:-60, left:'50%', transform:'translateX(-50%)', overflow:'visible' }}>
            <polygon points="-35,-55 35,-55 10,0 -10,0" fill={dark?'rgba(195,177,225,0.06)':'rgba(195,177,225,0.1)'} stroke="#C3B1E1" strokeWidth="0.8" strokeDasharray="4 3"/>
          </svg>
          <div style={{ position:'absolute', top:36, left:'50%', transform:'translateX(-50%)', background:dark?'rgba(0,0,0,0.65)':'rgba(255,255,255,0.9)', backdropFilter:'blur(4px)', padding:'2px 6px', borderRadius:4, fontSize:8.5, color:'#C3B1E1', fontFamily:'monospace', whiteSpace:'nowrap' }}>CAM A · 35mm</div>
        </div>
        {[{x:48,y:40,lbl:'A'},{x:54,y:38,lbl:'B'}].map(m=>(
          <div key={m.lbl} style={{ position:'absolute', left:`${m.x}%`, top:`${m.y}%`, transform:'translate(-50%,-50%)' }}>
            <div style={{ width:20, height:20, borderRadius:'50%', background:dark?'rgba(232,180,184,0.2)':'rgba(232,180,184,0.35)', border:'1.5px solid #E8B4B8', display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, color:'#E8B4B8', fontWeight:700 }}>{m.lbl}</div>
          </div>
        ))}
        <div style={{ position:'absolute', bottom:14, right:14, background:dark?'rgba(0,0,0,0.65)':'rgba(255,255,255,0.9)', backdropFilter:'blur(6px)', padding:'8px 12px', borderRadius:8, display:'flex', flexDirection:'column', gap:5 }}>
          {[['#E8D5B7','Key Light'],['#C3B1E1','Fill Light'],['#A8C5A0','Practical'],['#E8B4B8','Actor']].map(([col,lbl])=>(
            <div key={lbl} style={{ display:'flex', alignItems:'center', gap:6 }}>
              <div style={{ width:8, height:8, borderRadius:2, background:col }} />
              <span style={{ fontSize:9.5, color:c.muted, fontFamily:'monospace' }}>{lbl}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── New Project modal ─────────────────────────────────────────────────────────

function NewProjectModal({ theme, onClose, onAdd }) {
  const dark = theme === 'dark';
  const [title, setTitle] = useState('');
  const [client, setClient] = useState('');
  const [type, setType] = useState('TVC');
  const c = {
    bg: dark?'#1C1F2A':'#FFFFFF', border: dark?'#2A2E3E':'#DDD9D1',
    text: dark?'#C8C0B4':'#2A2520', muted: dark?'#4A5270':'#9A9589',
    input: dark?'#141820':'#F5F2EE', inputBorder: dark?'#2A2E3E':'#D5D1CA',
  };
  const GRADIENTS = [
    'linear-gradient(135deg,#E8B4B8,#C3B1E1)',
    'linear-gradient(135deg,#A8C5A0,#C3B1E1)',
    'linear-gradient(135deg,#E8D5B7,#A8C5A0)',
    'linear-gradient(135deg,#C3B1E1,#A8C5A0)',
  ];
  const handleSubmit = () => {
    if (!title.trim()) return;
    const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    const now = new Date();
    onAdd({
      id: 'p' + Date.now(),
      title: title.trim(),
      client: client.trim() || 'Independent',
      type,
      frames: 0, status: 'draft',
      gradient: GRADIENTS[Math.floor(Math.random() * GRADIENTS.length)],
      month: months[now.getMonth()] + ' ' + now.getFullYear(),
    });
  };
  const inputStyle = { width:'100%', padding:'9px 12px', borderRadius:7, fontSize:13, background:c.input, border:`1px solid ${c.inputBorder}`, color:c.text, fontFamily:"'DM Sans',sans-serif", outline:'none' };
  return (
    <>
      <div onClick={onClose} style={{ position:'fixed', inset:0, zIndex:900, background:'rgba(0,0,0,0.6)', backdropFilter:'blur(4px)', animation:'scrimIn 0.15s' }} />
      <div style={{ position:'fixed', top:'50%', left:'50%', transform:'translate(-50%,-50%)', zIndex:901, width:420, background:c.bg, border:`1px solid ${c.border}`, borderRadius:14, padding:'24px 26px', boxShadow:'0 20px 60px rgba(0,0,0,0.4)', fontFamily:"'DM Sans',sans-serif", animation:'slideInUp 0.18s ease' }}>
        <div style={{ display:'flex', alignItems:'center', marginBottom:20 }}>
          <div style={{ fontFamily:"'Playfair Display',serif", fontSize:18, fontWeight:700, color:c.text, letterSpacing:'-0.02em' }}>New Project</div>
          <div onClick={onClose} style={{ marginLeft:'auto', cursor:'pointer', fontSize:20, color:c.muted, lineHeight:1 }}>×</div>
        </div>
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:10.5, fontWeight:600, color:c.muted, marginBottom:6, textTransform:'uppercase', letterSpacing:'0.09em' }}>Title</div>
          <input autoFocus value={title} onChange={e=>setTitle(e.target.value)} placeholder="Project title…" style={inputStyle} onKeyDown={e=>e.key==='Enter'&&handleSubmit()} />
        </div>
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:10.5, fontWeight:600, color:c.muted, marginBottom:6, textTransform:'uppercase', letterSpacing:'0.09em' }}>Client</div>
          <input value={client} onChange={e=>setClient(e.target.value)} placeholder="Client name…" style={inputStyle} onKeyDown={e=>e.key==='Enter'&&handleSubmit()} />
        </div>
        <div style={{ marginBottom:22 }}>
          <div style={{ fontSize:10.5, fontWeight:600, color:c.muted, marginBottom:8, textTransform:'uppercase', letterSpacing:'0.09em' }}>Type</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
            {['TVC','Short Film','Brand Film','Documentary','Music Video','Other'].map(t=>(
              <div key={t} onClick={()=>setType(t)} style={{ padding:'5px 12px', borderRadius:6, cursor:'pointer', fontSize:11.5, background:type===t?(dark?'rgba(168,197,160,0.15)':'rgba(168,197,160,0.2)'):(dark?'rgba(255,255,255,0.04)':'rgba(0,0,0,0.04)'), border:`1px solid ${type===t?'rgba(168,197,160,0.4)':c.border}`, color:type===t?'#A8C5A0':c.muted, transition:'all 0.12s' }}>{t}</div>
            ))}
          </div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <div onClick={onClose} style={{ flex:1, padding:'9px', borderRadius:8, cursor:'pointer', fontSize:13, textAlign:'center', border:`1px solid ${c.border}`, color:c.muted }}>Cancel</div>
          <div onClick={handleSubmit} style={{ flex:2, padding:'9px', borderRadius:8, cursor:'pointer', fontSize:13, fontWeight:500, textAlign:'center', background:title.trim()?'rgba(168,197,160,0.18)':'rgba(168,197,160,0.05)', border:`1px solid ${title.trim()?'rgba(168,197,160,0.4)':c.border}`, color:title.trim()?'#A8C5A0':c.muted, transition:'all 0.15s' }}>Create Project</div>
        </div>
      </div>
    </>
  );
}

// ── Projects landing ──────────────────────────────────────────────────────────

function ProjectsView({ theme, projects, onOpenProject, onNewProject }) {
  const dark = theme === 'dark';
  const c = { bg:dark?'#111318':'#F8F6F2', card:dark?'#1C1F2A':'#FFFFFF', border:dark?'rgba(255,255,255,0.07)':'rgba(0,0,0,0.08)', text:dark?'#C8C0B4':'#2A2520', muted:dark?'#4A5270':'#9A9589' };
  return (
    <div style={{ flex:1, background:c.bg, padding:'32px', overflowY:'auto', fontFamily:"'DM Sans',sans-serif" }}>
      <div style={{ display:'flex', alignItems:'baseline', gap:12, marginBottom:28 }}>
        <div style={{ fontFamily:"'Playfair Display',serif", fontSize:22, fontWeight:700, color:c.text, letterSpacing:'-0.02em' }}>Projects</div>
        <div style={{ fontSize:11, color:c.muted }}>{projects.length} project{projects.length !== 1 ? 's' : ''}</div>
        <div onClick={onNewProject} style={{ marginLeft:'auto', padding:'7px 16px', borderRadius:8, cursor:'pointer', background:dark?'rgba(168,197,160,0.1)':'rgba(168,197,160,0.2)', border:'1px solid rgba(168,197,160,0.3)', fontSize:12, color:'#A8C5A0', fontWeight:500 }}>+ New Project</div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:16 }}>
        {projects.map(p=>(
          <div key={p.id} onClick={()=>onOpenProject(p.id)} style={{ background:c.card, border:`1px solid ${c.border}`, borderRadius:12, overflow:'hidden', cursor:'pointer', boxShadow:dark?'0 2px 14px rgba(0,0,0,0.35)':'0 2px 12px rgba(0,0,0,0.07)', transition:'transform 0.15s,box-shadow 0.15s' }}
            onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-2px)';e.currentTarget.style.boxShadow=dark?'0 8px 28px rgba(0,0,0,0.45)':'0 8px 24px rgba(0,0,0,0.12)';}}
            onMouseLeave={e=>{e.currentTarget.style.transform='';e.currentTarget.style.boxShadow=dark?'0 2px 14px rgba(0,0,0,0.35)':'0 2px 12px rgba(0,0,0,0.07)';}}>
            <div style={{ height:100, background:p.gradient, position:'relative' }}>
              <div style={{ position:'absolute', top:10, right:10, fontSize:9, fontFamily:'monospace', letterSpacing:'0.08em', color:'rgba(255,255,255,0.8)', background:'rgba(0,0,0,0.25)', padding:'2px 7px', borderRadius:4 }}>{p.month}</div>
            </div>
            <div style={{ padding:'14px 16px 16px' }}>
              <div style={{ fontFamily:"'Playfair Display',serif", fontSize:16, fontWeight:700, color:c.text, marginBottom:3, letterSpacing:'-0.01em' }}>{p.title}</div>
              <div style={{ fontSize:12, color:c.muted, marginBottom:10 }}>{p.client} · {p.type}</div>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ fontSize:9, fontFamily:'monospace', padding:'2px 7px', borderRadius:4, background:p.status==='active'?(dark?'rgba(168,197,160,0.12)':'rgba(168,197,160,0.2)'):(dark?'rgba(255,255,255,0.05)':'rgba(0,0,0,0.05)'), color:p.status==='active'?'#A8C5A0':c.muted, textTransform:'uppercase', letterSpacing:'0.08em' }}>{p.status}</span>
                <span style={{ fontSize:11, color:c.muted, marginLeft:'auto' }}>{p.frames} frames</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Top Bar ───────────────────────────────────────────────────────────────────

function TopBar({ theme, view, mode, setMode, notifOpen, setNotifOpen, historyOpen, setHistoryOpen, moodboardSideOpen, setMoodboardSideOpen, liveNotif, setLiveNotif }) {
  const dark = theme === 'dark';
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState('Parfum No. 7 — TVC');
  const [extraMenuOpen, setExtraMenuOpen] = useState(false);
  const [hasActivity, setHasActivity] = useState(true); // simulates live editing activity
  const menuRef = useRef(null);
  const showLiveNotif = view === 'storyboard' || view === 'lighting';

  // Simulate activity bursts — button pulses when edits are coming in
  useEffect(() => {
    const cycle = () => {
      setHasActivity(true);
      const off = setTimeout(() => setHasActivity(false), 4000 + Math.random() * 3000);
      return off;
    };
    let offTimer = cycle();
    const interval = setInterval(() => { clearTimeout(offTimer); offTimer = cycle(); }, 9000 + Math.random() * 6000);
    return () => { clearInterval(interval); clearTimeout(offTimer); };
  }, []);

  useEffect(() => {
    const handler = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setExtraMenuOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const PROJECT_VIEWS = new Set(['storyboard','assets','crew','lighting','moodboard','settings','team']);
  const inProject = PROJECT_VIEWS.has(view);

  const c = {
    bg:     dark ? '#111318' : '#F8F6F2',
    border: dark ? '#1C1F2A' : '#DDD9D1',
    text:   dark ? '#EDE8E2' : '#1A1714',
    muted:  dark ? '#4A5270' : '#9A9589',
    input:  dark ? '#1C1F2A' : '#EDEBE5',
    toggleBg: dark ? '#1C1F2A' : '#EDEBE5',
    toggleActive: dark ? '#111318' : '#FFFFFF',
    toggleShadow: dark ? '0 1px 4px rgba(0,0,0,0.5)' : '0 1px 6px rgba(0,0,0,0.12)',
    menuBg: dark ? '#1C1F2A' : '#FFFFFF',
    menuBorder: dark ? '#2A2E3E' : '#DDD9D1',
  };

  const viewLabel = { storyboard:'Storyboard', assets:'Assets', crew:'Crew', lighting:'Setup', moodboard:'Moodboard', settings:'Settings', projects:'Projects', calendar:'Calendar', archive:'Archive', team:'Team' }[view] || view;

  return (
    <div style={{ height:52, display:'flex', alignItems:'center', gap:10, padding:'0 16px 0 24px', borderBottom:`1px solid ${c.border}`, background:c.bg, flexShrink:0, position:'relative' }}>

      {/* Live users */}
      {inProject && (
        <div style={{ display:'flex', alignItems:'center', gap:4, marginRight:8 }}>
          {LIVE_USERS.map((u,i)=>(
            <div key={u.initials} title={`${u.name} · ${u.role} (${u.status})`} style={{ position:'relative', marginLeft: i===0?0:-8, zIndex:LIVE_USERS.length-i }}>
              <div style={{ width:26, height:26, borderRadius:'50%', background:u.gradient, display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, fontWeight:700, color:'#fff', border:`2px solid ${c.bg}`, cursor:'default' }}>{u.initials}</div>
              <div style={{ position:'absolute', bottom:0, right:0, width:7, height:7, borderRadius:'50%', background:u.status==='online'?'#A8C5A0':'#E8D5B7', border:`1.5px solid ${c.bg}`, animation:u.status==='online'?'pulse 2s ease-in-out infinite':undefined }} />
            </div>
          ))}
          <div style={{ fontSize:10, color:c.muted, marginLeft:10 }}>{LIVE_USERS.filter(u=>u.status==='online').length} online</div>
        </div>
      )}

      {/* Breadcrumb / title */}
      {inProject ? (
        <div style={{ display:'flex', alignItems:'center', gap:8, flex:1, minWidth:0 }}>
          {editingTitle ? (
            <input autoFocus value={title} onChange={e=>setTitle(e.target.value)} onBlur={()=>setEditingTitle(false)} onKeyDown={e=>{if(e.key==='Enter')setEditingTitle(false);}}
              style={{ fontFamily:"'Playfair Display',serif", fontSize:16, fontWeight:700, color:c.text, background:c.input, border:'none', outline:'none', borderRadius:5, padding:'3px 8px', letterSpacing:'-0.02em', minWidth:200 }} />
          ) : (
            <div onClick={()=>setEditingTitle(true)} style={{ fontFamily:"'Playfair Display',serif", fontSize:16, fontWeight:700, color:c.text, cursor:'text', letterSpacing:'-0.02em', lineHeight:1, borderRadius:4, padding:'3px 4px' }} title="Click to rename">{title}</div>
          )}
          <span style={{ color:c.muted, fontSize:13 }}>/</span>
          <span style={{ fontSize:13, color:c.muted }}>{viewLabel}</span>
        </div>
      ) : (
        <div style={{ flex:1, fontSize:15, fontWeight:600, color:c.text }}>{viewLabel}</div>
      )}

      {/* Storyboard ↔ Pitch Deck toggle */}
      {view === 'storyboard' && (
        <div style={{ display:'flex', alignItems:'center', background:c.toggleBg, borderRadius:8, padding:3, gap:2, flexShrink:0 }}>
          {[['storyboard','Storyboard'],['pitchdeck','Pitch Deck']].map(([m,label])=>(
            <div key={m} onClick={()=>setMode(m)} style={{ padding:'5px 12px', borderRadius:6, cursor:'pointer', fontSize:11.5, fontWeight:mode===m?600:400, userSelect:'none', background:mode===m?c.toggleActive:'transparent', color:mode===m?c.text:c.muted, boxShadow:mode===m?c.toggleShadow:'none', transition:'all 0.15s' }}>{label}</div>
          ))}
        </div>
      )}

      {/* Pitch deck export actions */}
      {view === 'storyboard' && mode === 'pitchdeck' && (
        <div style={{ display:'flex', gap:8, flexShrink:0 }}>
          <div style={{ padding:'6px 12px', borderRadius:7, cursor:'pointer', fontSize:11.5, border:`1px solid ${dark?'rgba(255,255,255,0.1)':'rgba(0,0,0,0.1)'}`, color:c.muted }}>⛶ Present</div>
          <div style={{ padding:'6px 12px', borderRadius:7, cursor:'pointer', fontSize:11.5, border:`1px solid ${dark?'rgba(255,255,255,0.1)':'rgba(0,0,0,0.1)'}`, color:c.muted }}>↓ PDF</div>
        </div>
      )}

      {/* Live Notifications toggle */}
      {showLiveNotif && (
        <div
          onClick={() => setLiveNotif(o => !o)}
          title={liveNotif ? 'Live filter ON' : 'Follow live activity'}
          style={{
            display:'flex', alignItems:'center', gap:6, padding:'5px 11px', borderRadius:8,
            cursor:'pointer', flexShrink:0, fontSize:11.5, fontWeight: liveNotif ? 600 : 400,
            background: liveNotif
              ? (dark?'rgba(168,197,160,0.12)':'rgba(168,197,160,0.18)')
              : (dark?'rgba(255,255,255,0.03)':'rgba(0,0,0,0.03)'),
            border: `1px solid ${liveNotif ? 'rgba(168,197,160,0.4)' : (dark?'rgba(255,255,255,0.07)':'rgba(0,0,0,0.07)')}`,
            color: liveNotif ? '#A8C5A0' : c.muted,
            transition:'all 0.2s',
          }}
        >
          <div style={{
            width:7, height:7, borderRadius:'50%', flexShrink:0,
            background: hasActivity ? '#A8C5A0' : (dark?'#3A3E54':'#C8C0B4'),
            boxShadow: hasActivity ? '0 0 0 2px rgba(168,197,160,0.25)' : 'none',
            animation: hasActivity ? 'pulse 1.4s ease-in-out infinite' : 'none',
            transition: 'background 0.4s, box-shadow 0.4s',
          }} />
          Live
        </div>
      )}

      {/* Notification bell */}
      <div onClick={()=>setNotifOpen(o=>!o)} style={{ width:32, height:32, borderRadius:8, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', background:notifOpen?(dark?'#1C1F2A':'#E2DED8'):'transparent', color:notifOpen?c.text:c.muted, position:'relative', transition:'background 0.14s', flexShrink:0 }}>
        <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M8 2.5a4 4 0 0 1 4 4v3L13.5 12H2.5L4 9.5V6.5a4 4 0 0 1 4-4z"/><path d="M6.5 12a1.5 1.5 0 0 0 3 0"/></svg>
        <div style={{ position:'absolute', top:5, right:6, width:6, height:6, borderRadius:'50%', background:'#E8B4B8', border:`1.5px solid ${c.bg}` }} />
      </div>

      {/* Invite */}
      {inProject && (
        <div style={{ display:'flex', alignItems:'center', gap:7, padding:'6px 14px', borderRadius:8, cursor:'pointer', border:`1px solid ${dark?'rgba(168,197,160,0.35)':'rgba(168,197,160,0.5)'}`, fontSize:12, color:dark?'#A8C5A0':'#4A7A44', fontWeight:500, flexShrink:0 }}>
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M7 2v10M2 7h10"/></svg>
          Invite
        </div>
      )}

      {/* Extra options bubble */}
      <div ref={menuRef} style={{ position:'relative', flexShrink:0 }}>
        <div
          onClick={()=>setExtraMenuOpen(o=>!o)}
          style={{
            width:32, height:32, borderRadius:8, cursor:'pointer',
            display:'flex', alignItems:'center', justifyContent:'center',
            background:extraMenuOpen?(dark?'#1C1F2A':'#E2DED8'):'transparent',
            color:c.muted, transition:'background 0.14s',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="8" cy="4" r="1" fill="currentColor" stroke="none"/>
            <circle cx="8" cy="8" r="1" fill="currentColor" stroke="none"/>
            <circle cx="8" cy="12" r="1" fill="currentColor" stroke="none"/>
          </svg>
        </div>
        {extraMenuOpen && (
          <div style={{
            position:'absolute', top:'calc(100% + 6px)', right:0, zIndex:600,
            background:c.menuBg, border:`1px solid ${c.menuBorder}`, borderRadius:10,
            padding:'6px', minWidth:180, boxShadow:'0 8px 32px rgba(0,0,0,0.3)',
            animation:'fadeIn 0.12s ease',
          }}>
            {[
              { label:'History', desc:'Browse frame changes', icon:'◷', active:historyOpen, action:()=>{ setHistoryOpen(o=>!o); setMoodboardSideOpen(false); setExtraMenuOpen(false); }, color:'#C3B1E1' },
              { label:'Moodboard', desc:'Side reference panel', icon:'◧', active:moodboardSideOpen, action:()=>{ setMoodboardSideOpen(o=>!o); setHistoryOpen(false); setExtraMenuOpen(false); }, color:'#E8B4B8' },
            ].map(item=>(
              <div key={item.label} onClick={item.action} style={{
                display:'flex', alignItems:'center', gap:10, padding:'9px 11px', borderRadius:7, cursor:'pointer',
                background:item.active?(dark?`${item.color}15`:`${item.color}20`):'transparent',
                transition:'background 0.12s',
              }}
              onMouseEnter={e=>{ if(!item.active) e.currentTarget.style.background=dark?'rgba(255,255,255,0.04)':'rgba(0,0,0,0.04)'; }}
              onMouseLeave={e=>{ if(!item.active) e.currentTarget.style.background='transparent'; }}
              >
                <span style={{ fontSize:16, color:item.color }}>{item.icon}</span>
                <div>
                  <div style={{ fontSize:12.5, fontWeight:500, color:dark?'#C8C0B4':'#2A2520' }}>{item.label}</div>
                  <div style={{ fontSize:10.5, color:dark?'#4A5270':'#9A9589' }}>{item.desc}</div>
                </div>
                {item.active && <div style={{ marginLeft:'auto', width:6, height:6, borderRadius:'50%', background:item.color }} />}
              </div>
            ))}
            <div style={{ height:1, background:c.menuBorder, margin:'4px 0' }} />
            {[
              { label:'Watermark Settings', icon:'◎' },
              { label:'Export Project', icon:'↓' },
              { label:'Archive Project', icon:'▦' },
            ].map(item=>(
              <div key={item.label} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 11px', borderRadius:7, cursor:'pointer', color:dark?'#6B7399':'#9A9589', fontSize:12 }}
                onMouseEnter={e=>{ e.currentTarget.style.background=dark?'rgba(255,255,255,0.04)':'rgba(0,0,0,0.04)'; e.currentTarget.style.color=dark?'#C8C0B4':'#2A2520'; }}
                onMouseLeave={e=>{ e.currentTarget.style.background='transparent'; e.currentTarget.style.color=dark?'#6B7399':'#9A9589'; }}>
                <span style={{ fontSize:13 }}>{item.icon}</span> {item.label}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Moodboard side panel ──────────────────────────────────────────────────────

function MoodboardSidePanel({ theme, items, onClose }) {
  const dark = theme === 'dark';
  const c = { bg:dark?'#141820':'#F0EDE7', border:dark?'#1E2232':'#DDD9D1', text:dark?'#C8C0B4':'#2A2520', muted:dark?'#4A5270':'#9A9589', card:dark?'#1C1F2A':'#FFFFFF' };
  const allItems = [...items, { id:'ref1', type:'image', content:'uploads/small_NVTE6ECR.jpg', source:'SC 04 ref' }, { id:'ref2', type:'image', content:'uploads/small_LF7JADRW.jpg', source:'SC 07 ref' }];
  return (
    <div style={{ width:280, flexShrink:0, background:c.bg, borderLeft:`1px solid ${c.border}`, display:'flex', flexDirection:'column', fontFamily:"'DM Sans',sans-serif", overflow:'hidden' }}>
      <div style={{ padding:'16px 16px 12px', borderBottom:`1px solid ${c.border}`, display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
        <span style={{ fontSize:14, color:'#E8B4B8' }}>◧</span>
        <div style={{ fontSize:13, fontWeight:600, color:c.text, flex:1 }}>Moodboard</div>
        <div onClick={onClose} style={{ cursor:'pointer', fontSize:16, color:c.muted }}>×</div>
      </div>
      <div style={{ flex:1, overflowY:'auto', padding:'12px' }}>
        {items.length === 0 && (
          <div style={{ fontSize:12, color:c.muted, textAlign:'center', padding:'20px 0', lineHeight:1.6 }}>
            Open History and click any entry to pull it here.
          </div>
        )}
        {allItems.map((item,i)=>(
          <div key={item.id||i} style={{ marginBottom:10, borderRadius:8, overflow:'hidden', border:`1px solid ${c.border}`, background:c.card }}>
            {item.content?.includes('.')
              ? <img src={item.content} alt="" style={{ width:'100%', display:'block', objectFit:'cover', maxHeight:140 }} />
              : <div style={{ padding:'10px 12px', fontSize:11.5, color:c.text, lineHeight:1.6, whiteSpace:'pre-wrap' }}>{item.content}</div>
            }
            <div style={{ padding:'4px 9px', fontSize:8.5, color:c.muted, fontFamily:'monospace', borderTop:`1px solid ${c.border}` }}>{item.source}</div>
          </div>
        ))}
      </div>
      <div style={{ padding:'10px 12px', borderTop:`1px solid ${c.border}`, flexShrink:0 }}>
        <div style={{ padding:'8px 12px', borderRadius:7, border:`1px dashed ${dark?'rgba(255,255,255,0.12)':'rgba(0,0,0,0.12)'}`, textAlign:'center', fontSize:11, color:c.muted, cursor:'pointer' }}>
          + Add reference manually
        </div>
      </div>
    </div>
  );
}

// ── Add Scene FAB ─────────────────────────────────────────────────────────────

function AddSceneFAB({ theme, onClick }) {
  const dark = theme === 'dark';
  return (
    <div onClick={onClick} title="Add new scene" style={{
      position:'fixed', bottom:68, right:20, zIndex:7000,
      display:'flex', alignItems:'center', gap:7,
      padding:'8px 14px 8px 10px', borderRadius:20,
      background:dark?'#1C1F2A':'#EDEBE5',
      border:`1px solid ${dark?'rgba(168,197,160,0.35)':'rgba(168,197,160,0.5)'}`,
      cursor:'pointer', color:'#A8C5A0', fontSize:12, fontWeight:500,
      boxShadow:'0 2px 14px rgba(0,0,0,0.25)', transition:'all 0.15s',
      fontFamily:"'DM Sans',sans-serif",
    }}
    onMouseEnter={e=>{ e.currentTarget.style.background=dark?'rgba(168,197,160,0.12)':'rgba(168,197,160,0.18)'; e.currentTarget.style.boxShadow='0 4px 20px rgba(0,0,0,0.3)'; }}
    onMouseLeave={e=>{ e.currentTarget.style.background=dark?'#1C1F2A':'#EDEBE5'; e.currentTarget.style.boxShadow='0 2px 14px rgba(0,0,0,0.25)'; }}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M7 2v10M2 7h10"/></svg>
      Add Scene
    </div>
  );
}

// ── Tweaks panel ──────────────────────────────────────────────────────────────

function TweaksPanel({ show, tweaks, setTweaks, onClose }) {
  if (!show) return null;
  const dark = tweaks.theme === 'dark';
  const c = { bg:dark?'#1C1F2A':'#FFFFFF', border:dark?'#2A2E3E':'#DDD9D1', text:dark?'#C8C0B4':'#2A2520', muted:dark?'#4A5270':'#9A9589', trackOn:'#A8C5A0', trackOff:dark?'#2A2E3E':'#DDD9D1' };
  const row = (label, children) => <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}><div style={{ fontSize:12, color:c.text }}>{label}</div>{children}</div>;
  const toggle = () => {
    const updated = { ...tweaks, theme: dark ? 'light' : 'dark' };
    setTweaks(updated);
    window.parent.postMessage({ type:'__edit_mode_set_keys', edits:updated }, '*');
  };
  return (
    <div style={{ position:'fixed', bottom:80, right:20, zIndex:8000, width:240, background:c.bg, border:`1px solid ${c.border}`, borderRadius:12, padding:'16px 18px', boxShadow:'0 8px 32px rgba(0,0,0,0.35)', fontFamily:"'DM Sans',sans-serif" }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div style={{ fontSize:13, fontWeight:600, color:c.text }}>Tweaks</div>
        <div onClick={onClose} style={{ cursor:'pointer', fontSize:16, color:c.muted }}>×</div>
      </div>
      {row('Dark Mode',
        <div onClick={toggle} style={{ width:38, height:22, borderRadius:11, cursor:'pointer', background:dark?c.trackOn:c.trackOff, position:'relative', transition:'background 0.2s' }}>
          <div style={{ position:'absolute', top:3, left:dark?19:3, width:16, height:16, borderRadius:'50%', background:'#fff', transition:'left 0.2s', boxShadow:'0 1px 3px rgba(0,0,0,0.2)' }} />
        </div>
      )}
      {row('Density',
        <div style={{ display:'flex', gap:4 }}>
          {['Compact','Comfortable'].map(d=>(
            <div key={d} onClick={()=>{ const u={...tweaks,density:d.toLowerCase()}; setTweaks(u); window.parent.postMessage({type:'__edit_mode_set_keys',edits:u},'*'); }} style={{ padding:'3px 8px', borderRadius:5, cursor:'pointer', fontSize:10.5, background:tweaks.density===d.toLowerCase()?(dark?'rgba(168,197,160,0.15)':'rgba(168,197,160,0.25)'):(dark?'#1A1E2A':'#F0ECE8'), color:tweaks.density===d.toLowerCase()?'#A8C5A0':c.muted }}>{d}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Root App ──────────────────────────────────────────────────────────────────

function App() {
  const [tweaks, setTweaks]               = useState(TWEAK_DEFAULTS);
  const [view, setView]                   = useState('projects');
  const [mode, setMode]                   = useState('storyboard');
  const [notifOpen, setNotifOpen]         = useState(false);
  const [tweaksOpen, setTweaksOpen]       = useState(false);
  const [historyOpen, setHistoryOpen]     = useState(false);
  const [historyFrameId, setHistoryFrameId] = useState(null);
  const [moodboardSideOpen, setMoodboardSideOpen] = useState(false);
  const [moodboardItems, setMoodboardItems] = useState([]);
  const [claudeEnabled, setClaudeEnabled] = useState(false);
  const [activeScene, setActiveScene]     = useState(null);
  const [liveNotif, setLiveNotif]         = useState(false);

  // lifted state
  const [projects, setProjects]           = useState(INITIAL_PROJECTS);
  const [activeProject, setActiveProject] = useState(null);
  const [scenes, setScenes]               = useState(INITIAL_SCENES);
  const [assets, setAssets]               = useState(INITIAL_ASSETS);
  const [producerMode, setProducerMode]   = useState(false);
  const [producerOpen, setProducerOpen]   = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  const theme = tweaks.theme;
  const dark = theme === 'dark';

  const handleOpenProject = (projectId) => {
    setActiveProject(projectId);
    setView('storyboard');
    setActiveScene(null);
  };

  const handleAddProject = (data) => {
    setProjects(prev => [data, ...prev]);
    setNewProjectOpen(false);
    handleOpenProject(data.id);
  };

  const handleAddScene = (sceneData) => {
    setScenes(prev => [...prev, sceneData]);
  };

  const handleAddAssets = (newAssets) => {
    setAssets(prev => [...newAssets, ...prev]);
  };

  const handleUpdateScene = (sceneId, updates) => {
    setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, ...updates } : s));
  };

  // Tweaks protocol
  useEffect(() => {
    const handler = (e) => {
      if (e.data?.type === '__activate_edit_mode')   setTweaksOpen(true);
      if (e.data?.type === '__deactivate_edit_mode') setTweaksOpen(false);
    };
    window.addEventListener('message', handler);
    window.parent.postMessage({ type:'__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', handler);
  }, []);

  const handleOpenHistory = (frameId) => {
    setHistoryFrameId(frameId);
    setHistoryOpen(true);
    setMoodboardSideOpen(false);
  };

  const handlePullToMoodboard = (item) => {
    setMoodboardItems(prev => {
      if (prev.some(i => i.id === item.id)) return prev;
      return [item, ...prev];
    });
    setMoodboardSideOpen(true);
  };

  const PROJECT_VIEWS = new Set(['storyboard','assets','crew','lighting','moodboard','settings','team']);
  const inProject = PROJECT_VIEWS.has(view);

  const renderMain = () => {
    switch (view) {
      case 'storyboard': return <StoryboardView theme={theme} mode={mode} onOpenHistory={handleOpenHistory} claudeEnabled={claudeEnabled} activeScene={activeScene} scenes={scenes} />;
      case 'assets':     return <AssetsView theme={theme} assets={assets} onAddAssets={handleAddAssets} />;
      case 'crew':
      case 'team':       return <CrewView theme={theme} />;
      case 'lighting':   return <LightingView theme={theme} activeScene={activeScene} />;
      case 'moodboard':  return <MoodboardView theme={theme} moodboardItems={moodboardItems} onAddItem={handlePullToMoodboard} />;
      case 'settings':   return <SettingsView theme={theme} onClaudeToggle={setClaudeEnabled} claudeEnabled={claudeEnabled} />;
      case 'projects':   return <ProjectsView theme={theme} projects={projects} onOpenProject={handleOpenProject} onNewProject={()=>setNewProjectOpen(true)} />;
      case 'calendar':   return <CalendarView theme={theme} projects={projects} scenes={scenes} producerMode={producerMode} />;
      default: return (
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', background:dark?'#111318':'#F8F6F2', color:dark?'#4A5270':'#B0A8A0', fontFamily:"'DM Sans',sans-serif", flexDirection:'column', gap:10 }}>
          <div style={{ fontSize:32, opacity:0.3 }}>◱</div>
          <div style={{ fontSize:13 }}>{view}</div>
        </div>
      );
    }
  };

  const activeProjectData = projects.find(p => p.id === activeProject) || null;

  return (
    <div style={{ display:'flex', width:'100vw', height:'100vh', overflow:'hidden', background:dark?'#111318':'#F8F6F2' }}>
      <Sidebar
        theme={theme} view={view} setView={setView} setActiveScene={setActiveScene}
        notifOpen={notifOpen} setNotifOpen={setNotifOpen}
        activeProject={activeProject} activeProjectData={activeProjectData}
        projects={projects} onOpenProject={handleOpenProject}
        scenes={scenes} onAddScene={handleAddScene}
        producerMode={producerMode} setProducerMode={setProducerMode}
        producerOpen={producerOpen} setProducerOpen={setProducerOpen}
      />

      <div style={{ marginLeft:240, flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <TopBar
          theme={theme} view={view} mode={mode} setMode={setMode}
          notifOpen={notifOpen} setNotifOpen={setNotifOpen}
          historyOpen={historyOpen} setHistoryOpen={setHistoryOpen}
          moodboardSideOpen={moodboardSideOpen} setMoodboardSideOpen={setMoodboardSideOpen}
          liveNotif={liveNotif} setLiveNotif={setLiveNotif}
        />
        <div style={{ flex:1, display:'flex', overflow:'hidden' }}>
          {renderMain()}
          {moodboardSideOpen && (
            <MoodboardSidePanel theme={theme} items={moodboardItems} onClose={()=>setMoodboardSideOpen(false)} />
          )}
          {producerOpen && inProject && (
            <ProducerPanel
              theme={theme}
              scene={scenes.find(s => s.id === activeScene) || null}
              scenes={scenes}
              onUpdateScene={handleUpdateScene}
              onClose={()=>setProducerOpen(false)}
            />
          )}
        </div>
      </div>

      {notifOpen && <NotificationsPanel theme={theme} onClose={()=>setNotifOpen(false)} liveNotif={liveNotif} activeScene={activeScene} />}
      {historyOpen && <HistoryPanel theme={theme} frameId={historyFrameId} onClose={()=>setHistoryOpen(false)} onPullToMoodboard={handlePullToMoodboard} />}
      {newProjectOpen && <NewProjectModal theme={theme} onClose={()=>setNewProjectOpen(false)} onAdd={handleAddProject} />}

      {/* Add Scene FAB */}
      {inProject && <AddSceneFAB theme={theme} onClick={()=>{}} />}

      {/* Tweaks gear */}
      <div onClick={()=>setTweaksOpen(o=>!o)} title="Tweaks" style={{ position:'fixed', bottom:20, right:20, zIndex:7000, width:38, height:38, borderRadius:'50%', cursor:'pointer', background:dark?'#1C1F2A':'#EDEBE5', border:`1px solid ${dark?'rgba(255,255,255,0.1)':'rgba(0,0,0,0.1)'}`, display:'flex', alignItems:'center', justifyContent:'center', color:dark?'#6B7399':'#9A9589', boxShadow:'0 2px 12px rgba(0,0,0,0.2)' }}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <circle cx="8" cy="8" r="2.3"/>
          <path d="M8 1.8v1.5M8 12.7v1.5M1.8 8h1.5M12.7 8h1.5M3.8 3.8l1.1 1.1M11.1 11.1l1.1 1.1M3.8 12.2l1.1-1.1M11.1 4.9l1.1-1.1"/>
        </svg>
      </div>

      <TweaksPanel show={tweaksOpen} tweaks={tweaks} setTweaks={setTweaks} onClose={()=>{ setTweaksOpen(false); window.parent.postMessage({type:'__edit_mode_dismissed'},'*'); }} />

      <style>{`
        @keyframes fadeIn  { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:translateY(0); } }
        @keyframes slideInUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
        @keyframes scrimIn { from { opacity:0; } to { opacity:1; } }
        @keyframes slideInRight { from { opacity:0; transform:translateX(24px); } to { opacity:1; transform:translateX(0); } }
      `}</style>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
</script>
</body>
</html>
```


## File: `storiiboard-sidebar.jsx` — Replace entire file

```jsx

// storiiboard-sidebar.jsx (v3) — Calendar nav, Team in project nav, compact project list,
// dynamic project name, functional Add Scene inline form, Producer mode toggle

const { useState: useSbState } = React;

const Ic = ({ d, size = 16, vb }) => (
  <svg width={size} height={size} viewBox={vb || `0 0 ${size} ${size}`} fill="none"
    stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);

const SbIcons = {
  Projects:   () => <Ic d={<><rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1"/><rect x="9" y="1.5" width="5.5" height="5.5" rx="1"/><rect x="1.5" y="9" width="5.5" height="5.5" rx="1"/><rect x="9" y="9" width="5.5" height="5.5" rx="1"/></>} />,
  Calendar:   () => <Ic d={<><rect x="1.5" y="3" width="13" height="12" rx="1.5"/><path d="M5 1.5v3M11 1.5v3M1.5 7h13"/><rect x="4" y="9.5" width="2" height="2" rx="0.4"/><rect x="7" y="9.5" width="2" height="2" rx="0.4"/><rect x="10" y="9.5" width="2" height="2" rx="0.4"/></>} />,
  Archive:    () => <Ic d={<><rect x="1.5" y="4.5" width="13" height="10" rx="1"/><path d="M1.5 4.5 3 2h10l1.5 2.5"/><path d="M5.5 9h5"/></>} />,
  Bell:       () => <Ic d={<><path d="M8 2.5a4 4 0 0 1 4 4v3L13.5 12H2.5L4 9.5V6.5a4 4 0 0 1 4-4z"/><path d="M6.5 12a1.5 1.5 0 0 0 3 0"/></>} />,
  Storyboard: () => <Ic d={<><rect x="1.5" y="2.5" width="6" height="4.5" rx="0.7"/><rect x="8.5" y="2.5" width="6" height="4.5" rx="0.7"/><rect x="1.5" y="9" width="6" height="4.5" rx="0.7"/><rect x="8.5" y="9" width="6" height="4.5" rx="0.7"/></>} />,
  Assets:     () => <Ic d={<><rect x="2" y="2" width="5" height="5" rx="0.7"/><rect x="9" y="2" width="5" height="5" rx="0.7"/><rect x="2" y="9" width="5" height="5" rx="0.7"/><path d="M11.5 9v6M8.5 12h6"/></>} />,
  Team:       () => <Ic d={<><circle cx="5.5" cy="5.5" r="2.4"/><circle cx="10.5" cy="5.5" r="2.4"/><path d="M1 14c0-2.5 2-4.5 4.5-4.5"/><path d="M15 14c0-2.5-2-4.5-4.5-4.5"/><path d="M5 9c.4-2.5 2.2-4.5 5.5-4.5"/></>} />,
  Lightning:  () => <Ic d={<><rect x="1.5" y="3" width="13" height="10" rx="1"/><circle cx="8" cy="8" r="2.5"/><path d="M3.5 5.5h1M3.5 8h1M3.5 10.5h1M11.5 5.5h1M11.5 8h1M11.5 10.5h1"/></>} />,
  Moodboard:  () => <Ic d={<><rect x="1.5" y="1.5" width="6" height="8" rx="0.7"/><rect x="9" y="1.5" width="5.5" height="5" rx="0.7"/><rect x="9" y="8" width="5.5" height="6.5" rx="0.7"/><rect x="1.5" y="11" width="6" height="3" rx="0.7"/></>} />,
  Gear:       () => <Ic d={<><circle cx="8" cy="8" r="2.3"/><path d="M8 1.8v1.5M8 12.7v1.5M1.8 8h1.5M12.7 8h1.5M3.8 3.8l1.1 1.1M11.1 11.1l1.1 1.1M3.8 12.2l1.1-1.1M11.1 4.9l1.1-1.1"/></>} />,
  Producer:   () => <Ic d={<><circle cx="8" cy="5" r="2.5"/><path d="M3 13c0-2.8 2.2-5 5-5s5 2.2 5 5"/><path d="M11 7l1.5 1.5L15 6"/></>} />,
  ChevDown:   () => <Ic d={<path d="M4 6l4 4 4-4"/>} />,
  Plus:       () => <Ic d={<><path d="M8 3v10M3 8h10"/></>} />,
  Scene:      () => <Ic size={12} d={<><circle cx="6" cy="6" r="4"/><path d="M4.5 4.5l3 3M4.5 7.5l1.5-1.5"/></>} />,
  Check:      () => <Ic d={<path d="M3 8l3.5 3.5L13 5"/>} />,
};

const GLOBAL_NAV = [
  { id: 'projects',  label: 'Projects',  icon: 'Projects' },
  { id: 'calendar',  label: 'Calendar',  icon: 'Calendar' },
  { id: 'archive',   label: 'Archive',   icon: 'Archive'  },
  { id: 'notif',     label: 'Notifications', icon: 'Bell', badge: 4 },
];

const PROJECT_NAV = [
  { id: 'storyboard', label: 'Storyboard', icon: 'Storyboard', expandable: true  },
  { id: 'assets',     label: 'Assets',     icon: 'Assets',     expandable: false },
  { id: 'team',       label: 'Team',       icon: 'Team',       expandable: false },
  { id: 'lighting',   label: 'Setup',      icon: 'Lightning',  expandable: true  },
  { id: 'moodboard',  label: 'Moodboard',  icon: 'Moodboard',  expandable: true  },
  { id: 'settings',   label: 'Settings',   icon: 'Gear',       expandable: false },
];

const PROJECT_VIEW_IDS = new Set(PROJECT_NAV.map(n => n.id));

function Sidebar({
  theme, view, setView, setActiveScene, notifOpen, setNotifOpen,
  activeProject, activeProjectData, projects, onOpenProject,
  scenes, onAddScene,
  producerMode, setProducerMode, producerOpen, setProducerOpen,
}) {
  const dark = theme === 'dark';
  const [projectExpanded, setProjectExpanded] = useSbState(true);
  const [openDropdowns, setOpenDropdowns] = useSbState({ storyboard: true, lighting: false, moodboard: false });
  const [recentExpanded, setRecentExpanded] = useSbState(true);

  // Add Scene inline form state
  const [addingScene, setAddingScene] = useSbState(false);
  const [newSceneTitle, setNewSceneTitle] = useSbState('');
  const [newSceneLocation, setNewSceneLocation] = useSbState('');

  const inProject = PROJECT_VIEW_IDS.has(view);

  const c = {
    bg:          dark ? '#0F1118' : '#EFECE6',
    border:      dark ? '#1C1F2A' : '#DDD9D1',
    text:        dark ? '#C8C0B4' : '#2A2520',
    muted:       dark ? '#4A5270' : '#9A9589',
    activeBg:    dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)',
    activeText:  dark ? '#EDE8E2' : '#1A1714',
    hover:       dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
    sceneHover:  dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
    sectionLbl:  dark ? '#363C54' : '#C0BAB0',
    badge:       '#E8B4B8',
    badgeText:   '#3A1518',
    divider:     dark ? '#1A1D28' : '#DDD9D1',
    accent:      { storyboard: '#C3B1E1', lighting: '#E8D5B7', moodboard: '#E8B4B8' },
    input:       dark ? '#141820' : '#F5F2EE',
    inputBorder: dark ? '#2A2E3E' : '#D5D1CA',
  };

  const toggleDropdown = (id) =>
    setOpenDropdowns(prev => ({ ...prev, [id]: !prev[id] }));

  const handleSceneClick = (navId, sceneId) => {
    setView(navId);
    setActiveScene(sceneId);
  };

  const handleAddSceneSubmit = () => {
    if (!newSceneTitle.trim()) return;
    const nextNum = String(scenes.length + 1).padStart(2, '0');
    onAddScene({
      id: 'sc_' + Date.now(),
      label: 'SC ' + (scenes.length + 1),
      title: newSceneTitle.trim(),
      location: newSceneLocation.trim() || 'TBD',
      frameIds: [],
      shootDate: null,
      venue: null,
      staffChecklist: [],
    });
    setNewSceneTitle('');
    setNewSceneLocation('');
    setAddingScene(false);
  };

  const navItemStyle = (active) => ({
    display: 'flex', alignItems: 'center', gap: 9, padding: '6px 9px',
    borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: active ? 500 : 400,
    marginBottom: 1, color: active ? c.activeText : c.text,
    background: active ? c.activeBg : 'transparent', transition: 'background 0.12s, color 0.12s',
    userSelect: 'none',
  });

  const renderNavItem = (item) => {
    const active = view === item.id;
    const IconComp = SbIcons[item.icon];
    const dropOpen = openDropdowns[item.id];
    const accentColor = c.accent[item.id] || '#A8C5A0';

    return (
      <div key={item.id}>
        <div
          style={navItemStyle(active)}
          onClick={() => {
            setView(item.id);
            if (item.expandable) toggleDropdown(item.id);
            setNotifOpen(false);
          }}
          onMouseEnter={e => { if (!active) e.currentTarget.style.background = c.hover; }}
          onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
        >
          <span style={{ color: active ? c.activeText : c.muted, display: 'flex', flexShrink: 0 }}>
            <IconComp />
          </span>
          <span style={{ flex: 1 }}>{item.label}</span>
          {item.expandable && (
            <span style={{
              display: 'flex', color: c.muted,
              transform: dropOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
              transition: 'transform 0.18s',
            }}>
              <SbIcons.ChevDown />
            </span>
          )}
        </div>

        {/* Scene dropdown */}
        {item.expandable && dropOpen && (
          <div style={{ marginBottom: 4 }}>
            <div style={{ marginLeft: 22, paddingLeft: 12, borderLeft: `1.5px solid ${accentColor}22` }}>
              {scenes.map(sc => (
                <div
                  key={sc.id}
                  onClick={() => handleSceneClick(item.id, sc.id)}
                  style={{
                    display: 'flex', alignItems: 'baseline', gap: 7,
                    padding: '5px 8px', borderRadius: 5, cursor: 'pointer',
                    marginBottom: 1, transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = c.sceneHover; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{
                    fontFamily: "'DM Mono','Fira Mono',monospace",
                    fontSize: 9, letterSpacing: '0.06em', color: accentColor, flexShrink: 0,
                  }}>{sc.label}</span>
                  <span style={{ fontSize: 11.5, color: c.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.id === 'lighting' ? sc.location : sc.title}
                  </span>
                </div>
              ))}

              {/* Inline Add Scene form */}
              {item.id === 'storyboard' && addingScene ? (
                <div style={{ padding: '6px 8px', marginTop: 4 }}>
                  <input
                    autoFocus
                    value={newSceneTitle}
                    onChange={e => setNewSceneTitle(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAddSceneSubmit(); if (e.key === 'Escape') setAddingScene(false); }}
                    placeholder="Scene title…"
                    style={{ width: '100%', padding: '5px 8px', borderRadius: 5, fontSize: 11.5, background: c.input, border: `1px solid ${c.inputBorder}`, color: c.text, fontFamily: "'DM Sans',sans-serif", outline: 'none', marginBottom: 4 }}
                  />
                  <input
                    value={newSceneLocation}
                    onChange={e => setNewSceneLocation(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAddSceneSubmit(); if (e.key === 'Escape') setAddingScene(false); }}
                    placeholder="Location (optional)…"
                    style={{ width: '100%', padding: '5px 8px', borderRadius: 5, fontSize: 11.5, background: c.input, border: `1px solid ${c.inputBorder}`, color: c.text, fontFamily: "'DM Sans',sans-serif", outline: 'none', marginBottom: 6 }}
                  />
                  <div style={{ display: 'flex', gap: 4 }}>
                    <div onClick={handleAddSceneSubmit} style={{ flex: 1, padding: '4px', borderRadius: 5, cursor: 'pointer', fontSize: 11, textAlign: 'center', background: 'rgba(195,177,225,0.15)', border: '1px solid rgba(195,177,225,0.3)', color: accentColor }}>Add</div>
                    <div onClick={() => setAddingScene(false)} style={{ padding: '4px 8px', borderRadius: 5, cursor: 'pointer', fontSize: 11, color: c.muted }}>Cancel</div>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '5px 8px', borderRadius: 5, cursor: 'pointer',
                    color: c.muted, fontSize: 11, marginTop: 2,
                  }}
                  onClick={() => {
                    if (item.id === 'storyboard') setAddingScene(true);
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = accentColor; }}
                  onMouseLeave={e => { e.currentTarget.style.color = c.muted; }}
                >
                  <SbIcons.Plus />
                  <span>{item.id === 'storyboard' ? 'Add Scene' : item.id === 'lighting' ? 'New Setup Diagram' : 'New Board'}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{
      width: 240, height: '100vh', background: c.bg, borderRight: `1px solid ${c.border}`,
      display: 'flex', flexDirection: 'column', flexShrink: 0,
      position: 'fixed', left: 0, top: 0, bottom: 0, zIndex: 100,
      fontFamily: "'DM Sans', sans-serif",
    }}>
      {/* Wordmark */}
      <div style={{ padding: '22px 20px 18px', borderBottom: `1px solid ${c.border}`, flexShrink: 0 }}>
        <div style={{
          fontFamily: "'Playfair Display', serif", fontSize: 21, fontWeight: 700,
          letterSpacing: '-0.02em', color: dark ? '#F0EAE2' : '#1A1714', lineHeight: 1,
        }}>
          Stor<span style={{ letterSpacing: '-0.06em', fontStyle: 'italic' }}>ii</span>board
        </div>
        <div style={{ fontSize: 9.5, color: c.sectionLbl, marginTop: 4, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          Production Suite
        </div>
      </div>

      {/* Global Nav */}
      <div style={{ padding: '14px 10px 8px', flexShrink: 0 }}>
        <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: c.sectionLbl, padding: '0 9px', marginBottom: 6 }}>
          Workspace
        </div>
        {GLOBAL_NAV.map(it => {
          const active = it.id === 'notif' ? notifOpen : view === it.id;
          const IconComp = SbIcons[it.icon];
          return (
            <div
              key={it.id}
              style={navItemStyle(active)}
              onClick={() => { if (it.id === 'notif') { setNotifOpen(o => !o); } else { setView(it.id); setNotifOpen(false); } }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = c.hover; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ color: active ? c.activeText : c.muted, display: 'flex', flexShrink: 0 }}><IconComp /></span>
              <span style={{ flex: 1 }}>{it.label}</span>
              {it.badge && (
                <span style={{ background: c.badge, color: c.badgeText, fontSize: 10, fontWeight: 700, borderRadius: 10, padding: '1px 6px', lineHeight: '16px' }}>{it.badge}</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Compact recent projects — shown when NOT inside a project */}
      {!inProject && projects.length > 0 && (
        <div style={{ borderTop: `1px solid ${c.divider}`, padding: '10px 10px 6px', flexShrink: 0 }}>
          <div
            onClick={() => setRecentExpanded(e => !e)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 9px', cursor: 'pointer', marginBottom: 4 }}
          >
            <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: c.sectionLbl, flex: 1 }}>
              Recent Projects
            </div>
            <span style={{ color: c.sectionLbl, display: 'flex', transform: recentExpanded ? 'rotate(0)' : 'rotate(-90deg)', transition: 'transform 0.18s' }}>
              <SbIcons.ChevDown />
            </span>
          </div>
          {recentExpanded && projects.slice(0, 5).map(p => (
            <div
              key={p.id}
              onClick={() => onOpenProject(p.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 9px', borderRadius: 6, cursor: 'pointer', marginBottom: 1 }}
              onMouseEnter={e => { e.currentTarget.style.background = c.hover; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.gradient, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: c.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.title}</div>
              </div>
              <span style={{ fontSize: 9, fontFamily: 'monospace', color: p.status === 'active' ? '#A8C5A0' : c.muted, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{p.status}</span>
            </div>
          ))}
        </div>
      )}

      {/* Project Nav — shown when inside a project */}
      {inProject && (
        <div style={{ flex: 1, overflowY: 'auto', borderTop: `1px solid ${c.divider}` }}>
          <div style={{ padding: '10px 10px 4px' }}>
            {/* Project header */}
            <div
              onClick={() => setProjectExpanded(e => !e)}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 9px', cursor: 'pointer', marginBottom: 6 }}
            >
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#A8C5A0', flexShrink: 0 }} />
              <span style={{ fontSize: 11, fontWeight: 500, color: c.muted, flex: 1, letterSpacing: '0.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {activeProjectData ? `${activeProjectData.title} — ${activeProjectData.type}` : 'Untitled Project'}
              </span>
              <span style={{ color: c.muted, display: 'flex', transform: projectExpanded ? 'rotate(0)' : 'rotate(-90deg)', transition: 'transform 0.18s' }}>
                <SbIcons.ChevDown />
              </span>
            </div>

            {projectExpanded && PROJECT_NAV.map(renderNavItem)}

            {/* Producer mode toggle */}
            {projectExpanded && (
              <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${c.divider}` }}>
                <div
                  onClick={() => {
                    setProducerMode(m => !m);
                    setProducerOpen(o => !o);
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 9px',
                    borderRadius: 6, cursor: 'pointer',
                    background: producerMode ? (dark ? 'rgba(232,180,184,0.1)' : 'rgba(232,180,184,0.15)') : 'transparent',
                    border: `1px solid ${producerMode ? 'rgba(232,180,184,0.35)' : 'transparent'}`,
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { if (!producerMode) e.currentTarget.style.background = c.hover; }}
                  onMouseLeave={e => { if (!producerMode) e.currentTarget.style.background = 'transparent'; }}
                >
                  <span style={{ color: producerMode ? '#E8B4B8' : c.muted, display: 'flex' }}><SbIcons.Producer /></span>
                  <span style={{ flex: 1, fontSize: 12.5, color: producerMode ? '#E8B4B8' : c.text }}>Producer Mode</span>
                  <div style={{
                    width: 28, height: 16, borderRadius: 8, background: producerMode ? 'rgba(232,180,184,0.5)' : (dark ? '#2A2E3E' : '#D5D1CA'),
                    position: 'relative', transition: 'background 0.2s', flexShrink: 0,
                  }}>
                    <div style={{
                      position: 'absolute', top: 2, left: producerMode ? 12 : 2,
                      width: 12, height: 12, borderRadius: '50%', background: '#fff',
                      transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                    }} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* User card */}
      <div style={{ borderTop: `1px solid ${c.border}`, padding: 10, flexShrink: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 9, padding: '7px 8px', borderRadius: 8, cursor: 'pointer',
          background: dark ? '#141720' : '#E8E4DC',
        }}>
          <div style={{
            width: 31, height: 31, borderRadius: '50%', flexShrink: 0,
            background: 'linear-gradient(140deg,#C3B1E1,#E8B4B8)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700, color: '#fff',
          }}>SR</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 500, color: c.activeText, lineHeight: 1.25 }}>Sofia Reyes</div>
            <div style={{ fontSize: 10, color: c.muted, marginTop: 1 }}>Director</div>
          </div>
          <div style={{
            fontSize: 9, fontWeight: 700, color: '#A8C5A0',
            background: dark ? 'rgba(168,197,160,0.1)' : 'rgba(100,160,90,0.12)',
            padding: '2px 6px', borderRadius: 4, letterSpacing: '0.06em', flexShrink: 0,
          }}>DIR</div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Sidebar, SbIcons });
```

## File: `storiiboard-views.jsx` — Replace entire file

```jsx

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
```

## File: `storiiboard-calendar.jsx` — CREATE this new file

```jsx

// storiiboard-calendar.jsx — Monthly calendar view with scenes, producer mode support

const { useState: useCalState } = React;

function CalendarView({ theme, projects, scenes, producerMode }) {
  const dark = theme === 'dark';
  const now = new Date();
  const [currentYear, setCurrentYear] = useCalState(now.getFullYear());
  const [currentMonth, setCurrentMonth] = useCalState(now.getMonth()); // 0-indexed
  const [selectedDay, setSelectedDay] = useCalState(null);
  const [viewMode, setViewMode] = useCalState('month'); // 'month' | 'week'

  const c = {
    bg:      dark ? '#111318' : '#F8F6F2',
    card:    dark ? '#1C1F2A' : '#FFFFFF',
    border:  dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)',
    divider: dark ? '#1C1F2A' : '#E4E0D8',
    text:    dark ? '#C8C0B4' : '#2A2520',
    muted:   dark ? '#4A5270' : '#9A9589',
    today:   dark ? 'rgba(195,177,225,0.15)' : 'rgba(195,177,225,0.2)',
    todayBorder: '#C3B1E1',
    hover:   dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
    header:  dark ? '#0F1118' : '#EFECE6',
  };

  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  const prevMonth = () => {
    if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear(y => y - 1); }
    else setCurrentMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear(y => y + 1); }
    else setCurrentMonth(m => m + 1);
  };
  const goToday = () => { setCurrentMonth(now.getMonth()); setCurrentYear(now.getFullYear()); setSelectedDay(null); };

  // Build calendar grid
  const firstDay = new Date(currentYear, currentMonth, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const daysInPrev  = new Date(currentYear, currentMonth, 0).getDate();
  const totalCells  = Math.ceil((firstDay + daysInMonth) / 7) * 7;

  const cells = [];
  for (let i = 0; i < totalCells; i++) {
    if (i < firstDay) {
      cells.push({ day: daysInPrev - firstDay + 1 + i, month: 'prev' });
    } else if (i >= firstDay + daysInMonth) {
      cells.push({ day: i - firstDay - daysInMonth + 1, month: 'next' });
    } else {
      const day = i - firstDay + 1;
      const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      const dayScenes = scenes.filter(s => s.shootDate === dateStr);
      cells.push({ day, month: 'current', dateStr, scenes: dayScenes });
    }
  }

  const isToday = (cell) => {
    if (cell.month !== 'current') return false;
    return cell.dateStr === `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  };

  const getProjectGradient = (scene) => {
    // Find which project this scene belongs to — just cycle colors for now
    const colors = ['#C3B1E1','#E8B4B8','#A8C5A0','#E8D5B7'];
    const idx = scenes.indexOf(scene) % colors.length;
    return colors[idx];
  };

  const venueStatus = (scene) => {
    if (!scene.venue) return null;
    const colors = { Confirmed: '#A8C5A0', TBD: '#E8D5B7', Cancelled: '#E87070' };
    return colors[scene.venue.status] || '#A8C5A0';
  };

  const selectedDateScenes = selectedDay
    ? scenes.filter(s => s.shootDate === selectedDay)
    : [];

  // Week view: show current week containing today
  const weekStart = new Date(currentYear, currentMonth, 1);
  const currentWeekDays = [];
  for (let d = 0; d < 7; d++) {
    const date = new Date(currentYear, currentMonth, 1 + d);
    const dateStr = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    currentWeekDays.push({ date, dateStr, dayScenes: scenes.filter(s => s.shootDate === dateStr) });
  }

  // All scenes with shoot dates for sidebar list
  const scheduledScenes = scenes.filter(s => s.shootDate).sort((a,b) => a.shootDate.localeCompare(b.shootDate));

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: c.bg, overflow: 'hidden', fontFamily: "'DM Sans',sans-serif" }}>

      {/* Header */}
      <div style={{ padding: '20px 28px 16px', borderBottom: `1px solid ${c.divider}`, background: c.header, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 20, fontWeight: 700, color: c.text, letterSpacing: '-0.02em' }}>
            {MONTHS[currentMonth]} {currentYear}
          </div>
          <div style={{ display: 'flex', gap: 6, marginLeft: 8 }}>
            <div onClick={prevMonth} style={{ width: 28, height: 28, borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', color: c.muted }}>‹</div>
            <div onClick={nextMonth} style={{ width: 28, height: 28, borderRadius: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', background: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', color: c.muted }}>›</div>
          </div>
          <div onClick={goToday} style={{ padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 11.5, background: dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', color: c.muted }}>Today</div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            {['month','week'].map(m => (
              <div key={m} onClick={() => setViewMode(m)} style={{ padding: '4px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 11.5, fontWeight: viewMode===m?500:400, background: viewMode===m?(dark?'rgba(195,177,225,0.12)':'rgba(195,177,225,0.18)'):(dark?'rgba(255,255,255,0.03)':'rgba(0,0,0,0.03)'), color: viewMode===m?'#C3B1E1':c.muted, border: `1px solid ${viewMode===m?'rgba(195,177,225,0.3)':'transparent'}`, textTransform: 'capitalize' }}>{m}</div>
            ))}
          </div>
          {producerMode && (
            <div style={{ padding: '4px 10px', borderRadius: 6, fontSize: 10.5, background: 'rgba(232,180,184,0.12)', border: '1px solid rgba(232,180,184,0.3)', color: '#E8B4B8', fontWeight: 600, letterSpacing: '0.04em' }}>
              PRODUCER VIEW
            </div>
          )}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Main calendar grid */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 16px' }}>
          {/* Day labels */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, paddingTop: 12, marginBottom: 4 }}>
            {DAYS.map(d => (
              <div key={d} style={{ textAlign: 'center', fontSize: 10, fontWeight: 600, color: c.muted, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '6px 0' }}>{d}</div>
            ))}
          </div>

          {/* Calendar cells */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
            {cells.map((cell, i) => {
              const today = isToday(cell);
              const isSelected = cell.dateStr && cell.dateStr === selectedDay;
              const isCurrent = cell.month === 'current';
              return (
                <div
                  key={i}
                  onClick={() => isCurrent && setSelectedDay(cell.dateStr === selectedDay ? null : cell.dateStr)}
                  style={{
                    minHeight: 90, padding: '6px 7px', borderRadius: 7,
                    background: isSelected ? (dark?'rgba(195,177,225,0.1)':'rgba(195,177,225,0.12)') : today ? c.today : 'transparent',
                    border: `1px solid ${isSelected ? 'rgba(195,177,225,0.35)' : today ? c.todayBorder + '55' : c.divider}`,
                    cursor: isCurrent ? 'pointer' : 'default',
                    opacity: isCurrent ? 1 : 0.28,
                    transition: 'background 0.12s, border 0.12s',
                  }}
                  onMouseEnter={e => { if (isCurrent && !isSelected) e.currentTarget.style.background = c.hover; }}
                  onMouseLeave={e => { if (isCurrent && !isSelected && !today) e.currentTarget.style.background = 'transparent'; if (today && !isSelected) e.currentTarget.style.background = c.today; }}
                >
                  <div style={{ fontSize: 11.5, fontWeight: today ? 700 : 400, color: today ? '#C3B1E1' : (isCurrent ? c.text : c.muted), marginBottom: 4, textAlign: 'right' }}>{cell.day}</div>
                  {cell.scenes && cell.scenes.map(sc => (
                    <div key={sc.id} style={{ marginBottom: 3 }}>
                      <div style={{
                        fontSize: 9.5, padding: '2px 6px', borderRadius: 4, lineHeight: 1.4,
                        background: dark ? `${getProjectGradient(sc)}22` : `${getProjectGradient(sc)}33`,
                        color: getProjectGradient(sc), fontWeight: 500,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        border: `1px solid ${getProjectGradient(sc)}44`,
                        display: 'flex', alignItems: 'center', gap: 4,
                      }}>
                        <span style={{ fontFamily: 'monospace', fontSize: 8.5, opacity: 0.8 }}>{sc.label}</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{sc.title}</span>
                        {producerMode && sc.venue && (
                          <span style={{ width: 5, height: 5, borderRadius: '50%', background: venueStatus(sc), flexShrink: 0, marginLeft: 'auto' }} />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right sidebar — scheduled scenes list */}
        <div style={{ width: 240, flexShrink: 0, borderLeft: `1px solid ${c.divider}`, padding: '16px 14px', overflowY: 'auto', background: dark ? '#0F1118' : '#F0EDE7' }}>
          <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: c.muted, marginBottom: 12 }}>
            {selectedDay ? 'Selected Day' : 'Shoot Schedule'}
          </div>

          {selectedDay && selectedDateScenes.length === 0 && (
            <div style={{ fontSize: 12, color: c.muted, padding: '12px 0', lineHeight: 1.6 }}>No scenes scheduled for this day.</div>
          )}

          {(selectedDay ? selectedDateScenes : scheduledScenes).map(sc => {
            const color = getProjectGradient(sc);
            return (
              <div key={sc.id} style={{ background: dark ? '#1C1F2A' : '#FFFFFF', border: `1px solid ${c.border}`, borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 9, color, letterSpacing: '0.06em' }}>{sc.label}</span>
                  <span style={{ fontSize: 11.5, fontWeight: 500, color: c.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sc.title}</span>
                </div>
                <div style={{ fontSize: 10.5, color: c.muted, marginBottom: producerMode ? 6 : 0 }}>
                  {sc.location} · {sc.shootDate ? new Date(sc.shootDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Unscheduled'}
                </div>
                {producerMode && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {sc.venue && (
                      <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: `${venueStatus(sc)}22`, color: venueStatus(sc), fontFamily: 'monospace', letterSpacing: '0.05em' }}>
                        {sc.venue.status || 'TBD'}
                      </span>
                    )}
                    {sc.staffChecklist.length > 0 && (
                      <span style={{ fontSize: 9, color: c.muted }}>
                        {sc.staffChecklist.filter(s => s.confirmed).length}/{sc.staffChecklist.length} staff confirmed
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {!selectedDay && scheduledScenes.length === 0 && (
            <div style={{ fontSize: 12, color: c.muted, lineHeight: 1.7 }}>
              No scenes scheduled yet. Set shoot dates in the Producer panel.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { CalendarView });
```

## File: `storiiboard-producer.jsx` — CREATE this new file

```jsx

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
```

---
## How to apply on Mac

1. Open your storiiboard project folder in Claude Code
2. Paste this entire document and say: **'Apply all these file changes to my project'**
3. Claude Code will replace/create each file
4. Open index.html in a browser (or use `npx serve .`) to test
