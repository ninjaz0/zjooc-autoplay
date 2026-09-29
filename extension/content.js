(() => {
  'use strict';
  if (window.top !== window.self || document.getElementById('zjooc-sequence-player')) return;
  const C = globalThis.ZjoocCore, P = globalThis.ZjoocPersistence, VERSION = '1.4.0';
  const course = () => location.pathname.match(/\/course\/study\/([^/]+)/)?.[1];
  const directory = () => /\/plan\/?$/.test(location.pathname);
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  let session,local,navigationType='navigate';
  try{session=sessionStorage;}catch(_){}
  try{local=localStorage;}catch(_){}
  try{navigationType=performance.getEntriesByType('navigation')[0]?.type||'navigate';}catch(_){}
  const loaded=P.load(course(),{session,local,navigationType});
  let state=loaded.state||{schema:2,queue:[],index:0,running:false,phase:'idle',mutedFallback:true};
  let persistentOK=true,lastCheckpointWrite=0,restorePending=true,resumeEnabled=true;
  const save=()=>{const result=P.save(state,{session,local});persistentOK=result.persistentOK;updateSavedLabel();return result.sessionOK;};
  let video = null, source = '', attempted = false, scanBusy = false, nextTimer = null, epoch = 0, boundAt=0;
  let abortVideo = null, navigationAt = 0, status = '', mutedByUs = false, repairTimer=null, health=null;
  let speedApplied=false, applyingSpeed=false;
  const log = [];
  const panel = document.createElement('div'); panel.id='zjooc-sequence-player';
  panel.style.cssText='position:fixed!important;right:16px!important;top:90px!important;z-index:2147483647!important;display:block!important;';
  const shadow = panel.attachShadow({mode:'open'});
  shadow.innerHTML=`<style>
  :host{all:initial}section{box-sizing:border-box;width:330px;max-height:80vh;overflow:auto;padding:16px;background:#fff;color:#172636;border:1px solid #cfdae5;border-radius:12px;box-shadow:0 8px 32px #0003;font:14px/1.6 system-ui,sans-serif}header{display:flex;align-items:center;justify-content:space-between}strong{font-size:17px}small{color:#66768b}button{cursor:pointer;font:inherit;border:1px solid #cad7e4;border-radius:6px;background:#f4f8fb;color:#172636;padding:5px 9px;margin:3px 3px 3px 0}button.primary{background:#087ec4;color:white;border-color:#087ec4}p{margin:8px 0;white-space:pre-wrap}ol{padding-left:24px;max-height:220px;overflow:auto}li{margin:4px 0}label{cursor:pointer}details{margin-top:8px}pre{font-size:11px;white-space:pre-wrap;overflow-wrap:anywhere}#mini{font-size:12px}button:disabled{opacity:.55;cursor:default}
  </style><section><header><strong>ZJOOC 视频连播</strong><button id="mini">收起</button></header><div id="body">
  <small>v${VERSION} · 仅识别视频条目</small><p id="status"></p>
  <button id="directory">返回课程目录</button><button id="scan">识别全部视频</button>
  <p><button class="primary" id="start">开始连播</button><button id="resume">继续上次播放</button><button id="stop">停止</button></p>
  <p><label>播放速度 <select id="speed"><option value="max">最高倍速（默认 4×）</option><option value="4">4×</option><option value="2">2×</option><option value="1.5">1.5×</option><option value="1.25">1.25×</option><option value="1">1×</option><option value="0.5">0.5×</option></select></label><small id="actualSpeed"></small></p>
  <label><input type="checkbox" id="quiet">课程视频默认静音</label><small id="actualAudio"></small>
  <br><label><input type="checkbox" id="muted">自动播放受限时静音启动</label>
  <br><label><input type="checkbox" id="repair">零时长异常时自动刷新（每节最多两次）</label>
  <button id="retry">刷新当前视频并重试</button>
  <small id="saved"></small>
  <details open><summary id="count">视频列表</summary><div id="list"></div></details>
  <details><summary>运行状态</summary><pre id="debug"></pre></details>
  <small>默认最高倍速；视频自然结束后进入下一节。若出现验证或题目，请手动处理。</small>
  </div></section>`;
  document.documentElement.append(panel);
  const $ = id => shadow.getElementById(id);
  function say(text) {status=text;$('status').textContent=text;}
  function record(text) {log.push(new Date().toLocaleTimeString()+' '+text);if(log.length>12)log.shift();$('debug').textContent=log.join('\n');}
  function render() {
    $('count').textContent=`视频列表 · 已选 ${state.queue.filter(x=>x.selected!==false).length}/${state.queue.length} 节 · 平台已完成 ${state.queue.filter(x=>x.platformStatus==='completed').length} 节`;
    const ol=document.createElement('ol');
    state.queue.forEach((item,index)=>{const li=document.createElement('li'), label=document.createElement('label'), input=document.createElement('input');input.type='checkbox';input.checked=item.selected!==false;input.disabled=state.running;input.onchange=()=>{item.selected=input.checked;item.manualSelection=input.checked;save();render();};label.append(input,document.createTextNode(`${index===state.index?' → ': ' '}${item.title} · ${{completed:'已完成','in-progress':'进行中','not-started':'未开始',unknown:'状态待确认'}[item.platformStatus]||'状态待确认'}`));li.append(label);ol.append(li);});
    $('list').replaceChildren(ol);$('muted').checked=state.mutedFallback!==false;
    $('quiet').checked=state.muteByDefault!==false;
    $('repair').checked=state.autoRepair!==false;
    $('speed').value=state.speedMode||'max';
    $('scan').disabled=scanBusy||state.running;updateSavedLabel();
  }
  function clearVideo() {if(abortVideo)abortVideo.abort();abortVideo=null;video=null;source='';attempted=false;mutedByUs=false;boundAt=0;health=null;speedApplied=false;restorePending=true;}
  function cancelTransitions(){clearTimeout(nextTimer);nextTimer=null;clearTimeout(repairTimer);repairTimer=null;}
  function stop(text='已停止。点击“继续”恢复当前视频。', pause=true) {
    capturePosition(true);epoch++;cancelTransitions();state.running=false;state.phase='idle';save();
    if(pause&&video&&!video.paused)video.pause();record(text);say(text);render();
  }
  function formatTime(seconds){const n=Math.max(0,Math.floor(seconds||0));return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;}
  function updateSavedLabel(){
    if(!state.queue.length){$('saved').textContent='播放位置会自动保存在此浏览器，关闭后可继续。';return;}
    const item=state.queue[state.index],saved=item&&state.checkpoints?.[item.key];
    $('saved').textContent=!persistentOK?'无法持久保存：浏览器存储被禁用或已满。':item?`上次位置：第 ${state.index+1} 节${saved?' · '+formatTime(saved.time):''}（本机保存）`:'本队列没有待播视频（本机保存）';
  }
  function capturePosition(force=false){
    if(!video||!video.isConnected||restorePending||state.phase!=='video'||state.activePath!==location.pathname||course()!==state.course)return;
    const now=Date.now();if(!force&&now-lastCheckpointWrite<5000)return;
    const checkpoint=P.bookmark({time:video.currentTime,duration:video.duration,readyState:video.readyState,seeking:video.seeking,zeroClock:C.zeroClock(video)},now);
    if(!checkpoint)return;
    const item=state.queue[state.index];if(!item)return;
    state.checkpoints ||= {};state.checkpoints[item.key]=checkpoint;lastCheckpointWrite=now;save();
  }
  function restorePosition(target){
    if(!restorePending)return true;
    if(!resumeEnabled){restorePending=false;return true;}
    const saved=state.checkpoints?.[state.queue[state.index]?.key];
    if(!saved){restorePending=false;return true;}
    if(target.readyState<1)return false;
    const time=P.resumeTime(saved,target.duration);
    if(time===null){restorePending=false;record('视频时长已变化，本节沿用平台位置。');return true;}
    if(target.currentTime>=time-1){restorePending=false;record('平台已恢复到保存位置或更后的位置。');return true;}
    let seekable=false;
    try{for(let i=0;i<target.seekable.length;i++)if(time>=target.seekable.start(i)&&time<=target.seekable.end(i))seekable=true;}catch(_){}
    if(!seekable&&Date.now()-boundAt<15000)return false;
    restorePending=false;
    if(!seekable){record('播放器尚不支持定位，沿用平台播放位置。');return true;}
    try{target.currentTime=time;health?.reset(Date.now());record(`继续上次位置 ${formatTime(time)}（回退 2 秒）。`);}catch(_){record('平台未接受续播定位，沿用平台位置。');}
    return true;
  }
  window.addEventListener('pagehide',()=>capturePosition(true));
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')capturePosition(true);});
  $('stop').onclick=()=>stop();
  $('mini').onclick=()=>{const collapsed=$('body').hidden=!$('body').hidden;$('mini').textContent=collapsed?'展开':'收起';};
  $('muted').onchange=()=>{state.mutedFallback=$('muted').checked;save();};
  function showAudio(target){$('actualAudio').textContent=target.muted||target.volume===0?' 当前静音':' 当前有声';}
  function applyAudio(target){target.muted=state.muteByDefault!==false;mutedByUs=target.muted;showAudio(target);}
  $('quiet').onchange=()=>{state.muteByDefault=$('quiet').checked;save();if(video&&video.isConnected)applyAudio(video);};
  $('speed').onchange=()=>{state.speedMode=$('speed').value;save();speedApplied=false;if(video)applySpeed(video);};
  function applySpeed(target){
    if(applyingSpeed||target!==video)return;
    applyingSpeed=true;
    try{
      const options=C.speedOptions(target),rate=C.chosenRate(state.speedMode,options);
      if(options.length){
        const values=Array.from(new Set(options.map(x=>x.rate))).sort((a,b)=>b-a);
        const selection=state.speedMode||'max';
        $('speed').replaceChildren();
        for(const value of ['max',...values]){const option=document.createElement('option');option.value=String(value);option.textContent=value==='max'?`最高倍速（${values[0]}×）`:`${value}×`;$('speed').append(option);}
        $('speed').value=selection==='max'||values.includes(Number(selection))?selection:'max';
      }
      if(Math.abs(target.playbackRate-rate)>0.01){
        // Prefer the native menu so its label follows the actual rate.
        options.find(x=>x.rate===rate)?.element.click();
        target.defaultPlaybackRate=rate;target.playbackRate=rate;
      }
      speedApplied=true;$('actualSpeed').textContent=` 当前 ${target.playbackRate}×`;
      record(`播放倍速：${target.playbackRate}×`);
    }catch(err){$('actualSpeed').textContent=' 倍速设置失败，请使用播放器菜单';record('倍速设置失败：'+err.message);speedApplied=true;}
    finally{applyingSpeed=false;}
  }
  $('repair').onchange=()=>{state.autoRepair=$('repair').checked;save();if(!state.autoRepair&&state.phase==='recovering')stop('已取消自动刷新。');};
  $('retry').onclick=()=>recover('手动刷新当前视频',true);
  function recover(reason, manual=false){
    const item=state.queue[state.index];
    if(directory()||course()!==state.course||!item)return say('请先识别目录并打开队列中的视频。');
    if(state.activePath&&state.activePath!==location.pathname)return stop('当前页面已切换，请回到队列当前视频再重试。',false);
    if(!manual&&(!state.running||state.phase==='recovering'))return;
    if(!manual&&state.autoRepair===false)return stop(reason+'。已停止，请点击“刷新当前视频并重试”。');
    state.retries ||= {};
    const used=Number(state.retries[item.key])||0;
    if(!manual&&used>=2)return stop('本节已自动刷新两次，异常仍存在。已停止，请检查平台页面后手动重试。');
    // An explicit manual retry starts a new bounded recovery attempt for this item.
    state.retries[item.key]=manual?0:used+1;
    cancelTransitions();const token=++epoch,path=location.pathname;
    state.running=true;state.phase='recovering';state.activePath=path;
    state.lastRecovery={key:item.key,reason,at:Date.now(),attempt:state.retries[item.key]};
    if(!save())return stop('无法保存播放队列，已停止自动刷新。请手动处理页面。');
    if(video&&!video.paused)video.pause();
    record(reason);say(`${reason}。3 秒后刷新并重试本节${manual?'':`（${used+1}/2）`}，不会跳到下一节。`);render();
    repairTimer=setTimeout(()=>{
      repairTimer=null;
      if(token!==epoch||!state.running)return;
      if(location.pathname!==path||course()!==state.course)return stop('页面已改变，取消刷新。',false);
      location.reload();
    },3000);
  }
  async function expandAll() {
    for(let i=0;i<12;i++){const icons=C.collapsed(document);if(!icons.length)return;icons.forEach(el=>el.click());await sleep(180);}
  }
  async function scan() {
    if(scanBusy||state.running)return;
    if(!directory())return say('请先点击“返回课程目录”。');
    scanBusy=true;render();say('正在展开章节并读取带视频图标的条目…');
    const token=++epoch;
    try {
      await expandAll();if(token!==epoch)return;
      const found=C.videos(document);
      if(!found.length){record('未识别到视频标记。');say('没有找到带视频图标的条目，请确认目录已加载。');return;}
      const previous=new Map(state.queue.map(item=>[item.key,item]));
      const queue=found.map(({key,title,path,platformStatus})=>{const manualSelection=previous.get(key)?.manualSelection;return {key,title,path,platformStatus,manualSelection,selected:manualSelection===undefined?platformStatus!=='completed':manualSelection};});
      state={schema:2,queue,index:C.nextIndex(queue,-1),course:course(),running:false,phase:'idle',mutedFallback:state.mutedFallback,muteByDefault:state.muteByDefault,autoRepair:state.autoRepair,speedMode:state.speedMode||'max',retries:{},checkpoints:state.checkpoints||{}};
      save();record(`已读取 ${found.length} 个视频叶子节点，排除了章节目录。`);say(`已识别 ${found.length} 节视频，平台已完成 ${queue.filter(x=>x.platformStatus==='completed').length} 节。默认从第一节未完成视频开始，可勾选已完成视频重看。`);
    }catch(err){say('识别失败：'+err.message);record(err.message);}finally{scanBusy=false;render();}
  }
  $('scan').onclick=scan;
  function returnDirectory() {
    state.activePath=null;
    if(directory()){state.phase='directory';navigationAt=Date.now();save();return;}
    const back=C.exactText(document,'返回章节列表');
    if(!back)return stop('找不到平台的“返回章节列表”入口，请手动返回目录后点击“继续”。',false);
    state.phase='returning';navigationAt=Date.now();save();back.click();
  }
  $('directory').onclick=()=>{stop();if(directory())return say('当前已在课程目录，可点击“识别全部视频”。');returnDirectory();state.running=false;save();};
  function start(restart) {
    if(scanBusy)return;
    if(!state.queue.length)return say('请先点击“识别全部视频”。');
    if(course()!==state.course)return say('请在当前课程重新识别视频。');
    resumeEnabled=true;restorePending=true;
    if(restart)state.index=C.nextIndex(state.queue,-1);
    if(state.index>=state.queue.length)return say('队列已结束，可点击“开始连播”重新播放。');
    cancelTransitions();state.running=true;state.since=Date.now();epoch++;render();
    if(!restart&&video&&video.isConnected&&!video.ended){state.phase='video';restorePending=false;save();attemptPlay(video);return;}
    clearVideo();returnDirectory();save();tick();
  }
  $('start').onclick=()=>start(true);$('resume').onclick=()=>start(false);
  function docs(){const list=[document];for(let i=0;i<list.length;i++)for(const frame of list[i].querySelectorAll('iframe')){try{if(frame.contentDocument&&!list.includes(frame.contentDocument))list.push(frame.contentDocument);}catch(_){}}return list;}
  async function attemptPlay(target) {
    applyAudio(target);
    attempted=true;
    try {await target.play();if(state.running&&target===video)record('播放器开始播放。');}
    catch(error){
      if(!state.running||target!==video)return;
      if(error.name==='NotAllowedError'&&state.mutedFallback!==false){
        target.muted=true;mutedByUs=true;showAudio(target);
        try{await target.play();say('已静音启动播放，可在播放器打开声音。');record('浏览器限制有声自动播放，已静音启动。');return;}catch(_){}
      }
      say('需要手动点击一次播放器的播放按钮，然后将继续连播。');record('播放请求未完成：'+error.name);
    }
  }
  function finish(target) {
    if(!state.running||state.phase!=='video'||target!==video||!target.ended||nextTimer)return;
    const token=epoch;state.phase='ending';save();say('本节播放完毕，4 秒后进入下一节…');record('收到真实播放器 ended。');
    nextTimer=setTimeout(()=>{
      nextTimer=null;if(token!==epoch||!state.running||target!==video)return;
      // A completed picture with a still-zero UI clock must be retried, not advanced.
      if(target.currentTime>=5 && C.zeroClock(target)===true)return recover('视频已经结束，但播放器时间仍为 00:00 / 00:00');
      if(state.checkpoints)delete state.checkpoints[state.queue[state.index].key];
      state.index=C.nextIndex(state.queue,state.index);resumeEnabled=true;state.activePath=null;save();
      if(state.index>=state.queue.length)return stop('所选视频已全部播放结束。',false);
      clearVideo();render();returnDirectory();
    },4000);
  }
  async function openItem() {
    if(scanBusy)return;scanBusy=true;const token=epoch;
    try{
      await expandAll();if(token!==epoch||!state.running)return;
      const observed=C.videos(document);
      if(observed.length){state.queue=C.mergePlatform(state.queue,observed);while(state.index<state.queue.length&&state.queue[state.index].selected===false)state.index++;save();render();}
      if(state.index>=state.queue.length)return stop('平台已完成或未勾选的条目已跳过，当前没有待播放视频。',false);
      const item=state.queue[state.index],found=observed.find(x=>x.key===item.key);
      if(!found){if(Date.now()-navigationAt>30000)stop('未找到下一节视频，请重新识别目录。');return;}
      state.activePath=null;state.phase='opening';state.since=Date.now();navigationAt=Date.now();save();
      say(`正在打开 ${state.index+1}/${state.queue.length}：${item.title}`);record('点击视频：'+item.title);found.element.click();
    }finally{scanBusy=false;}
  }
  function bind(target){
    if(abortVideo)abortVideo.abort();abortVideo=new AbortController();
    video=target;source=target.currentSrc||target.src;attempted=false;boundAt=Date.now();speedApplied=false;
    health=new C.PlaybackHealth(boundAt);state.activePath=location.pathname;
    applyAudio(target);
    const opt={signal:abortVideo.signal};
    target.addEventListener('ended',()=>finish(target),opt);
    target.addEventListener('playing',()=>{if(state.running&&target===video){if(!speedApplied)applySpeed(target);say(`正在播放 ${state.index+1}/${state.queue.length}：${state.queue[state.index].title}${mutedByUs?'（静音，可手动开声）':''}`);}},opt);
    target.addEventListener('loadedmetadata',()=>{if(state.running&&target===video)applySpeed(target);},opt);
    target.addEventListener('ratechange',()=>{if(target===video)$('actualSpeed').textContent=` 当前 ${target.playbackRate}×`;},opt);
    target.addEventListener('volumechange',()=>{if(target===video)showAudio(target);},opt);
    target.addEventListener('pause',()=>{capturePosition(true);if(state.running&&state.phase==='video'&&target===video&&!target.ended)say('视频已暂停。可点击“继续”，或处理平台弹窗后手动播放。');},opt);
    target.addEventListener('error',()=>{if(state.running&&target===video)stop('视频加载失败，请手动确认页面后继续。',false);},opt);
    state.phase='video';save();record('已连接当前 HTML5 播放器。');
  }
  function tick(){
    if(!state.running)return;
    if(course()!==state.course)return stop('已离开本课程，连播停止。',false);
    if(state.phase==='recovering')return;
    if(state.phase==='returning'){
      if(directory()){state.phase='directory';navigationAt=Date.now();save();}
      else if(Date.now()-navigationAt>20000)stop('返回目录未完成，请手动返回章节列表后继续。',false);
      return;
    }
    if(state.phase==='directory'){if(directory())void openItem();return;}
    if(state.phase==='ending')return;
    if(state.phase!=='opening'&&state.phase!=='video')return;
    if(state.activePath&&state.activePath!==location.pathname)return stop('已切换到其他页面，当前连播停止。',false);
    if(directory()){
      if(state.phase==='opening'&&Date.now()-state.since>15000)stop('视频条目未能打开，请重新识别或手动打开视频。',false);
      else if(state.phase==='video')stop('页面已返回目录，点击“继续”恢复队列。',false);
      return;
    }
    const target=docs().flatMap(doc=>Array.from(doc.querySelectorAll('video'))).filter(el=>el.isConnected&&el.getClientRects().length).sort((a,b)=>b.clientWidth*b.clientHeight-a.clientWidth*a.clientHeight)[0];
    if(!target){if(Date.now()-state.since>45000)stop('45 秒内未找到视频播放器，请手动点击页面播放按钮后继续。',false);return;}
    const src=target.currentSrc||target.src;
    if(target!==video||(src&&source&&src!==source))bind(target);
    if(!source&&src)source=src;
    if(target.error)return stop('平台视频加载失败，请手动确认后继续。',false);
    if(!speedApplied&&target.readyState>=1)applySpeed(target);
    // play() also triggers loading; waiting for metadata before play can deadlock lazy players.
    if(!attempted&&(src||target.querySelector('source')))void attemptPlay(target);
    let frames;try{frames=target.getVideoPlaybackQuality?.().totalVideoFrames;}catch(_){}
    const problem=health?.sample({now:Date.now(),time:target.currentTime,duration:target.duration,rate:target.playbackRate,frames,paused:target.paused,seeking:target.seeking,ended:target.ended,zeroClock:C.zeroClock(target)});
    if(problem)return recover(problem);
    if(restorePosition(target))capturePosition();
    if(target.ended)finish(target);
    if(target.readyState<1&&Date.now()-boundAt>45000)stop('播放器加载超时，请手动确认网络和视频后继续。',false);
  }
  render();
  say(state.queue.length?`已保存 ${state.queue.length} 节视频。${state.running?'正在恢复…':'点击“继续上次播放”接着看。'}`:'请在课程目录点击“识别全部视频”。');
  if(state.running){state.since=Date.now();navigationAt=Date.now();if(directory()){state.phase='directory';state.activePath=null;}else state.phase='opening';save();}
  if(state.lastRecovery&&state.lastRecovery.key===state.queue[state.index]?.key)record('已保留本节队列，等待刷新后的播放器重新加载。');
  if(state.course===course())save();
  record('连播助手 '+VERSION+' 就绪。');
  setInterval(()=>{try{tick();}catch(err){stop('运行异常：'+err.message,false);}},750);
})();
