/* Local course bookmarks. No account credentials or network calls. */
(function(root){
  'use strict';
  const SESSION_KEY='zjooc-sequence-player-v2';
  const LOCAL_PREFIX='zjooc-autoplay-course-v1:';
  function valid(state,course){
    return !!state && state.schema===2 && state.course===course && Array.isArray(state.queue) &&
      state.queue.every(item=>item&&typeof item.key==='string'&&typeof item.title==='string') &&
      Number.isInteger(state.index)&&state.index>=0&&state.index<=state.queue.length;
  }
  function read(storage,key){try{return JSON.parse(storage.getItem(key));}catch(_){return null;}}
  function load(course,{session,local,navigationType='navigate'}){
    const sessionState=read(session,SESSION_KEY),saved=read(local,LOCAL_PREFIX+course);
    const persistent=saved?.format===1&&valid(saved.state,course)?saved.state:null;
    const transient=valid(sessionState,course)?sessionState:null;
    const state=persistent&&(!transient||(persistent.updatedAt||0)>(transient.updatedAt||0))?persistent:transient;
    if(!state)return {state:null,restored:false};
    const copy=JSON.parse(JSON.stringify(state));
    // Preserve exclusions made in versions before platform completion metadata existed.
    copy.queue.forEach(item=>{if(item.manualSelection===undefined&&!item.platformStatus&&item.selected===false)item.manualSelection=false;});
    // A browser session restore can preserve sessionStorage. Only a real reload auto-resumes.
    if(navigationType!=='reload'||state!==transient){copy.running=false;copy.phase='idle';}
    return {state:copy,restored:!!copy.queue.length};
  }
  function save(state,{session,local},now=Date.now()){
    state.updatedAt=now;let sessionOK=false,persistentOK=false;
    try{session.setItem(SESSION_KEY,JSON.stringify(state));sessionOK=true;}catch(_){}
    if(state.course){
      const snapshot={...state,running:false,phase:'idle'};
      try{local.setItem(LOCAL_PREFIX+state.course,JSON.stringify({format:1,savedAt:now,state:snapshot}));persistentOK=true;}catch(_){}
    }
    return {sessionOK,persistentOK};
  }
  function bookmark(sample,now=Date.now()){
    if(sample.zeroClock===true||sample.seeking||sample.readyState<2||!Number.isFinite(sample.duration)||sample.duration<=0||!Number.isFinite(sample.time)||sample.time<=0||sample.time>=sample.duration)return null;
    return {time:sample.time,duration:sample.duration,updatedAt:now};
  }
  function resumeTime(saved,duration){
    if(!saved||!Number.isFinite(saved.time)||saved.time<=0||!Number.isFinite(saved.duration)||!Number.isFinite(duration)||duration<=0)return null;
    if(Math.abs(saved.duration-duration)>Math.max(2,duration*0.02))return null;
    return Math.max(0,Math.min(saved.time-2,duration-2));
  }
  const api={SESSION_KEY,LOCAL_PREFIX,valid,load,save,bookmark,resumeTime};
  root.ZjoocPersistence=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
