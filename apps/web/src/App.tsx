import { useMemo, useState } from 'react';
import { Layer, Line, Rect, Stage, Text, Group } from 'react-konva';
import type { TemplateDocument, TemplateElement } from './types';

const MM_TO_PX = 4;
const A4 = { w: 210, h: 297 };
const API = (import.meta.env.VITE_TEMPLATE_API_URL as string | undefined) || '';
const withApi = (path: string) => `${API}${path}`;
const authHeaders = (base: Record<string, string> = {}): HeadersInit => {
  const token = localStorage.getItem('token');
  const headers: Record<string, string> = { ...base };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
};

const blankTemplate = (): TemplateDocument => ({
  templateName: 'Neues-Template',
  version: '1.0.0',
  page: { format: 'A4', orientation: 'portrait', widthMm: A4.w, heightMm: A4.h },
  styles: { defaultFont: 'Helvetica' },
  fields: [],
  elements: []
});

const id = () => Math.random().toString(36).slice(2, 9);
const mm2px = (mm: number) => mm * MM_TO_PX;
const px2mm = (px: number) => Number((px / MM_TO_PX).toFixed(2));

const newElement = (type: TemplateElement['type']): TemplateElement => ({
  id: id(),
  type,
  x: 10,
  y: 10,
  w: type === 'line' ? 40 : type === 'checkbox' ? 6 : 40,
  h: type === 'multiline' || type === 'table' ? 20 : type === 'line' ? 0.4 : 10,
  text: 'Text',
  fontSize: 10,
  align: 'left',
  stroke: '#111827',
  lineHeight: 1.2,
  padding: 1
});

