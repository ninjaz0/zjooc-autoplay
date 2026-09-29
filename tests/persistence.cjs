const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {parseHTML}=require('linkedom');
const P=require('../extension/persistence.js');
const storage=()=>{const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)}};
const base='/ucenter/student/course/study/course-a/plan';
const first=JSON.stringify(['第一节']),second=JSON.stringify(['第二节']);
const initial=()=>({schema:2,course:'course-a',queue:[{key:first,title:'第一节'},{key:second,title:'第二节'}],index:1,running:true,phase:'video',muteByDefault:false,speedMode:'2',checkpoints:{[second]:{time:84,duration:100,updatedAt:1000}}});
const local=storage(),oldSession=storage();
P.save(initial(),{session:oldSession,local},1000);
let loaded=P.load('course-a',{session:storage(),local});
assert.equal(loaded.state.index,1);assert.equal(loaded.state.running,false);assert.equal(loaded.state.checkpoints[second].time,84);
assert.equal(P.load('course-b',{session:oldSession,local}).state,null);
assert.equal(P.load('course-a',{session:oldSession,local,navigationType:'reload'}).state.running,true);
assert.equal(P.load('course-a',{session:oldSession,local,navigationType:'back_forward'}).state.running,false);
const other={...initial(),course:'course-b',index:0};P.save(other,{session:storage(),local},1200);
assert.equal(P.load('course-a',{session:storage(),local}).state.index,1);assert.equal(P.load('course-b',{session:storage(),local}).state.index,0);
const corrupt=storage();corrupt.setItem(P.LOCAL_PREFIX+'course-a','not json');assert.equal(P.load('course-a',{session:storage(),local:corrupt}).state,null);
const denied={getItem(){throw Error('blocked')},setItem(){throw Error('quota')}};
assert.equal(P.save(initial(),{session:oldSession,local:denied}).persistentOK,false);
assert.equal(P.bookmark({time:80,duration:100,readyState:4,seeking:false,zeroClock:true}),null);
assert.equal(P.bookmark({time:80,duration:NaN,readyState:4,seeking:false,zeroClock:null}),null);
assert.equal(P.resumeTime({time:84,duration:100},100),82);assert.equal(P.resumeTime({time:84,duration:100},130),null);

// New page/window, with empty sessionStorage and the same durable localStorage.
function page(){
 const {window,document}=parseHTML('<html><body><main id="app"></main></body></html>');
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return Array.from(this.querySelectorAll('option')).find(o=>o.hasAttribute('selected'))?.getAttribute('value')||this.querySelector('option')?.getAttribute('value')||''},set(value){this.querySelectorAll('option').forEach(o=>{if(o.getAttribute('value')===String(value))o.setAttribute('selected','');else o.removeAttribute('selected')})}});
 let now=10000,tick,video,plays=0,opened=[];const location={pathname:base},session=storage();
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}}
 const ctx={window,document,location,performance:{getEntriesByType:()=>[{type:'navigate'}]},sessionStorage:session,localStorage:local,Date:Clock,AbortController,console,getComputedStyle:()=>({content:'none'}),setInterval:fn=>tick=fn,setTimeout:(fn,ms)=>{if(ms<1000)Promise.resolve().then(fn);return 1},clearTimeout(){}};
 window.top=window;window.self=window;
 document.querySelector('#app').innerHTML=['第一节','第二节'].map(title=>`<div role="treeitem" class="el-tree-node"><div class="el-tree-node__content"><span class="el-tree-node__expand-icon is-leaf"></span><div><span><i class="icon-video"></i>${title}</span></div></div></div>`).join('');
 document.querySelectorAll('.icon-video').forEach(icon=>icon.parentElement.onclick=()=>{
  opened.push(icon.parentElement.textContent);location.pathname=base+'/detail/two';document.querySelector('#app').innerHTML='<div><video src="demo.mp4"></video><span id="clock">00:02 / 01:40</span></div>';
  video=document.querySelector('video');Object.assign(video,{currentSrc:'demo.mp4',currentTime:0,duration:100,readyState:4,paused:true,seeking:false,ended:false,playbackRate:1,seekable:{length:1,start:()=>0,end:()=>100},clientWidth:100,clientHeight:100,getClientRects:()=>[{}],play(){plays++;this.paused=false;return Promise.resolve()},pause(){this.paused=true}});
 });
 vm.createContext(ctx);for(const file of ['core','persistence','content'])vm.runInContext(fs.readFileSync('extension/'+file+'.js','utf8'),ctx);
 const ui=document.querySelector('#zjooc-sequence-player').shadowRoot;
 return {window,document,ui,tick:()=>tick(),advance(ms){now+=ms;tick()},get video(){return video},get plays(){return plays},opened,state:()=>JSON.parse(session.getItem(P.SESSION_KEY))};
}
(async()=>{
 // Restore the initial bookmark after the storage error case modified oldSession only.
 P.save(initial(),{session:storage(),local},5000);
 let p=page();assert.equal(p.state().running,false);assert.equal(p.plays,0);assert.match(p.ui.getElementById('saved').textContent,/1:24/);
 p.ui.getElementById('resume').click();for(let i=0;i<10;i++)await Promise.resolve();p.tick();
 assert.deepEqual(p.opened,['第二节']);assert.equal(p.video.currentTime,82);assert.equal(p.video.muted,false);assert.equal(p.video.playbackRate,2);
 p.video.currentTime=90;p.advance(6000);assert.equal(JSON.parse(local.getItem(P.LOCAL_PREFIX+'course-a')).state.checkpoints[second].time,90);
 p.document.querySelector('#clock').textContent='00:00 / 00:00';p.video.currentTime=95;p.advance(6000);assert.equal(JSON.parse(local.getItem(P.LOCAL_PREFIX+'course-a')).state.checkpoints[second].time,90,'broken clock must not replace healthy bookmark');
 p.document.querySelector('#clock').textContent='01:33 / 01:40';p.video.currentTime=93;p.window.dispatchEvent(new p.window.Event('pagehide'));assert.equal(JSON.parse(local.getItem(P.LOCAL_PREFIX+'course-a')).state.checkpoints[second].time,93);
 p=page();assert.equal(p.state().index,1);assert.equal(p.state().running,false);assert.equal(p.state().checkpoints[second].time,93);assert.equal(p.plays,0);
 console.log('PASS: empty-session restart; per-course isolation; reload vs reopen; exact bookmark restore; speed/mute preferences; 5-second/pagehide save; zero-clock exclusion; storage failure.');
})().catch(err=>{console.error(err);process.exitCode=1});
