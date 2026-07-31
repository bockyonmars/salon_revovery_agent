# Shared layouts

## Application shell

- Source: `src/App.tsx`
- Fixed 248px plum sidebar, sticky 68px topbar, and responsive main content region.

```tsx
return (
  <div className="app-shell">
    <Sidebar active={activeView} approvals={approvals.length} onNavigate={setActiveView} />
    <main className="main-region">
      <Topbar title={activeView} approvalCount={approvals.length} onNew={() => setShowNewAction(true)} onApprovals={() => setActiveView('Approvals')} />
      <div className="mobile-route-strip" aria-label="Mobile navigation">
        {[...navItems, ...controlItems].map(({ label }) => <button key={label} className={activeView === label ? 'active' : ''} onClick={() => setActiveView(label)}>{label}</button>)}
      </div>
      {/* active operational screen */}
    </main>
  </div>
)
```

## Sidebar

- Source: `src/App.tsx`
- Primary product navigation, controls group, approval count, and operator identity.

```tsx
function Sidebar({ active, approvals, onNavigate }: { active: string; approvals: number; onNavigate: (label: string) => void }) {
  return (
    <aside className="sidebar">
      <Brand />
      <nav aria-label="Primary navigation">
        {navItems.map(({ label, icon: Icon }) => <button key={label} className={active === label ? 'active' : ''} onClick={() => onNavigate(label)}><Icon weight={active === label ? 'fill' : 'bold'} /><span>{label}</span></button>)}
        <p className="nav-label">Controls</p>
        {controlItems.map(({ label, icon: Icon }) => <button key={label} className={active === label ? 'active' : ''} onClick={() => onNavigate(label)}><Icon weight={active === label ? 'fill' : 'bold'} /><span>{label}</span>{label === 'Approvals' && approvals > 0 && <b className="nav-count">{approvals}</b>}</button>)}
      </nav>
      <button className="operator"><span className="operator-avatar">JD</span><span><strong>Julian de Villiers</strong><small>Mayfair Flagship</small></span><GearSix /></button>
    </aside>
  )
}
```

## Topbar

- Source: `src/App.tsx`
- Current screen, location, reporting period, approvals, and primary recovery action.

```tsx
<header className="topbar">
  <div className="topbar-title"><h1>{title}</h1><span className="topbar-divider" /><button className="location-button"><MapPin weight="fill" /> Mayfair Flagship <CaretDown /></button></div>
  <div className="topbar-actions"><label className="range-control"><CalendarBlank /><select><option>Last 30 days</option></select></label><button className="icon-button notification-button"><Bell weight="bold" /></button><button className="primary-button new-action"><Plus weight="bold" /> New recovery</button></div>
</header>
```
