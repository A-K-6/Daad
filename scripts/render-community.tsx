/** Render real React views with synthetic props; no SIP engine or network calls. */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdir, copyFile, readdir } from 'node:fs/promises';
import { StatusBar } from '@/components/StatusBar';
import { DialerPad } from '@/components/DialerPad';
import { IncomingCallModal } from '@/components/IncomingCallModal';
import { ActiveCallView } from '@/components/ActiveCallView';
import { ProvisioningView } from '@/components/ProvisioningView';
const out = 'build/community-preview';
await mkdir(out, { recursive: true });
const css = (await readdir('dist/assets')).find(x => x.endsWith('.css'))!;
await copyFile(`dist/assets/${css}`, `${out}/styles.css`);
const noop = () => {};
const config = {serverUrl:'tls://pbx.example.com:5061',sipUri:'sip:1001@pbx.example.com',username:'1001',password:''};
const call = {remoteIdentity:'2002',remoteUri:'sip:2002@pbx.example.com',direction:'outgoing' as const,startTime:0,duration:12,isMuted:false,isHeld:false};
const stages = ['setup','keypad','incoming','outgoing','active'] as const;
for (const stage of stages) {
  const view = <div style={{width:360,height:600,overflow:'hidden',position:'relative',display:'flex',flexDirection:'column',background:'var(--surface-1)',border:'1px solid var(--stroke-2)',borderRadius:16}}>
    {stage === 'setup' ? <ProvisioningView initialConfig={config} connectionState="Disconnected" connectionError={null} certStatus="unknown" onProvision={async()=>{}}/> : <>
      <StatusBar config={config} connectionState="Registered" connectionError={null} certStatus="verified" onOpenSettings={noop}/>
      <main style={{flex:1,position:'relative',overflow:'hidden',display:'flex',flexDirection:'column'}}>
        {stage === 'keypad' ? <><div style={{padding:12,borderBottom:'1px solid var(--stroke-2)'}}>Keypad</div><DialerPad connectionState="Registered" onCall={noop} onOpenSettings={noop}/></> : stage === 'incoming' ? <IncomingCallModal callInfo={{...call,direction:'incoming',startTime:null}} onAnswer={noop} onDecline={noop}/> : <ActiveCallView simple callState={stage==='outgoing'?'Calling':'Active'} callInfo={stage==='outgoing'?{...call,startTime:null,duration:0}:call} onHangup={noop} onToggleMute={noop} onToggleHold={noop} onSendDtmf={noop}/>}
      </main>
    </>}
  </div>;
  await Bun.write(`${out}/${stage}.html`, `<!doctype html><html data-theme="light"><meta charset="utf-8"><title>Daad UI preview</title><link rel="stylesheet" href="styles.css"><style>body{margin:0;padding:24px;background:#eef0f3;width:408px;height:720px;box-sizing:border-box}*{animation:none!important;transition:none!important}</style><div style="font:600 18px system-ui;margin-bottom:6px">Daad · ${stage}</div><div style="font:12px system-ui;color:#555;margin-bottom:18px">UI preview · synthetic account · no real call</div>${renderToStaticMarkup(view)}</html>`);
}
console.log(out);
