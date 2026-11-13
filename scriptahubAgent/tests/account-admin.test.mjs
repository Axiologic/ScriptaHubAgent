import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.location=new URL('http://localhost/account/dashboard.html?lang=ro');
const {mountAdministration}=await import('../site/assets/account-admin.js');
class Node {
  constructor(tag){this.tag=tag;this.children=[];this.value='';}
  append(...nodes){this.children.push(...nodes);}
  prepend(...nodes){this.children.unshift(...nodes);}
  setAttribute(name,value){this[name]=value;}
  replaceChildren(...nodes){this.children=nodes;}
  reportValidity(){return true;}
  setCustomValidity(message){this.validationMessage=message;}
  get valueAsNumber(){return Number(this.value);}
}
const points={bookReward:10,correctionReward:5,editionCost:10,forkCost:15,rewardValidityDays:180,firstNoticeDays:30,lastNoticeDays:7};
function setup(t){
  const original=Object.getOwnPropertyDescriptor(globalThis,'document'),events=[];
  Object.defineProperty(globalThis,'document',{configurable:true,value:{documentElement:{lang:'ro'},createElement:tag=>new Node(tag),createElementNS:(namespace,tag)=>Object.assign(new Node(tag),{namespaceURI:namespace}),dispatchEvent:event=>events.push(event.type)}});
  t.after(()=>{if(original)Object.defineProperty(globalThis,'document',original);else delete globalThis.document;});
  const host=new Node('div');
  return {host,events};
}
function nodes(node){return [node,...node.children.flatMap(nodes)];}
function ui(host){
  const all=nodes(host),form=all.find(node=>node.tag==='form');
  return {form,field:name=>all.find(node=>node.name===name),reset:all.find(node=>node.tag==='button'&&node.type==='button'),status:all.find(node=>node.role==='status')};
}
const event={preventDefault(){}};

test('administration has one form and Save/Reset; reset restores loaded values without writing',async t=>{
  const {host}=setup(t);const writes=[];
  await mountAdministration(host,async(path,body)=>{if(body)writes.push({path,body});return path==='/policy'?{points}:{unitAmountMinor:5,currency:'eur'};});
  const {field,reset}=ui(host);
  assert.equal(nodes(host).filter(node=>node.tag==='form').length,1);
  assert.deepEqual(nodes(host).filter(node=>node.tag==='button').map(node=>node.textContent),['Reset','Salvează']);
  field('bookReward').value='99';field('bookReward').oninput();field('creditPrice').value='0.25';field('creditPrice').oninput();field('currency').value='USD';field('currency').onchange();
  reset.onclick();assert.equal(field('bookReward').value,10);assert.equal(field('creditPrice').value,'0.05');assert.equal(field('currency').value,'EUR');assert.equal(writes.length,0);
});

test('one Save writes edited rules and pricing and blocks repeated submissions',async t=>{
  const {host,events}=setup(t);const writes=[];let finishPrice;
  await mountAdministration(host,async(path,body)=>{
    if(!body)return path==='/policy'?{points}:{unitAmountMinor:5,currency:'eur'};
    writes.push({path,body});if(path==='/offer-settings')await new Promise(resolve=>{finishPrice=resolve;});
    return path==='/policy'?{points:body}:body;
  });
  const {field,form,reset,status}=ui(host);field('bookReward').value='20';field('creditPrice').value='0.10';
  const save=form.onsubmit(event);await form.onsubmit(event);assert.equal(writes.length,1);assert.equal(reset.disabled,true);
  finishPrice();await save;
  assert.deepEqual(writes.map(write=>write.path),['/offer-settings','/policy']);
  assert.deepEqual(writes[0].body,{unitAmountMinor:10,currency:'eur'});assert.equal(writes[1].body.bookReward,20);
  assert.deepEqual(events,['scriptahub:points-pricing','scriptahub:points-policy']);assert.match(status.textContent,/au fost salvate/);
  field('bookReward').value=1;reset.onclick();assert.equal(field('bookReward').value,20);
});

test('failed price save retains edits and does not write rules',async t=>{
  const {host}=setup(t);const writes=[];
  await mountAdministration(host,async(path,body)=>{if(!body)return path==='/policy'?{points}:{unitAmountMinor:5,currency:'eur'};writes.push(path);throw Error('Unavailable');});
  const {field,form,status}=ui(host);field('creditPrice').value='0.10';field('bookReward').value=25;
  await form.onsubmit(event);assert.deepEqual(writes,['/offer-settings']);assert.equal(field('creditPrice').value,'0.10');assert.equal(field('bookReward').value,25);assert.equal(field('creditPrice').disabled,false);assert.equal(status.textContent,'Unavailable');
});

test('partial save is reported and retry writes only the remaining settings',async t=>{
  const {host}=setup(t);const writes=[];let fail=true;
  await mountAdministration(host,async(path,body)=>{
    if(!body)return path==='/policy'?{points}:{unitAmountMinor:5,currency:'eur'};
    writes.push(path);if(path==='/policy'&&fail)throw Error('Unavailable');return path==='/policy'?{points:body}:body;
  });
  const {field,form,status}=ui(host);field('creditPrice').value='0.10';field('bookReward').value=25;
  await form.onsubmit(event);assert.match(status.textContent,/Prețul a fost salvat, dar regulile/);assert.equal(field('bookReward').value,25);
  fail=false;await form.onsubmit(event);assert.deepEqual(writes,['/offer-settings','/policy','/policy']);assert.match(status.textContent,/au fost salvate/);
});

test('loading errors keep fields editable and a delayed read preserves typed values',async t=>{
  const {host}=setup(t);let resolvePolicy,rejectPrice;
  const mount=mountAdministration(host,path=>new Promise((resolve,reject)=>{if(path==='/policy')resolvePolicy=resolve;else rejectPrice=reject;}));
  const {field,form,reset,status}=ui(host);field('bookReward').value=55;field('bookReward').oninput();field('creditPrice').value='0.10';field('creditPrice').oninput();
  assert.notEqual(field('creditPrice').disabled,true);resolvePolicy({points});rejectPrice(Error('Unavailable'));await mount;
  assert.equal(field('bookReward').value,55);assert.equal(field('creditPrice').value,'0.10');assert.match(status.textContent,/nu au putut fi încărcate/);
  assert.equal(nodes(form).find(node=>node.type==='submit').disabled,false);reset.onclick();assert.equal(field('creditPrice').value,'');assert.equal(field('currency').value,'EUR');assert.equal(field('bookReward').value,10);
});
