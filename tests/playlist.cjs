const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {parseHTML}=require('linkedom');
const node=(title,kind='folder',children='',closed=false)=>`<div role="treeitem" class="el-tree-node ${closed?'':'is-expanded'}" aria-expanded="${!closed}"><div class="el-tree-node__content"><span class="el-tree-node__expand-icon ${kind==='folder'?'':'is-leaf'}"></span><div><span><i class="${kind==='video'?'iconfont icon-shipin':''}" data-kind="${kind}"></i>${title}</span></div></div>${children?`<div role="group">${children}</div>`:''}</div>`;
const fixture=node('模块一','folder',node('1.1 小节','folder',node('同名视频','video')+node('课程文档','document')))+node('模块二','folder',node('2.1 小节','folder',node('同名视频','video')+node('最后视频','video')));
const {window,document}=parseHTML('<html><body><main id="tree">'+fixture+'</main><div id="stage"></div></body></html>');
Object.defineProperty(window.HTMLSelectElement.prototype,'value',{configurable:true,get(){return Array.from(this.querySelectorAll('option')).find(o=>o.hasAttribute('selected'))?.getAttribute('value')||this.querySelector('option')?.getAttribute('value')||''},set(value){this.querySelectorAll('option').forEach(o=>{if(o.getAttribute('value')===String(value))o.setAttribute('selected','');else o.removeAttribute('selected');});}});
const style=el=>({content:el.getAttribute('data-kind')==='glyph'?'"\ue63e"':'none'});
const C=require('../extension/core.js');
let items=C.videos(document,style);assert.equal(items.length,3);assert.equal(new Set(items.map(x=>x.key)).size,3);assert.ok(items.every(x=>!/模块|小节|文档/.test(x.title)));
const extra=document.createElement('div');extra.innerHTML=node('仅字体标记视频','glyph');document.querySelector('#tree').append(extra);assert.equal(C.videos(document,style).length,4);extra.remove();
assert.equal(C.nextIndex([{selected:true},{selected:false},{selected:true}],0),2);
let tick,stored=null,timerId=0;const timers=new Map();const path='/ucenter/student/course/study/test/plan';const location={pathname:path};
const ctx={window,document,location,getComputedStyle:style,sessionStorage:{getItem:()=>stored,setItem:(k,v)=>stored=v},setInterval:fn=>tick=fn,setTimeout:(fn,ms)=>{const id=++timerId;if(ms<1000)Promise.resolve().then(fn);else timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),AbortController,Date,console};window.top=window;window.self=window;
let playing=null,opened=[];const tree=document.querySelector('#tree'),stage=document.querySelector('#stage');
function mountVideo(item){
 opened.push(item.key);location.pathname=path+'/detail/'+opened.length;tree.remove();stage.innerHTML='<span id="back">返回章节列表</span><video src="demo.mp4"></video>';playing=stage.querySelector('video');
 Object.assign(playing,{currentSrc:'demo.mp4',playbackRate:1,defaultPlaybackRate:1,readyState:1,paused:true,ended:false,playCount:0,clientWidth:100,clientHeight:100,getClientRects:()=>[{}],play(){this.mutedAtPlay=this.muted;this.playCount++;this.paused=false;this.dispatchEvent(new window.Event('playing'));return Promise.resolve()},pause(){this.paused=true;this.dispatchEvent(new window.Event('pause'));}});
 document.querySelector('#back').onclick=()=>{location.pathname=path;stage.replaceChildren();document.body.append(tree)};
}
items.forEach(item=>{const target=Array.from(document.querySelectorAll('.icon-shipin')).find(el=>el.closest('[role=treeitem]')===item.element.closest('[role=treeitem]'));target.parentElement.onclick=()=>mountVideo(item);});
vm.createContext(ctx);vm.runInContext(fs.readFileSync('extension/core.js','utf8'),ctx);vm.runInContext(fs.readFileSync('extension/content.js','utf8'),ctx);
const ui=document.querySelector('#zjooc-sequence-player').shadowRoot;const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
(async()=>{
 ui.getElementById('scan').click();await flush();assert.equal(JSON.parse(stored).queue.length,3);
 ui.getElementById('start').click();await flush();tick();await flush();assert.equal(opened.length,1);assert.equal(playing.playCount,1);assert.equal(playing.playbackRate,4);assert.equal(playing.muted,true,'course video must start muted');assert.equal(playing.mutedAtPlay,true,'mute must be set before play()');ui.getElementById('quiet').checked=false;ui.getElementById('quiet').onchange();assert.equal(playing.muted,false);assert.equal(JSON.parse(stored).phase,'video');tick();assert.equal(playing.playCount,1);
 playing.ended=true;playing.dispatchEvent(new window.Event('ended'));playing.dispatchEvent(new window.Event('ended'));assert.equal(timers.size,1);
 const fn=[...timers.values()][0];timers.clear();fn();tick();tick();await flush();tick();await flush();assert.equal(opened.length,2);assert.equal(playing.playCount,1);assert.equal(playing.muted,false,'explicit unmute preference survives next video');assert.equal(JSON.parse(stored).index,1);
 playing.ended=true;playing.dispatchEvent(new window.Event('ended'));ui.getElementById('stop').click();assert.equal(timers.size,0);assert.equal(JSON.parse(stored).running,false);
 console.log('PASS: excludes headings/documents; video glyph; duplicate titles; unchecked skipping; real DOM scan; start; no repeat forcing; ended dedupe; SPA return/open next/play; stop cancels next.');
})().catch(e=>{console.error(e);process.exitCode=1});
