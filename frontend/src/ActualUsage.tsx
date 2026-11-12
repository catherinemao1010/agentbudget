import {useEffect,useState} from 'react';
import {Activity,Check,Copy,Terminal} from 'lucide-react';
import {short} from './data';
type Usage={connected:boolean;received_at:string|null;observed_at:string|null;session_count:number;input_tokens:number;cached_tokens:number;output_tokens:number;reasoning_tokens:number;request_count:number;total_tokens:number;models:{model:string;input_tokens:number;output_tokens:number}[]};
export function ActualUsage({setup=false}:{setup?:boolean}) {
  const [usage,setUsage]=useState<Usage|null>(null),[error,setError]=useState(''),[token,setToken]=useState(''),[busy,setBusy]=useState(false),[copied,setCopied]=useState(false),[signin,setSignin]=useState(false);
  useEffect(()=>{
    let stopped=false,active=false;
    async function refresh(){
      if(active)return;active=true;
      try{
        const response=await fetch('/api/collector/usage',{cache:'no-store'});
        if(stopped)return;
        if(response.status===401){setSignin(true);return;}
        if(!response.ok)throw new Error('Usage connection unavailable. Retrying automatically.');
        const data=await response.json();
        if(!stopped){setUsage(data);setError('');setSignin(false);}
      }catch(e){if(!stopped)setError((e as Error).message);}finally{active=false;}
    }
    void refresh();const timer=setInterval(()=>void refresh(),10000);
    return()=>{stopped=true;clearInterval(timer);};
  },[]);
  async function connect(method:'POST'|'DELETE'){
    setBusy(true);setError('');
    try{
      const r=await fetch('/api/collector/connection',{method,headers:{'X-AgentBudget-Client':'dashboard'}});
      const data=await r.json();if(!r.ok)throw new Error(data.error||'Could not update connection');
      setToken(data.token||'');setCopied(false);
      setUsage(u=>u?{...u,connected:method==='POST'}:u);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  const fresh=!!usage?.connected&&!!usage?.received_at&&Date.now()-Date.parse(usage.received_at)<120000;
  return <section className="actual-usage" aria-label="Actual Codex usage">
    <div className="actual-heading"><div><span className="eyebrow">ACTUAL USAGE · CODEX ON YOUR MAC</span><h2>Real tokens, automatically tracked.</h2></div><span className={'actual-state '+(fresh?'fresh':'')}><Activity size={15}/>{fresh?'Receiving usage':usage?.connected?'Waiting for collector':'Not connected'}</span></div>
    <p>Recorded input and output tokens from your local Codex sessions. All recorded history, separate from the SDK demo below. Updates every 30 seconds while your Mac is awake.</p>
    {signin&&<p><a href="/signin-with-chatgpt?return_to=%2F" target="_top">Sign in with ChatGPT</a> to connect and view your private usage.</p>}
    {error&&<p role="status" className="actual-error">{error}</p>}
    <div className="actual-metrics">
      <div><span>Total tokens</span><strong title={usage?.total_tokens.toLocaleString()}>{usage?.received_at?short(usage.total_tokens):'—'}</strong><small>{usage?.session_count||0} recorded sessions</small></div>
      <div><span>Input tokens</span><strong>{usage?.received_at?short(usage.input_tokens):'—'}</strong><small>{short(usage?.cached_tokens||0)} cached · included in input</small></div>
      <div><span>Output tokens</span><strong>{usage?.received_at?short(usage.output_tokens):'—'}</strong><small>{short(usage?.reasoning_tokens||0)} reasoning · included in output</small></div>
      <div><span>Actual cost</span><strong className="unavailable">Unavailable</strong><small>Subscription charges aren’t exposed per request</small></div>
    </div>
    {usage?.received_at&&<><div className="actual-models">{usage.models.map(m=><span key={m.model}>{m.model}<strong>{short(m.input_tokens+m.output_tokens)} tokens</strong></span>)}</div><p className="actual-caption">Last received {new Date(usage.received_at).toLocaleString()} · {usage.request_count.toLocaleString()} model responses. Cached and reasoning tokens are not counted twice.</p></>}
    {setup?<div className="collector-setup"><h3><Terminal size={18}/> Connect this Mac once</h3><p>The open-source collector runs in the background at login. It sends token counts, model names, timestamps, and hashed session identifiers. Prompts, responses, API keys, and Codex login credentials stay on your Mac.</p>
      <div className="collector-actions"><button className="secondary" disabled={busy||signin} onClick={()=>void connect('POST')}>{usage?.connected?'Replace collector key':'Create collector key'}</button>{usage?.connected&&<button className="secondary" disabled={busy} onClick={()=>void connect('DELETE')}>Disconnect collector</button>}</div>
      {token&&<div className="collector-token"><label htmlFor="collector-key">Your write-only key · shown once · keep private</label><input id="collector-key" type="password" readOnly value={token} autoComplete="off"/><button className="secondary" onClick={async()=>{try{await navigator.clipboard.writeText(token);setCopied(true);}catch{setError('Clipboard unavailable. Select and copy the key.');}}}>{copied?<Check size={15}/>:<Copy size={15}/>} {copied?'Copied':'Copy key'}</button></div>}
      <p>From your <a href="https://github.com/catherinemao1010/agentbudget" target="_blank" rel="noreferrer">AgentBudget source checkout</a>, run:</p><pre><code>{`python3 scripts/codex-collector.py configure --site ${window.location.origin}\npython3 scripts/codex-collector.py install`}</code></pre><p className="actual-caption">Paste the key at the hidden prompt. To stop: <code>python3 scripts/codex-collector.py uninstall</code>. Disconnecting revokes uploads; your existing usage history stays private in your account.</p>
    </div>:!usage?.connected&&<p className="actual-caption">Open Integrations to set up the automatic collector once.</p>}
    <p className="actual-caption">Coverage: Codex session logs on one connected Mac (up to 2,000 sessions). Ordinary ChatGPT web chats and other devices are not included. Tracking is observational; it cannot enforce Codex subscription limits.</p>
  </section>;
}
