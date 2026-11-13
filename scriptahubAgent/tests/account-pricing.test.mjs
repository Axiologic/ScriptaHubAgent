import test from 'node:test';
import assert from 'node:assert/strict';
import {pricingMinorAmount,createPricingFields} from '../site/assets/account-pricing.js';

test('displayed point prices convert to exact minor units without rounding or accepting invalid amounts',()=>{
  assert.equal(pricingMinorAmount('5.00',2),500);
  assert.equal(pricingMinorAmount('1,01',2),101);
  assert.equal(pricingMinorAmount('1.005',3),1005);
  assert.equal(pricingMinorAmount('500',0),500);
  for(const value of ['0','-1','1.001','1e3','NaN','1000000'])assert.throws(()=>pricingMinorAmount(value,2));
});

class Node {
  constructor(tag){this.tag=tag;this.children=[];this.value='';this.validity={valid:true};}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;}
  setCustomValidity(message){this.validationMessage=message;}
  reportValidity(){return true;}
  get valueAsNumber(){return Number(this.value);}
}

test('pricing fields use a currency selector with EUR default and exact minor-unit conversion',t=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'document',{configurable:true,value:{documentElement:{lang:'ro'},createElement:tag=>new Node(tag)}});
  t.after(()=>{if(original)Object.defineProperty(globalThis,'document',original);else delete globalThis.document;});
  const editor=createPricingFields();const [price,currency]=editor.controls;
  assert.equal(editor.group.tag,'fieldset');assert.equal(currency.tag,'select');assert.equal(currency.value,'EUR');
  assert.deepEqual(currency.children.slice(0,5).map(option=>option.value),['EUR','USD','JPY','GBP','CNY']);
  assert.ok(currency.children.every(option=>option.value));assert.ok(currency.children.some(option=>option.value==='RON'));
  for(const code of ['isk','ugx']) {
    editor.apply({unitAmountMinor:500,currency:code});
    assert.equal(price.value,'5');
    assert.equal(price.step,'1');
    assert.deepEqual(editor.read(),{unitAmountMinor:500,currency:code});
    price.value='5.01';assert.equal(editor.read(),null);
  }
  editor.apply({unitAmountMinor:500,currency:'jpy'});assert.equal(price.value,'500');
  assert.deepEqual(editor.read(),{unitAmountMinor:500,currency:'jpy'});
  editor.apply({unitAmountMinor:5,currency:'eur'});assert.equal(price.value,'0.05');
  price.value='1.01';price.oninput();currency.value='RON';currency.onchange();
  editor.apply({unitAmountMinor:500,currency:'usd'},{preserveEdits:true});
  assert.deepEqual(editor.read(),{unitAmountMinor:101,currency:'ron'});
  editor.apply({unitAmountMinor:5,currency:'eur'});assert.equal(currency.value,'EUR');assert.equal(price.value,'0.05');
  price.value='0.001';assert.equal(editor.read(),null);assert.ok(price.validationMessage);
});
