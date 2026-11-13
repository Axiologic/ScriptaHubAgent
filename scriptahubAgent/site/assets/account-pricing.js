import { stripeCurrencies, stripeCurrencyUnits } from './stripe-currencies.js?v=stripe-units-1';

// Convert a displayed price exactly; do not round a fractional minor unit.
export function pricingMinorAmount(value, digits, scale = 10 ** digits) {
  const match = /^(\d+)(?:[.,](\d+))?$/.exec(String(value).trim());
  if (!match || !Number.isInteger(digits) || digits < 0 || digits > 4) throw new Error('Invalid price');
  const fraction = (match[2] || '').replace(/0+$/, '');
  if (fraction.length > digits) throw new Error('Invalid price precision');
  const amount = Number(match[1] + fraction.padEnd(digits, '0')) * (scale / 10 ** digits);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 99999999) throw new Error('Invalid price amount');
  return amount;
}

export function createPricingFields() {
  const ro=document.documentElement.lang==='ro';
  const t=(en,romanian)=>ro?romanian:en;
  const el=(tag,text,props={})=>Object.assign(document.createElement(tag),{textContent:text,...props});
  const group=el('fieldset','',{className:'account-pricing-fields'});
  group.append(el('legend',t('Credit pricing','Prețul creditelor')),
    el('p',t('Set the price of one credit. Changes apply to new purchases; payments already started keep their original price.',
      'Stabilește prețul unui credit. Modificările se aplică achizițiilor noi; plățile deja începute păstrează prețul inițial.'),{className:'account-policy-help'}));
  const price=el('input','',{name:'creditPrice',type:'number',min:'0.01',step:'0.01',required:true});
  const currency=el('select','',{name:'currency',required:true});
  const names=new Intl.DisplayNames([ro?'ro':'en'],{type:'currency'});
  const preferred=['EUR','USD','JPY','GBP','CNY'];
  for(const code of [...preferred,...stripeCurrencies.filter(code=>!preferred.includes(code))]) {
    currency.append(el('option',`${code} · ${names.of(code)}`,{value:code}));
  }
  currency.value='EUR';
  for(const [caption,input] of [[t('Price per credit','Preț per credit'),price],[t('Currency','Monedă'),currency]]) {
    const label=el('label','');label.append(el('span',caption),input);group.append(label);
  }
  const units=()=>stripeCurrencyUnits(currency.value);
  const updatePrecision=()=>{
    if(!stripeCurrencies.includes(currency.value))return;
    const {digits,scale}=units();
    price.step=String(10 ** -digits);
    price.min=price.step;
    price.max=(Math.floor(99999999 / (scale / 10 ** digits)) / 10 ** digits).toFixed(digits);
  };
  const edited=new Set();
  currency.onchange=()=>{edited.add('currency');price.setCustomValidity('');updatePrecision();};
  price.oninput=()=>{edited.add('price');price.setCustomValidity('');};
  return {
    group,controls:[price,currency],
    apply(settings,{preserveEdits=false}={}) {
      if(!preserveEdits || !edited.has('currency'))currency.value=(settings.currency || 'EUR').toUpperCase();
      updatePrecision();
      const {digits,scale}=units();
      if(!preserveEdits || !edited.has('price')) {
        const amount=settings.unitAmountMinor / scale;
        price.value=settings.unitAmountMinor && Number(amount.toFixed(digits)) === amount ? amount.toFixed(digits) : '';
      }
      price.setCustomValidity('');
      if(!preserveEdits)edited.clear();
    },
    read() {
      const {digits,scale}=units();
      try {return {unitAmountMinor:pricingMinorAmount(price.value,digits,scale),currency:currency.value.toLowerCase()};}
      catch {price.setCustomValidity(t('Enter a valid price for this currency.','Introdu un preț valid pentru această monedă.'));price.reportValidity();return null;}
    },
  };
}
