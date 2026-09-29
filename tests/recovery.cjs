const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {parseHTML}=require('linkedom');
const path='/ucenter/student/course/study/test/plan/detail/second';
const initial=()=>({value:JSON.stringify({schema:2,queue:[{key:'first',title:'第一节'},{key:'second',title:'第二节'}],index:1,course:'test',running:true,phase:'opening',autoRepair:true,retries:{}})});
function page(storage, deny=false){
 const {window,document}=parseHTML('<html><body><div><video src="demo.mp4"></video><span>00:00 / 00:00</span></div></body></html>');
 Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return Array.from(this.querySelectorAll('option')).find(o=>o.hasAttribute('selected'))?.getAttribute('value')||this.querySelector('option')?.getAttribute('value')||''},set(value){this.querySelectorAll('option').forEach(o=>{if(o.getAttribute('value')===String(value))o.setAttribute('selected','');else o.removeAttribute('selected');});}});
 const v=document.querySelector('video');let tick,now=0,reloads=0,id=0;const timers=new Map();
 Object.assign(v,{currentSrc:'demo.mp4',playbackRate:1,defaultPlaybackRate:1,currentTime:0,duration:120,readyState:4,paused:true,seeking:false,ended:false,clientWidth:400,clientHeight:220,getClientRects:()=>[{}],play(){this.paused=false;return Promise.resolve()},pause(){this.paused=true;this.dispatchEvent(new window.Event('pause'))}});
 const location={pathname:path,reload(){reloads++}};
 class Clock extends Date {constructor(...args){super(...(args.length?args:[now]))}static now(){return now}}
 const ctx={window,document,location,performance:{getEntriesByType:()=>[{type:'reload'}]},Date:Clock,AbortController,console,getComputedStyle:()=>({content:'none'}),sessionStorage:{getItem:()=>storage.value,setItem:(k,val)=>{if(deny)throw Error('storage blocked');storage.value=val;}},setInterval:fn=>tick=fn,setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms});return id},clearTimeout:i=>timers.delete(i)};
 window.top=window;window.self=window;vm.createContext(ctx);
 for(const name of ['core','persistence','content'])vm.runInContext(fs.readFileSync('extension/'+name+'.js','utf8'),ctx);
 const ui=document.querySelector('#zjooc-sequence-player').shadowRoot;
 return {v,ui,location,timers,tick:()=>tick(),progress(seconds=25){tick();for(let i=1;i<=seconds;i++){now=i*1000;if(!v.paused)v.currentTime+=1;tick();}},state:()=>JSON.parse(storage.value),reloads:()=>reloads,runTimers(){for(const [i,t] of [...timers]){timers.delete(i);t.fn();}}};
}
let saved=initial(),p=page(saved);p.progress();assert.equal(p.state().phase,'recovering');assert.equal(p.state().index,1);assert.equal(p.state().retries.second,1);assert.equal(p.v.paused,true);p.runTimers();assert.equal(p.reloads(),1);
p=page(saved);p.progress();assert.equal(p.state().retries.second,2);p.runTimers();assert.equal(p.reloads(),1);
p=page(saved);p.progress();assert.equal(p.state().running,false);assert.equal(p.timers.size,0);assert.equal(p.state().index,1);assert.match(p.ui.getElementById('status').textContent,/两次/);
p=page(initial());p.progress();p.ui.getElementById('stop').click();p.runTimers();assert.equal(p.reloads(),0);
p=page(initial());p.progress();p.location.pathname='/ucenter/student/course/study/test/plan';p.runTimers();assert.equal(p.reloads(),0);assert.equal(p.state().running,false);
p=page(initial(),true);p.progress();p.runTimers();assert.equal(p.reloads(),0);assert.match(p.ui.getElementById('status').textContent,/无法保存/);
p=page(initial());p.tick();p.v.currentTime=8;p.v.ended=true;p.v.dispatchEvent(new p.v.ownerDocument.defaultView.Event('ended'));p.runTimers();assert.equal(p.state().index,1);assert.equal(p.state().phase,'recovering');p.runTimers();assert.equal(p.reloads(),1);
console.log('PASS: saved current index; retry counts survive reload; two-reload cap; cancellation on stop/route change; blocked storage; ended 0/0 never advances queue.');
