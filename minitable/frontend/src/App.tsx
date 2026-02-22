import { useEffect, useState, useRef, useCallback, useMemo, useReducer } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  ColumnDef,
  VisibilityState,
  ColumnOrderState,
  ColumnSizingState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { io } from 'socket.io-client';

// ─── Constants ────────────────────────────────────────────────────────────────

const API_BASE  = 'http://localhost:3001';
const PAGE_SIZE = 150;

// Apple wing emoji PNG (used directly as <img> src)
const WING_URL = 'https://emojigraph.org/media/apple/wing_1fabd.png';

// Per-column widths: 80–120 px based on expected content volume.
// Rule: ≥ header-label width; longest-content cols → 120 px; icon-only → 56 px.
const COLUMN_WIDTHS: Record<string, number> = {
  marcus_error:      56,   // icon indicator only
  tasks_name:       200,   // task names — exception: 200 px
  compose:          120,   // long free-text
  link_to_ad:       120,   // URLs
  attachments:      110,   // "Attachments" header + content
  compose_creator:  120,   // "Compose Creator" = widest header (15 chars)
  compose_done_date:105,   // "Compose Done"
  localization:     105,   // "Localization" header
  ai_services:      100,   // "AI Services"
  impressions:      100,   // "Impressions" header
  test_status:      100,   // "Test Status"
  deadline:          90,   // date YYYY-MM-DD
  purchases:         90,   // numbers
  status:            90,   // pill + short word
  platform:          88,   // short platform names
  product:           88,   // medium
  concept:           85,   // medium
  stage:             80,   // short stage labels
  task_owner:        80,   // person names
  team:              80,   // short team names
  size:              80,   // "Size" — very short
};

const socket = io(API_BASE, { transports: ['websocket'] });

// ─── Field helpers ────────────────────────────────────────────────────────────

const DATE_FIELDS   = new Set(['deadline', 'compose_done_date']);
const NUMBER_FIELDS = new Set(['impressions', 'purchases']);
// Secondary fields rendered in muted grey (#5a5a6a) instead of near-white (#ccc)
const MUTED_FIELDS  = new Set(['link_to_ad', 'purchases', 'compose_done_date', 'attachments', 'impressions']);

// ─── Select field config ──────────────────────────────────────────────────────

type SelectOpt = { value: string; color?: string };
const SELECT_CONFIG: Record<string, { options: SelectOpt[] }> = {
  status: {
    options: [
      { value: 'Draft',       color: '#888'    },
      { value: 'Ready',       color: '#00ff88' },
      { value: 'To Do',       color: '#0088ff' },
      { value: 'In Progress', color: '#ff8800' },
      { value: 'In Approve',  color: '#aa00ff' },
      { value: 'Done',        color: '#00d97e' },
    ],
  },
  platform: {
    options: [
      { value: 'Instagram' }, { value: 'YouTube' }, { value: 'Google' },
      { value: 'TikTok' }, { value: 'Facebook' }, { value: 'LinkedIn' }, { value: 'Twitter' },
    ],
  },
  compose_creator: {
    options: [
      { value: 'Dmytro Petrenko' }, { value: 'Oksana Koval' }, { value: 'Ivan Marchenko' },
      { value: 'Anna Shevchenko' }, { value: 'Oleh Kovalenko' }, { value: 'Maria Bondar' },
    ],
  },
  team: {
    options: [
      { value: 'Internal' }, { value: 'Growth' }, { value: 'Brand' },
      { value: 'Marketing' }, { value: 'Design' },
    ],
  },
  test_status: {
    options: [
      { value: 'Not Tested', color: '#666'    },
      { value: 'Testing',    color: '#ff8800' },
      { value: 'Passed',     color: '#00d97e' },
      { value: 'Failed',     color: '#ff4444' },
      { value: 'Skipped',    color: '#aa00ff' },
    ],
  },
  stage: {
    options: [
      { value: 'Concept',    color: '#888'    },
      { value: 'Production', color: '#0088ff' },
      { value: 'Review',     color: '#ff8800' },
      { value: 'Published',  color: '#00d97e' },
      { value: 'Archived',   color: '#444'    },
    ],
  },
  task_owner: {
    options: [
      { value: 'Dmytro Petrenko' }, { value: 'Oksana Koval' }, { value: 'Ivan Marchenko' },
      { value: 'Anna Shevchenko' }, { value: 'Oleh Kovalenko' }, { value: 'Maria Bondar' },
    ],
  },
  localization: {
    options: [
      { value: 'English' }, { value: 'Ukrainian' }, { value: 'German' },
      { value: 'French' },  { value: 'Spanish' },   { value: 'Polish' },
      { value: 'Italian' }, { value: 'Portuguese' }, { value: 'Dutch' },
      { value: 'Swedish' }, { value: 'Turkish' },
    ],
  },
};

// Demo errors injected client-side
const DEMO_ERRORS: Record<number, string> = {
  2: 'Missing brief & deadline',
  4: 'No assigned owner',
  6: 'Status not set — blocked',
};

// ─── Column config ────────────────────────────────────────────────────────────

const COLUMN_LABELS: Record<string, string> = {
  marcus_error:      'Markus Error',
  tasks_name:        'Task Name',
  compose:           'Compose',
  link_to_ad:        'Link to Ad',
  stage:             'Stage',
  task_owner:        'Owner',
  deadline:          'Deadline',
  team:              'Team',
  ai_services:       'AI Services',
  purchases:         'Purchases',
  platform:          'Platform',
  product:           'Product',
  localization:      'Localization',
  size:              'Size',
  concept:           'Concept',
  status:            'Status',
  compose_creator:   'Compose Creator',
  compose_done_date: 'Compose Done',
  attachments:       'Attachments',
  impressions:       'Impressions',
  test_status:       'Test Status',
};

// Column definitions — each column has its own default width from COLUMN_WIDTHS
const COLUMN_DEFS: ColumnDef<Row>[] = Object.keys(COLUMN_LABELS).map((field) => ({
  id:          field,
  accessorKey: field,
  header:      COLUMN_LABELS[field],
  size:        COLUMN_WIDTHS[field] ?? 90,
  minSize:     50,
  maxSize:     1200,
  enableResizing: true,
}));

