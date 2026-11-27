import { mountPoints, pointsApi } from './account-points.js?v=users-errors-1';
import { newSubmissionId } from './submission-policy.js';

const ro = document.documentElement.lang === 'ro';
const t = (en, romanian) => ro ? romanian : en;
const el = (tag, text, props = {}) => Object.assign(document.createElement(tag), {textContent:text, ...props});
const button = (en, romanian) => el('button', t(en,romanian), {type:'button',className:'button button-quiet'});
const personName = user => user.displayName || user.username || user.email || t('Unnamed account','Cont fără nume');
const roles = user => (user.roles || []).map(role => role === 'admin' ? t('Administrator','Administrator') : role === 'user' || role === 'selfRegistered' ? t('Member','Membru') : role).join(' · ');
const joinedDate = new Intl.DateTimeFormat(ro ? 'ro-RO' : 'en', {dateStyle:'medium'});
const date = value => {
  const timestamp = value ? new Date(value) : null;
  return timestamp && Number.isFinite(timestamp.getTime()) ? joinedDate.format(timestamp) : '—';
};

function errorMessage(error, action) {
  if (error.status === 401) return t('Your session has expired. Sign in again.','Sesiunea a expirat. Autentifică-te din nou.');
  if (error.code === 'account_service_access') return t(
    'The account service did not authorize this action. Ask a platform administrator to check the access settings.',
    'Serviciul de conturi a refuzat această acțiune. Cere unui administrator al platformei să verifice accesul.');
  if (error.status === 403) return t(
    'This action requires administrator access.','Această acțiune este disponibilă administratorilor.');
  if (error.status === 429) return t(
    'There were too many requests. Wait a moment and try again.','Au fost prea multe cereri. Așteaptă puțin și încearcă din nou.');
  if (error.status === 504) return t(
    'The account service took too long to respond. Try again.','Serviciul de conturi a răspuns prea greu. Încearcă din nou.');
  if (error.code === 'users_page_invalid') return t(
    'This page of users is invalid. Search again.','Pagina de utilizatori este invalidă. Repetă căutarea.');
  if (error.code === 'credit_award_invalid') return t(
    'Enter a valid number of credits and a reason.','Introdu un număr valid de credite și un motiv.');
  if (error.code === 'account_service_rejected' || error.status === 400) return action === 'list'
    ? t('The account service rejected the request for the user list. If it keeps happening, contact an administrator.',
      'Serviciul de conturi a respins cererea de listare a utilizatorilor. Dacă problema persistă, contactează un administrator.')
    : t('The account service rejected the credit award. If it keeps happening, contact an administrator.',
      'Serviciul de conturi a respins acordarea creditelor. Dacă problema persistă, contactează un administrator.');
  return action === 'list'
    ? t('The user list could not be loaded. Try searching again.','Lista de utilizatori nu s-a putut încărca. Repetă căutarea.')
    : t('The credit award could not be confirmed. Try again.','Acordarea creditelor nu a putut fi confirmată. Încearcă din nou.');
}

export async function mountUsers(host) {
  const listView = el('div',''), detailView = el('div','',{hidden:true});
  const searchForm = el('form','',{className:'account-user-search'});
  const label = el('label',t('Find a user','Caută un utilizator'));
  const search = el('input','',{type:'search',maxLength:200,placeholder:t('Email or name','Email sau nume')});
  label.append(search);
  const find = button('Search','Caută');find.type='submit';searchForm.append(label,find);
  const status = el('p','',{role:'status',className:'account-users-status'});
  const columns = el('div','',{className:'account-user-columns',hidden:true});
  columns.setAttribute('aria-hidden','true');
  columns.append(el('span',t('Name and email','Nume și email')),el('span',t('Role','Rol')),el('span',t('Joined','Înregistrat la')));
  const list = el('ul','',{className:'account-user-list'});
  const pages = el('nav','',{className:'account-user-pages'});pages.setAttribute('aria-label',t('Users pages','Paginile utilizatorilor'));
  listView.append(el('h2',t('Users and credit awards','Utilizatori și acordare de credite')),searchForm,status,columns,list,pages);host.replaceChildren(listView,detailView);
  let request = 0, timer;

  async function showDetails(user, item) {
    listView.hidden=true;detailView.hidden=false;
    const back = button('Back to users','Înapoi la utilizatori');
    back.onclick=()=>{detailView.hidden=true;listView.hidden=false;(item.isConnected ? item : search).focus();};
    const heading = el('h2',personName(user));heading.tabIndex=-1;
    const header = el('header','',{className:'account-user-detail-header'});
    header.append(heading,back);
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
    const actions = el('div','',{className:'account-settings-actions'});
    actions.append(grantStatus,grant);
    grantForm.append(field(t('Credits','Credite'),amount),field(t('Reason','Motiv'),reason),actions);
    const award = el('section','',{className:'account-user-award'});
    award.append(el('h3',t('Award credits','Acordă credite')),grantForm);
    detailView.replaceChildren(header,facts,award,balance);
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
      } catch(error) {grantStatus.textContent=errorMessage(error,'grant');}
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
      columns.hidden=!result.users.length;
      for(const user of result.users){
        const row=el('li',''), item=el('button','',{type:'button',className:'account-user-item'});
        const identity=el('span','',{className:'account-user-identity'});
        const name=personName(user);
        identity.append(el('strong',name));
        if (user.email && user.email !== name) identity.append(el('span',user.email));
        const role=el('span',roles(user) || '—',{className:'account-user-role'});
        const joined=el('span','',{className:'account-user-date'});
        joined.append(el('span',t('Joined: ','Înregistrat la: '),{className:'sr-only'}), date(user.createdAt));
        item.append(identity,role,joined);
        item.onclick=()=>void showDetails(user,item);
        row.append(item);list.append(row);
      }
      const total=result.totalCount ?? result.users.length;
      status.textContent=result.users.length ? t(`${start+1}–${start+result.users.length} of ${total} users`,`${start+1}–${start+result.users.length} din ${total} utilizatori`) : t('No matching users.','Nu am găsit utilizatori.');
      const previous=button('Previous','Înapoi'),next=button('Next','Înainte');
      previous.onclick=()=>void load(Math.max(0,start-25));next.onclick=()=>void load(start+25);
      if(start)pages.append(previous);if(start+result.users.length<total)pages.append(next);
    }catch(error){if(token===request){columns.hidden=true;list.replaceChildren();pages.replaceChildren();status.textContent=errorMessage(error,'list');}}
    finally{if(token===request)list.removeAttribute('aria-busy');}
  }
  searchForm.onsubmit=event=>{event.preventDefault();clearTimeout(timer);void load();};
  search.oninput=()=>{clearTimeout(timer);++request;timer=setTimeout(()=>void load(),250);};
  await load();
}
