(() => {
  'use strict';
  const entrance=document.querySelector('[data-mascot-entrance]');if(!entrance)return;
  const root=new URL('../',document.currentScript.src);
  const words={
    en:['Why ScriptaHub.com?','Ask AI Librarian','What would you like to explore?','Find books','Close presentation','Loading the presentation…','The presentation could not load. Close it and try again.'],
    ro:['Ce este ScriptaHub.com?','Întreabă bibliotecarul AI','Ce ai vrea să explorezi?','Găsește cărți','Închide prezentarea','Se încarcă prezentarea…','Prezentarea nu s-a încărcat. Închide și încearcă din nou.'],
    fr:['Qu’est-ce que ScriptaHub.com ?','Bibliothécaire IA','Que souhaitez-vous explorer ?','Trouver des livres','Fermer la présentation','Chargement de la présentation…','La présentation n’a pas pu être chargée. Fermez-la et réessayez.'],
    de:['Was ist ScriptaHub.com?','KI-Bibliothekar fragen','Was möchten Sie erkunden?','Bücher finden','Präsentation schließen','Präsentation wird geladen…','Die Präsentation konnte nicht geladen werden. Schließen Sie sie und versuchen Sie es erneut.'],
    es:['¿Qué es ScriptaHub.com?','Bibliotecario IA','¿Qué te gustaría explorar?','Buscar libros','Cerrar presentación','Cargando la presentación…','No se pudo cargar la presentación. Ciérrala e inténtalo de nuevo.'],
    pt:['O que é ScriptaHub.com?','Bibliotecário IA','O que gostaria de explorar?','Encontrar livros','Fechar apresentação','A carregar a apresentação…','Não foi possível carregar a apresentação. Feche e tente novamente.'],
    it:['Cos’è ScriptaHub.com?','Bibliotecario IA','Che cosa vorresti esplorare?','Trova libri','Chiudi presentazione','Caricamento della presentazione…','Impossibile caricare la presentazione. Chiudila e riprova.'],
    pl:['Czym jest ScriptaHub.com?','Bibliotekarz AI','Co chcesz odkryć?','Znajdź książki','Zamknij prezentację','Ładowanie prezentacji…','Nie udało się załadować prezentacji. Zamknij ją i spróbuj ponownie.']
  };
  let language='en',loadPromise=null,attempt=0;
  const icon=kind=>kind==='play'?'<svg viewBox="0 0 24 24"><path d="m9 5 11 7-11 7Z"/></svg>':'<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 1-8 8H5l-4 3 2-7a8 8 0 1 1 17-4Z"/><path d="M7 10h8M7 14h5"/></svg>';
  entrance.innerHTML=`<div class="mascot-portrait" data-mascot-portrait>${ScriptaMascot.svg()}</div><div class="mascot-options"><button class="mascot-choice" type="button" data-mascot-ask aria-expanded="false" aria-controls="mascot-question"><span class="mascot-choice-icon" aria-hidden="true">${icon('ask')}</span><span data-mascot-label="1"></span><span class="mascot-choice-arrow" aria-hidden="true">↗</span></button><button class="mascot-choice" type="button" data-mascot-start aria-haspopup="dialog"><span class="mascot-choice-icon" aria-hidden="true">${icon('play')}</span><span data-mascot-label="0"></span><span class="mascot-choice-arrow" aria-hidden="true">↗</span></button><form class="mascot-question" id="mascot-question" hidden><div class="mascot-question-entry"><label class="sr-only" for="mascot-query" data-mascot-label="2"></label><textarea id="mascot-query" rows="3" required maxlength="2000" aria-describedby="mascot-speech-status"></textarea><span id="mascot-speech-status" class="mascot-speech-status" role="status" aria-live="polite"></span></div><div class="mascot-question-actions"><button class="mascot-question-close" type="button" data-mascot-cancel aria-label="Close question"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18"/></svg></button><button type="button" data-mascot-dictate aria-label="Dictate" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 10v1a6 6 0 0 0 12 0v-1M12 17v4M9 21h6"/></svg></button><button type="submit" data-mascot-send><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 17 17 7M7 7h10v10"/></svg></button></div></form></div>`;
  const dialog=document.createElement('dialog');dialog.className='mascot-film-dialog';dialog.setAttribute('aria-label','ScriptaHub presentation');
  dialog.innerHTML='<div class="mascot-film-viewer"><button class="mascot-film-close presentation-close" type="button"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18"/></svg></button><p class="mascot-film-status" role="status" hidden></p><shf-player aria-label="ScriptaHub · An invitation to explore"></shf-player></div>';
  document.body.append(dialog);
  const player=dialog.querySelector('shf-player'),start=entrance.querySelector('[data-mascot-start]'),ask=entrance.querySelector('[data-mascot-ask]'),form=entrance.querySelector('form'),input=form.querySelector('textarea'),status=dialog.querySelector('[role=status]');
  const dictation=ScriptaDictation.bind({input,button:form.querySelector('[data-mascot-dictate]'),status:form.querySelector('[role=status]'),language});
  function showQuestion(focus=true){form.hidden=false;ask.setAttribute('aria-expanded','true');entrance.classList.add('is-asking');if(focus)input.focus();}
  function hideQuestion(){dictation.stop();entrance.dataset.questionDismissed='true';form.hidden=true;ask.setAttribute('aria-expanded','false');entrance.classList.remove('is-asking');ask.focus();}
  form.querySelector('[data-mascot-cancel]').addEventListener('click',hideQuestion);
  ask.addEventListener('click',()=>{if(form.hidden)showQuestion();else hideQuestion();});
  form.addEventListener('submit',event=>{event.preventDefault();dictation.stop();const request=input.value.trim();if(!request){input.focus();return;}const url=new URL('librarian/index.html',root);url.searchParams.set('lang',language);url.hash=new URLSearchParams({request}).toString();location.href=url.href;});
  input.addEventListener('keydown',e=>{if(e.key==='Escape')hideQuestion();if(e.key==='Enter'&&(e.ctrlKey||e.metaKey))form.requestSubmit();});
  const cleanup=()=>{++attempt;player.pause();document.body.classList.remove('mascot-film-open');status.hidden=true;start.focus();};
  dialog.addEventListener('close',cleanup);
  dialog.querySelector('button').addEventListener('click',()=>dialog.close());
  start.addEventListener('click',async()=>{
    const token=++attempt;dialog.showModal();document.body.classList.add('mascot-film-open');status.textContent=words[language][5];status.hidden=false;
    // Unlock during the explicit visitor gesture, then load and play only if still open.
    const unlocked=player.audio.unlock();
    try{
      if(!loadPromise)loadPromise=player.load(new URL('assets/films/library-introduction.shf',root).href).catch(e=>{loadPromise=null;throw e;});
      await Promise.all([loadPromise,unlocked]);if(token!==attempt||!dialog.open)return;
      player.setTheme('color');status.hidden=true;await player.play();
    }catch(error){if(token===attempt&&dialog.open){status.textContent=words[language][6];status.hidden=false;}}
  });
  function localize(next){language=words[next]?next:'en';dictation.setLanguage(language);for(const node of [...entrance.querySelectorAll('[data-mascot-label]'),...dialog.querySelectorAll('[data-mascot-label]')])node.textContent=words[language][+node.dataset.mascotLabel];input.placeholder=words[language][2];form.querySelector('[data-mascot-send]').setAttribute('aria-label',words[language][3]);form.querySelector('[data-mascot-send]').title=words[language][3];dialog.setAttribute('aria-label',words[language][0]);dialog.querySelector('.mascot-film-close').setAttribute('aria-label',words[language][4]);form.querySelector('[data-mascot-cancel]').setAttribute('aria-label',({en:'Close question',ro:'Închide întrebarea',fr:'Fermer la question',de:'Frage schließen',es:'Cerrar pregunta',pt:'Fechar pergunta',it:'Chiudi domanda',pl:'Zamknij pytanie'})[language]);if(location.hash==='#ask-librarian'&&form.hidden&&!entrance.dataset.questionDismissed)showQuestion(false);}
  document.addEventListener('scriptahub:language',e=>localize(e.detail.language));
  addEventListener('hashchange',()=>{if(location.hash==='#ask-librarian'){entrance.scrollIntoView({block:'center'});showQuestion();}});
  globalThis.ScriptaHomeLibrarian={localize};localize(new URL(location.href).searchParams.get('lang')||document.documentElement.lang);
})();
