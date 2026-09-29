/* DOM adapter: only marked video leaves in the actual Element UI course tree. */
(function(root) {
  'use strict';
  const clean = value => (value || '').replace(/[\ue000-\uf8ff]/g, '').replace(/\s+/g, ' ').trim();
  const ownContent = node => Array.from(node.children).find(el => el.classList.contains('el-tree-node__content'));
  const titleOf = content => {
    if (!content) return '';
    const copy = content.cloneNode(true);
    copy.querySelectorAll('i,svg,.el-tree-node__expand-icon,.el-checkbox,.el-badge__content').forEach(el => el.remove());
    return clean(copy.textContent);
  };
  function videoMarker(content, style = getComputedStyle) {
    return Array.from(content.querySelectorAll('i,[class]')).some(el => {
      if (el.classList.contains('el-tree-node__expand-icon')) return false;
      if (/(?:^|[-_ ])(?:video|shipin)(?:[-_ ]|$)/i.test(el.getAttribute('class') || '')) return true;
      if ((el.textContent || '').includes('\ue63e')) return true;
      try { return (style(el, '::before').content || '').includes('\ue63e'); } catch (_) { return false; }
    });
  }
  function platformStatus(content,style=getComputedStyle){
    let completed=false,started=false,knownVideo=false;
    for(const el of content.querySelectorAll('i,span,[class]')){
      let glyph=el.textContent||'';try{glyph+=(style(el,'::before').content||'')+(style(el,'::after').content||'');}catch(_){}
      // Verified against ZJOOC's green check and orange in-progress dot.
      if(glyph.includes('\ue621'))completed=true;
      if(glyph.includes('\ue619'))started=true;
      if(glyph.includes('\ue63e'))knownVideo=true;
      const label=el.getAttribute('aria-label')||el.getAttribute('title')||'';
      if(/^(已完成|已学完|学习完成)$/.test(label.trim()))completed=true;
      if(/^(学习中|进行中|未完成)$/.test(label.trim()))started=true;
    }
    return completed?'completed':started?'in-progress':knownVideo?'not-started':'unknown';
  }
  function mergePlatform(queue,found){
    const byKey=new Map(found.map(item=>[item.key,item]));
    return queue.map(item=>{
      const current=byKey.get(item.key);if(!current)return item;
      return {...item,platformStatus:current.platformStatus,selected:item.manualSelection===undefined?current.platformStatus!=='completed':item.manualSelection};
    });
  }
  function videos(doc = document, style = getComputedStyle) {
    return Array.from(doc.querySelectorAll('[role="treeitem"]')).flatMap(node => {
      const content = ownContent(node);
      if (!content || !videoMarker(content, style)) return [];
      // A parent whose subtree happens to include a video is never a video itself.
      if (node.querySelector('[role="treeitem"]')) return [];
      const title = titleOf(content);
      if (!title) return [];
      const path = [title];
      for (let parent = node.parentElement?.closest('[role="treeitem"]'); parent; parent = parent.parentElement?.closest('[role="treeitem"]')) path.unshift(titleOf(ownContent(parent)));
      return [{key: JSON.stringify(path), title, path, platformStatus:platformStatus(content,style), element: content.querySelector(':scope > div > span') || content.lastElementChild || content}];
    });
  }
  function collapsed(doc = document) {
    return Array.from(doc.querySelectorAll('[role="treeitem"]')).flatMap(node => {
      const icon = ownContent(node)?.querySelector('.el-tree-node__expand-icon');
      if (!icon || icon.classList.contains('is-leaf') || node.getAttribute('aria-expanded') === 'true' || node.classList.contains('is-expanded')) return [];
      return [icon];
    });
  }
  function exactText(doc, text) {
    return Array.from(doc.querySelectorAll('a,button,span,div')).find(el => clean(el.textContent) === text && !Array.from(el.children).some(c => clean(c.textContent) === text));
  }
  function nextIndex(queue, from) {
    for (let i=from+1; i<queue.length; i++) if (queue[i].selected !== false) return i;
    return queue.length;
  }
  // These are the options verified in ZJOOC's current native player menu.
  const DEFAULT_RATES=[0.5,1,1.25,1.5,2,4];
  function speedOptions(video){
    for(let root=video.parentElement,depth=0;root&&depth<6;root=root.parentElement,depth++){
      if(/^(BODY|HTML)$/.test(root.tagName)||root.querySelectorAll('video').length!==1)break;
      const options=Array.from(root.querySelectorAll('button,li,span,div')).flatMap(el=>{
        if(el.children.length)return [];
        const text=clean(el.textContent),match=text.match(/^(\d+(?:\.\d+)?)\s*(?:倍速?|[xX×])$/);
        const rate=text==='正常'?1:match?Number(match[1]):0;
        return rate>0&&rate<=16?[{rate,element:el}]:[];
      });
      if(new Set(options.map(x=>x.rate)).size>=2)return options;
    }
    return [];
  }
  function chosenRate(mode, options){
    const rates=options.length?Array.from(new Set(options.map(x=>x.rate))).sort((a,b)=>a-b):DEFAULT_RATES;
    const wanted=mode==='max'||mode==null?rates[rates.length-1]:Number(mode);
    return rates.includes(wanted)?wanted:rates[rates.length-1];
  }
  // Inspect only the active player's ancestors, never the whole course page.
  function zeroClock(video) {
    for (let el=video.parentElement, depth=0; el && depth<6; el=el.parentElement, depth++) {
      if (/^(BODY|HTML)$/.test(el.tagName) || el.querySelectorAll('video').length !== 1) break;
      const text=el.innerText || el.textContent || '';
      if (text.length>12000) break;
      const clocks=Array.from(text.matchAll(/(\d{1,2}:\d{2}(?::\d{2})?)\s*[/／|｜]\s*(\d{1,2}:\d{2}(?::\d{2})?)/g));
      if (clocks.length) return clocks.every(m=>/^0+$/.test((m[1]+m[2]).replace(/:/g,'')));
    }
    return null; // No readable clock is not evidence of failure.
  }
  class PlaybackHealth {
    constructor(now) {this.reset(now);}
    reset(now) {this.boundAt=now;this.previous=null;this.badSince=null;this.activeMs=0;this.lastAdvance=now;}
    sample(s) {
      const previous=this.previous;this.previous=s;
      if (s.paused || s.seeking || s.ended) {this.badSince=null;this.activeMs=0;return null;}
      const elapsed=previous ? s.now-previous.now : 0;
      const delta=previous ? s.time-previous.time : 0;
      // A seek, source reset or long suspension starts a fresh observation window.
      if (delta<0 || delta>Math.max(3,elapsed/1000*Math.max(1,s.rate||1)*1.75+1) || elapsed>5000) {
        this.badSince=null;this.activeMs=0;this.lastAdvance=s.now;return null;
      }
      const moved=previous && (delta>0.05 || (Number.isFinite(s.frames)&&Number.isFinite(previous.frames)&&s.frames>previous.frames));
      if(moved)this.lastAdvance=s.now;
      const missingDuration=!Number.isFinite(s.duration) && s.duration!==Infinity || s.duration<=0;
      const broken=s.zeroClock===true || (missingDuration && s.zeroClock!==false);
      if(!broken || s.now-this.lastAdvance>4000){this.badSince=null;this.activeMs=0;return null;}
      if(this.badSince===null)this.badSince=s.now;
      if(moved)this.activeMs+=Math.max(0,Math.min(elapsed,2000));
      if(s.now-this.boundAt>=15000 && s.now-this.badSince>=20000 && this.activeMs>=5000) {
        return s.zeroClock===true ? '画面在播放，但播放器时间持续显示 00:00 / 00:00' : '画面在播放，但视频时长持续未初始化';
      }
      return null;
    }
  }
  const api = {clean, titleOf, videoMarker, videos, collapsed, exactText, nextIndex, platformStatus, mergePlatform, zeroClock, PlaybackHealth, DEFAULT_RATES, speedOptions, chosenRate};
  root.ZjoocCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
