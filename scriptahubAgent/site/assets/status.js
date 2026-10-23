(() => {
  const root=document.querySelector('[data-voice-status]');
  if(!root)return;
  function render(){
  const data=window.SCRIPTA_VOICE_MIGRATION_STATUS;
  if(!data){root.textContent='Stadiul prezentărilor nu a fost generat încă.';return;}
  const runtimeUnavailable=(data.entries||[]).some(entry=>String(entry.publicationError||'').includes('shf-presentation-creator/runtime/shf-core.js'));
  const queryBefore=root.querySelector('[data-status-search]')?.value||'';
  const focusSearch=document.activeElement===root.querySelector('[data-status-search]');
  const openTitles=new Set([...root.querySelectorAll('details[open]')].map(details=>details.closest('article').dataset.statusBook));
  const labels={'publication-invalid':runtimeUnavailable?'Verificarea filmelor așteaptă runtime-ul SHF':'Arhivă SHF publicată invalidă · necesită reconstruire','qwen-complete':'Scenariu curent publicat cu voce Qwen','rendering':'Generarea vocii în curs','pending-piper':'Înregistrare Piper anterioară','needs-render':'Generarea vocii în așteptare','needs-rerender':'Înregistrarea Qwen necesită actualizare','untracked':'Proiect lipsă'};
  const reviews={reviewed:'Scenariu revizuit independent','independent-review-pending':'Ciornă rescrisă · revizuirea independentă lipsește','rewrite-pending':'Rescriere editorială necesară'};
  const order=['publication-invalid','qwen-complete','rendering','needs-rerender','pending-piper','needs-render','untracked'];
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const duration=ms=>`${Math.floor(ms/60000)}:${String(Math.round(ms/1000)%60).padStart(2,'0')}`;
  const link=(url,label)=>`<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(label)}</a>`;
  const planText=value=>typeof value==='string'?value:Array.isArray(value)?value.map(planText).join(' '):value&&typeof value==='object'?Object.entries(value).map(([key,text])=>`${key}: ${planText(text)}`).join(' '):'';
  const article=entry=>{
    const review=entry.editorialReview;
    const stages=entry.stages||{};
    const failed=(entry.status==='publication-invalid'&&!runtimeUnavailable)||Object.values(stages).some(stage=>['failed','interrupted','review-required'].includes(stage.status));
    const done=stages.animation?.status==='done'&&stages.voice?.status==='done';
    const checking=entry.status==='qwen-complete'||['built','reviewing'].includes(stages.animation?.status)||stages.voice?.status==='generated';
    const state=entry.active?'active':failed?'failed':done?'done':checking?'review':'pending';
    const stateLabel={active:'În lucru',failed:'Necesită atenție',done:'Gata',review:'De verificat',pending:'De făcut'}[state];
    const currentSteps=Object.entries(stages).filter(([,stage])=>['running','reviewing','rewriting'].includes(stage.status)).map(([name])=>({text:'text',animation:'animație',voice:'voce'}[name]||name));
    const remaining=entry.status==='publication-invalid'&&runtimeUnavailable
      ? 'Verificarea filmului nu poate rula până când este restaurat runtime-ul SHF; starea arhivei nu este încă stabilită.'
      : entry.status==='publication-invalid'
      ? 'Arhiva SHF publicată nu poate fi citită după încercări repetate. Filmul trebuie reconstruit și publicat din nou; rândul rămâne vizibil până când arhiva poate fi citită.'
      : entry.status==='qwen-complete'
      ? 'Textul curent și audio sunt în filmul publicat; audiția și verificarea vizuală sunt controale separate.'
      : `${entry.editorialStatus==='reviewed'?'':'Încheie revizuirea scenariului. '}Adaptează grafica la scene, generează narațiunea schimbată, măsoară și ajustează durata, apoi reconstruiește și verifică filmul în toate cele trei teme.`;
    return `<article data-status-book="${escape(entry.title.toLowerCase())}" data-work-state="${state}">
      <div><h3>${link(entry.bookPage,entry.title)} <span class="status-indicator status-indicator-${state}"><span aria-hidden="true">${entry.active?'●':done?'✓':failed?'!':'○'}</span> ${stateLabel}${entry.active&&currentSteps.length?` · ${escape(currentSteps.join(' + '))}`:''}</span></h3>
        <p class="status-stages">Text: ${escape(entry.stages?.text?.status||entry.editorialStatus)} · Animație: ${escape(entry.stages?.animation?.status||'pending')} · Voce: ${escape(entry.stages?.voice?.status||'pending')}</p>
        ${Object.entries(stages).filter(([,stage])=>['failed','interrupted','review-required'].includes(stage.status)&&stage.note).map(([name,stage])=>`<p class="status-note"><strong>${escape(name)}:</strong> ${escape(stage.note)}</p>`).join('')}
        <p>${escape(reviews[entry.editorialStatus]||'Revizuire în așteptare')} · ${entry.scriptWords||0} cuvinte · țintă 1–2 min, maximum 2 min</p>
        <p>Vocea din filmul publicat: ${escape(entry.publishedVoice||entry.voice||'Voce necunoscută')} · ${duration(entry.durationMs||0)}.</p>
        <p>Voce planificată: ${escape(entry.plannedVoice||'Qwen local; alegerea vocii în așteptare')}.</p>
      </div>
      <div class="status-actions">${link(entry.bookPage,'Cartea')}${entry.animationPage?link(entry.animationPage,'Animația publicată'):''}</div>
      <details${openTitles.has(entry.title.toLowerCase())?' open':''}><summary>Scenariul rostit și planul filmului</summary>
        ${review?.hook?`<p class="status-hook"><strong>Opening hook:</strong> ${escape(review.hook)}</p>`:''}
        ${review?.distinctiveContribution?`<p><strong>Distinctive idea:</strong> ${escape(planText(review.distinctiveContribution))}</p>`:''}
        <h4>Narațiunea exactă</h4>
        ${(entry.script||[]).map(scene=>{
          const plan=entry.visualPlan?.scenes?.find(item=>item.sceneId===scene.id);
          return `<section class="status-scene"><h5>${escape(scene.title)}</h5>
            ${plan?`<p><strong>On screen:</strong> ${escape(planText(plan.composition))}</p>`:''}
            <ol>${scene.lines.map((line,index)=>{
              const intent=review?.independentReview?.sentenceIntentions?.find(item=>item.sceneId===scene.id&&item.line===index+1);
              const cue=plan?.cues?.find(item=>item.line===index+1);
              return `<li><p class="status-spoken">${escape(line)}</p><dl class="status-direction">
                <div><dt>Purpose</dt><dd>${escape(planText(intent?.purpose)||'Final review pending')}</dd></div>
                <div><dt>Viewer response</dt><dd>${escape(planText(intent?.viewerResponse)||'Final review pending')}</dd></div>
                <div><dt>Voice</dt><dd>${escape(scene.emotions?.[index]||'Pending')} · intensity ${Math.round((scene.intensities?.[index]||0)*100)}% · pause ${((scene.pausesMs?.[index]||0)/1000).toFixed(1)} s</dd></div>
                <div><dt>Exact TTS direction</dt><dd>${escape(scene.voiceDirections?.[index]||'Pending')}</dd></div>
                <div><dt>Visual cue</dt><dd>${escape(planText(cue?.visualAction)||'Detailed visual plan pending')}</dd></div>
              </dl></li>`;
            }).join('')}</ol>
            ${plan?`<p><strong>Keep:</strong> ${escape(planText(plan.keep)||'None')}<br><strong>Remove:</strong> ${escape(planText(plan.remove)||'None')}<br><strong>Add or change:</strong> ${escape(planText(plan.addOrChange)||'None')}</p>`:''}
          </section>`;
        }).join('')}
        <h4>Plan vizual propus</h4>
        <p>${escape(planText(review?.visualPlan)||'Book-specific visual revision plan pending.')}</p>
        <p>${entry.presentationPlan?.scenes||0} selected scenes, ${entry.presentationPlan?.beats||0} narration sentences. Final duration will come from the measured audio.</p>
        ${entry.visualPlan?.checks?`<p><strong>Checks before completion:</strong> ${escape(planText(entry.visualPlan.checks))}</p>`:''}
        <h4>Ce rămâne de făcut</h4><p>${escape(remaining)}</p>
      </details>
    </article>`;
  };
  const c=data.editorialCounts||{};
  const active=data.entries.filter(entry=>entry.active);
  const finished=data.entries.filter(entry=>entry.status==='qwen-complete'&&entry.animationCompleted&&entry.voiceGenerated);
  const finishedTable=`<section class="status-group status-finished" data-finished-films><h2>Filme finalizate și publicate <small>${finished.length}</small></h2><p class="status-note">Animație verificată și voce nouă, disponibile în filmul publicat.</p>${finished.length?`<div class="status-table-scroll"><table><thead><tr><th scope="col">Carte</th><th scope="col">Durată</th><th scope="col">Voce</th><th scope="col">Linkuri</th></tr></thead><tbody>${finished.map(entry=>`<tr data-status-book="${escape(entry.title.toLowerCase())}"><th scope="row">${link(entry.bookPage,entry.title)}</th><td>${duration(entry.durationMs)}</td><td>${escape(entry.publishedVoiceId||entry.publishedVoice||entry.voice)}</td><td><div class="status-actions">${link(entry.animationPage,'Vezi filmul')}${link(entry.bookPage,'Cartea')}</div></td></tr>`).join('')}</tbody></table></div>`:'<p>Niciun film finalizat încă.</p>'}</section>`;
  root.innerHTML=`${runtimeUnavailable?'<p class="status-gate"><strong>Verificarea animațiilor așteaptă instrumentele SHF.</strong> Legăturile către ScriptaSkillSet indică un director lipsă. Arhivele afișate mai jos nu au fost verificate, deci nu sunt declarate defecte. Conversiile cărților continuă separat.</p>':data.productionPause?.paused?'<p class="status-gate"><strong>Producția prezentărilor este oprită la cererea editorului.</strong> Progresul este salvat; reluarea se face doar la cerere. Conversiile cărților de mai sus sunt urmărite separat.</p>':''}<p class="status-updated">Actualizat: ${new Date(data.updatedAt).toLocaleString('ro-RO')} · verificare la fiecare minut · prezentări ale cărților</p>
    <p class="status-gate">${data.conversionGate==='plans-reviewed'?'Toate scenariile și planurile vizuale sunt gata. Vocea și filmul sunt urmărite separat mai jos.':`Planuri vizuale pregătite: ${data.visualPlans||0}/${data.entries.length} prezentări urmărite. Producția vocii așteaptă revizuirea scenariilor și a planurilor.`}</p>
    <div class="status-counts"><div><strong>${active.length}</strong><span>În lucru acum</span></div><div><strong>${data.entries.length}</strong><span>Prezentări urmărite</span></div><div><strong>${c.reviewed||0}</strong><span>Texte revizuite</span></div><div data-production-count="animations"><strong>${data.productionCounts?.animations||0}</strong><span>Animații realizate</span><small>Vizual verificat</small></div><div data-production-count="voices"><strong>${data.productionCounts?.voices||0}</strong><span>Voci generate</span><small>Textul curent înregistrat</small></div><div data-production-count="published"><strong>${data.productionCounts?.published??data.counts?.['qwen-complete']??0}</strong><span>Filme noi publicate</span><small>Voce și animație împachetate</small></div><div data-production-count="publication-invalid"><strong>${data.productionCounts?.publicationInvalid??data.counts?.['publication-invalid']??0}</strong><span>${runtimeUnavailable?'Arhive neverificate':'Arhive SHF invalide'}</span><small>${runtimeUnavailable?'Lipsește runtime-ul SHF':'Necesită reconstruire'}</small></div></div>
    <label class="status-search">Caută o prezentare<input type="search" placeholder="Titlul cărții" data-status-search></label>
    ${active.length?`<section class="status-group status-active"><h2>În lucru acum <small>${active.length}</small></h2><div class="status-list">${active.map(article).join('')}</div></section>`:'<p class="status-idle">Nicio carte nu este procesată în acest moment.</p>'}
    ${finishedTable}
    ${order.map(key=>{const entries=data.entries.filter(entry=>entry.status===key&&!entry.active);return entries.length?`<section class="status-group"><h2>${labels[key]} <small>${entries.length}</small></h2><div class="status-list">${entries.map(article).join('')}</div></section>`:'';}).join('')}`;
  root.querySelector('[data-status-search]').addEventListener('input',event=>{
    const query=event.target.value.toLowerCase().trim();
    root.querySelectorAll('[data-status-book]').forEach(article=>{article.hidden=!article.dataset.statusBook.includes(query);});
    root.querySelectorAll('.status-group').forEach(group=>{group.hidden=![...group.querySelectorAll('[data-status-book]')].some(article=>!article.hidden)&&!(group.hasAttribute('data-finished-films')&&!finished.length&&!query);});
  });
  const search=root.querySelector('[data-status-search]');search.value=queryBefore;search.dispatchEvent(new Event('input'));
  if(focusSearch)search.focus({preventScroll:true});
  }
  render();
  let refreshing=false;
  const refresh=()=>{
    if(refreshing)return;
    refreshing=true;
    const script=document.createElement('script');
    script.src=`assets/voice-migration-status.js?t=${Date.now()}`;
    script.onload=()=>{refreshing=false;script.remove();render();};
    script.onerror=()=>{refreshing=false;script.remove();};
    document.head.append(script);
  };
  setInterval(refresh,60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
})();
