
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
