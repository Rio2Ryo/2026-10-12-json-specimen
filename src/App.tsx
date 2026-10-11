import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEMO, DEFAULT_POLICY, infer, inspect, parseSpecimens, parseProbe, validateRecords, validatePolicy, validateProbe, type Policy } from './engine'
import './styles.css'
type Lab = {records: Record<string,unknown>[];excluded:number[];policy:Policy;probe:unknown}
type Debug = {getState:()=>Lab;load:(records:unknown)=>void;policy:(policy:unknown)=>void;probe:(value:unknown)=>void;inspect:()=>{schema:ReturnType<typeof infer>;fields:ReturnType<typeof inspect>;result:ReturnType<typeof validateProbe>};reset:()=>void}
declare global {interface Window {__SPECIMEN__:Debug}}
const initial = ():Lab => ({records:structuredClone(DEMO),excluded:[],policy:{...DEFAULT_POLICY},probe:{id:'agent-03',profile:{name:'Ryo'},tasks:[]}})
const compact = (v:unknown) => JSON.stringify(v) ?? '—'
const typeLabel:Record<string,string> = {string:'文字',number:'数値',integer:'整数',boolean:'真偽',object:'物体',array:'配列',null:'null',missing:'不在'}
function download(data:unknown,name:string) { const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000) }
export default function App(){
 const [lab,setLab]=useState(initial)
 const ref=useRef(lab)
 const [selected,setSelected]=useState('/id')
 const [draft,setDraft]=useState('{"id":4,"profile":{"name":"朝のエージェント","timezone":"Asia/Tokyo"},"tasks":[]}')
 const [probeText,setProbeText]=useState(JSON.stringify(lab.probe,null,2))
 const [notice,setNotice]=useState('琥珀色は型の食い違い。まず /id を選んで、標本を見比べよう。')
 const [tab,setTab]=useState<'field'|'schema'>('field')
 const [query,setQuery]=useState('')
 const [onlyInteresting,setOnlyInteresting]=useState(false)
 const [page,setPage]=useState(0)
 const update=useCallback((next:Lab)=>{if(next.records!==ref.current.records){setQuery('');setOnlyInteresting(false);setPage(0)}ref.current=next;setLab(next)},[])
 const active=useMemo(()=>lab.records.filter((_,i)=>!lab.excluded.includes(i)),[lab.records,lab.excluded])
 const fields=useMemo(()=>inspect(lab.records),[lab.records])
 const filteredFields=fields.filter(f=>f.path.toLowerCase().includes(query.toLowerCase())&&(!onlyInteresting||Object.keys(f.types).length>1||f.present<f.total))
 const pages=Math.max(1,Math.ceil(filteredFields.length/32))
 const safePage=Math.min(page,pages-1)
 const shownFields=filteredFields.slice(safePage*32,(safePage+1)*32)
 const schema=useMemo(()=>infer(active,lab.policy),[active,lab.policy])
 const result=useMemo(()=>validateProbe(lab.probe,schema),[lab.probe,schema])
 const chosen=fields.find(f=>f.path===selected)??fields[0]
 const divergent=fields.filter(f=>Object.keys(f.types).length>1).length
 const rejected=lab.records.map(r=>validateProbe(r,schema))
 const observedSchema=infer(active,{...lab.policy,mode:'observed'})
 const dominantSchema=infer(active,{...lab.policy,mode:'dominant'})
 const observedPass=lab.records.filter(r=>validateProbe(r,observedSchema).valid).length
 const dominantPass=lab.records.filter(r=>validateProbe(r,dominantSchema).valid).length
 const safely=(fn:()=>void)=>{try{fn()}catch(e){setNotice(e instanceof Error?e.message:'操作できませんでした')}}
 useEffect(()=>{
  window.__SPECIMEN__={
   getState:()=>structuredClone(ref.current),
   load:records=>{update({...ref.current,records:structuredClone(validateRecords(records)),excluded:[]});setSelected('/id')},
   policy:policy=>update({...ref.current,policy:validatePolicy(policy)}),
   probe:value=>{const check=validateProbe(value,{});if(!check.valid)throw Error(check.errors.join('\n'));const parsed=structuredClone(value);update({...ref.current,probe:parsed});setProbeText(JSON.stringify(parsed,null,2))},
   inspect:()=>{const s=ref.current;const records=s.records.filter((_,i)=>!s.excluded.includes(i));const current=infer(records,s.policy);return structuredClone({schema:current,fields:inspect(s.records),result:validateProbe(s.probe,current)})},
   reset:()=>{const s=initial();update(s);setProbeText(JSON.stringify(s.probe,null,2));setSelected('/id')},
  }
 },[update])
 const policyChange=(p:Partial<Policy>)=>safely(()=>{const next=validatePolicy({...ref.current.policy,...p});update({...ref.current,policy:next});setNotice('仮説を変更しました。右側の反例と、各標本の合否も再検証しました。')})
 const importDraft=(replace:boolean)=>safely(()=>{const incoming=parseSpecimens(draft);const records=validateRecords(replace?incoming:[...ref.current.records,...incoming]);update({...ref.current,records,excluded:replace?[]:ref.current.excluded});setNotice(`${incoming.length}標本を${replace?'置き換え':'追加'}。推定仕様を再計算しました。`);setTab('field')})
 const toggle=(i:number)=>safely(()=>{const s=ref.current;const excluded=s.excluded.includes(i)?s.excluded.filter(n=>n!==i):[...s.excluded,i];if(excluded.length>=s.records.length)throw Error('推定には少なくとも1標本を残してください。');update({...s,excluded});setNotice(`標本 ${String(i+1).padStart(2,'0')} を${excluded.includes(i)?'推定から除外':'推定に復帰'}。見えなくせず、反例として残しました。`)})
 return <div className="app">
  <header><a href="/" className="mark" aria-label="JSON標本室ホーム">◈</a><div className="wordmark">DATA ARCHAEOLOGY <span>LOCAL LAB / 012</span></div><div className="privacy"><i/> データは端末の中だけ</div></header>
  <main>
   <section className="intro"><div><p className="eyebrow">仕様がない。それなら、掘り出そう。</p><h1>JSON標本室<span>Find the shape.<br/>Keep the exceptions.</span></h1><p className="lead">「だいたい同じ」の中にある、ひとつの違い。<br/>標本を並べて、仕様を発見し、反例で疑う。</p></div><aside className="first"><b>最初の10秒</b><ol><li><strong>琥珀色の /id</strong> を選ぶ</li><li>数値と文字の標本を見比べる</li><li><strong>多数派で絞る</strong> → 反例が落ちる</li></ol><small>生成AIではなく、実データから推定する研究道具。</small></aside></section>
   <section className="statusbar"><div><strong>{String(lab.records.length).padStart(2,'0')}</strong> 標本 <span> / {active.length} 使用中</span></div><div><strong>{divergent}</strong> 型の食い違い</div><div><strong>{fields.filter(f=>f.present<f.total).length}</strong> 任意のフィールド</div><p role="status">{notice}</p></section>
   <div className="workspace">
    <section className="strata panel"><div className="sectionhead"><div><p className="eyebrow">01 / OBSERVE</p><h2>標本の地層</h2></div><button className="quiet" onClick={()=>{const s=initial();update(s);setSelected('/id');setProbeText(JSON.stringify(s.probe,null,2));setNotice('デモ標本に戻しました。')}}>デモに戻す</button></div>
     <div className="fieldtools"><label>地層を検索<input type="search" maxLength={80} placeholder="/profile · /tasks" value={query} onChange={e=>{setQuery(e.target.value);setPage(0)}}/></label><label className="check"><input type="checkbox" checked={onlyInteresting} onChange={e=>{setOnlyInteresting(e.target.checked);setPage(0)}}/>食い違い・欠けだけ</label><div className="pager"><button disabled={safePage===0} onClick={()=>setPage(safePage-1)} aria-label="前の地層ページ">←</button><span>{safePage+1}/{pages} · {filteredFields.length}地層</span><button disabled={safePage===pages-1} onClick={()=>setPage(safePage+1)} aria-label="次の地層ページ">→</button></div></div>
     <div className="matrixwrap"><table className="matrix"><thead><tr><th scope="col">FIELD / JSON POINTER</th>{lab.records.map((_,i)=><th scope="col" key={i}><button className={lab.excluded.includes(i)?'sample excluded':'sample'} onClick={()=>toggle(i)} aria-pressed={!lab.excluded.includes(i)} title="クリックで推定から除外／復帰">{String(i+1).padStart(2,'0')}<small>{lab.excluded.includes(i)?'除外':rejected[i].valid?'合格':'反例'}</small></button></th>)}</tr></thead><tbody>{shownFields.map(f=><tr key={f.path} className={`${chosen?.path===f.path?'selected':''} ${Object.keys(f.types).length>1?'fracture':''}`}><th scope="row"><button onClick={()=>{setSelected(f.path);setTab('field');setNotice(`${f.path} を観察中。標本ごとの値と、欠けた場所を下で確認できます。`)}} aria-pressed={chosen?.path===f.path}>{f.path}<small>{Object.keys(f.types).length>1?'型が食い違う':f.present<f.total?'一部で欠ける':'揃っている'}</small></button></th>{f.values.map(v=><td key={v.index} className={lab.excluded.includes(v.index)?'muted':''}><button className={`fossil ${v.type}`} aria-label={`${f.path} 標本${v.index+1} ${v.present?typeLabel[v.type]??v.type:'不在'}`} onClick={()=>{setSelected(f.path);setTab('field');setNotice(`標本${v.index+1} の ${f.path}: ${v.present?compact(v.value).slice(0,120):'フィールドがありません'}`)}}><span className="crystal"/><small>{v.present?typeLabel[v.type]??v.type:'—'}</small></button></td>)}</tr>)}</tbody></table></div>
     <div className="legend"><span><i className="amber"/>型の食い違い</span><span><i/>揃っている</span><span>— = 欠けた地層</span><span>標本番号を押すと推定から除外</span></div>
     <div className="tabs" role="group" aria-label="観察内容"><button aria-pressed={tab==='field'} onClick={()=>setTab('field')}>フィールドを見る</button><button aria-pressed={tab==='schema'} onClick={()=>setTab('schema')}>掘り出した仕様</button></div>
     {tab==='field'&&chosen?<div className="detail"><div className="detailhead"><h3>{chosen.path}</h3><span>{chosen.present}/{chosen.total} 標本で出現</span></div><div className="valuegrid">{chosen.values.map(v=><article key={v.index} className={lab.excluded.includes(v.index)?'excluded':''}><p>SPECIMEN {String(v.index+1).padStart(2,'0')} <b>{v.present?typeLabel[v.type]??v.type:'不在'}</b></p><pre>{v.present?JSON.stringify(v.value,null,2):'この標本にはありません。'}</pre></article>)}</div></div>:<pre className="schema">{JSON.stringify(schema,null,2)}</pre>}
    </section>
    <aside className="controls"><section className="panel policy"><p className="eyebrow">02 / HYPOTHESIZE</p><h2>どこまで、信じる？</h2><p className="sub">観測は事実。仕様は仮説。例外を消さずに絞り込む。</p><fieldset><legend>型の許容範囲</legend><div className="segmented"><button aria-pressed={lab.policy.mode==='observed'} onClick={()=>policyChange({mode:'observed'})}>見た型を全部</button><button aria-pressed={lab.policy.mode==='dominant'} onClick={()=>policyChange({mode:'dominant'})}>多数派で絞る</button></div></fieldset><label className="selectlabel">必須にする基準<select value={lab.policy.required} onChange={e=>policyChange({required:e.target.value as Policy['required']})}><option value="all">全ての標本にある項目</option><option value="majority">60%以上にある項目</option></select></label><label className="check"><input type="checkbox" checked={lab.policy.closed} onChange={e=>policyChange({closed:e.target.checked})}/>未観測のキーを拒否する</label><div className="comparison"><div><small>全観測型なら</small><b>{observedPass}/{lab.records.length}</b><span>標本が合格</span></div><div className="ambertext"><small>多数派なら</small><b>{dominantPass}/{lab.records.length}</b><span>標本が合格</span></div></div><p className="caution">多数派 = 出現型の60%以上。該当なしなら最多の型（同率は全て）。統計は仕様の保証ではありません。</p></section>
     <section className={`panel probe ${result.valid?'valid':'invalid'}`}><p className="eyebrow">03 / FALSIFY</p><h2>反例を、投げ込む。</h2><label htmlFor="probe">このJSONは、今の仕様を通る？</label><textarea id="probe" spellCheck={false} maxLength={20000} value={probeText} onChange={e=>setProbeText(e.target.value)}/><button className="primary" onClick={()=>safely(()=>{const parsed=parseProbe(probeText);update({...ref.current,probe:parsed});setNotice('反例を検証しました。型・必須・未観測キーを実際に照合しています。')})}>反例を検証する →</button><div className="verdict" aria-live="polite"><b>{result.valid?'PASS / この仮説を通る':'FAIL / 仕様との境界を発見'}</b>{result.valid?<p>証明ではなく、今回の入力に対する合格です。</p>:<ul>{result.errors.slice(0,8).map((e,i)=><li key={i}>{e}</li>)}</ul>}</div><small className="sub">表示の合否は最後に検証したJSON。仮説を変えると自動で再判定。</small></section>
    </aside>
   </div>
   <section className="bottomgrid"><section className="panel inputpanel"><p className="eyebrow">04 / COLLECT</p><h2>あなたの標本を入れる。</h2><label htmlFor="specimens">JSONオブジェクト、またはオブジェクトの配列</label><textarea id="specimens" maxLength={20000} spellCheck={false} value={draft} onChange={e=>setDraft(e.target.value)}/><div className="buttons"><button className="primary" onClick={()=>importDraft(false)}>標本を追加</button><button onClick={()=>importDraft(true)}>全標本を置き換える</button></div><p className="caution">最大40標本・20,000文字・深さ8・4,000ノード。データは保存・送信しません。</p></section><section className="panel takehome"><p className="eyebrow">05 / TAKE HOME</p><h2>発見を、道具にする。</h2><p>推定したJSON Schemaを、検証器・エージェント・CIへ。<br/>これは標本の説明であり、完全なAPI仕様ではありません。</p><button className="export" onClick={()=>safely(()=>{download({$schema:'https://json-schema.org/draft/2020-12/schema',...schema},'specimen.schema.json');setNotice('JSON Schemaを書き出しました。現在使用中の標本と仮説から推定した仕様です。')})}>JSON Schemaを持ち帰る ↗</button><details><summary>AIから操作する / CLI・debug</summary><code>window.__SPECIMEN__.inspect()<br/>.load(records) / .policy(policy) / .probe(json)<br/>npm run scenario -- --mode dominant</code><button onClick={()=>safely(()=>{download({records:active,policy:lab.policy,probe:lab.probe,schema,result},'specimen.session.json');setNotice('検証セッションをJSON保存しました。')})}>検証セッションを保存</button></details></section></section>
  </main><footer><span>JSON標本室 / A TOOL, NOT A GUESS.</span><span>端末内で推定 · 外部APIなし · 例外は捨てない</span></footer>
 </div>
}
