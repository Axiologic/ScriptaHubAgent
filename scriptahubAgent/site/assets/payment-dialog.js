let sdkPromise;
export function loadStripeSdk() {
  if (globalThis.Stripe) return Promise.resolve(globalThis.Stripe);
  if (!sdkPromise) sdkPromise = new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src='https://js.stripe.com/endive/stripe.js';script.async=true;
    const timer=setTimeout(()=>finish(new Error('Stripe could not be loaded.')),20000);
    function finish(error) {
      clearTimeout(timer);script.onload=null;script.onerror=null;
      if(error){script.remove();sdkPromise=undefined;reject(error);}else resolve(globalThis.Stripe);
    }
    script.onload=()=>finish(globalThis.Stripe?null:new Error('Stripe could not be loaded.'));
    script.onerror=()=>finish(new Error('Stripe could not be loaded.'));
    document.head.append(script);
  });
  return sdkPromise;
}

export function paymentAppearance() {
  const style=getComputedStyle(document.documentElement);
  const value=(name,fallback)=>style.getPropertyValue(name).trim() || fallback;
  const desktop=matchMedia('(min-width: 601px)').matches;
  return {theme:'flat',variables:{
    colorPrimary:value('--green','#008069'),colorBackground:value('--field','#f0f2f5'),
    colorText:value('--ink','#111b21'),colorTextSecondary:value('--muted','#667781'),
    fontFamily:style.fontFamily,fontSizeBase:desktop?'14px':'16px',borderRadius:'8px',spacingUnit:'4px',
    accordionItemSpacing:'6px',accordionItemLabelFontSize:'14px',accordionItemLabelColorText:value('--ink','#111b21'),
  }};
}