const DEFAULT_COLUMN_ORDER = COLUMN_DEFS.map((c) => c.id as string);

// ─── Types ────────────────────────────────────────────────────────────────────

type Row       = Record<string, any> & { id: number };
type Dropdown  = { rowId: number; field: string } | null;
type EditCell  = { rowId: number; field: string } | null;
type ErrorItem = { key: string; label: string; count: number };
type CalAnchor = { rowId: number; field: string; value: string; top: number; left: number } | null;

// ─── Check Engine icons ───────────────────────────────────────────────────────

const CheckEngineIcon = () => (
  <svg width="54" height="36" viewBox="0 0 54 36" fill="none"
    style={{ filter: 'drop-shadow(0 0 5px rgba(255,68,68,0.85)) drop-shadow(0 0 12px rgba(255,68,68,0.4))', flexShrink: 0 }}>
    <g stroke="#ff4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none">
      <rect x="14" y="11" width="26" height="16" rx="2.5"/>
      <path d="M14,15 H6 V21 H14"/><path d="M40,15 H48 V21 H40"/>
      <rect x="18" y="5"  width="7" height="8" rx="1.5"/>
      <rect x="29" y="5"  width="7" height="8" rx="1.5"/>
    </g>
  </svg>
);

// Inline — displayed in Markus Error cells
const RowCheckEngine = () => (
  <svg width="18" height="13" viewBox="0 0 54 36" fill="none"
    style={{ filter: 'drop-shadow(0 0 2.5px rgba(255,68,68,1))', flexShrink: 0 }}>
    <g stroke="#ff4444" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none">
      <rect x="14" y="11" width="26" height="16" rx="2.5"/>
      <path d="M14,15 H6 V21 H14"/><path d="M40,15 H48 V21 H40"/>
      <rect x="18" y="5"  width="7" height="8" rx="1.5"/>
      <rect x="29" y="5"  width="7" height="8" rx="1.5"/>
    </g>
  </svg>
);

// ─── Neon Toggle ──────────────────────────────────────────────────────────────

const NeonToggle = ({ checked, onChange }: { checked: boolean; onChange: () => void }) => (
  <div role="switch" aria-checked={checked}
    onClick={(e) => { e.stopPropagation(); onChange(); }}
    style={{
      width: 40, height: 22, borderRadius: 11, flexShrink: 0,
      backgroundColor: checked ? 'rgba(0,136,255,0.12)' : 'rgba(255,255,255,0.04)',
      border: `1.5px solid ${checked ? 'rgba(0,136,255,0.6)' : '#2a2a35'}`,
      position: 'relative', cursor: 'pointer', transition: 'all 0.25s',
      boxShadow: checked ? '0 0 10px rgba(0,136,255,0.5)' : 'none',
    }}>
    <div style={{
      width: 16, height: 16, borderRadius: '50%',
      backgroundColor: checked ? '#0088ff' : '#333',
      position: 'absolute', top: 2, left: checked ? 20 : 2,
      transition: 'all 0.25s',
      boxShadow: checked ? '0 0 8px #0088ff, 0 0 18px rgba(0,136,255,0.6)' : 'none',
    }}/>
  </div>
);

// ─── Calendar Picker ──────────────────────────────────────────────────────────

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
const DAYS   = ['Mo','Tu','We','Th','Fr','Sa','Su'];

const calBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: '#555', cursor: 'pointer',
  fontSize: 22, padding: '2px 10px', borderRadius: 6, lineHeight: 1,
  fontFamily: 'inherit', transition: 'color 0.15s',
};

type CalendarProps = { value: string; onSelect: (d: string) => void; onClose: () => void };

