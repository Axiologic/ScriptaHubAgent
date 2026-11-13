import { createPricingFields } from './account-pricing.js?v=stripe-units-1';
import { pointsApi } from './account-points.js?v=credit-payment-feedback-10';

export async function mountAdministration(host, api = pointsApi) {
  const ro=document.documentElement.lang==='ro';
  const t=(en,romanian)=>ro?romanian:en;
  const el=(tag,text,props={})=>Object.assign(document.createElement(tag),{textContent:text,...props});
  const form=el('form','',{className:'account-settings-form'});
  const status=el('p',t('Loading credit settings…','Se încarcă regulile creditelor…'),{role:'status'});
  const fields=new Map();
  const groups=[
    [t('Contribution rewards','Recompense pentru contribuții'),[
      ['bookReward',t('Published book reward','Recompensă pentru carte publicată')],
      ['correctionReward',t('Correction reward per contributor and published edition','Recompensă pentru corecturi, per contributor și ediție publicată')],
    ],t('Rewards are awarded only after publication. All accepted corrections from one contributor in an edition receive one reward.',
      'Recompensele se acordă doar după publicare. Toate corecturile acceptate ale unui contributor incluse într-o ediție primesc o singură recompensă.')],
    [t('Processing costs','Costuri de procesare'),[
      ['editionCost',t('New edition cost','Cost pentru ediție nouă')],
      ['forkCost',t('Derived book cost','Cost pentru carte derivată')],
    ]],
    [t('Expiration and notifications','Expirare și notificări'),[
      ['rewardValidityDays',t('Reward validity in days (0: no expiration)','Valabilitatea recompensei în zile (0: fără expirare)')],
      ['firstNoticeDays',t('First reminder, days before expiration (0: disabled)','Prima notificare, zile înainte de expirare (0: dezactivată)')],
      ['lastNoticeDays',t('Last reminder, days before expiration (0: disabled)','Ultima notificare, zile înainte de expirare (0: dezactivată)')],
    ]],
  ];
  for(const [title,definitions,note] of groups){
    const group=el('fieldset','');group.append(el('legend',title));
    for(const [name,caption] of definitions){
      const label=el('label',''),input=el('input','',{type:'number',min:0,max:name.endsWith('Days')?3650:1000000,step:1,required:true});
      input.name=name;fields.set(name,input);label.append(el('span',caption),input);group.append(label);
    }
    if(note)group.append(el('p',note,{className:'account-policy-help'}));
    form.append(group);
  }
  const pricing=createPricingFields();form.append(pricing.group);
  const submit=el('button',t('Save','Salvează'),{type:'submit',className:'button button-quiet',disabled:true});
  const reset=el('button',t('Reset','Reset'),{type:'button',className:'button button-quiet button-no-icon account-settings-reset',disabled:true});
  const resetIcon=document.createElementNS('http://www.w3.org/2000/svg','svg');
  for(const [name,value] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.8','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'}))resetIcon.setAttribute(name,value);
  const resetPath=document.createElementNS(resetIcon.namespaceURI,'path');
  resetPath.setAttribute('d','M3 10a9 9 0 1 1 2.9 8.1M3 4v6h6');resetIcon.append(resetPath);reset.prepend(resetIcon);
  const actions=el('div','',{className:'account-settings-actions'});actions.append(reset,submit);form.append(actions);
  host.replaceChildren(el('h2',t('Credit settings','Setările creditelor')),form,status);
  const controls=[...fields.values(),...pricing.controls,submit,reset];
  const edited=new Set();let pending=false,loading=true,savedPolicy=null,savedPricing=null;
  for(const [name,input] of fields)input.oninput=()=>edited.add(name);
  const applyPolicy=(points,preserveEdits=false)=>{for(const [name,input] of fields)if(!preserveEdits || !edited.has(name))input.value=points?.[name] ?? '';};
  const equal=(a,b)=>a && Object.keys(b).every(key=>a[key]===b[key]);
  reset.onclick=()=>{
    if(pending || loading)return;
    applyPolicy(savedPolicy);pricing.apply(savedPricing || {});edited.clear();status.textContent='';
  };
  form.onsubmit=async event=>{
    event.preventDefault();if(pending || loading || !form.reportValidity())return;
    const points=Object.fromEntries([...fields].map(([name,input])=>[name,input.valueAsNumber]));
    if(points.firstNoticeDays && points.lastNoticeDays>points.firstNoticeDays){
      status.textContent=t('The first reminder must be at least as early as the last one.','Prima notificare trebuie să fie cel puțin la fel de devreme ca ultima.');return;
    }
    const price=pricing.read();if(!price)return;
    pending=true;controls.forEach(input=>{input.disabled=true;});status.textContent='';let priceSaved=false;
    try {
      if(!equal(savedPricing,price)) {
        await api('/offer-settings',price);savedPricing={...price};priceSaved=true;
        document.dispatchEvent(new CustomEvent('scriptahub:points-pricing'));
      }
      if(!equal(savedPolicy,points)) {
        const result=await api('/policy',points);savedPolicy={...result.points};
        document.dispatchEvent(new CustomEvent('scriptahub:points-policy'));
      }
      applyPolicy(savedPolicy);pricing.apply(savedPricing);edited.clear();
      status.textContent=t('Settings saved.','Setările au fost salvate.');
    } catch(error) {
      status.textContent=priceSaved
        ? t('The price was saved, but the credit rules were not. Your edits are kept; save again to finish.',
          'Prețul a fost salvat, dar regulile creditelor nu. Modificările sunt păstrate; apasă din nou Salvează pentru a termina.')
        : error.message;
    } finally {pending=false;controls.forEach(input=>{input.disabled=false;});}
  };
  const results=await Promise.allSettled([api('/policy'),api('/offer-settings')]);
  if(results[0].status==='fulfilled'){savedPolicy={...results[0].value.points};applyPolicy(savedPolicy,true);}
  if(results[1].status==='fulfilled'){savedPricing={...results[1].value};pricing.apply(savedPricing,{preserveEdits:true});}
  status.textContent=results.some(result=>result.status==='rejected')
    ? t('Some settings could not be loaded. Enter all required values to save, or refresh the page to try loading again.',
      'Unele setări nu au putut fi încărcate. Completează câmpurile necesare pentru a salva sau reîncarcă pagina pentru a încerca din nou încărcarea.') : '';
  loading=false;submit.disabled=false;reset.disabled=false;
}