export function openPaymentDialog({quantity,create,verify,onSession,onUnpaid,loadSdk=loadStripeSdk}) {
  const ro=document.documentElement.lang==='ro',t=(en,romanian)=>ro?romanian:en;
  const el=(tag,text,props={})=>Object.assign(document.createElement(tag),{textContent:text,...props});
  const dialog=el('dialog','',{className:'account-payment-dialog'});
  const title=el('h2',t('Buy credits','Cumpără credite'),{id:'account-payment-title'});
  dialog.setAttribute('aria-labelledby',title.id);
  const close=el('button','×',{type:'button',className:'site-icon-button',title:t('Close','Închide')});close.setAttribute('aria-label',close.title);
  const header=el('header','');header.append(title,close);
  const summary=el('p',quantity===1?t('1 credit','1 credit'):t(`${quantity} credits`,`${quantity} credite`),{className:'account-payment-summary'});
  const total=el('p','',{className:'account-payment-total'});
  const totalAmount=el('span','');
  total.append('Total: ',totalAmount);
  const overview=el('div','',{className:'account-payment-overview'});overview.append(summary,total);
  const form=el('form','',{className:'account-payment-form'}),mount=el('div','',{className:'account-payment-element'});
  const loader=el('p','',{className:'account-payment-loader',role:'status'});
  const loadingSpinner=el('span','',{className:'account-payment-spinner'});
  loadingSpinner.setAttribute('aria-hidden','true');
  loader.append(loadingSpinner,el('span',t('Loading secure payment…','Se încarcă formularul de plată…')));
  const pay=el('button','',{type:'submit',className:'button button-no-icon',disabled:true});
  const processingSpinner=el('span','',{className:'account-payment-spinner',hidden:true});
  processingSpinner.setAttribute('aria-hidden','true');
  const payText=el('span',t('Pay','Plătește'));
  pay.append(processingSpinner,payText);
  const footer=el('footer','');
  footer.append(pay);
  form.append(mount,footer);
  const content=el('div','',{className:'account-payment-content',inert:true});
  content.dataset.loading='';
  content.append(overview,form);
  dialog.append(header,loader,content);
  document.body.append(dialog);
  dialog.showModal();

  let active=true, paying=false, submitted=false, canConfirm=false;
  let checkout, payment, actions, purchaseSession, sessionId, done, layoutTimer, layoutObserver;
  let elementReady=false, prepared=false;
  const result=new Promise(resolve=>{done=resolve;});
  const preparationTimer=setTimeout(()=>failPreparation(t(
    'The payment form took too long to load. Try again.',
    'Formularul de plată s-a încărcat prea lent. Încearcă din nou.'
  )),30000);

  function stopPreparation() {
    clearTimeout(preparationTimer);
    clearTimeout(layoutTimer);
    layoutObserver?.disconnect();
  }

  function failPreparation(error) {
    if (!active || prepared) return;
    finish({status:'error',message:error});
  }

  function revealContent() {
    if (!active || prepared) return;
    prepared=true;
    stopPreparation();
    loader.hidden=true;
    delete content.dataset.loading;
    content.inert=false;
    updatePayButton();
  }

  function waitForLayout() {
    if (!active || prepared || !actions || !elementReady) return;
    // Stripe can resize its iframe after emitting ready. Reveal the measured layout once it settles.
    clearTimeout(layoutTimer);
    layoutTimer=setTimeout(revealContent,220);
  }

  function finish(outcome) {
    if (!active || paying) return;
    active=false;
    stopPreparation();
    payment?.destroy();
    checkout?.destroy?.();
    dialog.close();
    dialog.remove();
    done({...outcome,sessionId});
  }

  function updatePayButton() {
    pay.disabled=!prepared || paying || (!submitted && !canConfirm);
    processingSpinner.hidden=!paying;
    close.disabled=paying;
    mount.inert=paying || submitted;
    form.setAttribute('aria-busy',String(paying));
    if (paying) payText.textContent=t('Processing payment…','Se procesează plata…');
    else if (totalAmount.textContent) payText.textContent=t(`Pay ${totalAmount.textContent}`,`Plătește ${totalAmount.textContent}`);
  }

  const closeDialog=()=>finish({status:submitted?'pending':'cancelled'});
  close.onclick=closeDialog;
  dialog.addEventListener('cancel',event=>{event.preventDefault();closeDialog();});

  async function processPayment(confirm) {
    paying=true;
    updatePayButton();
    let outcome;
    try {
      if (confirm) {
        const confirmation=await onSession(purchaseSession,()=>actions.confirm({redirect:'if_required'}));
        if (confirmation.type==='error') {
          onUnpaid(sessionId);
          outcome={status:'error',message:confirmation.error.message};
          return;
        }
        submitted=true;
      }
      const state=await verify(sessionId);
      outcome=['paid','expired','failed'].includes(state.status) ? state : {...state,status:'pending'};
    } catch {
      outcome={status:'error',message:t(
        'We couldn’t check the payment. Refresh the page to try again.',
        'Nu am putut verifica plata. Reîncarcă pagina pentru a încerca din nou.'
      )};
    } finally {
      paying=false;
      if (outcome) finish(outcome);
      else updatePayButton();
    }
  }

  form.onsubmit=event=>{
    event.preventDefault();
    if (pay.disabled || !sessionId) return;
    void processPayment(!submitted);
  };

  void (async()=>{
    try {
      const [Stripe,session]=await Promise.all([loadSdk(),create()]);
      if (!active) return;
      purchaseSession=session;
      sessionId=session.sessionId;
      if (session.status==='complete') {
        await onSession(session);
        if (!active) return;
        submitted=true;
        mount.hidden=true;
        revealContent();
        await processPayment(false);
        return;
      }
      checkout=Stripe(session.publishableKey,{locale:ro?'ro':'en'}).initCheckoutElementsSdk({
        clientSecret:session.clientSecret,
        elementsOptions:{appearance:paymentAppearance(),savedPaymentMethod:{enableSave:'never'}},
      });
      const update=session=>{
        if (!active) return;
        totalAmount.textContent=session.total.total.amount;
        canConfirm=session.canConfirm;
        updatePayButton();
        waitForLayout();
      };
      checkout.on('change',update);
      payment=checkout.createPaymentElement({layout:{type:'accordion',defaultCollapsed:false,radios:'always',spacedAccordionItems:true,visibleAccordionItemsCount:2},wallets:{link:'never'}});
      payment.on('ready',()=>{
        elementReady=true;
        waitForLayout();
      });
      payment.on('loaderror',()=>{
        failPreparation(t('The secure payment form could not be loaded. Try again.','Formularul securizat de plată nu a putut fi încărcat. Încearcă din nou.'));
      });
      layoutObserver=new ResizeObserver(waitForLayout);
      layoutObserver.observe(content);
      payment.mount(mount);
      const loaded=await checkout.loadActions();
      if (!active) return;
      if (loaded.type==='error') throw new Error(loaded.error.message);
      actions=loaded.actions;
      update(actions.getSession());
    } catch {
      failPreparation(t('The payment form could not be opened. Try again.','Formularul de plată nu a putut fi deschis. Încearcă din nou.'));
    }
  })();
  return result;
}
