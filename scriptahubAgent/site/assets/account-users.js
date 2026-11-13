import { mountPoints, pointsApi } from './account-points.js?v=credit-payment-feedback-10';
import { newSubmissionId } from './submission-policy.js';

const ro = document.documentElement.lang === 'ro';
const t = (en, romanian) => ro ? romanian : en;
const el = (tag, text, props = {}) => Object.assign(document.createElement(tag), {textContent:text, ...props});
const button = (en, romanian) => el('button', t(en,romanian), {type:'button',className:'button button-quiet'});
const personName = user => user.displayName || user.username || user.email || t('Unnamed account','Cont fără nume');
const roles = user => (user.roles || []).map(role => role === 'admin' ? t('Administrator','Administrator') : role === 'user' || role === 'selfRegistered' ? t('Member','Membru') : role).join(' · ');
const date = value => value ? new Date(value).toLocaleDateString(ro ? 'ro' : 'en') : '—';

export async function mountUsers(host) {
  const listView = el('div',''), detailView = el('div','',{hidden:true});
  const searchForm = el('form','',{className:'account-user-search'});
  const label = el('label',t('Find a user','Caută un utilizator'));
  const search = el('input','',{type:'search',maxLength:200,placeholder:t('Email or name','Email sau nume')});
  label.append(search);
  const find = button('Search','Caută');find.type='submit';searchForm.append(label,find);
  const status = el('p','',{role:'status',className:'account-users-status'});
  const list = el('ul','',{className:'account-user-list'});
  const pages = el('nav','',{className:'account-user-pages'});pages.setAttribute('aria-label',t('Users pages','Paginile utilizatorilor'));
  listView.append(el('h2',t('Users and credit awards','Utilizatori și acordare de credite')),searchForm,status,list,pages);host.replaceChildren(listView,detailView);
  let request = 0, timer;

  async function showDetails(user) {
    listView.hidden=true;detailView.hidden=false;
    const back = button('Back to users','Înapoi la utilizatori');
    back.onclick=()=>{detailView.hidden=true;listView.hidden=false;search.focus();};
    const heading = el('h2',personName(user));heading.tabIndex=-1;
    const facts = el('dl','',{className:'account-user-facts'});
    for (const [name,value] of [[t('Email','Email'),user.email],[t('Role','Rol'),roles(user)],[t('Joined','Înregistrat la'),date(user.createdAt)]]) {
      const row=el('div','');row.append(el('dt',name),el('dd',value || '—'));facts.append(row);
    }
    const balance = el('div','',{className:'account-user-points'});
    const grantForm = el('form','',{className:'account-user-grant'});
    const amount = el('input','',{type:'number',min:1,max:1000000,step:1,required:true});
    const reason = el('input','',{type:'text',maxLength:500,required:true});
    const field = (caption,input) => {const label=el('label',caption);label.append(input);return label;};
    const grant = button('Grant credits','Acordă credite');grant.type='submit';grant.disabled=true;
    const grantStatus = el('p','',{role:'status'});
    grantForm.append(field(t('Credits','Credite'),amount),field(t('Reason','Motiv'),reason),grant);
    detailView.replaceChildren(back,heading,facts,el('h3',t('Award credits','Acordă credite')),grantForm,grantStatus,balance);
    heading.focus();
    let requestId, pending=false;
    grantForm.oninput=()=>{if(!pending)requestId=undefined;};
    grantForm.onsubmit=async event=>{
      event.preventDefault();if(pending || !grantForm.reportValidity())return;
      requestId ||= newSubmissionId();pending=true;grant.disabled=amount.disabled=reason.disabled=true;grantStatus.textContent='';
      try {
        await pointsApi('/grant',{userId:user.id,amount:amount.valueAsNumber,reason:reason.value,requestId});
        await points.refresh();
        grantStatus.textContent=t('Credits awarded.','Creditele au fost acordate.');
        amount.value=reason.value='';requestId=undefined;
      } catch(error) {grantStatus.textContent=error.message;}
      finally {pending=false;grant.disabled=amount.disabled=reason.disabled=false;}
    };
    // The personal points view has its own state and is never switched to this user.
    const points = await mountPoints(balance,{userId:user.id});
    grant.disabled=false;
  }

  async function load(start=0) {
    const token=++request;
    status.textContent=t('Loading users…','Se încarcă utilizatorii…');list.setAttribute('aria-busy','true');
    try {
      const result=await pointsApi('/users?'+new URLSearchParams({search:search.value.trim(),start}));
      if(token!==request)return;
      list.replaceChildren();pages.replaceChildren();
      for(const user of result.users){
        const row=el('li',''), item=el('button','',{type:'button',className:'account-user-item'});
        const identity=el('span','',{className:'account-user-identity'});
        identity.append(el('strong',personName(user)),el('span',user.email || ''));
        const summary=el('span',roles(user),{className:'account-user-role'});
        item.append(identity,summary,el('span',date(user.createdAt),{className:'account-user-date'}));
        item.onclick=()=>void showDetails(user);
        row.append(item);list.append(row);
      }
      const total=result.totalCount ?? result.users.length;
      status.textContent=result.users.length ? t(`${start+1}–${start+result.users.length} of ${total} users`,`${start+1}–${start+result.users.length} din ${total} utilizatori`) : t('No matching users.','Nu am găsit utilizatori.');
      const previous=button('Previous','Înapoi'),next=button('Next','Înainte');
      previous.onclick=()=>void load(Math.max(0,start-25));next.onclick=()=>void load(start+25);
      if(start)pages.append(previous);if(start+result.users.length<total)pages.append(next);
    }catch(error){if(token===request){list.replaceChildren();pages.replaceChildren();status.textContent=error.message;}}
    finally{if(token===request)list.removeAttribute('aria-busy');}
  }
  searchForm.onsubmit=event=>{event.preventDefault();clearTimeout(timer);void load();};
  search.oninput=()=>{clearTimeout(timer);++request;timer=setTimeout(()=>void load(),250);};
  await load();
}
