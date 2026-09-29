const assert=require('node:assert/strict');
const {parseHTML}=require('linkedom');
const C=require('../extension/core.js');
function run(modify, seconds=26){const h=new C.PlaybackHealth(0);let result=null;for(let i=0;i<=seconds;i++){const s={now:i*1000,time:i,duration:120,frames:i*25,paused:false,seeking:false,ended:false,zeroClock:true};modify(s,i);result=h.sample(s)||result;}return result;}
assert.match(run(()=>{}),/00:00/,'UI clock failure must be detected even with a healthy native duration');
assert.equal(run(s=>s.zeroClock=false),null);
assert.equal(run(s=>s.zeroClock=null),null);
assert.match(run(s=>{s.duration=NaN;s.zeroClock=null}),/时长/);
assert.equal(run(s=>{s.duration=Infinity;s.zeroClock=null}),null);
assert.equal(run(s=>s.paused=true),null);
assert.equal(run(s=>{s.time=0;s.frames=0}),null,'still loading or stalled is not advancing playback');
assert.equal(run((s,i)=>{if(i>=10)s.zeroClock=false}),null,'initial zero clock must be ignored after recovery');
assert.equal(run((s,i)=>{if(i===12)s.seeking=true}),null,'seek interrupts the debounce window');
assert.match(run(s=>s.time=0),/00:00/,'frame advancement catches a stuck native clock');
assert.equal(run(()=>{},10),null,'normal loading grace');
const {document}=parseHTML('<html><body><p>00:00 / 00:00 outside player</p><div id="player"><video></video><span id="clock">00:00 / 00:00</span></div></body></html>');
const v=document.querySelector('video'),clock=document.querySelector('#clock');
assert.equal(C.zeroClock(v),true);clock.textContent='00:12 / 11:25';assert.equal(C.zeroClock(v),false);
clock.textContent='00:00／00:00';assert.equal(C.zeroClock(v),true);
clock.textContent='00:00:00 | 00:00:00';assert.equal(C.zeroClock(v),true);
clock.textContent='00:00 / 00:00 00:12 / 11:25';assert.equal(C.zeroClock(v),false,'valid clock prevents hidden zero template false positive');
clock.remove();assert.equal(C.zeroClock(v),null,'must not read unrelated page text');
console.log('PASS: progressing 0/0; healthy/native-only clocks; loading, pause, seek, stall, live-stream exclusions; decoded frames fallback; player-scoped clock parsing.');

assert.match(run(s=>{s.rate=4;s.time*=4}),/00:00/,'4x playback must not look like a seek');
assert.equal(C.chosenRate('max',[]),4);assert.equal(C.chosenRate('1.5',[]),1.5);
const custom=[{rate:1},{rate:2},{rate:3}];assert.equal(C.chosenRate('max',custom),3);assert.equal(C.chosenRate('4',custom),3);
const menu=document.createElement('div');menu.innerHTML='<span>正常</span><span>2倍速</span><span>4倍速</span>';document.querySelector('#player').append(menu);assert.deepEqual(C.speedOptions(v).map(o=>o.rate),[1,2,4]);
console.log('PASS: verified native speed options, default max 4x, custom speed selection and rate-aware recovery.');
