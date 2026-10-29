(() => {
  'use strict';
  const policy = import(new URL('submission-policy.js', document.currentScript.src));
  const translations = {
    en: ['Submitting your contribution…', 'Contribution received. Reference:', 'Submitting this form sends it to ScriptaHub. Selected documents are uploaded after you accept the agreement.'],
    ro: ['Se trimite contribuția…', 'Contribuția a fost primită. Referință:', 'Trimiterea formularului îl transmite către ScriptaHub. Documentele selectate sunt încărcate după acceptarea acordului.'],
    fr: ['Envoi de votre contribution…', 'Contribution enregistrée. Référence :', 'Ce formulaire envoie votre contribution à ScriptaHub. Les documents sont téléversés après votre accord.'],
    de: ['Beitrag wird gesendet…', 'Beitrag gespeichert. Referenz:', 'Dieses Formular sendet Ihren Beitrag an ScriptaHub. Dokumente werden nach Ihrer Zustimmung hochgeladen.'],
    es: ['Enviando tu contribución…', 'Contribución guardada. Referencia:', 'Este formulario envía tu contribución a ScriptaHub. Los documentos se cargan después de aceptar el acuerdo.'],
    pt: ['A enviar a contribuição…', 'Contribuição guardada. Referência:', 'Este formulário envia a contribuição à ScriptaHub. Os documentos são carregados após aceitar o acordo.'],
    it: ['Invio del contributo…', 'Contributo salvato. Riferimento:', 'Questo modulo invia il contributo a ScriptaHub. I documenti vengono caricati dopo l’accettazione dell’accordo.'],
    pl: ['Wysyłanie zgłoszenia…', 'Zgłoszenie zapisano. Identyfikator:', 'Ten formularz przesyła zgłoszenie do ScriptaHub. Dokumenty są wysyłane po zaakceptowaniu umowy.'],
  };
  const lang = () => new URL(location.href).searchParams.get('lang') || 'en';
  const words = () => translations[lang()] || translations.en;
  const dbName = 'scriptahub-agent-uploads';
  function database() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('files');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function retrieve(key) {
    const db = await database();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('files', 'readonly');
        const request = tx.objectStore('files').get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  }
  async function remove(key) {
    const db = await database();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction('files', 'readwrite');
        tx.objectStore('files').delete(key);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } finally { db.close(); }
  }
  const root = new URL('../', document.currentScript.src);
  async function loadDraftFiles(key, expectedNames) {
    const files=await retrieve(key);
    if(!Array.isArray(files)||files.length!==expectedNames.length||files.some((file,index)=>file.name!==expectedNames[index])) throw new Error('The draft documents are no longer available. Select them again before submitting.');
    (await policy).validateDocuments(files);
    return files;
  }
  function contributionKind(draft, count) {
    const source = new URL(draft.returnUrl).pathname;
    if (source.includes('/fork/')) return 'fork';
    if (source.includes('/create/')) return count ? 'manuscript' : 'book-proposal';
    if (source.includes('/translate/')) return 'translation';
    if (source.includes('/animation-request/') || source.includes('/Animation/')) return 'animation';
    return 'edit';
  }
  function bookId(draft) {
    const line = draft.lines.find(value => /^(?:Book ID|Source book ID):\s*/.test(value));
    return line?.split(':').slice(1).join(':').trim() || undefined;
  }
  const sending = new WeakSet();
  function bindFormValidity(form) {
    for(const field of form.querySelectorAll('[required]')) {
      const label=field.closest('label')?.querySelector('span');
      if(label&&!label.querySelector('.required-indicator')) {
        const marker=document.createElement('span');marker.className='required-indicator';marker.textContent=' *';marker.setAttribute('aria-hidden','true');label.append(marker);
      }
    }
    const button=form.querySelector('button[type="submit"]');
    const update=()=>{
      const valid=[...form.elements].every(field=>!field.willValidate||(field.validity.valid&&(!field.required||typeof field.value!=='string'||field.value.trim().length>0)));
      button.disabled=!valid||form.dataset.contributionReady==='false'||sending.has(button)||button.dataset.submissionComplete==='true';
    };
    form.updateContributionState=update;
    form.addEventListener('input',update);form.addEventListener('change',update);
    form.addEventListener('reset',()=>queueMicrotask(update));
    update();return update;
  }
  async function submitDirect(metadata, files, status, button) {
    if (sending.has(button) || button.dataset.submissionComplete === 'true') return false;
    sending.add(button);
    button.disabled = true;
    status.textContent = words()[0];
    let received;
    try {
      (await policy).validateDocuments(files);
      const body = new FormData();
      body.set('metadata', JSON.stringify(metadata));
      for (const file of files) body.append('documents', file, file.name);
      const response = await fetch(new URL('api/submissions', root), { method: 'POST', credentials: 'same-origin', body });
      received = await response.json();
      if (!response.ok) throw new Error(received.error || `Upload failed (${response.status})`);
      status.textContent = `${words()[1]} ${received.submissionId}`;
      button.dataset.submissionComplete = 'true';
      try { if (metadata.values?.annotationDraftKey?.startsWith('scriptahub:suggest:')) sessionStorage.removeItem(metadata.values.annotationDraftKey); } catch { /* A confirmed submission stays successful even if local draft cleanup is unavailable. */ }
      return true;
    } catch (error) {
      status.textContent = error.message;
      button.disabled = false;
      return false;
    } finally { sending.delete(button);button.form?.updateContributionState?.(); }
  }
  async function submitContribution(draft,files,status,button) {
    if(draft.agreementAccepted!==true)throw new Error('Contribution agreement is required');
    const submissionPolicy=await policy;
    button.dataset.submissionId ||= submissionPolicy.newSubmissionId();
    const metadata={submissionId:button.dataset.submissionId,kind:contributionKind(draft,files.length),agreementVersion:'2026-09-10',agreementAccepted:true,values:draft.values,language:draft.language ?? lang(),...(bookId(draft)?{bookId:bookId(draft)}:{})};
    return submitDirect(metadata,files,status,button);
  }
  globalThis.ScriptaContributionBridge = {bindFormValidity,loadDraftFiles,deleteDraftFiles:remove,submitContribution,submitDirect,
    newSubmissionId:async()=>(await policy).newSubmissionId(),
    note:language=>(translations[language]||translations.en)[2]};
  let account;
  let accountRequired = false;
  fetch(new URL('api/session', root), { credentials: 'same-origin' })
    .then(response => response.ok ? response.json() : null)
    .then(result => { account = result?.user; if (!account) requireLogin(); })
    .catch(() => requireLogin());
  function requireLogin() {
    if (!location.pathname.includes('/books/')) return;
    accountRequired = true;
    for (const form of document.querySelectorAll('.workflow-form')) {
      const button = form.querySelector('button[type=submit]');
      if (button) button.disabled = true;
      if (form.querySelector('.workflow-account')) continue;
      const notice = document.createElement('p');
      notice.className = 'workflow-account';
      const link = document.createElement('a');
      link.href = `/auth/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`;
      link.textContent = lang() === 'ro' ? 'Autentifică-te pentru a trimite o sugestie' : 'Sign in to send a suggestion';
      notice.append(link);
      form.prepend(notice);
    }
  }
  // The source shell still contains email wording. The agent shows its actual delivery method.
  const observer = new MutationObserver(() => {
    if (!account && accountRequired) requireLogin();
    for (const note of document.querySelectorAll('.workflow-form > .workflow-note, .create-form-footer .workflow-note, .agreement-page .workflow-note')) {
      if (note.dataset.agentCopy) continue;
      note.textContent = words()[2];
      note.dataset.agentCopy = 'true';
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
