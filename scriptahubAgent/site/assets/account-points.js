import { newSubmissionId } from './submission-policy.js';
import { openPaymentDialog } from './payment-dialog.js?v=payment-feedback-7';
import { stripeCurrencyUnits } from './stripe-currencies.js?v=stripe-units-1';

const root = new URL('../',import.meta.url);
const ro = new URL(location.href).searchParams.get('lang') === 'ro';
const t = (en,romanian) => ro ? romanian : en;
const el = (name, text, props = {}) => Object.assign(document.createElement(name),{textContent:text,...props});
const control = (en,romanian) => el('button',t(en,romanian),{type:'button',className:'button button-quiet'});
export async function pointsApi(suffix = '', body) {
  const url = new URL('api/dashboard/points' + suffix,root);
  const response = await fetch(url,{cache:'no-store',credentials:'same-origin',
    ...(body ? {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)} : {})});
  if (!response.ok) throw new Error(t('Credits service unavailable. Try again.','Serviciul de credite nu este disponibil. Încearcă din nou.'));
  return response.json();
}

export async function mountPoints(section, {userId = '', accountId = ''} = {}) {
  const status = el('p','',{role:'status'});
  status.dataset.pointsStatus = '';
  const purchaseHelp = t('Choose how many credits you want to buy.','Alege câte credite vrei să cumperi.');
  const purchaseStatus = el('div','',{className:'account-credit-purchase-status',role:'status'});
  const paymentLabels = {
    pending:t('Payment processing','Plată în curs de procesare'),
    paid:t('Payment confirmed. Credits added','Plată confirmată. Credite adăugate'),
    failed:t('Payment failed','Plată eșuată'),
    expired:t('Payment expired','Sesiune de plată expirată'),
    unavailable:t('Status unavailable. Checking again shortly','Stare indisponibilă. Verificăm din nou în scurt timp'),
  };
  let offer, checkoutId, pollTimer, checking=false, checkoutOpen=false, dialogSession;
  let updatePurchaseControls=()=>{};
  let purchaseQuantity='';
  const payments = new Map();
  const paymentKey='scriptahub:payment:'+(accountId || 'current');
  const paymentPrefix=paymentKey+':';
  const validSession = id => /^cs_[A-Za-z0-9_]{1,200}$/.test(id || '');
  const returnedSession = () => new URL(location.href).searchParams.get('checkout_session_id');
  const withPaymentLock = (id, action) => navigator.locks ? navigator.locks.request(paymentPrefix+id,action) : action();

  function showPayments(message = '') {
    const rows = [...payments.values()].reverse().map(payment=>{
      const details = [];
      if (payment.currency && Number.isSafeInteger(payment.amountMinor)) {
        const {digits,scale}=stripeCurrencyUnits(payment.currency);
        details.push(new Intl.NumberFormat(ro?'ro-RO':'en',{
          style:'currency',currency:payment.currency,minimumFractionDigits:digits,maximumFractionDigits:digits,
        }).format(payment.amountMinor / scale));
      }
      if (Number.isSafeInteger(payment.credits)) {
        details.push(payment.credits===1 ? '1 credit' : t(`${payment.credits} credits`,`${payment.credits} credite`));
      }
      if (payment.createdAt && Number.isFinite(Date.parse(payment.createdAt))) {
        details.push(new Intl.DateTimeFormat(ro?'ro-RO':'en',{
          day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit',
        }).format(new Date(payment.createdAt)));
      }
      const label = paymentLabels[payment.status];
      const row = el('p',[...details,label].join(' · '));
      row.dataset.kind=payment.status;
      return row;
    });
    if (message || !rows.length) rows.unshift(el('p',message || purchaseHelp));
    if (purchaseStatus.textContent !== rows.map(row=>row.textContent).join('')) purchaseStatus.replaceChildren(...rows);
  }

  function schedulePaymentCheck() {
    if (userId || checking || pollTimer || ![...payments].some(([id,payment])=>
      id!==dialogSession && ['pending','unavailable'].includes(payment.status))) return;
    pollTimer=setTimeout(()=>{
      pollTimer=undefined;
      void checkPendingPayments();
    },10000);
  }

  function trackPayment(sessionId, details = {}) {
    if (!validSession(sessionId)) return;
    payments.set(sessionId,{status:'pending',...details});
    try {localStorage.setItem(paymentPrefix+sessionId,sessionId);}
    catch {try {sessionStorage.setItem(paymentPrefix+sessionId,sessionId);}catch{}}
    showPayments();
    schedulePaymentCheck();
  }

  function forgetPayment(sessionId) {
    for (const name of ['localStorage','sessionStorage']) {
      try {
        const storage=window[name];
        storage.removeItem(paymentPrefix+sessionId);
        if (storage.getItem(paymentKey)===sessionId) storage.removeItem(paymentKey);
      } catch {}
    }
    if (returnedSession()===sessionId) {
      const url=new URL(location.href);
      url.searchParams.delete('checkout_session_id');
      history.replaceState(history.state,'',url);
    }
  }

  function applyPaymentStatus(sessionId, state) {
    const previous=payments.get(sessionId);
    if (!previous || !['pending','unavailable'].includes(previous.status)) return false;
    if (state.status==='open') payments.delete(sessionId);
    else payments.set(sessionId,{...previous,...state});
    if (['open','paid','failed','expired'].includes(state.status)) forgetPayment(sessionId);
    showPayments();
    return state.status==='paid';
  }

  async function checkPendingPayments() {
    if (userId || checking) return;
    clearTimeout(pollTimer);
    pollTimer=undefined;
    const pending=[...payments].filter(([id,payment])=>id!==dialogSession && ['pending','unavailable'].includes(payment.status));
    if (!pending.length) return;
    checking=true;
    let refreshBalance=false;
    try {
      for (const [sessionId] of pending) {
        try {
          const state=await withPaymentLock(sessionId,()=>pointsApi('/checkout-status',{sessionId}));
          refreshBalance=applyPaymentStatus(sessionId,state) || refreshBalance;
        } catch {
          applyPaymentStatus(sessionId,{status:'unavailable'});
        }
      }
      if (refreshBalance) await render().catch(()=>showPayments(t(
        'Refresh the page to see the updated balance.','Reîncarcă pagina pentru a vedea soldul actualizat.'
      )));
    } finally {
      checking=false;
      schedulePaymentCheck();
    }
  }

  if (!userId) {
    for (const name of ['localStorage','sessionStorage']) {
      try {
        const storage=window[name];
        for (const key of Object.keys(storage)) {
          if (key!==paymentKey && !key.startsWith(paymentPrefix)) continue;
          const id=storage.getItem(key);
          if (validSession(id)) payments.set(id,{status:'pending'});
        }
      } catch {}
    }
    if (validSession(returnedSession())) payments.set(returnedSession(),{status:'pending'});
    showPayments();
  }

  section.replaceChildren(status);
  function run(button, action) {
    button.disabled = true;
    status.textContent = '';
    return action().catch(error => {status.textContent = error.message;}).finally(()=>{button.disabled = false;});
  }

  async function render(start = 0) {
    const query = new URLSearchParams({start,lang:document.documentElement.lang,...(userId ? {userId} : {})});
    const {balance,ledger} = await pointsApi('?' + query);
    const overview = el('div','',{className:'account-credit-overview'});
    const balanceCard = el('div','',{className:'account-credit-balance'});
    const wallet = el('span','',{className:'account-credit-wallet'});
    wallet.setAttribute('aria-hidden','true');
    wallet.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="M20 8V6a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h13a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H6a3 3 0 0 1-3-3V7m18 6h-4a1.5 1.5 0 0 0 0 3h4"/></svg>';
    const balanceDetails = el('div','');
    balanceDetails.append(
      el('h2',t('Available credits','Credite disponibile')),
      el('strong',String(balance.balance),{className:'account-credit-available'}),
      el('p',t(`Reserved: ${balance.reservedBalance}`,`Rezervate: ${balance.reservedBalance}`),{className:'account-credit-reserved'}),
    );
    balanceCard.append(wallet,balanceDetails);
    overview.append(balanceCard);
    section.replaceChildren(overview);
    for (const lot of balance.expiring || []) {
      const date = new Date(lot.expiresAt).toLocaleDateString(ro ? 'ro' : 'en',{timeZone:'UTC'});
      const expiry = lot.amount === 1
        ? t(`1 credit expires on ${date}`,`1 credit expiră pe ${date}`)
        : t(`${lot.amount} credits expire on ${date}`,`${lot.amount} credite expiră pe ${date}`);
      balanceDetails.append(el('p',expiry,{className:'account-credit-expiry'}));
    }
    if (!userId) {
      offer ||= await pointsApi('/offer').catch(()=>({available:false}));
      if (offer.available) {
        const purchase = el('form','',{className:'account-credit-purchase'});
        const amount = el('input','',{type:'number',min:1,max:Math.floor(99999999 / offer.unitAmountMinor),step:1,value:purchaseQuantity,placeholder:'0',required:true});
        const {digits,scale} = stripeCurrencyUnits(offer.currency);
        const formatter = new Intl.NumberFormat(ro ? 'ro-RO' : 'en', {
          style:'currency',currency:offer.currency,minimumFractionDigits:digits,maximumFractionDigits:digits,
        });
        const unitPrice = formatter.format(offer.unitAmountMinor / scale);
        const label = el('label',t('Number of credits','Număr de credite'),{className:'account-credit-quantity'});
        label.append(amount);
        const total = el('input','',{type:'text',readOnly:true});
        const totalLabel = el('label','Total',{className:'account-credit-total'});
        totalLabel.append(total);
        const buy = control('Buy','Cumpără');
        buy.type = 'submit';
        buy.classList.add('button-no-icon');
        buy.insertAdjacentHTML('afterbegin','<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M3 10h18m-14 5h4"></path></svg>');
        const updateTotal = () => {
          const quantity = amount.valueAsNumber;
          const valid = amount.validity.valid && Number.isSafeInteger(quantity);
          total.value = formatter.format(valid ? quantity * offer.unitAmountMinor / scale : 0);
          buy.disabled = checkoutOpen || !valid;
        };
        updatePurchaseControls = updateTotal;
        amount.oninput = () => {
          purchaseQuantity = amount.value;
          checkoutId = undefined;
          updateTotal();
        };
        updateTotal();
        purchase.onsubmit = event => {
          event.preventDefault();
          if (checkoutOpen || buy.disabled || !purchase.reportValidity()) return;
          const quantity=amount.valueAsNumber;
          if (!Number.isSafeInteger(quantity)) return;
          checkoutId ||= newSubmissionId();
          checkoutOpen = true;
          updateTotal();
          void openPaymentDialog({quantity,
            create:()=>pointsApi('/checkout',{requestId:checkoutId,quantity,returnUrl:new URL('account/dashboard.html?tab=points&lang=' + document.documentElement.lang,root).href}),
            verify:sessionId=>pointsApi('/checkout-status',{sessionId}),
            onSession:(session,confirm)=>{
              const {sessionId,credits=quantity,amountMinor,currency,createdAt}=session;
              dialogSession=sessionId;
              return withPaymentLock(sessionId,()=>{
                trackPayment(sessionId,{credits,amountMinor,currency,createdAt});
                return confirm?.();
              });
            },
            onUnpaid:sessionId=>applyPaymentStatus(sessionId,{status:'failed'}),
          }).then(async result=>{
            if (dialogSession) {
              checkoutId=undefined;
              if (result.status==='error') showPayments(result.message);
              else if (applyPaymentStatus(dialogSession,result)) {
                purchaseQuantity='';
                await render().catch(()=>showPayments(t(
                  'Refresh the page to see the updated balance.','Reîncarcă pagina pentru a vedea soldul actualizat.'
                )));
              }
            } else if (result.status==='error') showPayments(result.message);
          }).catch(()=>showPayments(t('Could not complete the checkout.','Nu am putut finaliza sesiunea de plată.'))).finally(()=>{
            dialogSession=undefined;
            checkoutOpen=false;
            updatePurchaseControls();
            schedulePaymentCheck();
          });
        };
        const purchaseHeader = el('div','',{className:'account-credit-purchase-header'});
        const price = el('p','',{className:'account-credit-unit-price'});
        price.append(el('strong',unitPrice),' per credit');
        purchaseHeader.append(el('h2',t('Buy credits','Cumpără credite')),price);
        const purchaseActions = el('div','',{className:'account-credit-purchase-actions'});
        purchaseActions.append(purchaseStatus,buy);
        purchase.append(purchaseHeader,label,totalLabel,purchaseActions);
        overview.append(purchase);
      } else {
        section.append(el('p',t('Credit purchases are unavailable.','Cumpărarea de credite nu este disponibilă.')));
        if (payments.size) section.append(purchaseStatus);
      }
    }
    const history = el('ul','');
    const names = {grant:t('Awarded','Acordate'),purchase:t('Purchased','Cumpărate'),reserve:t('Reserved','Rezervate'),
      spend:t('Spent','Cheltuite'),release:t('Released','Eliberate'),refund:t('Refunded','Restituite'),adminAdjustment:t('Adjusted','Ajustate'),expire:t('Expired','Expirate')};
    const reasons = {
      'Approved book proposal': t('Published book reward','Recompensă pentru carte publicată'),
      'Approved manuscript': t('Published book reward','Recompensă pentru carte publicată'),
      'Approved corrections': t('Corrections included in a published edition','Corecturi incluse într-o ediție publicată'),
      'New book edition': t('New book edition','Ediție nouă a cărții'),
      'Derived book': t('Derived book','Carte derivată'),
    };
    for (const entry of ledger.entries) {
      const day = new Date(entry.createdAt).toLocaleDateString(ro ? 'ro' : 'en');
      const item = el('li', [day,names[entry.type] || entry.type,`${entry.amount} ${entry.amount === 1 ? 'credit' : t('credits','credite')}`,reasons[entry.reason] || entry.reason].filter(Boolean).join(' · '));
      if (entry.book?.title) {
        item.append(document.createTextNode(' · '));
        if (entry.book.path) {
          const link = el('a',entry.book.title);
          const url = new URL(entry.book.path,root);
          url.searchParams.set('lang',document.documentElement.lang);
          link.href=url.href;item.append(link);
        } else item.append(document.createTextNode(entry.book.title));
      }
      history.append(item);
    }
    section.append(el('h2',t('Credit history','Istoricul creditelor'),{className:'account-credit-history-title'}),history);
    if (!history.childElementCount) section.append(el('p',t('No credit activity yet.','Încă nu există operațiuni cu credite.')));
    const pages = el('nav','');
    const previous = control('Previous','Înapoi');
    const next = control('Next','Înainte');
    previous.onclick = () => void run(previous,()=>render(Math.max(0,start-25)));
    next.onclick = () => void run(next,()=>render(start+25));
    if (start) pages.append(previous);
    if (start + 25 < ledger.totalCount) pages.append(next);
    if (pages.childElementCount) section.append(pages);
    section.append(status);
  }

  if (!userId) document.addEventListener('scriptahub:points-pricing', () => {
    offer = undefined;
    void render().catch(error => { status.textContent = error.message; });
  });
  if (!userId) window.addEventListener('storage', event => {
    if (!event.key?.startsWith(paymentPrefix) || !validSession(event.newValue) || payments.has(event.newValue)) return;
    payments.set(event.newValue,{status:'pending'});
    showPayments();
    schedulePaymentCheck();
  });
  await render().catch(error => { status.textContent = error.message; });
  await checkPendingPayments();
  return {refresh: render};
}
