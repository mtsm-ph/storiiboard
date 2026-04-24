
// storiiboard-notifications.jsx
// Sliding notifications panel

const { useState: useNotifState } = React;

const NOTIFS = [
  {
    id: 'n1', type: 'comment', read: false,
    avatar: 'JL', name: 'James Lau',
    text: 'Left a comment on Shot 04 — "Mirror Scene"',
    time: '2m ago', accent: '#C3B1E1', link: 'f01',
  },
  {
    id: 'n2', type: 'approval', read: false,
    avatar: 'TH', name: 'Tom Hirsch',
    text: 'Requesting approval: changed Location on SC 07 from "Business Class" to "Economy Plus"',
    time: '18m ago', accent: '#E8D5B7', link: 'f02',
  },
  {
    id: 'n3', type: 'status', read: false,
    avatar: 'SR', name: 'Sofia Reyes',
    text: 'Shot 04 status changed to Approved',
    time: '1h ago', accent: '#A8C5A0', link: 'f04',
  },
  {
    id: 'n4', type: 'plugin', read: false,
    avatar: '▶', name: 'Editor Sync',
    text: 'New editor cut pushed to SC 12 — "The Ceremony" by editor@studio.com',
    time: '2h ago', accent: '#E8B4B8', link: 'f03',
  },
  {
    id: 'n5', type: 'asset', read: true,
    avatar: 'PN', name: 'Priya Nair',
    text: 'Linked "Desert Location Scout" to SC 12 — The Ceremony',
    time: '3h ago', accent: '#A8C5A0', link: 'f03',
  },
  {
    id: 'n6', type: 'approved', read: true,
    avatar: 'SR', name: 'Sofia Reyes',
    text: 'Your lens change on Shot 01 has been approved',
    time: '5h ago', accent: '#C3B1E1', link: 'f01',
  },
  {
    id: 'n7', type: 'invite', read: true,
    avatar: 'EK', name: 'Elena Kovacs',
    text: 'Accepted invite and joined Parfum No. 7 — TVC as Colorist',
    time: 'Yesterday', accent: '#A8C5A0', link: null,
  },
  {
    id: 'n8', type: 'duplicate', read: true,
    avatar: '⚠', name: 'System',
    text: 'Duplicate name detected: two crew members named "Tom" — please verify roles',
    time: 'Yesterday', accent: '#E8C07A', link: null,
  },
];

const TYPE_LABELS = {
  comment:  'Comment',
  approval: 'Approval Request',
  status:   'Status Change',
  plugin:   'Plugin Update',
  asset:    'Asset Linked',
  approved: 'Approved',
  invite:   'Invite Accepted',
  duplicate:'Warning',
};

// Scene → frame id mapping for live filter
const SCENE_FRAME_MAP = { sc04:['f01'], sc07:['f02'], sc12:['f03'], sc15:['f04'], sc18:['f05'], sc21:['f06'] };

