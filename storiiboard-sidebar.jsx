
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
