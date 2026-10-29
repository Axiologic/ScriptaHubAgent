import {newSubmissionId} from './submission-policy.js';
// Embedded reader presentation must never leak into standalone navigation.
export function standaloneReaderUrl(readerURL) {
  const url = new URL(readerURL);
  url.searchParams.delete('view');
  return url;
}
// Suggest builds one contribution; annotations never submit independently.
export async function renderSuggest({root,book,lang,siteRoot,words,submitContribution,prepareContributionForm}) {
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const icon=(paths)=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.8');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');for(const d of paths){const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',d);svg.append(p);}return svg;};
  root.replaceChildren();
  const status=el('p','','workflow-status');status.dataset.workflowStatus='';status.setAttribute('role','status');root.append(status);
  try {
    const session=await fetch(new URL('api/session',siteRoot),{credentials:'same-origin',cache:'no-store'});
    if(session.status===401){location.assign(`/auth/login?returnTo=${encodeURIComponent(location.pathname+location.search)}`);return;}
    if(!session.ok)throw Error('Could not verify your session.');
    if(!book)throw Error(words.missingBook);
    const contextURL=new URL('api/dashboard/book-context',siteRoot);contextURL.searchParams.set('bookId',book.id);
    const response=await fetch(contextURL,{credentials:'same-origin',cache:'no-store'});
    if(!response.ok)throw Error('Could not open this book for suggestions.');
    const context=await response.json();
    const readerURL=globalThis.ScriptaReading.readingUrl(book,lang,'read',lang,siteRoot);
    if(!readerURL)throw Error('An HTML edition is required to annotate this book.');
    const language=readerURL.searchParams.get('language'),edition=readerURL.searchParams.get('id');
    const key=`scriptahub:suggest:${context.bookId}:${context.revision}:${language}`;
    const user=(await session.json()).user;const draftKey=key+':'+user.id;
    let items=[];try{const saved=JSON.parse(sessionStorage.getItem(draftKey)||'[]');if(Array.isArray(saved))items=saved;}catch{}
    const help=el('p','Select a passage, then choose “Suggest a change”. Review all annotations before submitting.','workflow-note');
    const add=el('button',undefined,'button button-no-icon suggest-selection-action');add.append(icon(['M21 11V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v16l4-4h8','m13 11 6-6 3 3-6 6-4 1 1-4Z']),el('span','Suggest a change'));add.type='button';add.title='Suggest a change';add.setAttribute('aria-label','Suggest a change');add.setAttribute('aria-haspopup','dialog');add.disabled=true;add.hidden=true;
    readerURL.searchParams.set('view','suggest');
    const frame=el('iframe');frame.title='Book to annotate';frame.src=readerURL.href;frame.className='suggest-reader';
    const list=el('details',undefined,'suggest-annotations');list.setAttribute('aria-label','Draft annotations');
    const summary=el('summary');const count=el('span','0','suggest-annotation-count');count.setAttribute('aria-live','polite');
    summary.append(el('span','Annotations'),count,icon(['m6 9 6 6 6-6']));
    const annotationBody=el('div',undefined,'suggest-annotation-list');list.append(summary,annotationBody);
    const form=el('form',undefined,'workflow-form suggest-proposal-form');
    const hidden=(name,value)=>{const n=el('input');n.type='hidden';n.name=name;n.value=value;form.append(n);return n;};
    const annotationsField=hidden('annotations','');hidden('baseRevision',String(context.revision));hidden('annotationDraftKey',draftKey);
    const submitInfo=el('span','','suggest-submit-info');submitInfo.setAttribute('aria-live','polite');
    const submit=el('button','Submit','workflow-submit');submit.type='submit';const submitBar=el('div',undefined,'workflow-form suggest-submit-bar');submitBar.append(submitInfo,submit);form.append(submitBar);prepareContributionForm(form,lang);
    const dialog=el('dialog',undefined,'suggest-dialog');dialog.setAttribute('aria-labelledby','suggest-dialog-title');
    const dialogHeader=el('header',undefined,'suggest-dialog-header');const dialogTitle=el('h2','Suggest a change');dialogTitle.id='suggest-dialog-title';
    const close=el('button',undefined,'site-icon-button suggest-dialog-close');close.type='button';close.title='Close';close.setAttribute('aria-label','Close suggestion');close.append(icon(['M6 6l12 12M18 6 6 18']));close.onclick=()=>dialog.close();dialogHeader.append(dialogTitle,close);
    const edit=el('form',undefined,'workflow-form');const quote=el('blockquote');
    const field=(label,name,tag)=>{const wrap=el('label',undefined,'form-field');wrap.append(el('span',label));const n=el(tag);n.name=name;wrap.append(n);edit.append(wrap);return n;};
    const passage=el('section',undefined,'suggest-passage');passage.append(el('span','Selected passage','suggest-field-label'),quote);edit.append(passage);
    const kind=field(words.kind,'kind','select');for(const label of words.kinds){const n=el('option',label);n.value=label;kind.append(n);}
    const feedback=field(words.feedback,'feedback','textarea');feedback.required=true;feedback.maxLength=4000;
    const sources=field(words.sources,'sources','textarea');sources.maxLength=4000;
    const save=el('button','Save annotation','workflow-submit');save.type='submit';const actions=el('footer',undefined,'suggest-dialog-actions');actions.append(save);edit.append(actions);dialog.append(dialogHeader,edit);
    feedback.rows=4;feedback.placeholder=words.feedbackHint||'';sources.rows=2;sources.placeholder=words.sourcesHint||'';ScriptaContributionBridge.bindFormValidity(edit);
    const fitDialog=()=>{const viewport=window.visualViewport;if(!viewport||!dialog.open)return;const margin=innerWidth<=600?10:16;dialog.style.maxHeight=Math.max(100,viewport.height-2*margin)+'px';dialog.style.top=viewport.offsetTop+'px';dialog.style.bottom=Math.max(0,innerHeight-viewport.offsetTop-viewport.height)+'px';};
    const openDialog=()=>{add.hidden=true;edit.updateContributionState();dialog.showModal();fitDialog();window.visualViewport?.addEventListener('resize',fitDialog);window.visualViewport?.addEventListener('scroll',fitDialog);};
    dialog.addEventListener('close',()=>{window.visualViewport?.removeEventListener('resize',fitDialog);window.visualViewport?.removeEventListener('scroll',fitDialog);dialog.style.removeProperty('max-height');dialog.style.removeProperty('top');dialog.style.removeProperty('bottom');refreshSelection();});
    let selected=null,editing=null,refreshSelection=()=>{},positionAction=()=>{},detachReader=()=>{},positionFrame=0;
    const queuePosition=()=>{
      if(!add.isConnected){
        window.removeEventListener('scroll',queuePosition,true);window.removeEventListener('resize',queuePosition);
        window.visualViewport?.removeEventListener('scroll',queuePosition);window.visualViewport?.removeEventListener('resize',queuePosition);
        detachReader();layoutObserver.disconnect();cancelAnimationFrame(positionFrame);return;
      }
      if(!positionFrame)positionFrame=requestAnimationFrame(()=>{positionFrame=0;if(add.isConnected)positionAction();});
    };
    const layoutObserver=new ResizeObserver(queuePosition);
    // Keep pointer activation from clearing the reader's selection before click.
    add.addEventListener('mousedown',event=>event.preventDefault());
    const persist=()=>{sessionStorage.setItem(draftKey,JSON.stringify(items));};
    const show=()=>{count.textContent=String(items.length);count.setAttribute('aria-label',`${items.length} draft annotations`);annotationBody.replaceChildren();form.dataset.contributionReady=String(items.length>0);form.updateContributionState();submitInfo.textContent=items.length?`${items.length} annotation${items.length===1?'':'s'} ready`:'Add an annotation to submit';
      if(!items.length)annotationBody.append(el('p','No annotations yet. Select a passage to add one.','workflow-note'));
      for(const item of items){const card=el('article',undefined,'dashboard-card');card.append(el('blockquote',item.quote),el('p',item.feedback));
        const controls=el('div',undefined,'dashboard-actions');
        const change=el('button','Edit','button button-no-icon');change.type='button';change.onclick=()=>{editing=item;selected=item;quote.textContent=item.quote;kind.value=item.kind;feedback.value=item.feedback;sources.value=item.sources;openDialog();};
        const remove=el('button','Remove','button button-no-icon');remove.type='button';remove.onclick=()=>{items=items.filter(other=>other.id!==item.id);persist();show();};controls.append(change,remove);card.append(controls);annotationBody.append(card);
      }
    };
    frame.addEventListener('load',()=>{
      detachReader();add.hidden=true;
      const doc=frame.contentDocument,stage=doc?.querySelector('[data-reader-stage]');
      if(!stage){status.textContent='The reader could not be opened for annotation.';return;}
      let activeRange=null;
      positionAction=()=>{
        const selection=doc.getSelection();
        if(dialog.open||!activeRange||!selected||!selection?.rangeCount||selection.isCollapsed||!stage.contains(activeRange.commonAncestorContainer)){add.hidden=true;return;}
        const reader=frame.getBoundingClientRect(),viewport=window.visualViewport,edge=8;
        const scaleX=reader.width/frame.offsetWidth,scaleY=reader.height/frame.offsetHeight;
        const stageBox=stage.getBoundingClientRect();
        const minX=(viewport?.offsetLeft||0)+edge,minY=(viewport?.offsetTop||0)+edge;
        const viewportRight=(viewport?.offsetLeft||0)+(viewport?.width||innerWidth)-edge;
        const viewportBottom=(viewport?.offsetTop||0)+(viewport?.height||innerHeight)-edge;
        const clip={left:Math.max(minX,reader.left+(frame.clientLeft+stageBox.left)*scaleX),
          right:Math.min(viewportRight,reader.right,reader.left+(frame.clientLeft+stageBox.right)*scaleX),
          top:Math.max(minY,reader.top+(frame.clientTop+stageBox.top)*scaleY),
          bottom:Math.min(viewportBottom,reader.bottom,reader.top+(frame.clientTop+stageBox.bottom)*scaleY)};
        const passage=[...activeRange.getClientRects()].map(rect=>({left:reader.left+(frame.clientLeft+rect.left)*scaleX,
          right:reader.left+(frame.clientLeft+rect.right)*scaleX,top:reader.top+(frame.clientTop+rect.top)*scaleY,
          bottom:reader.top+(frame.clientTop+rect.bottom)*scaleY}))
          .find(rect=>rect.right>clip.left&&rect.left<clip.right&&rect.bottom>clip.top&&rect.top<clip.bottom);
        if(!passage){add.hidden=true;return;}
        add.hidden=false;
        const width=add.offsetWidth,height=add.offsetHeight;
        const maxX=viewportRight-width,maxY=viewportBottom-height;
        const fitsRight=passage.right+edge+width<=viewportRight;
        add.style.left=Math.max(minX,Math.min(maxX,fitsRight?passage.right+edge:passage.right-width))+'px';
        add.style.top=Math.max(minY,Math.min(maxY,fitsRight?Math.max(passage.top,clip.top):Math.min(passage.bottom,clip.bottom)+edge))+'px';
      };
      refreshSelection=()=>{
        if(dialog.open){add.hidden=true;return;}
        const selection=doc.getSelection();
        if(!selection?.rangeCount||selection.isCollapsed){activeRange=null;selected=null;add.disabled=true;add.hidden=true;return;}
        const range=selection.getRangeAt(0),quoteText=range.toString();
        if(!stage.contains(range.commonAncestorContainer)||!quoteText.trim()||quoteText.length>4000){activeRange=null;selected=null;add.disabled=true;add.hidden=true;return;}
        const before=range.cloneRange();before.selectNodeContents(stage);before.setEnd(range.startContainer,range.startOffset);
        const text=stage.textContent,start=before.toString().length;
        selected={quote:quoteText,start,end:start+quoteText.length,prefix:text.slice(Math.max(0,start-100),start),suffix:text.slice(start+quoteText.length,start+quoteText.length+100),section:range.startContainer.parentElement?.closest('section')?.querySelector('h1,h2,h3')?.textContent||'',edition,language};
        activeRange=range.cloneRange();add.disabled=false;queuePosition();
      };
      const events=[['selectionchange',refreshSelection,false],['scroll',queuePosition,true],['click',queuePosition,true],['input',queuePosition,true],['change',queuePosition,true],['load',queuePosition,true]];
      for(const [name,handler,capture]of events)doc.addEventListener(name,handler,{capture,passive:true});
      frame.contentWindow.addEventListener('resize',queuePosition);
      layoutObserver.observe(stage);
      detachReader=()=>{for(const [name,handler,capture]of events)doc.removeEventListener(name,handler,capture);doc.defaultView?.removeEventListener('resize',queuePosition);layoutObserver.unobserve(stage);};
      doc.fonts?.ready.then(queuePosition);
      refreshSelection();
    });
    add.onclick=()=>{if(!selected)return;editing=null;edit.reset();quote.textContent=selected.quote;openDialog();};
    edit.onsubmit=event=>{event.preventDefault();if(!edit.reportValidity()||!selected)return;
      const item={...selected,id:editing?.id||newSubmissionId(),kind:kind.value,feedback:feedback.value,sources:sources.value};delete item.text;
      const next=editing?items.map(old=>old.id===editing.id?item:old):[...items,item];
      if(next.length>50||JSON.stringify(next).length>16000){status.textContent='This proposal is too large. Shorten the annotations or submit a smaller set.';return;}
      items=next;persist();show();dialog.close();
    };
    form.onsubmit=async event=>{event.preventDefault();if(!items.length)return;annotationsField.value=JSON.stringify(items);
      const submitted=await submitContribution(`ScriptaHub edition feedback: ${book.title?.[lang]||book.title?.en}`, [`Book ID: ${book.id}`,`Edition language: ${language}`,`Annotations: ${items.length}`],language,form);
      if(submitted!==true)return;
      const previous=document.referrer?new URL(document.referrer):null;
      if(previous&&previous.origin===siteRoot.origin&&previous.pathname.startsWith(siteRoot.pathname)&&previous.pathname!==location.pathname&&history.length>1) {
        history.back();
      } else {
        location.replace(standaloneReaderUrl(readerURL).href);
      }
    };
    window.addEventListener('scroll',queuePosition,{capture:true,passive:true});window.addEventListener('resize',queuePosition);
    window.visualViewport?.addEventListener('scroll',queuePosition,{passive:true});window.visualViewport?.addEventListener('resize',queuePosition);
    root.replaceChildren(help,add,frame,list,form,dialog);form.append(status);layoutObserver.observe(frame);show();
  }catch(error){status.textContent=error.message;}
}
