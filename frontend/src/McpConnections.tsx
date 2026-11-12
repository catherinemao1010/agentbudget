import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowUpRight, Check, Copy, RefreshCw, Terminal, X } from 'lucide-react';
import type { PluginSync } from './usePluginSync';
const apps = [
  {name:'ChatGPT',mark:'✳',description:'Ask about your tracked spending, tokens, and task outcomes.',hosted:true},
  {name:'Codex',mark:'›_',description:'Bring your AgentBudget reports into your coding workflow.',hosted:true},
  {name:'Claude Code',mark:'✺',description:'Connect your local ledger through the MCP server.',command:'claude mcp add --transport stdio agentbudget -- /absolute/path/to/.venv/bin/agentbudget-mcp'},
  {name:'Cursor',mark:'◈',description:'Explore your local agent costs from your editor.',command:'{\n  "mcpServers": {\n    "agentbudget": {\n      "command": "/absolute/path/to/.venv/bin/agentbudget-mcp"\n    }\n  }\n}'},
  {name:'Gemini CLI',mark:'✦',description:'Query your local runs and token usage with Gemini CLI.',command:'gemini mcp add agentbudget /absolute/path/to/.venv/bin/agentbudget-mcp'},
];
export function McpConnections({sync}:{sync:PluginSync}) {
  const [selected,setSelected]=useState<typeof apps[number]|null>(null);
  const [copied,setCopied]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{if(selected)dialog.current?.showModal();else dialog.current?.close();setCopied(false);},[selected]);
  return <section className="mcp-section">
    <span className="eyebrow">YOUR WORKFLOW, CONNECTED</span>
    <h2>MCP & plugins</h2>
    <p className="mcp-intro">Bring AgentBudget into your favorite AI apps. Ask about the price, tokens used, and outcomes of your tracked tasks.</p>
    <div className="mcp-sync">
      <div><strong><Activity size={17}/> Automatic sync</strong><p>{sync.message}</p><small>{sync.syncedAt ? `Last saved ${new Date(sync.syncedAt).toLocaleString()}. ` : ''}Task names, costs, tokens, and timings save to your account as you work. No API keys or model prompts.</small></div>
      <span className="sync-pill" role="status">{sync.state==='saved' ? <Check size={16}/> : <RefreshCw size={16} className={sync.state==='saving'?'spin':''}/>} {sync.state==='saved'?'Up to date':sync.state==='saving'?'Saving…':sync.state==='local'?'Local only':sync.state==='offline'?'Retrying…':'Connecting…'}</span>
    </div>
    <div className="mcp-apps">{apps.map(app=><article className="mcp-app" key={app.name}>
      <div><h3><span className={'mcp-logo '+app.name.split(' ')[0].toLowerCase()} aria-hidden="true">{app.mark}</span>{app.name}</h3><p>{app.description}</p></div>
      <button className="secondary" onClick={()=>setSelected(app)}>{app.hosted?'Connect':'Set up'} {app.name}<ArrowUpRight size={16}/></button>
    </article>)}</div>
    <p className="mcp-scope">The plugin reads AgentBudget records. It does not access ChatGPT subscriptions or automatically measure every conversation. Budget enforcement happens in requests routed through the Python SDK.</p>
    <dialog ref={dialog} onCancel={()=>setSelected(null)} onClick={e=>{if(e.target===e.currentTarget)setSelected(null)}} className="mcp-dialog">
      {selected&&<><button className="icon-button mcp-close" aria-label="Close setup" onClick={()=>setSelected(null)}><X size={20}/></button><span className="soft-icon"><Terminal size={24}/></span><h2>Connect {selected.name}</h2>
      {selected.hosted?<><p>Your published AgentBudget site provides a private plugin with three read-only reporting tools.</p><ol><li>Open Plugins → Personal → Created by you.</li><li>Select AgentBudget, then Install or Connect if prompted.</li><li>Start a new chat, type <strong>@</strong>, and choose AgentBudget.</li></ol><p>Your dashboard saves automatically. Try:</p><blockquote>“Show my estimated spending and total tokens. Include demo runs.”</blockquote><small>Installation and account access are managed by your chat app. This page does not verify whether you have connected it.</small></>:<><p>Install AgentBudget from the source checkout and start its local API with <code>agentbudget serve</code>. Replace the executable path below with your installed path.</p>{selected.name==='Cursor'&&<p>Add this configuration to <code>.cursor/mcp.json</code>, then restart Cursor.</p>}<pre><code>{selected.command}</code></pre><button className="secondary" onClick={async()=>{try{await navigator.clipboard.writeText(selected.command!);setCopied(true);}catch{setCopied(false);}}}>{copied?<Check size={16}/>:<Copy size={16}/>} {copied?'Copied':'Copy configuration'}</button><p className="muted">These apps read your local ledger. Hosted automatic sync is separate.</p></>}
      </>}
    </dialog>
  </section>;
}