function NotificationsPanel({ theme, onClose, liveNotif, activeScene }) {
  const dark = theme === 'dark';
  const [notifs, setNotifs] = useNotifState(NOTIFS);
  const [filter, setFilter] = useNotifState('all');

  const colors = {
    bg:     dark ? '#141820' : '#F0EDE7',
    border: dark ? '#1C1F2A' : '#DDD9D1',
    text:   dark ? '#C8C0B4' : '#2A2520',
    muted:  dark ? '#4A5270' : '#9A9589',
    itemBg: dark ? '#1A1E2B' : '#FAFAF8',
    itemBgUnread: dark ? '#1C2035' : '#FFFFFF',
    itemBorder: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)',
    hdr:    dark ? '#111318' : '#EEEAE4',
    chip:   dark ? '#1C1F2A' : '#E2DED8',
    chipTx: dark ? '#6B7399' : '#7A7469',
    chipActive: dark ? 'rgba(195,177,225,0.15)' : 'rgba(195,177,225,0.25)',
    chipActiveTx: dark ? '#C3B1E1' : '#7A6AAE',
  };

  const markAllRead = () => setNotifs(prev => prev.map(n => ({ ...n, read: true })));
  const markRead = (id) => setNotifs(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));

  // Live filter: when 'live' tab selected or liveNotif prop active, filter to active scene frames
  const liveFrameIds = (filter === 'live' || liveNotif) && activeScene ? (SCENE_FRAME_MAP[activeScene] || []) : null;
  const baseFiltered = filter === 'unread' ? notifs.filter(n => !n.read) : notifs;
  const filtered = liveFrameIds ? baseFiltered.filter(n => !n.link || liveFrameIds.includes(n.link)) : baseFiltered;
  const unreadCount = notifs.filter(n => !n.read).length;

  const FILTER_OPTS = [
    { id: 'all',    label: 'All' },
    { id: 'unread', label: `Unread (${unreadCount})` },
    { id: 'live',   label: 'Live', accent: '#A8C5A0' },
  ];

  return (
    <>
      {/* Invisible click-away */}
      <div
        onClick={onClose}
        style={{ position:'fixed', inset:0, zIndex:200 }}
      />

      {/* Floating bubble panel */}
      <div style={{
        position: 'fixed', top: 60, right: 16, zIndex: 201,
        width: 380, maxHeight: 'calc(100vh - 80px)',
        background: colors.bg, borderRadius: 16,
        border: `1px solid ${colors.border}`,
        display: 'flex', flexDirection: 'column',
        fontFamily: "'DM Sans', sans-serif",
        boxShadow: '0 16px 48px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.2)',
        animation: 'bubblePop 0.2s cubic-bezier(0.34,1.56,0.64,1)',
        transformOrigin: 'top right',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 18px 14px', background: colors.hdr,
          borderBottom: `1px solid ${colors.border}`, flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: colors.text, flex: 1 }}>
              Notifications
              {liveNotif && activeScene && (
                <span style={{ marginLeft:8, fontSize:9, fontFamily:'monospace', letterSpacing:'0.08em', color:'#A8C5A0', background:dark?'rgba(168,197,160,0.12)':'rgba(168,197,160,0.18)', padding:'2px 7px', borderRadius:4, verticalAlign:'middle' }}>
                  LIVE · {activeScene.toUpperCase().replace('sc','SC ')}
                </span>
              )}
            </div>
            {unreadCount > 0 && (
              <div
                onClick={markAllRead}
                style={{
                  fontSize: 10.5, color: colors.muted, cursor: 'pointer',
                  marginRight: 12, textDecoration: 'underline',
                }}
              >Mark all read</div>
            )}
            <div
              onClick={onClose}
              style={{
                width: 26, height: 26, borderRadius: '50%',
                background: colors.border, display: 'flex', alignItems: 'center',
                justifyContent: 'center', cursor: 'pointer', fontSize: 14, color: colors.muted,
              }}
            >×</div>
          </div>
          {/* Filter tabs */}
          <div style={{ display: 'flex', gap: 5 }}>
            {FILTER_OPTS.map(opt => {
              const active = filter === opt.id;
              const isLive = opt.id === 'live';
              return (
                <div
                  key={opt.id}
                  onClick={() => setFilter(opt.id)}
                  style={{
                    padding: '4px 11px', borderRadius: 16, cursor: 'pointer',
                    fontSize: 11, fontWeight: active ? 600 : 400, userSelect: 'none',
                    display: 'flex', alignItems: 'center', gap: 5,
                    background: active
                      ? (isLive ? (dark?'rgba(168,197,160,0.18)':'rgba(168,197,160,0.25)') : colors.chipActive)
                      : colors.chip,
                    color: active
                      ? (isLive ? '#A8C5A0' : colors.chipActiveTx)
                      : colors.chipTx,
                    border: active && isLive ? '1px solid rgba(168,197,160,0.4)' : '1px solid transparent',
                  }}
                >
                  {isLive && (
                    <div style={{
                      width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                      background: active ? '#A8C5A0' : colors.chipTx,
                      animation: active ? 'pulse 1.4s ease-in-out infinite' : 'none',
                    }} />
                  )}
                  {opt.label}
                </div>
              );
            })}
            {/* Mute toggle */}
            <div style={{
              marginLeft: 'auto', padding: '4px 11px', borderRadius: 16, cursor: 'pointer',
              fontSize: 11, background: colors.chip, color: colors.chipTx, userSelect: 'none',
            }}>Mute project</div>
          </div>
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 10px' }}>
          {filtered.map(n => (
            <div
              key={n.id}
              onClick={() => markRead(n.id)}
              style={{
                display: 'flex', gap: 11, padding: '11px 10px 11px',
                borderRadius: 9, marginBottom: 4, cursor: 'pointer',
                background: n.read ? colors.itemBg : colors.itemBgUnread,
                border: `1px solid ${n.read ? 'transparent' : colors.itemBorder}`,
                position: 'relative', transition: 'background 0.14s',
              }}
            >
              {/* Unread dot */}
              {!n.read && (
                <div style={{
                  position: 'absolute', top: 12, right: 10,
                  width: 6, height: 6, borderRadius: '50%', background: n.accent,
                }} />
              )}

              {/* Avatar */}
              <div style={{
                width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                background: n.type === 'plugin'
                  ? 'rgba(232,180,184,0.15)'
                  : n.type === 'duplicate'
                  ? 'rgba(232,192,122,0.15)'
                  : `${n.accent}22`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: n.avatar.length > 2 ? 13 : 11, fontWeight: 700,
                color: n.accent,
                border: `1px solid ${n.accent}33`,
              }}>{n.avatar}</div>

              {/* Content */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', marginBottom: 3 }}>
                  <span style={{
                    fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.08em', color: n.accent, fontFamily: 'monospace',
                  }}>{TYPE_LABELS[n.type]}</span>
                </div>
                <div style={{
                  fontSize: 12, color: colors.text, lineHeight: 1.45,
                  marginBottom: 5, textWrap: 'pretty',
                  opacity: n.read ? 0.7 : 1,
                }}>{n.text}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: colors.muted }}>{n.name}</span>
                  <span style={{ fontSize: 10, color: colors.muted, opacity: 0.6 }}>·</span>
                  <span style={{ fontSize: 10, color: colors.muted, opacity: 0.6 }}>{n.time}</span>
                  {n.link && (
                    <>
                      <span style={{ fontSize: 10, color: colors.muted, opacity: 0.6 }}>·</span>
                      <span style={{ fontSize: 10, color: n.accent, cursor: 'pointer' }}>View →</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{
              textAlign: 'center', padding: '40px 20px',
              color: colors.muted, fontSize: 13,
            }}>
              {liveNotif && activeScene ? `No notifications for ${activeScene.toUpperCase().replace('sc','SC ')}` : 'All caught up'}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes bubblePop {
          from { transform: scale(0.88) translateY(-8px); opacity: 0; }
          to   { transform: scale(1) translateY(0); opacity: 1; }
        }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.35} }
      `}</style>
    </>
  );
}

Object.assign(window, { NotificationsPanel });
