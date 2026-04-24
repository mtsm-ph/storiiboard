
// storiiboard-sidebar.jsx (v2) — expandable scene dropdowns, Moodboard nav, Lighting Setup

const { useState: useSbState } = React;

const Ic = ({ d, size = 16, vb }) => (
  <svg width={size} height={size} viewBox={vb || `0 0 ${size} ${size}`} fill="none"
    stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
);

const SbIcons = {
  Projects:   () => <Ic d={<><rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1"/><rect x="9" y="1.5" width="5.5" height="5.5" rx="1"/><rect x="1.5" y="9" width="5.5" height="5.5" rx="1"/><rect x="9" y="9" width="5.5" height="5.5" rx="1"/></>} />,
  Gigs:       () => <Ic d={<><circle cx="8" cy="5.5" r="2.8"/><path d="M1.5 14.5c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5"/></>} />,
  Archive:    () => <Ic d={<><rect x="1.5" y="4.5" width="13" height="10" rx="1"/><path d="M1.5 4.5 3 2h10l1.5 2.5"/><path d="M5.5 9h5"/></>} />,
  Team:       () => <Ic d={<><circle cx="5.5" cy="5.5" r="2.4"/><circle cx="10.5" cy="5.5" r="2.4"/><path d="M1 14c0-2.5 2-4.5 4.5-4.5"/><path d="M15 14c0-2.5-2-4.5-4.5-4.5"/><path d="M5 9c.4-2.5 2.2-4.5 5.5-4.5"/></>} />,
  Bell:       () => <Ic d={<><path d="M8 2.5a4 4 0 0 1 4 4v3L13.5 12H2.5L4 9.5V6.5a4 4 0 0 1 4-4z"/><path d="M6.5 12a1.5 1.5 0 0 0 3 0"/></>} />,
  Storyboard: () => <Ic d={<><rect x="1.5" y="2.5" width="6" height="4.5" rx="0.7"/><rect x="8.5" y="2.5" width="6" height="4.5" rx="0.7"/><rect x="1.5" y="9" width="6" height="4.5" rx="0.7"/><rect x="8.5" y="9" width="6" height="4.5" rx="0.7"/></>} />,
  Assets:     () => <Ic d={<><rect x="2" y="2" width="5" height="5" rx="0.7"/><rect x="9" y="2" width="5" height="5" rx="0.7"/><rect x="2" y="9" width="5" height="5" rx="0.7"/><path d="M11.5 9v6M8.5 12h6"/></>} />,
  Crew:       () => <Ic d={<><circle cx="8" cy="5" r="2.8"/><path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6"/></>} />,
  Lightning:  () => <Ic d={<><rect x="1.5" y="3" width="13" height="10" rx="1"/><circle cx="8" cy="8" r="2.5"/><path d="M3.5 5.5h1M3.5 8h1M3.5 10.5h1M11.5 5.5h1M11.5 8h1M11.5 10.5h1"/></>} />,
  Moodboard:  () => <Ic d={<><rect x="1.5" y="1.5" width="6" height="8" rx="0.7"/><rect x="9" y="1.5" width="5.5" height="5" rx="0.7"/><rect x="9" y="8" width="5.5" height="6.5" rx="0.7"/><rect x="1.5" y="11" width="6" height="3" rx="0.7"/></>} />,
  Gear:       () => <Ic d={<><circle cx="8" cy="8" r="2.3"/><path d="M8 1.8v1.5M8 12.7v1.5M1.8 8h1.5M12.7 8h1.5M3.8 3.8l1.1 1.1M11.1 11.1l1.1 1.1M3.8 12.2l1.1-1.1M11.1 4.9l1.1-1.1"/></>} />,
  ChevDown:   () => <Ic d={<path d="M4 6l4 4 4-4"/>} />,
  Plus:       () => <Ic d={<><path d="M8 3v10M3 8h10"/></>} />,
  Scene:      () => <Ic size={12} d={<><circle cx="6" cy="6" r="4"/><path d="M4.5 4.5l3 3M4.5 7.5l1.5-1.5"/></>} />,
};

const GLOBAL_NAV = [
  { id: 'projects',       label: 'Projects',      icon: 'Projects' },
  { id: 'gigs',           label: 'Gigs',           icon: 'Gigs'     },
  { id: 'archive',        label: 'Archive',        icon: 'Archive'  },
  { id: 'team',           label: 'Team Directory', icon: 'Team'     },
  { id: 'notif',          label: 'Notifications',  icon: 'Bell', badge: 4 },
];

// Scenes data shared with views — exported on window
const SB_SCENES = [
  { id: 'sc04', label: 'SC 04', title: 'Mirror Scene',     location: 'Paris Apt.',     frameIds: ['f01'] },
  { id: 'sc07', label: 'SC 07', title: 'Airplane Reverie', location: 'Business Class', frameIds: ['f02'] },
  { id: 'sc12', label: 'SC 12', title: 'The Ceremony',     location: 'Desert Plain',   frameIds: ['f03'] },
  { id: 'sc15', label: 'SC 15', title: 'Control Room',     location: 'Server Room',    frameIds: ['f04'] },
  { id: 'sc18', label: 'SC 18', title: 'Empty Frame',      location: 'TBD',            frameIds: ['f05'] },
  { id: 'sc21', label: 'SC 21', title: 'Departure Board',  location: 'Airport',        frameIds: ['f06'] },
];

// expandable: which project nav items have scene dropdowns
const PROJECT_NAV = [
  { id: 'storyboard', label: 'Storyboard',    icon: 'Storyboard', expandable: true  },
  { id: 'assets',     label: 'Assets',         icon: 'Assets',     expandable: false },
  { id: 'crew',       label: 'Crew',           icon: 'Crew',       expandable: false },
  { id: 'lighting',   label: 'Setup',          icon: 'Lightning',  expandable: true  },
  { id: 'moodboard',  label: 'Moodboard',      icon: 'Moodboard',  expandable: true  },
  { id: 'settings',   label: 'Settings',       icon: 'Gear',       expandable: false },
];

const PROJECT_VIEW_IDS = new Set(PROJECT_NAV.map(n => n.id));

function Sidebar({ theme, view, setView, setActiveScene, notifOpen, setNotifOpen }) {
  const dark = theme === 'dark';
  const [projectExpanded, setProjectExpanded] = useSbState(true);
  // track which expandable nav items are open
  const [openDropdowns, setOpenDropdowns] = useSbState({ storyboard: true, lighting: false, moodboard: false });

  const c = {
    bg:          dark ? '#0F1118' : '#EFECE6',
    border:      dark ? '#1C1F2A' : '#DDD9D1',
    text:        dark ? '#C8C0B4' : '#2A2520',
    muted:       dark ? '#4A5270' : '#9A9589',
    activeBg:    dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)',
    activeText:  dark ? '#EDE8E2' : '#1A1714',
    hover:       dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
    sceneHover:  dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
    sceneActive: dark ? 'rgba(195,177,225,0.1)' : 'rgba(195,177,225,0.18)',
    sectionLbl:  dark ? '#363C54' : '#C0BAB0',
    badge:       '#E8B4B8',
    badgeText:   '#3A1518',
    divider:     dark ? '#1A1D28' : '#DDD9D1',
    subIndent:   dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.07)',
    accent:      { storyboard: '#C3B1E1', lighting: '#E8D5B7', moodboard: '#E8B4B8' },
  };

  const toggleDropdown = (id) =>
    setOpenDropdowns(prev => ({ ...prev, [id]: !prev[id] }));

  const handleSceneClick = (navId, sceneId) => {
    setView(navId);
    setActiveScene(sceneId);
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
            {/* Left accent line */}
            <div style={{ marginLeft: 22, paddingLeft: 12, borderLeft: `1.5px solid ${accentColor}22` }}>
              {SB_SCENES.map(sc => {
                const scActive = view === item.id; // highlight when parent is active
                return (
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
                      fontSize: 9, letterSpacing: '0.06em', color: accentColor,
                      flexShrink: 0,
                    }}>{sc.label}</span>
                    <span style={{ fontSize: 11.5, color: c.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {item.id === 'lighting' ? sc.location : sc.title}
                    </span>
                  </div>
                );
              })}
              {/* Add scene / add setup */}
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 8px', borderRadius: 5, cursor: 'pointer',
                  color: c.muted, fontSize: 11, marginTop: 2,
                }}
                onMouseEnter={e => { e.currentTarget.style.color = accentColor; }}
                onMouseLeave={e => { e.currentTarget.style.color = c.muted; }}
              >
                <SbIcons.Plus />
                <span>{item.id === 'storyboard' ? 'Add Scene' : item.id === 'lighting' ? 'New Setup Diagram' : 'New Board'}</span>
              </div>
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

      {/* Project Nav */}
      {PROJECT_VIEW_IDS.has(view) && (
        <div style={{ flex: 1, overflowY: 'auto', borderTop: `1px solid ${c.divider}` }}>
          <div style={{ padding: '10px 10px 4px' }}>
            <div
              onClick={() => setProjectExpanded(e => !e)}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 9px', cursor: 'pointer', marginBottom: 6 }}
            >
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#A8C5A0', flexShrink: 0 }} />
              <span style={{ fontSize: 11, fontWeight: 500, color: c.muted, flex: 1, letterSpacing: '0.02em' }}>
                Parfum No. 7 — TVC
              </span>
              <span style={{ color: c.muted, display: 'flex', transform: projectExpanded ? 'rotate(0)' : 'rotate(-90deg)', transition: 'transform 0.18s' }}>
                <SbIcons.ChevDown />
              </span>
            </div>
            {projectExpanded && PROJECT_NAV.map(renderNavItem)}
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

Object.assign(window, { Sidebar, SbIcons, SB_SCENES });
