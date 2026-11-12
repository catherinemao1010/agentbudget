import {useEffect,useState} from 'react';
import {Activity,Check,Copy,Terminal} from 'lucide-react';
import {short} from './data';
import {UsageInsights,type Insights} from './UsageInsights';
type Usage={insights:Insights;account_code:string;connected:boolean;received_at:string|null;observed_at:string|null;session_count:number;input_tokens:number;cached_tokens:number;output_tokens:number;reasoning_tokens:number;request_count:number;total_tokens:number;models:{model:string;input_tokens:number;output_tokens:number}[]};
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
  function downloadConnection(){
    const blob=new Blob([JSON.stringify({site:window.location.origin,token})],{type:'application/json'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download='agentbudget-connection.json';link.click();
    setTimeout(()=>URL.revokeObjectURL(url),10000);
  }
  async function reloadUsage(){const r=await fetch('/api/collector/usage',{cache:'no-store'});if(!r.ok)throw Error('Could not refresh usage');setUsage(await r.json());}
  const setupPrompt='[@AgentBudget](plugin://plugin_asdk_app_sites_711063549e90819195b81a20f0ab56cc) Set up or update automatic AgentBudget tracking on this Mac for me. Use get_tracking_setup, verify my account code, explain what usage and quota metadata will be uploaded, and ask for consent before enabling uploads. Handle downloads and local installation yourself so I do not need to use Terminal. Preserve an existing working connection. Verify a fresh automatic upload afterward.';
  const setupLink='codex://new?prompt='+encodeURIComponent(setupPrompt);
  const fresh=!!usage?.connected&&!!usage?.received_at&&Date.now()-Date.parse(usage.received_at)<120000;
  return <section className="actual-usage" aria-label="Actual Codex usage">
    <div className="actual-heading"><div><span className="eyebrow">ACTUAL USAGE · CODEX ON YOUR MAC</span><h2>{setup?'Connect once. Track automatically.':'Your usage, reset and runway.'}</h2></div><span className={'actual-state '+(fresh?'fresh':'')}><Activity size={15}/>{fresh?'Receiving usage':usage?.connected?'Waiting for collector':'Not connected'}</span></div>
    <p>Recorded input and output tokens from your local Codex sessions. All recorded history, separate from the SDK demo below. Updates every 30 seconds while your Mac is awake.</p>
    {signin&&<p><a href="/signin-with-chatgpt?return_to=%2F%3Fsetup%3D1" target="_top">Sign in with ChatGPT</a> to connect and view your private usage.</p>}
    {error&&<p role="status" className="actual-error">{error}</p>}
    {!setup&&<UsageInsights data={usage?.insights} onSaved={reloadUsage}/> }
    <details className="recorded-history"><summary>All recorded usage · {usage?.received_at?short(usage.total_tokens):'not connected'} tokens</summary><div className="actual-metrics">
      <div><span>Total tokens</span><strong title={usage?.total_tokens.toLocaleString()}>{usage?.received_at?short(usage.total_tokens):'—'}</strong><small>{usage?.session_count||0} recorded sessions</small></div>
      <div><span>Input tokens</span><strong>{usage?.received_at?short(usage.input_tokens):'—'}</strong><small>{short(usage?.cached_tokens||0)} cached · included in input</small></div>
      <div><span>Output tokens</span><strong>{usage?.received_at?short(usage.output_tokens):'—'}</strong><small>{short(usage?.reasoning_tokens||0)} reasoning · included in output</small></div>
      <div><span>Actual cost</span><strong className="unavailable">Unavailable</strong><small>Subscription charges aren’t exposed per request</small></div>
    </div>
    {usage?.received_at&&<><div className="actual-models">{usage.models.map(m=><span key={m.model}>{m.model}<strong>{short(m.input_tokens+m.output_tokens)} tokens</strong></span>)}</div><p className="actual-caption">Last received {new Date(usage.received_at).toLocaleString()} · {usage.request_count.toLocaleString()} model responses. Cached and reasoning tokens are not counted twice.</p></>}
    </details>
    {setup?<div className="collector-setup"><h3><Terminal size={18}/> Automatic tracking for your account</h3><div className="assisted-setup"><strong>Let Codex handle setup</strong><p>Open the prepared request in the desktop app, send it, and follow any sign-in or consent prompts. Codex can handle the downloads and local commands for you. Requires a local Mac session with file and shell access.</p><a className="primary" href={setupLink}>Set up with Codex</a><p className="actual-caption">The request is not sent automatically. If AgentBudget is available to your account, Codex can offer to install or connect it. This button does not itself install the collector.</p></div><details className="manual-setup"><summary>Manual setup & connection controls</summary><p>Installing @AgentBudget connects your reports. To collect actual tokens, each person must connect their own Mac once. Requires macOS and Python 3.9 or newer.</p><p><strong>1. Check your account</strong><br/>Sign in with the same ChatGPT account used for the plugin. Ask @AgentBudget to “set up automatic tracking” and compare its account code with <strong>{usage?.account_code||'sign in to see your code'}</strong>. Do not use someone else’s connection file.</p><p>The open-source collector runs in the background at login. It sends token counts, model names, timestamps, hashed session identifiers, and Codex allowance and credit-balance readings. Prompts, responses, API keys, and Codex login credentials stay on your Mac.</p>
      <p><strong>2. Download the collector and your connection file</strong><br/><a href="/downloads/agentbudget-collector.py" download="agentbudget-collector.py">Download collector for Mac</a> · <a href="https://github.com/catherinemao1010/agentbudget/blob/main/scripts/codex-collector.py" target="_blank" rel="noreferrer">Review open-source code</a></p><div className="collector-actions"><button className="secondary" disabled={busy||signin} onClick={()=>void connect('POST')}>{usage?.connected?'Replace collector key':'Create collector key'}</button>{usage?.connected&&<button className="secondary" disabled={busy} onClick={()=>void connect('DELETE')}>Disconnect collector</button>}</div>
      {token&&<div className="collector-token"><label htmlFor="collector-key">Your write-only key · shown once · keep private</label><input id="collector-key" type="password" readOnly value={token} autoComplete="off"/><button className="secondary" onClick={async()=>{try{await navigator.clipboard.writeText(token);setCopied(true);}catch{setError('Clipboard unavailable. Select and copy the key.');}}}>{copied?<Check size={15}/>:<Copy size={15}/>} {copied?'Copied':'Copy key'}</button><button className="secondary" onClick={downloadConnection}>Download connection file</button><small>Contains your private collector key. Import it locally and remove the download.</small></div>}
      <p><strong>3. Enable automatic tracking</strong><br/>After downloading both files, open Terminal and run this command. If your browser renamed a download, adjust its filename. Review the privacy notice and type <code>yes</code> to enable tracking.</p>
      <pre><code>{`python3 ~/Downloads/agentbudget-collector.py setup --config-file ~/Downloads/agentbudget-connection.json`}</code></pre>
      <p>The installer verifies the first upload, then starts background syncing at login. You can close this website afterward. Remove the downloaded connection JSON after setup.</p>
      <p className="actual-caption">This setup supports one Mac per account. Replacing a key disconnects its previous collector. To stop background collection:</p>
      <pre><code>{`python3 "$HOME/Library/Application Support/AgentBudget/collector.py" uninstall`}</code></pre>
      <p className="actual-caption">Use Disconnect collector to revoke uploads. Existing usage history stays private in your account. Windows and Linux automatic installation are not supported yet.</p>
    </details></div>:!usage?.connected&&<p className="actual-caption">Open Integrations to set up the automatic collector once.</p>}
    <p className="actual-caption">Coverage: Codex session logs on one connected Mac (up to 2,000 sessions). Ordinary ChatGPT web chats and other devices are not included. Tracking is observational; it cannot enforce Codex subscription limits.</p>
  </section>;
}