function intersects(a: TemplateElement, b: TemplateElement) {
  if (a.type === 'line' || b.type === 'line') return false;
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

const belegnummerRegex = /^ICSL1-\d{8}-\d{6}$/;
const generateBelegnummer = () => {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `ICSL1-${ymd}-000001`;
};

export function App() {
  const [template, setTemplate] = useState<TemplateDocument>(blankTemplate());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [snap, setSnap] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [previewData, setPreviewData] = useState<Record<string, string>>({ belegnummer: generateBelegnummer(), datum: new Date().toISOString().slice(0, 10) });

  const selected = template.elements.find((e) => e.id === selectedId);
  const collisions = useMemo(() => {
    const pairs: string[] = [];
    for (let i = 0; i < template.elements.length; i++) {
      for (let j = i + 1; j < template.elements.length; j++) {
        if (intersects(template.elements[i], template.elements[j])) pairs.push(`${template.elements[i].id}/${template.elements[j].id}`);
      }
    }
    return pairs;
  }, [template.elements]);

  const updateElement = (patch: Partial<TemplateElement>) => {
    if (!selectedId) return;
    setTemplate((t) => ({ ...t, elements: t.elements.map((e) => (e.id === selectedId ? { ...e, ...patch } : e)) }));
  };

  const addElement = (type: TemplateElement['type']) => setTemplate((t) => ({ ...t, elements: [...t.elements, newElement(type)] }));

  const aligned = (dir: string) => {
    if (!selected) return;
    const e = selected;
    if (dir === 'left') updateElement({ x: 0 });
    if (dir === 'center') updateElement({ x: (A4.w - e.w) / 2 });
    if (dir === 'right') updateElement({ x: A4.w - e.w });
    if (dir === 'top') updateElement({ y: 0 });
    if (dir === 'middle') updateElement({ y: (A4.h - e.h) / 2 });
    if (dir === 'bottom') updateElement({ y: A4.h - e.h });
  };

  const reorder = (front: boolean) => {
    if (!selectedId) return;
    setTemplate((t) => {
      const idx = t.elements.findIndex((e) => e.id === selectedId);
      if (idx < 0) return t;
      const copy = [...t.elements];
      const [item] = copy.splice(idx, 1);
      if (front) copy.push(item); else copy.unshift(item);
      return { ...t, elements: copy };
    });
  };

  const save = async () => {
    await fetch(withApi(`/templates/${template.templateName}`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(template) });
    alert('Gespeichert');
  };

  const load = async (name: string) => {
    const res = await fetch(withApi(`/templates/${name}`));
    if (res.ok) setTemplate(await res.json());
  };

  const exportDoc = async (type: 'pdf' | 'png') => {
    const res = await fetch(withApi(`/export/${type}`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ template, data: previewData }) });
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${template.templateName}.${type}`;
    a.click();
  };

  const renderedText = (e: TemplateElement) => (e.fieldId ? (previewData[e.fieldId] ?? `{{${e.fieldId}}}`) : e.text || '');

  return <div className="p-4 grid grid-cols-[220px_1fr_320px] gap-4 h-screen overflow-hidden">
    <aside className="bg-white p-3 rounded shadow space-y-2 overflow-auto">
      <h2 className="font-semibold">Werkzeuge</h2>
      {(['text','multiline','line','rect','image','barcode','checkbox','table'] as const).map((t) => <button key={t} className="w-full border p-1 rounded" onClick={() => addElement(t)}>{t}</button>)}
      <hr/>
      <label>Template Name<input className="w-full border" value={template.templateName} onChange={(e) => setTemplate({ ...template, templateName: e.target.value })}/></label>
      <button className="w-full border p-1" onClick={save}>Auf Server speichern</button>
      <button className="w-full border p-1" onClick={async () => {
        const list = await (await fetch(withApi('/templates'))).json();
        const pick = prompt(`Vorlagen: ${list.join(', ')}`);
        if (pick) load(pick);
      }}>Laden</button>
      <button className="w-full border p-1" onClick={() => navigator.clipboard.writeText(JSON.stringify(template, null, 2))}>JSON kopieren</button>

      <button className="w-full border p-1" onClick={async () => {
        const res = await fetch('/api/receipt-template', { headers: authHeaders() });
        if (!res.ok) return alert('Kein aktives Portal-Belegtemplate gefunden');
        const doc = await res.json();
        setTemplate(doc);
      }}>Portal-Beleg laden</button>
      <button className="w-full border p-1" onClick={async () => {
        const res = await fetch('/api/receipt-template', {
          method: 'PUT',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(template)
        });
        if (!res.ok) return alert('Speichern im Portal fehlgeschlagen');
        alert('Portal-Belegtemplate aktualisiert');
      }}>Als Portal-Beleg speichern</button>
      <button className="w-full border p-1" onClick={() => {
        const txt = prompt('Template JSON einfügen');
        if (txt) setTemplate(JSON.parse(txt));
      }}>JSON import</button>
      <hr/>
      <label>Zoom {Math.round(zoom * 100)}%
        <input type="range" min={0.5} max={2} step={0.1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
      </label>
      <label className="block"><input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)}/> Grid</label>
      <label className="block"><input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)}/> Snap</label>
      <p className={`${collisions.length ? 'text-red-600' : 'text-green-700'}`}>Collision Check: {collisions.length ? `${collisions.length} Überlappungen` : 'Keine Überlappung'}</p>
      <button className="w-full border p-1" onClick={() => exportDoc('pdf')}>PDF Export</button>
      <button className="w-full border p-1" onClick={() => exportDoc('png')}>PNG Export</button>
      <hr/>
      <h3 className="font-medium">Preview-Daten</h3>
      {['belegnummer','datum','frachtfuehrer','kennzeichen'].map((f) => <label key={f} className="block">{f}<input className="w-full border" value={previewData[f] || ''} onChange={(e) => setPreviewData({ ...previewData, [f]: e.target.value })}/></label>)}
      <small className={belegnummerRegex.test(previewData.belegnummer || '') ? 'text-green-700' : 'text-red-600'}>Format Belegnummer: ICSL1-YYYYMMDD-000001</small>
    </aside>

    <main className="bg-slate-200 rounded p-4 overflow-auto" onClick={() => setSelectedId(null)}>
      <div style={{ width: mm2px(A4.w) * zoom, height: mm2px(A4.h) * zoom }} className="bg-white shadow mx-auto">
        <Stage width={mm2px(A4.w) * zoom} height={mm2px(A4.h) * zoom} scale={{ x: zoom, y: zoom }}>
          <Layer>
            {showGrid && Array.from({ length: A4.w + 1 }).map((_, i) => <Line key={`v${i}`} points={[mm2px(i), 0, mm2px(i), mm2px(A4.h)]} stroke={i % 10 === 0 ? '#d1d5db' : '#e5e7eb'} strokeWidth={0.2} />)}
            {showGrid && Array.from({ length: A4.h + 1 }).map((_, i) => <Line key={`h${i}`} points={[0, mm2px(i), mm2px(A4.w), mm2px(i)]} stroke={i % 10 === 0 ? '#d1d5db' : '#e5e7eb'} strokeWidth={0.2} />)}
            <Line points={[mm2px(A4.w/2),0,mm2px(A4.w/2),mm2px(A4.h)]} stroke="#bfdbfe" dash={[4,4]} />
            <Line points={[0,mm2px(A4.h/2),mm2px(A4.w),mm2px(A4.h/2)]} stroke="#bfdbfe" dash={[4,4]} />
          </Layer>
          <Layer>
            {template.elements.map((e) => <Group key={e.id} x={mm2px(e.x)} y={mm2px(e.y)} draggable onClick={(evt) => { evt.cancelBubble = true; setSelectedId(e.id); }} onDragEnd={(evt) => {
              const nx = px2mm(evt.target.x());
              const ny = px2mm(evt.target.y());
              const snapX = snap ? Math.round(nx) : nx;
              const snapY = snap ? Math.round(ny) : ny;
              setTemplate((t) => ({ ...t, elements: t.elements.map((it) => it.id === e.id ? { ...it, x: snapX, y: snapY } : it) }));
            }}>
              {e.type === 'rect' && <Rect width={mm2px(e.w)} height={mm2px(e.h)} stroke={e.stroke} strokeWidth={1} />}
              {e.type === 'line' && <Line points={[0,0,mm2px(e.w),0]} stroke={e.stroke} strokeWidth={1} />}
              {(e.type === 'text' || e.type === 'multiline' || e.type === 'barcode') && <Text text={e.type === 'barcode' ? `||| ${renderedText(e)} |||` : renderedText(e)} width={mm2px(e.w)} height={mm2px(e.h)} fontSize={(e.fontSize || 10) * MM_TO_PX * 0.25} fontStyle={e.bold ? 'bold' : 'normal'} align={e.align} />}
              {e.translationText && <Text y={mm2px(4)} text={e.translationText} fontSize={8} fill="#6b7280" />}
              {e.type === 'checkbox' && <Rect width={mm2px(e.w)} height={mm2px(e.h)} stroke="black" />}
              {e.type === 'table' && <>
                <Rect width={mm2px(e.w)} height={mm2px(e.h)} stroke="black" />
                {Array.from({ length: e.cols || 3 }).map((_, idx) => <Line key={idx} points={[mm2px(((idx + 1) * e.w) / (e.cols || 3)),0,mm2px(((idx + 1) * e.w) / (e.cols || 3)),mm2px(e.h)]} stroke="black" />)}
              </>}
              {selectedId === e.id && <Rect width={mm2px(e.w)} height={mm2px(e.h)} stroke="#2563eb" dash={[4,4]} />}
            </Group>)}
          </Layer>
        </Stage>
      </div>
    </main>

    <aside className="bg-white p-3 rounded shadow space-y-2 overflow-auto">
      <h2 className="font-semibold">Properties</h2>
      {selected ? <>
        {(['x','y','w','h'] as const).map((k) => <label key={k} className="block">{k} (mm)<input className="w-full border" type="number" value={selected[k]} onChange={(e) => updateElement({ [k]: Number(e.target.value) })}/></label>)}
        <label className="block">Text<input className="w-full border" value={selected.text || ''} onChange={(e) => updateElement({ text: e.target.value })}/></label>
        <label className="block">Field ID<input className="w-full border" value={selected.fieldId || ''} onChange={(e) => {
          const fieldId = e.target.value;
          updateElement({ fieldId });
          if (fieldId && !template.fields.find((f) => f.id === fieldId)) setTemplate((t) => ({ ...t, fields: [...t.fields, { id: fieldId, type: selected.fieldType || 'string' }] }));
        }}/></label>
        <label className="block">Field Type<select className="w-full border" value={selected.fieldType || 'string'} onChange={(e) => updateElement({ fieldType: e.target.value as TemplateElement['fieldType'] })}><option>string</option><option>date</option><option>number</option></select></label>
        <label className="block">Font size<input className="w-full border" type="number" value={selected.fontSize || 10} onChange={(e) => updateElement({ fontSize: Number(e.target.value) })}/></label>
        <label className="block"><input type="checkbox" checked={!!selected.bold} onChange={(e) => updateElement({ bold: e.target.checked })}/> Bold</label>
        <label className="block">Align<select className="w-full border" value={selected.align || 'left'} onChange={(e) => updateElement({ align: e.target.value as TemplateElement['align'] })}><option>left</option><option>center</option><option>right</option></select></label>
        <label className="block">Stroke<input className="w-full border" value={selected.stroke || '#111827'} onChange={(e) => updateElement({ stroke: e.target.value })}/></label>
        <label className="block">Padding<input className="w-full border" type="number" value={selected.padding || 0} onChange={(e) => updateElement({ padding: Number(e.target.value) })}/></label>
        <label className="block">Line Height<input className="w-full border" type="number" step="0.1" value={selected.lineHeight || 1.2} onChange={(e) => updateElement({ lineHeight: Number(e.target.value) })}/></label>
        <label className="block">Translation Label<input className="w-full border" value={selected.translationText || ''} onChange={(e) => updateElement({ translationText: e.target.value })}/></label>
        <div className="grid grid-cols-3 gap-1">
          {['left','center','right','top','middle','bottom'].map((a) => <button key={a} className="border p-1" onClick={() => aligned(a)}>{a}</button>)}
        </div>
        <button className="border p-1 w-full" onClick={() => reorder(true)}>Bring to front</button>
        <button className="border p-1 w-full" onClick={() => reorder(false)}>Send to back</button>
        <button className="border p-1 w-full text-red-700" onClick={() => setTemplate((t) => ({ ...t, elements: t.elements.filter((e) => e.id !== selected.id) }))}>Delete</button>
      </> : <p>Element wählen…</p>}
      <hr/>
      <h3 className="font-medium">Felder</h3>
      {template.fields.map((f) => <div key={f.id} className="text-xs border p-1">{f.id} ({f.type})</div>)}
    </aside>
  </div>;
}
