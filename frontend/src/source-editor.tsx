import { useEffect, useState } from "react";
import { request, type Page, type RecordData } from "./api";
import { formatStatus } from "./overview-data";
import { RequiredMark } from "./time-fields";
type SourceRef = { material_id: string; material_version_id: string; artifact_id: string; chunk_start: number; chunk_end: number };
export function SourceEditor({value, change}: {value: unknown[]; change: (value: unknown[]) => void}) {
  const refs = value as SourceRef[];
  return <details className="source-editor"><summary>Source citations (optional)</summary><p>Link questions to extracted material passages. Citations remain private.</p>
    {refs.map((ref, index) => <SourceRow key={index} value={ref} change={value => change(refs.map((ref, i) => i === index ? value : ref))} remove={() => change(refs.filter((_, i) => i !== index))} />)}
    <button type="button" className="secondary" onClick={() => change([...refs, { material_id: "", material_version_id: "", artifact_id: "", chunk_start: 0, chunk_end: 0 }])}>Add source citation</button>
  </details>;
}
function SourceRow({value, change, remove}: {value: SourceRef; change: (value: SourceRef) => void; remove: () => void}) {
  const [materials, setMaterials] = useState<RecordData[]>([]), [versions, setVersions] = useState<RecordData[]>([]), [error, setError] = useState("");
  useEffect(() => { request<Page>("/materials?limit=100").then(page => setMaterials(page.items)).catch(error => setError(error.message)); }, []);
  useEffect(() => { setVersions([]); if (!value.material_id) return; let active = true; request<Page>(`/materials/${value.material_id}/versions`).then(page => { if (active) setVersions(page.items); }).catch(error => { if(active) setError(error.message); }); return () => {active = false;}; }, [value.material_id]);
  return <div className="question-editor">
    <label><span>Source material<RequiredMark /></span><select required value={value.material_id} onChange={event => change({...value, material_id: event.target.value, material_version_id: "", artifact_id: ""})}><option value="">Choose material</option>{materials.map(material => <option key={material.id} value={material.id}>{String(material.title)}</option>)}</select></label>
    <label><span>Converted version<RequiredMark /></span><select required value={value.material_version_id} onChange={event => { const version = versions.find(version => version.id === event.target.value); change({...value, material_version_id: event.target.value, artifact_id: String(version?.artifact_id ?? "")}); }}><option value="">Choose a version with extracted text</option>{value.material_version_id && !versions.some(version => version.id === value.material_version_id) && <option value={value.material_version_id}>Saved source version</option>}{versions.filter(version => version.artifact_id).map((version, index) => <option key={version.id} value={version.id}>{`Version ${index + 1} — ${formatStatus(version.conversion_state)}`}</option>)}</select></label>
    <div className="source-range"><label><span>First passage (starting at 1)<RequiredMark /></span><input required type="number" min="1" value={value.chunk_start + 1} onChange={event => change({...value, chunk_start: Number(event.target.value) - 1})} /></label><label><span>Last passage<RequiredMark /></span><input required type="number" min={value.chunk_start + 1} value={value.chunk_end + 1} onChange={event => change({...value, chunk_end: Number(event.target.value) - 1})} /></label></div>
    <button type="button" className="text-button" onClick={remove}>Remove citation</button>{error && <p role="alert" className="error">{error}</p>}
  </div>;
}