const CalendarPicker: React.FC<CalendarProps> = ({ value, onSelect, onClose }) => {
  const today  = new Date();
  const initD  = value ? new Date(value + 'T00:00:00') : today;
  const [vY, setVY] = useState(initD.getFullYear());
  const [vM, setVM] = useState(initD.getMonth());
  const [sel, setSel] = useState(value);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, [onClose]);

  const prevM = () => { if (vM === 0) { setVY((y) => y-1); setVM(11); } else setVM((m) => m-1); };
  const nextM = () => { if (vM === 11) { setVY((y) => y+1); setVM(0); } else setVM((m) => m+1); };
  const fmt   = (y: number, m: number, d: number) =>
    `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  const todayStr = fmt(today.getFullYear(), today.getMonth(), today.getDate());

  const handleDay   = (d: number) => { const s = fmt(vY,vM,d); setSel(s); onSelect(s); onClose(); };
  const handleToday = () => { onSelect(todayStr); onClose(); };

  const daysInM = new Date(vY, vM+1, 0).getDate();
  const offset  = (new Date(vY, vM, 1).getDay() + 6) % 7;
  const cells: (number|null)[] = [...Array<null>(offset).fill(null), ...Array.from({length:daysInM},(_,i)=>i+1)];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div onClick={(e)=>e.stopPropagation()} style={{
      position:'absolute', top:'100%', left:0, marginTop:6,
      backgroundColor:'#0b0b15', border:'1px solid rgba(34,207,255,0.2)',
      borderRadius:14, padding:'16px 14px', zIndex:2001, width:268,
      boxShadow:'0 20px 56px rgba(0,0,0,0.88), 0 0 36px rgba(34,207,255,0.07)',
    }}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
        <button style={calBtn} onClick={prevM}
          onMouseEnter={(e)=>{e.currentTarget.style.color='#22cfff';}}
          onMouseLeave={(e)=>{e.currentTarget.style.color='#555';}}>‹</button>
        <span style={{fontSize:14,fontWeight:600,color:'#22cfff',
          textShadow:'0 0 10px rgba(34,207,255,0.8), 0 0 24px rgba(34,207,255,0.4)',letterSpacing:'0.02em'}}>
          {MONTHS[vM]} {vY}
        </span>
        <button style={calBtn} onClick={nextM}
          onMouseEnter={(e)=>{e.currentTarget.style.color='#22cfff';}}
          onMouseLeave={(e)=>{e.currentTarget.style.color='#555';}}>›</button>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',marginBottom:4}}>
        {DAYS.map((d)=>(
          <div key={d} style={{textAlign:'center',fontSize:10,color:'#333',fontWeight:700,letterSpacing:'0.06em',paddingBottom:6}}>{d}</div>
        ))}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:3}}>
        {cells.map((day,i) => {
          if (!day) return <div key={i}/>;
          const s=fmt(vY,vM,day); const isSel=s===sel; const isTod=s===todayStr;
          return (
            <div key={i} onClick={()=>handleDay(day)} style={{
              textAlign:'center',padding:'7px 0',borderRadius:8,cursor:'pointer',
              fontSize:13,fontWeight:isSel?700:400,
              color:isSel?'#fff':isTod?'#22cfff':'#aaa',
              backgroundColor:isSel?'rgba(34,207,255,0.18)':'transparent',
              border:`1px solid ${isSel?'rgba(34,207,255,0.5)':isTod?'rgba(34,207,255,0.15)':'transparent'}`,
              boxShadow:isSel?'0 0 10px rgba(34,207,255,0.4)':'none',transition:'all 0.1s',
            }}
            onMouseEnter={(e)=>{if(!isSel){e.currentTarget.style.backgroundColor='rgba(255,255,255,0.06)';e.currentTarget.style.color='#fff';}}}
            onMouseLeave={(e)=>{if(!isSel){e.currentTarget.style.backgroundColor='transparent';e.currentTarget.style.color=isTod?'#22cfff':'#aaa';}}}>
              {day}
            </div>
          );
        })}
      </div>
      <div style={{marginTop:12,display:'flex',justifyContent:'center'}}>
        <button onClick={handleToday} style={{
          background:'transparent',border:'1px solid rgba(34,207,255,0.2)',
          borderRadius:7,padding:'5px 20px',color:'#22cfff',fontSize:12,cursor:'pointer',fontFamily:'inherit',transition:'all 0.15s',
        }}
        onMouseEnter={(e)=>{e.currentTarget.style.backgroundColor='rgba(34,207,255,0.1)';e.currentTarget.style.boxShadow='0 0 10px rgba(34,207,255,0.3)';}}
        onMouseLeave={(e)=>{e.currentTarget.style.backgroundColor='transparent';e.currentTarget.style.boxShadow='none';}}>
          Today
        </button>
      </div>
    </div>
  );
};

// ─── Mini Logo — Apple 🪽 emoji wings + neon circle ──────────────────────────
//
// Layout:   [LEFT-WING]  [CIRCLE + "Mini"]  [RIGHT-WING]
//
// Both wings are rendered with scaleX(-1) applied to the outer wrapper so the
// emoji faces OUTWARD (feathers toward center, tips spread left/right).
// The inner <img> (.wl / .wr) animates; transform-origin: right center so
// rotation pivots at the INNER edge (nearest the circle) in each wing's space.
// No colour filter — emoji renders in its natural Apple colours.

const MiniLogo: React.FC = () => (
  <div className="logo-hover"
    style={{ display:'inline-flex', alignItems:'center', gap:0, lineHeight:0, flexShrink:0 }}>

    {/* ── Left wing — scaleX(-1) wrapper flips emoji tip to point LEFT.
         transformOrigin:'left center' in img-local space = visual RIGHT edge
         (nearest the circle) after the parent's scaleX(-1) flip.            ── */}
    <div style={{ transform:'scaleX(-1)', display:'flex', flexShrink:0, marginRight:-6 }}>
      <img
        className="wl"
        src={WING_URL}
        width={48} height={44}
        alt=""
        style={{ objectFit:'contain', display:'block', transformOrigin:'left center' }}
      />
    </div>

    {/* ── Circle + "Mini" ── */}
    <svg width="44" height="44" viewBox="0 0 44 44" fill="none" style={{ flexShrink:0 }}>
      <defs>
        <filter id="lgl" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="1.2" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <g filter="url(#lgl)">
        <circle cx="22" cy="22" r="17" stroke="#22cfff" strokeWidth="1.1" fill="none"/>
        <text x="22" y="27" textAnchor="middle"
          fill="#22cfff" fontSize="12.5" fontWeight="300"
          fontFamily="-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif">
          Mini
        </text>
      </g>
    </svg>

    {/* ── Right wing — plain emoji, tip naturally points RIGHT ── */}
    <img
      className="wr"
      src={WING_URL}
      width={48} height={44}
      alt=""
      style={{ objectFit:'contain', display:'block', transformOrigin:'left center', marginLeft:-6 }}
    />
  </div>
);

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {

  const rowsMapRef       = useRef<Map<number, Row>>(new Map());
  const idToIdxRef       = useRef<Map<number, number>>(new Map());
  const fetchedPagesRef  = useRef<Set<number>>(new Set());
  const fetchingPagesRef = useRef<Set<number>>(new Set());

  const [total,       setTotal]       = useState(0);
  const [loadedCount, setLoadedCount] = useState(0);
  const [errors,      setErrors]      = useState<ErrorItem[]>([]);
  const [showErrors,  setShowErrors]  = useState(true);
  const [, forceUpdate] = useReducer((n: number) => n + 1, 0);

  const [editingCell,     setEditingCell]     = useState<EditCell>(null);
  const [editingDropdown, setEditingDropdown] = useState<Dropdown>(null);
  const [calAnchor,       setCalAnchor]       = useState<CalAnchor>(null);
  const [idColWidth,      setIdColWidth]      = useState(48);

  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() => {
    try { return JSON.parse(localStorage.getItem('mt_vis') || '{}'); } catch { return {}; }
  });
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(() => {
    try {
      const s = JSON.parse(localStorage.getItem('mt_ord') || '[]');
      return s.length === DEFAULT_COLUMN_ORDER.length ? s : DEFAULT_COLUMN_ORDER;
    } catch { return DEFAULT_COLUMN_ORDER; }
  });
  const [columnSizing,  setColumnSizing]  = useState<ColumnSizingState>({});
  const [showSettings,  setShowSettings]  = useState(false);
  const [stagedVis,     setStagedVis]     = useState<VisibilityState>({});
  const [stagedOrder,   setStagedOrder]   = useState<ColumnOrderState>([]);
  const [stagedDragged, setStagedDragged] = useState<string | null>(null);

  const tableContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { localStorage.setItem('mt_vis', JSON.stringify(columnVisibility)); }, [columnVisibility]);
  useEffect(() => { localStorage.setItem('mt_ord', JSON.stringify(columnOrder)); }, [columnOrder]);

  useEffect(() => {
    if (!loadedCount) return;
    let dl=0,st=0,tn=0;
    rowsMapRef.current.forEach((r)=>{ if(!r.deadline) dl++; if(!r.status) st++; if(!r.tasks_name) tn++; });
    setErrors([
      { key:'deadline',   label:'No due date',  count:dl },
      { key:'status',     label:'No status',    count:st },
      { key:'tasks_name', label:'No task name', count:tn },
    ].filter((e)=>e.count>0));
  }, [loadedCount]);

  const fetchPage = useCallback(async (page: number) => {
    if (fetchedPagesRef.current.has(page))  return;
    if (fetchingPagesRef.current.has(page)) return;
    fetchingPagesRef.current.add(page);
    try {
      const offset = page * PAGE_SIZE;
      const res    = await fetch(`${API_BASE}/api/rows?limit=${PAGE_SIZE}&offset=${offset}`);
      const json   = await res.json();
      const rows: Row[] = json.data ?? [];
      for (let i=0; i<rows.length; i++) {
        const idx = offset+i, row = rows[i];
        if (DEMO_ERRORS[row.id]) row.marcus_error = DEMO_ERRORS[row.id];
        rowsMapRef.current.set(idx, row);
        idToIdxRef.current.set(row.id, idx);
      }
      fetchedPagesRef.current.add(page);
      fetchingPagesRef.current.delete(page);
      setTotal(json.total ?? 0);
      setLoadedCount(rowsMapRef.current.size);
      forceUpdate();
    } catch { fetchingPagesRef.current.delete(page); }
  }, []);

  useEffect(() => { fetchPage(0); }, [fetchPage]);

  useEffect(() => {
    socket.on('cell-updated', (updatedRow: Row) => {
      const idx = idToIdxRef.current.get(updatedRow.id);
      if (idx !== undefined) { rowsMapRef.current.set(idx, updatedRow); forceUpdate(); }
    });
    return () => { socket.off('cell-updated'); };
  }, []);

  const updateCell = useCallback(async (rowId: number, field: string, value: string) => {
    const idx = idToIdxRef.current.get(rowId);
    if (idx !== undefined) {
      const cur = rowsMapRef.current.get(idx);
      if (cur) rowsMapRef.current.set(idx, { ...cur, [field]: value });
    }
    setEditingCell(null); setEditingDropdown(null);
    try {
      await fetch(`${API_BASE}/api/rows/${rowId}`, {
        method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({[field]:value}),
      });
    } catch { /* optimistic already applied */ }
  }, []);

  const table = useReactTable({
    data:[], columns:COLUMN_DEFS, getCoreRowModel:getCoreRowModel(),
    state:{ columnVisibility, columnOrder, columnSizing },
    onColumnVisibilityChange:setColumnVisibility,
    onColumnOrderChange:setColumnOrder,
    onColumnSizingChange:setColumnSizing,
    enableColumnResizing:true, columnResizeMode:'onChange',
  });

  const visibleColumns = table.getVisibleLeafColumns();
  const allColumns     = table.getAllLeafColumns();
  const headerGroup    = table.getHeaderGroups()[0];

  // ── Explicit table width = ID col + sum of all visible column widths ────────
  // With tableLayout:fixed this forces every column to its exact size.
  const totalTableWidth = useMemo(
    () => idColWidth + visibleColumns.reduce((s, col) => s + col.getSize(), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [idColWidth, visibleColumns.length, columnSizing, columnOrder, columnVisibility]
  );

  const virtualizer = useVirtualizer({
    count:total, getScrollElement:()=>tableContainerRef.current,
    estimateSize:()=>48, overscan:20,
  });
  const virtualRows   = virtualizer.getVirtualItems();
  const totalHeight   = virtualizer.getTotalSize();
  const paddingTop    = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom = virtualRows.length > 0
    ? totalHeight - (virtualRows[virtualRows.length-1].end ?? 0) : 0;

  useEffect(() => {
    if (!virtualRows.length || !total) return;
    const fi=virtualRows[0].index, li=virtualRows[virtualRows.length-1].index;
    const max=Math.ceil(total/PAGE_SIZE)-1;
    const sp=Math.max(0,Math.floor(fi/PAGE_SIZE)-1), ep=Math.min(Math.floor(li/PAGE_SIZE)+2,max);
    for (let p=sp; p<=ep; p++) fetchPage(p);
  }, [virtualRows, total, fetchPage]);

  const openSettings  = useCallback(() => { setStagedVis({...columnVisibility}); setStagedOrder([...columnOrder]); setStagedDragged(null); setShowSettings(true); }, [columnVisibility,columnOrder]);
  const applySettings = useCallback(() => { setColumnVisibility(stagedVis); setColumnOrder(stagedOrder); setShowSettings(false); }, [stagedVis,stagedOrder]);
  const closeSettings = useCallback(() => setShowSettings(false), []);

  const modalDragStart = (id: string) => setStagedDragged(id);
  const modalDragOver  = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (!stagedDragged || stagedDragged===id) return;
    setStagedOrder((prev) => {
      const next=[...prev], from=next.indexOf(stagedDragged), to=next.indexOf(id);
      if (from===-1||to===-1) return prev;
      next.splice(from,1); next.splice(to,0,stagedDragged); return next;
    });
  };
  const modalDragEnd = () => setStagedDragged(null);

  // ── ID column manual resize ───────────────────────────────────────────────
  const onIdResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = idColWidth;
    const onMove = (ev: MouseEvent) => setIdColWidth(Math.max(32, startW + (ev.clientX - startX)));
    const onUp   = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [idColWidth]);

  // ── Cell renderer ─────────────────────────────────────────────────────────
  const renderCell = useMemo(() => (row: Row, field: string) => {
    const value    = row[field] ?? '';
    const textColor = MUTED_FIELDS.has(field) ? '#5a5a6a' : '#ccc';

    // ── Markus Error — icon only; tooltip appears on hover via CSS ──────────
    if (field === 'marcus_error') {
      const errText = row.marcus_error
        ?? (() => {
          const e: string[] = [];
          if (!row.deadline)   e.push('No due date');
          if (!row.status)     e.push('No status');
          if (!row.tasks_name) e.push('No name');
          return e.join(' · ') || null;
        })();

      if (!errText) {
        return (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', opacity:0.12 }}>
            <RowCheckEngine/>
          </div>
        );
      }
      return (
        // .me-wrap triggers .me-tip visibility on :hover (CSS)
        <div className="me-wrap">
          <RowCheckEngine/>
          <div className="me-tip">
            <div style={{ fontSize:11, fontWeight:700, color:'#ff7777', textTransform:'uppercase' as const, letterSpacing:'0.06em', marginBottom:6 }}>
              ⚠ Markus Error
            </div>
            <div style={{ fontSize:12, color:'#bbb', lineHeight:'1.5' }}>{errText}</div>
          </div>
        </div>
      );
    }

    // ── Select dropdown ────────────────────────────────────────────────────
    const selConf = SELECT_CONFIG[field];
    if (selConf) {
      const isOpen = editingDropdown?.rowId===row.id && editingDropdown?.field===field;
      const opt    = selConf.options.find((o)=>o.value===value);
      const color  = opt?.color;
      return (
        <div style={{ position:'relative' }}>
          <div onClick={(e)=>{ e.stopPropagation(); setEditingDropdown(isOpen?null:{rowId:row.id,field}); }}
            style={{ display:'inline-flex',alignItems:'center',gap:6,padding:'5px 8px',borderRadius:6,cursor:'pointer',
              backgroundColor:'rgba(255,255,255,0.04)',border:`1px solid ${isOpen?'rgba(255,255,255,0.15)':'rgba(255,255,255,0.07)'}`,
              whiteSpace:'nowrap' as const, maxWidth:'100%', transition:'border-color 0.15s' }}>
            {color && <div style={{width:6,height:6,borderRadius:'50%',flexShrink:0,backgroundColor:color,boxShadow:`0 0 6px ${color}`}}/>}
            <span style={{fontSize:12,color:color??'#bbb',fontWeight:color?500:400,overflow:'hidden',textOverflow:'ellipsis'}}>{value||'—'}</span>
            <span style={{fontSize:9,color:'#444',marginLeft:2}}>▾</span>
          </div>
          {isOpen && (
            <div style={ST.dropdown}>
              {selConf.options.map((o)=>(
                <div key={o.value} onClick={()=>updateCell(row.id,field,o.value)} style={ST.dropdownItem}
                  onMouseEnter={(e)=>{ e.currentTarget.style.backgroundColor='rgba(255,255,255,0.06)'; }}
                  onMouseLeave={(e)=>{ e.currentTarget.style.backgroundColor='transparent'; }}>
                  {o.color && <div style={{width:7,height:7,borderRadius:'50%',flexShrink:0,backgroundColor:o.color,boxShadow:`0 0 8px ${o.color}`}}/>}
                  <span style={{fontSize:13,color:o.color??'#ccc'}}>{o.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    // ── Date picker — click captures coords; calendar rendered at App level ─
    if (DATE_FIELDS.has(field)) {
      return (
        <div
          onClick={(e) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setCalAnchor({
              rowId: row.id, field,
              value: value ? String(value).slice(0, 10) : '',
              top:  rect.bottom + 6,
              left: Math.min(rect.left, window.innerWidth - 290),
            });
          }}
          style={{...ST.cellText, cursor:'pointer', color: value ? textColor : '#3a3a4a'}}>
          {value ? String(value).slice(0, 10) : '—'}
        </div>
      );
    }

    // ── Text / number ──────────────────────────────────────────────────────
    const isEditing = editingCell?.rowId===row.id && editingCell?.field===field;
    if (isEditing) {
      if (field==='compose') {
        return (
          <textarea defaultValue={value} autoFocus
            onBlur={(e)=>updateCell(row.id,field,e.target.value)}
            onKeyDown={(e)=>{ if(e.key==='Escape') setEditingCell(null); if(e.key==='Enter'&&e.ctrlKey) updateCell(row.id,field,e.currentTarget.value); }}
            style={{...ST.input,resize:'vertical',minWidth:200,minHeight:60}}/>
        );
      }
      return (
        <input type={NUMBER_FIELDS.has(field)?'number':'text'} defaultValue={value} autoFocus
          onBlur={(e)=>updateCell(row.id,field,e.target.value)}
          onKeyDown={(e)=>{ if(e.key==='Enter') updateCell(row.id,field,e.currentTarget.value); if(e.key==='Escape') setEditingCell(null); }}
          style={ST.input}/>
      );
    }
    return (
      <div onClick={()=>setEditingCell({rowId:row.id,field})}
        style={{...ST.cellText, color: textColor}} title={String(value)}>
        {value||'—'}
      </div>
    );
  }, [editingCell, editingDropdown, updateCell, setCalAnchor]);

  const totalErrors = errors.reduce((s,e)=>s+e.count, 0);
  const colCount    = (headerGroup?.headers.length ?? 0) + 1;

  return (
    <>
      <style>{`
        html, body { margin:0; padding:0; height:100%; overflow:hidden; background:#0d0d12; }
        * { box-sizing:border-box; }
        ::-webkit-scrollbar { width:8px; height:8px; }
        ::-webkit-scrollbar-track { background:#0d0d12; }
        ::-webkit-scrollbar-thumb { background:#2a2a35; border-radius:4px; }
        ::-webkit-scrollbar-thumb:hover { background:#3a3a48; }

        @keyframes shimmer {
          0%   { background-position: -400px 0; }
          100% { background-position:  400px 0; }
        }
        .skeleton {
          background: linear-gradient(90deg,#1a1a24 25%,#22222e 50%,#1a1a24 75%);
          background-size:800px 100%; animation:shimmer 1.4s infinite;
          border-radius:4px; height:12px;
        }

        /* Row hover — covers sticky cell too */
        tbody tr:hover > td { background-color:#13131c !important; }

        /* Sticky ID column — solid bg + right gradient shadow */
        .td-sticky {
          position:sticky !important; left:0; z-index:1;
          background-color:#0d0d12;
          box-shadow: inset -1px 0 0 #1a1a24, 14px 0 18px 6px rgba(13,13,18,0.96);
        }
        thead .td-sticky { background-color:#16161e; z-index:11; box-shadow: inset -1px 0 0 #22222a, 14px 0 18px 6px rgba(22,22,30,0.97); }
        tbody tr:hover > td.td-sticky { background-color:#13131c !important; }

        /* ── Wing flap animation ──────────────────────────────────────────────
           Both .wl and .wr use transformOrigin:'left center' in their own
           coordinate space.  For .wl (inside scaleX(-1) wrapper) that local
           "left" is the VISUAL RIGHT (circle side).  For .wr (no wrapper) the
           local "left" IS the visual left (circle side).

           Rotation direction analysis:
             .wr — anchor at visual-left, feathers to the right:
                   rotate(-N) = counter-clockwise → tip goes UP ✓
             .wl — anchor at visual-right (after scaleX flip), feathers to left:
                   rotate(-N) in local space → clockwise visually (scaleX inverts) →
                   clockwise around right anchor → left tip goes UP ✓

           ⟹ SAME keyframe (-N = tips UP) makes both wings symmetric.         */
        @keyframes flap {
          0%,100% { transform:rotate(0deg); }
          35%     { transform:rotate(-26deg); }
          65%     { transform:rotate(9deg); }
        }
        .logo-hover:hover .wl { animation:flap 0.52s ease-in-out infinite; }
        .logo-hover:hover .wr { animation:flap 0.52s ease-in-out infinite; }

        /* Column resize handle */
        .rh { position:absolute; right:0; top:0; height:100%; width:6px; cursor:col-resize; user-select:none; touch-action:none; background:transparent; transition:background 0.15s; }
        .rh:hover  { background:rgba(0,136,255,0.3); }
        .rh.active { background:rgba(0,136,255,0.85); }

        /* ── Markus Error cell: icon only, tooltip on hover ── */
        .me-wrap {
          position:relative; display:flex; align-items:center;
          justify-content:center; cursor:default;
        }
        .me-tip {
          display:none;
          position:absolute;
          bottom:calc(100% + 8px);
          left:50%; transform:translateX(-50%);
          background:#0c0c16;
          border:1px solid rgba(255,68,68,0.3);
          border-radius:10px; padding:12px 16px;
          z-index:3000; min-width:190px; max-width:260px;
          white-space:normal;
          box-shadow:0 10px 28px rgba(0,0,0,0.8), 0 0 14px rgba(255,68,68,0.12);
          pointer-events:none;
        }
        .me-tip::after {
          content:'';
          position:absolute; top:100%; left:50%; transform:translateX(-50%);
          border:6px solid transparent;
          border-top-color:rgba(255,68,68,0.3);
        }
        .me-wrap:hover .me-tip { display:block; }
      `}</style>

      <div style={ST.page}>

        {/* ── Header ── */}
        <header style={ST.header}>
          <div>
            <h1 style={ST.title}>
              <MiniLogo/>
              <span style={{ color:'#fff', fontWeight:700 }}>Table</span>
            </h1>
            <p style={ST.subtitle}>
              {total.toLocaleString()} rows total
              {loadedCount > 0 && loadedCount < total && ` · ${loadedCount.toLocaleString()} loaded`}
            </p>
          </div>
          <div style={{ display:'flex', gap:10, alignItems:'center' }}>
            {totalErrors > 0 && (
              <button onClick={()=>setShowErrors((v)=>!v)} style={{
                ...ST.headerBtn,
                borderColor:     showErrors?'rgba(255,68,68,0.45)':'#22222a',
                color:           showErrors?'#ff7777':'#666',
                backgroundColor: showErrors?'rgba(255,68,68,0.07)':'#16161e',
                boxShadow:       showErrors?'0 0 12px rgba(255,68,68,0.2)':'none',
              }}>⚠️ {totalErrors.toLocaleString()} Errors</button>
            )}
            <button onClick={openSettings} style={ST.headerBtn}
              onMouseEnter={(e)=>{ e.currentTarget.style.backgroundColor='#22222a'; }}
              onMouseLeave={(e)=>{ e.currentTarget.style.backgroundColor='#16161e'; }}>
              ⚙️ Fields
            </button>
          </div>
        </header>

        {/* ── Error panel ── */}
        {showErrors && errors.length > 0 && (
          <div style={ST.errorPanel}>
            <CheckEngineIcon/>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:11,color:'#ff6666',fontWeight:700,textTransform:'uppercase' as const,letterSpacing:'0.1em',marginBottom:8 }}>
                Check Engine &mdash; {loadedCount.toLocaleString()} rows scanned
              </div>
              <div style={{ display:'flex', gap:24, flexWrap:'wrap' as const }}>
                {errors.map((err)=>(
                  <div key={err.key} style={{ display:'flex',alignItems:'center',gap:8,fontSize:13,color:'#888' }}>
                    <div style={{ width:6,height:6,borderRadius:'50%',flexShrink:0,backgroundColor:'#ff4444',boxShadow:'0 0 6px #ff4444' }}/>
                    <span><strong style={{ color:'#ff8888' }}>{err.count.toLocaleString()}</strong>{' rows — '}{err.label}</span>
                  </div>
                ))}
              </div>
            </div>
            <button onClick={()=>setShowErrors(false)}
              style={{ background:'none',border:'none',color:'#444',fontSize:20,cursor:'pointer',padding:4,lineHeight:1 }}
              onMouseEnter={(e)=>{ e.currentTarget.style.color='#aaa'; }}
              onMouseLeave={(e)=>{ e.currentTarget.style.color='#444'; }}>×</button>
          </div>
        )}

        {/* ── Table ── */}
        <div ref={tableContainerRef} style={ST.tableContainer}>
          <table style={{ ...ST.table, width: totalTableWidth }}>
            <colgroup>
              <col style={{ width:idColWidth, minWidth:32 }}/>
              {visibleColumns.map((col)=>(
                <col key={col.id} style={{ width:col.getSize() }}/>
              ))}
            </colgroup>

            <thead style={{ position:'sticky', top:0, zIndex:10 }}>
              <tr>
                <th className="td-sticky" style={{ ...ST.th, width:idColWidth, position:'relative' }}>
                  ID
                  <div className="rh" onMouseDown={onIdResizeStart}/>
                </th>
                {headerGroup?.headers.map((header)=>(
                  <th key={header.id} style={{ ...ST.th, width:header.getSize(), position:'relative' }}>
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {header.column.getCanResize() && (
                      <div className={`rh${header.column.getIsResizing()?' active':''}`}
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}/>
                    )}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {paddingTop>0 && <tr><td colSpan={colCount} style={{ height:paddingTop, padding:0 }}/></tr>}

              {virtualRows.map((vRow)=>{
                const row = rowsMapRef.current.get(vRow.index);
                if (!row) {
                  return (
                    <tr key={vRow.index} style={{ borderBottom:'1px solid #1a1a24', height:48 }}>
                      <td className="td-sticky" style={{ ...ST.td, width:idColWidth, color:'#2a2a35', fontSize:12 }}>{vRow.index+1}</td>
                      {visibleColumns.map((col)=>(
                        <td key={col.id} style={{ ...ST.td, width:col.getSize() }}>
                          <div className="skeleton" style={{ width:`${48+(col.id.length*7)%38}%` }}/>
                        </td>
                      ))}
                    </tr>
                  );
                }
                return (
                  <tr key={vRow.index} style={{ borderBottom:'1px solid #1a1a24', height:48 }}>
                    <td className="td-sticky" style={{ ...ST.td, width:idColWidth, color:'#444', fontSize:12 }}>{row.id}</td>
                    {visibleColumns.map((col)=>{
                      const dropOpen = editingDropdown?.rowId===row.id && editingDropdown?.field===col.id;
                      const isMarkus = col.id === 'marcus_error';
                      return (
                        <td key={col.id} style={{
                          ...ST.td, width:col.getSize(),
                          overflow:(dropOpen||isMarkus) ? 'visible' : 'hidden',
                          textAlign: isMarkus ? 'center' : 'left',
                        }}>
                          {renderCell(row, col.id)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}

              {paddingBottom>0 && <tr><td colSpan={colCount} style={{ height:paddingBottom, padding:0 }}/></tr>}
            </tbody>
          </table>
        </div>

        {/* ── Fields modal ── */}
        {showSettings && (
          <>
            <div onClick={closeSettings} style={ST.overlay}/>
            <div style={ST.modal}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                <h2 style={{ margin:0, fontSize:17, fontWeight:700, letterSpacing:'-0.3px' }}>Configure Fields</h2>
                <button onClick={closeSettings}
                  style={{ background:'none',border:'none',color:'#555',fontSize:24,cursor:'pointer',lineHeight:1 }}
                  onMouseEnter={(e)=>{ e.currentTarget.style.color='#ccc'; }}
                  onMouseLeave={(e)=>{ e.currentTarget.style.color='#555'; }}>×</button>
              </div>
              <p style={{ margin:'0 0 14px', fontSize:12, color:'#444' }}>Drag ⠿ to reorder · toggle to show/hide</p>
              <div style={{ display:'flex', flexDirection:'column', gap:2, maxHeight:'52vh', overflowY:'auto' }}>
                {stagedOrder.map((colId)=>{
                  const isVisible = stagedVis[colId] !== false;
                  return (
                    <div key={colId} draggable
                      onDragStart={()=>modalDragStart(colId)}
                      onDragOver={(e)=>modalDragOver(e,colId)}
                      onDragEnd={modalDragEnd}
                      style={{
                        display:'flex', alignItems:'center', gap:12, padding:'9px 10px', borderRadius:8, cursor:'grab',
                        backgroundColor:stagedDragged===colId?'rgba(0,136,255,0.07)':'transparent',
                        border:`1px solid ${stagedDragged===colId?'rgba(0,136,255,0.25)':'transparent'}`,
                        opacity:stagedDragged===colId?0.5:1, transition:'all 0.15s',
                      }}
                      onMouseEnter={(e)=>{ if(stagedDragged!==colId) e.currentTarget.style.backgroundColor='rgba(255,255,255,0.025)'; }}
                      onMouseLeave={(e)=>{ if(stagedDragged!==colId) e.currentTarget.style.backgroundColor='transparent'; }}>
                      <span style={{ color:'#2a2a35', fontSize:16, userSelect:'none' as const, flexShrink:0 }}>⠿</span>
                      <span style={{ flex:1, fontSize:14, color:isVisible?'#ccc':'#3a3a4a', transition:'color 0.2s', userSelect:'none' as const }}>
                        {COLUMN_LABELS[colId]??colId}
                      </span>
                      <NeonToggle checked={isVisible} onChange={()=>setStagedVis((prev)=>({...prev,[colId]:!isVisible}))}/>
                    </div>
                  );
                })}
              </div>
              <div style={{ display:'flex', gap:10, marginTop:20 }}>
                <button onClick={applySettings} style={ST.btnPrimary}
                  onMouseEnter={(e)=>{ e.currentTarget.style.boxShadow='0 0 20px rgba(0,136,255,0.55)'; }}
                  onMouseLeave={(e)=>{ e.currentTarget.style.boxShadow='0 0 10px rgba(0,136,255,0.25)'; }}>Apply</button>
                <button onClick={closeSettings} style={ST.btnSecondary}
                  onMouseEnter={(e)=>{ e.currentTarget.style.borderColor='#444'; e.currentTarget.style.color='#aaa'; }}
                  onMouseLeave={(e)=>{ e.currentTarget.style.borderColor='#22222a'; e.currentTarget.style.color='#555'; }}>Close</button>
              </div>
            </div>
          </>
        )}

        {editingDropdown !== null && (
          <div onClick={()=>setEditingDropdown(null)} style={{ position:'fixed',inset:0,zIndex:997 }}/>
        )}
      </div>

      {/* ── Calendar picker — fixed overlay, never clipped by table scroll ── */}
      {calAnchor && (
        <>
          <div onClick={()=>setCalAnchor(null)}
            style={{ position:'fixed', inset:0, zIndex:2000 }}/>
          <div style={{ position:'fixed', top: calAnchor.top, left: calAnchor.left, zIndex:2001 }}>
            <CalendarPicker
              value={calAnchor.value}
              onSelect={(d) => { updateCell(calAnchor.rowId, calAnchor.field, d); setCalAnchor(null); }}
              onClose={() => setCalAnchor(null)}
            />
          </div>
        </>
      )}
    </>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const ST = {
  page: {
    height:'100vh', overflow:'hidden', backgroundColor:'#0d0d12', color:'#fff',
    fontFamily:'-apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif',
    padding:'22px 32px 16px', display:'flex' as const, flexDirection:'column' as const, gap:14,
  },
  header: { display:'flex' as const, justifyContent:'space-between' as const, alignItems:'flex-start' as const, flexShrink:0 },
  title:  { margin:0, fontSize:28, letterSpacing:'-0.5px', display:'flex' as const, alignItems:'center' as const, gap:10 },
  subtitle: { margin:'5px 0 0', color:'#555', fontSize:14 },
  headerBtn: {
    padding:'9px 18px', backgroundColor:'#16161e', border:'1px solid #22222a',
    borderRadius:8, color:'#aaa', fontSize:14, cursor:'pointer',
    display:'flex' as const, alignItems:'center' as const, gap:8, transition:'all 0.15s', fontFamily:'inherit',
  },
  errorPanel: {
    display:'flex' as const, alignItems:'center' as const, gap:20, padding:'14px 20px', flexShrink:0,
    backgroundColor:'rgba(255,68,68,0.05)', border:'1px solid rgba(255,68,68,0.18)',
    borderRadius:10, boxShadow:'0 0 24px rgba(255,68,68,0.07)',
  },
  tableContainer: {
    flex:1, minHeight:0, overflowY:'auto' as const, overflowX:'auto' as const,
    border:'1px solid #1a1a24', borderRadius:10, backgroundColor:'#0d0d12',
  },
  table: {
    borderCollapse:'collapse' as const,
    // width is set dynamically (totalTableWidth) — forces fixed column sizes
    tableLayout:'fixed' as const,
  },
  th: {
    padding:'12px 8px', textAlign:'left' as const, fontSize:10, fontWeight:600, color:'#555',
    borderRight:'1px solid #1a1a24', whiteSpace:'nowrap' as const, letterSpacing:'0.06em',
    textTransform:'uppercase' as const, overflow:'hidden' as const,
    backgroundColor:'#16161e', userSelect:'none' as const, borderBottom:'2px solid #22222a',
  },
  td: {
    padding:'8px 8px', borderRight:'1px solid #1a1a24',
    overflow:'hidden' as const, verticalAlign:'middle' as const, height:48,
  },
  cellText: {
    cursor:'text', overflow:'hidden' as const, textOverflow:'ellipsis' as const,
    whiteSpace:'nowrap' as const, color:'#ccc', fontSize:13, lineHeight:'1.4',
  },
  input: {
    width:'100%', padding:'6px 8px', backgroundColor:'#111118',
    border:'1px solid #0088ff', borderRadius:5, color:'#fff',
    fontSize:13, outline:'none', fontFamily:'inherit',
  },
  dropdown: {
    position:'absolute' as const, top:'100%', left:0, marginTop:4,
    backgroundColor:'#0f0f18', backdropFilter:'blur(12px)',
    borderRadius:8, border:'1px solid #22222a', padding:4, zIndex:1000, minWidth:150,
    boxShadow:'0 14px 44px rgba(0,0,0,0.75)',
  },
  dropdownItem: {
    padding:'8px 12px', cursor:'pointer', borderRadius:6,
    display:'flex' as const, alignItems:'center' as const, gap:10,
    backgroundColor:'transparent', fontSize:13, color:'#ccc', transition:'background-color 0.1s',
  },
  overlay: { position:'fixed' as const, inset:0, backgroundColor:'rgba(0,0,0,0.55)', zIndex:1999 },
  modal: {
    position:'fixed' as const, top:'50%', left:'50%', transform:'translate(-50%,-50%)',
    backgroundColor:'#0f0f18', border:'1px solid #1e1e2a', borderRadius:14, padding:24,
    zIndex:2000, width:400, maxHeight:'82vh', overflowY:'auto' as const,
    boxShadow:'0 24px 64px rgba(0,0,0,0.85)',
  },
  btnPrimary: {
    flex:1, padding:'11px 0', backgroundColor:'rgba(0,136,255,0.1)',
    border:'1px solid rgba(0,136,255,0.5)', borderRadius:9, color:'#55aaff',
    fontSize:14, fontWeight:600, cursor:'pointer', fontFamily:'inherit',
    transition:'box-shadow 0.2s', boxShadow:'0 0 10px rgba(0,136,255,0.25)',
  },
  btnSecondary: {
    flex:1, padding:'11px 0', backgroundColor:'transparent', border:'1px solid #22222a',
    borderRadius:9, color:'#555', fontSize:14, cursor:'pointer', fontFamily:'inherit', transition:'all 0.15s',
  },
} as const;
