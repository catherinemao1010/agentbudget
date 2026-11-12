import { useEffect, useRef, useState } from 'react';
import type { Run } from './data';
export type PluginSync = {state:'checking'|'saved'|'saving'|'offline'|'local';syncedAt:string|null;message:string};
// Mounted at app level: changing dashboard pages never interrupts synchronization.
export function usePluginSync(runs:Run[],setRuns:(runs:Run[])=>void) {
  const [status,setStatus]=useState<PluginSync>({state:'checking',syncedAt:null,message:'Checking automatic sync…'});
  const current=useRef(runs); current.current=runs;
  const apply=useRef(setRuns); apply.current=setRuns;
  const bootRuns=useRef(runs);
  useEffect(()=>{
    let stopped=false, ready=false, active=false;
    let baseline:Run[]=[], timestamp:string|null=null;
    const serialize=(r:Run)=>JSON.stringify(r);
    const publish=(state:PluginSync['state'],message:string)=>{if(!stopped)setStatus({state,syncedAt:timestamp,message});};
    async function tick() {
      if(stopped||active)return;
      active=true;
      try {
        if(!ready) {
          const response=await fetch('/api/plugin/snapshot',{cache:'no-store'});
          if(response.status===401||response.status===404){publish('local','Sign in on the hosted site for automatic sync. Local MCP reads your local API directly.');return;}
          if(!response.ok)throw new Error('Cloud connection unavailable');
          const cloud=await response.json();
          if(stopped)return;
          if(!Array.isArray(cloud.runs)){publish('local','Automatic cloud sync is available on the hosted site.');return;}
          timestamp=cloud.synced_at;
          baseline=cloud.runs;
          if(cloud.synced_at) {
            // Hydrate from the cloud, retaining edits made while the initial read was pending.
            const boot=new Map(bootRuns.current.map(r=>[r.id,serialize(r)]));
            const edits=current.current.filter(r=>boot.get(r.id)!==serialize(r));
            const merged=new Map(cloud.runs.map((r:Run)=>[r.id,r] as const));
            for(const r of edits)merged.set(r.id,r);
            const hydrated=Array.from(merged.values()) as Run[];
            current.current=hydrated;apply.current(hydrated);
          }
          ready=true;
        }
        const sent=current.current;
        const previous=new Map(baseline.map(r=>[r.id,serialize(r)]));
        const ids=new Set(sent.map(r=>r.id));
        const upserts=sent.filter(r=>previous.get(r.id)!==serialize(r));
        const removed=baseline.filter(r=>!ids.has(r.id)).map(r=>r.id);
        if(!upserts.length&&!removed.length){publish('saved','Changes save automatically. The plugin reads the latest saved records on every request.');return;}
        publish('saving','Saving changes to your plugin… Keep this page open until saved.');
        const response=await fetch('/api/plugin/changes',{method:'POST',headers:{'Content-Type':'application/json','X-AgentBudget-Client':'dashboard'},body:JSON.stringify({upserts,removed})});
        const data=await response.json();
        if(stopped)return;
        if(!response.ok)throw new Error(data.error||'Automatic sync failed');
        baseline=sent; timestamp=data.synced_at;
        publish('saved','Changes save automatically. The plugin reads the latest saved records on every request.');
      } catch(e) {publish('offline',`${e instanceof Error?e.message:'Sync unavailable'}. Retrying automatically; keep this page open.`);}
      finally {active=false;}
    }
    void tick();
    const timer=setInterval(()=>void tick(),2000);
    const wake=()=>void tick();
    window.addEventListener('online',wake);
    document.addEventListener('visibilitychange',wake);
    return ()=>{stopped=true;clearInterval(timer);window.removeEventListener('online',wake);document.removeEventListener('visibilitychange',wake);};
  },[]);
  return status;
}
