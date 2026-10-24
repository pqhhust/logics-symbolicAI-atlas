let notebookEndpoint='',linkError='',linkConflict=false,savingNotebook=false,notebookRetry=null;
const progressGroups=['ratings','notes','bookmarks','rubrics'];
const clone=x=>JSON.parse(JSON.stringify(x));
function cloudBaseKey(id){return 'symbolic-atlas-cloud-base-'+id}
function changesBetween(current,base){const changes=[];for(const group of progressGroups)for(const[key,value]of Object.entries(current[group]||{})){const previous=base[group]?.[key];if(JSON.stringify(value)!==JSON.stringify(previous))changes.push({group,key,value,...(previous===undefined?{}:{previous})})}return changes}
function applyChanges(base,changes){for(const c of changes)(base[c.group]??={})[c.key]=c.value;return base}
function currentPrivateLink(){const u=new URL(location.href);u.search='';u.hash='open='+currentUser.token;return u.href}
function saveNotebookCache(){try{localStorage.setItem(storageKey(),JSON.stringify(state));localStorage.setItem(cloudBaseKey(currentUser.id),JSON.stringify(lastSaved));}catch{}updateProgress()}
function notebookStatus(text){$('#storage-note').textContent=text;const status=$('#notebook-sync-status');if(status)status.textContent=text}
async function notebookRequest(method,token,payload){
 if(!notebookEndpoint)throw new Error('Private-link storage is unavailable. Local notebooks still work.');
 const headers={};if(token)headers.Authorization='Bearer '+token;if(payload!==undefined)headers['Content-Type']='application/json';
 const r=await fetch(notebookEndpoint,{method,headers,body:payload===undefined?undefined:JSON.stringify(payload),credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',redirect:'error'});
 let d;try{d=await r.json()}catch{throw new Error('Notebook service did not respond. Please retry.')}
 if(!r.ok){const e=new Error(d.error||'Could not open notebook');e.status=r.status;throw e}return d;
}
function rememberNotebook(notebook,token){const profiles=localProfiles(),entry={id:notebook.id,name:notebook.name,token};const index=profiles.findIndex(x=>x.id===entry.id);if(index<0)profiles.push(entry);else profiles[index]=entry;writeProfiles(profiles);localStorage.setItem('symbolic-atlas-active-local-profile',entry.id);currentUser=entry;$('#profile-link').textContent=entry.name;}
async function openPrivateNotebook(token,fromLink=false){
 const priorUser=currentUser,priorState=state;const {notebook}=await notebookRequest('GET',token);let cached,base;
 try{cached=JSON.parse(localStorage.getItem('symbolic-atlas-user-'+notebook.id)||'null');base=JSON.parse(localStorage.getItem(cloudBaseKey(notebook.id))||'null')}catch{}
 rememberNotebook(notebook,token);cloudAvailable=true;linkConflict=false;linkError='';lastSaved=clone(notebook.progress);state=Object.assign(freshState(),clone(notebook.progress));
 if(cached&&base){const pending=changesBetween(cached,base);if(pending.length){try{const result=await notebookRequest('PATCH',token,{changes:pending});state=Object.assign(freshState(),result.notebook.progress);lastSaved=clone(result.notebook.progress)}catch(e){state=Object.assign(freshState(),cached);lastSaved=clone(base);pendingSave=true;if(e.status===409){linkConflict=true;linkError=e.message}else linkError='Your unsynced work is kept on this device. Retry saving when online.'}}}
 pendingSave=changesBetween(state,lastSaved).length>0;saveNotebookCache();notebookStatus(linkError||'Private notebook connected · saved across devices.');
 if(fromLink){history.replaceState(null,'',location.pathname+location.search+'#profile')}
 return notebook;
}
async function initProfile(){
 const match=/^#open=([A-Za-z0-9_-]{43})$/.exec(location.hash),incoming=match?.[1];
 await initLocalProfile();profileReady=false;
 try{const r=await fetch('private-links-config.json',{cache:'no-store'});if(r.ok){const config=await r.json();const url=new URL(config.endpoint);if(url.protocol==='https:'||(['127.0.0.1','localhost'].includes(url.hostname)&&url.protocol==='http:'))notebookEndpoint=url.href}}catch{}
 if(incoming){history.replaceState(null,'',location.pathname+location.search+'#profile');try{await openPrivateNotebook(incoming,true)}catch(e){linkError='Could not open that private link: '+e.message;notebookStatus(linkError)}}
 else if(currentUser?.token){try{await openPrivateNotebook(currentUser.token)}catch(e){cloudAvailable=false;linkError='Could not connect. This device’s copy is available; cloud saves will retry when you reconnect.';notebookStatus(linkError)}}
 profileReady=true;
}
async function saveCloud(){
 if(!currentUser?.token||!cloudAvailable||savingNotebook||linkConflict)return;
 const changes=changesBetween(state,lastSaved);if(!changes.length){pendingSave=false;return}
 savingNotebook=true;const snapshot=clone(state),token=currentUser.token;
 notebookStatus('Saving your private notebook…');
 try{
  const {notebook}=await notebookRequest('PATCH',token,{changes});
  if(currentUser?.token!==token)return;
  const whileSaving=changesBetween(state,snapshot);state=Object.assign(freshState(),applyChanges(clone(notebook.progress),whileSaving));lastSaved=clone(notebook.progress);pendingSave=changesBetween(state,lastSaved).length>0;linkError='';saveNotebookCache();notebookStatus('Saved to your private notebook · ready on another device.');
 }catch(e){pendingSave=true;if(e.status===409){linkConflict=true;linkError='Another device changed the same entry. Open Profiles to choose which version to keep.'}else linkError='Not synced yet. Your work is kept on this device; use Retry save in Profiles.';saveNotebookCache();notebookStatus(linkError)}
 finally{savingNotebook=false;if(pendingSave&&!linkConflict){clearTimeout(notebookRetry);notebookRetry=setTimeout(saveCloud,15000)}}
}
async function createPrivateNotebook(name,copyCurrent=false){
 const source=copyCurrent?clone(state):freshState();const {secret,notebook}=await notebookRequest('POST',null,{name});rememberNotebook(notebook,secret);state=source;lastSaved=clone(notebook.progress);cloudAvailable=true;linkConflict=false;linkError='';pendingSave=changesBetween(state,lastSaved).length>0;saveNotebookCache();if(pendingSave)await saveCloud();renderProfile();toast('Your private link is ready. Copy it and keep it safe.');
}
function tokenFromInput(value){const text=value.trim();if(/^[A-Za-z0-9_-]{43}$/.test(text))return text;try{const u=new URL(text);if(u.origin!==location.origin||u.pathname.replace(/\/$/,'')!==location.pathname.replace(/\/$/,''))return null;return /^#open=([A-Za-z0-9_-]{43})$/.exec(u.hash)?.[1]||null}catch{return null}}
async function reconnectNotebook(){if(!currentUser?.token)return;try{cloudAvailable=true;await openPrivateNotebook(currentUser.token);if(pendingSave&&!linkConflict)await saveCloud();renderProfile()}catch(e){linkError=e.message;cloudAvailable=false;renderProfile()}}
function renderProfile(){
 const remote=!!currentUser?.token;
 $('#main').innerHTML=intro('Your personal notebook','Keep your place.<br><em>Come back by private link.</em>','Create a private link once. Save it, then open it on another device to continue with the same notes, bookmarks and review progress.')+
 (linkError?`<div class="callout" role="status">${esc(linkError)}</div>`:'')+
 `<section class="profile-card"><div class="profile-avatar">${esc(currentUser?currentUser.name[0].toUpperCase():'⊢')}</div><h2>${esc(currentUser?.name||'Your study notebook')}</h2>${remote?`<div class="eyebrow">PRIVATE-LINK NOTEBOOK</div><label class="scratch-label" for="private-link-value">Your private link</label><div class="filter-row"><input id="private-link-value" class="search-input" readonly value="${esc(currentPrivateLink())}"><button id="copy-private-link" class="btn primary">Copy private link</button></div><p>Keep this link private. Anyone with it can open and edit your notebook.</p><p id="notebook-sync-status" class="sync-status" role="status">${esc(linkConflict?'This notebook has conflicting edits.':cloudAvailable?'Connected · your progress is saved across devices.':'Offline · this device has a saved copy.')}</p><div class="button-row"><button id="notebook-retry" class="btn">Retry save</button><button id="notebook-export" class="btn">Export a backup</button><button id="notebook-leave" class="btn">Close this notebook</button></div>${linkConflict?'<div class="callout"><p>The same entry was edited on another device. Choose which version to keep. Your current notes can be exported first.</p><div class="button-row"><button id="use-cloud-notes" class="btn">Export this copy and load saved version</button><button id="use-device-notes" class="btn">Keep my edits for conflicting entries</button></div></div>':''}`:`<p>${currentUser?'This is a device-only notebook. Make it portable by creating a private link.':'No account or email is needed. Choose a name for a new private notebook.'}</p><div class="filter-row"><input id="private-notebook-name" class="search-input" maxlength="50" placeholder="Your notebook name" aria-label="Private notebook name" value="${esc(currentUser?.name||'')}"><button id="create-private-notebook" class="btn primary">${currentUser?'Make this notebook portable':'Create my private link'}</button></div><label class="scratch-label"><input id="copy-current-notes" type="checkbox" ${currentUser?'checked':''}> Include the notes and progress from this device’s current notebook</label><p class="footer-note">Copy the generated link somewhere safe. It is the key to this notebook.</p>`}</section>`+
 `<section class="profile-card"><h3>Already have a private link?</h3><div class="filter-row"><input id="resume-private-link" class="search-input" type="text" autocomplete="off" spellcheck="false" placeholder="Paste your private link here" aria-label="Paste private notebook link"><button id="resume-private-notebook" class="btn">Open notebook</button></div><p class="footer-note">You can also paste the full link directly into your browser’s address bar.</p></section>`+
 `<details class="profile-card"><summary>Device-only notebooks & backups</summary><div id="local-notebook-panel"></div></details>`;
 const profiles=localProfiles();$('#local-notebook-panel').innerHTML=`<p>These notebooks are stored only in this browser. Private-link notebooks are labelled below.</p><select id="local-profile" aria-label="Choose saved notebook"><option value="">Guest</option>${profiles.map(p=>`<option value="${p.id}" ${currentUser?.id===p.id?'selected':''}>${esc(p.name)}${p.token?' · private link':''}</option>`).join('')}</select><div class="filter-row"><input id="new-profile-name" class="search-input" maxlength="50" placeholder="New device-only notebook"><button id="new-profile-create" class="btn">Create device-only</button></div><div class="button-row"><button id="profile-export" class="btn">Export current notebook</button><label class="btn" for="profile-import">Import missing entries</label><input type="file" id="profile-import" accept="application/json,.json" hidden></div>`;
 if(!remote){$('#create-private-notebook').onclick=async()=>{const b=$('#create-private-notebook'),name=$('#private-notebook-name').value.trim(),copy=$('#copy-current-notes').checked;if(!name){toast('Enter a notebook name.');return}b.disabled=true;try{await createPrivateNotebook(name,copy)}catch(e){b.disabled=false;toast(e.message)}}}
 else{
  $('#copy-private-link').onclick=async()=>{try{await navigator.clipboard.writeText(currentPrivateLink());toast('Private link copied. Keep it safe.')}catch{$('#private-link-value').select();toast('Select and copy your private link.')}};
  $('#notebook-export').onclick=()=>$('#export').click();$('#notebook-retry').onclick=reconnectNotebook;
  $('#notebook-leave').onclick=async()=>{if(pendingSave){await saveCloud();if(pendingSave){toast('Some edits are not synced. Export a backup before leaving.');return}}localStorage.removeItem('symbolic-atlas-active-local-profile');location.hash='profile';location.reload()};
  if(linkConflict){$('#use-cloud-notes').onclick=async()=>{try{$('#export').click();const {notebook}=await notebookRequest('GET',currentUser.token);state=Object.assign(freshState(),notebook.progress);lastSaved=clone(notebook.progress);linkConflict=false;pendingSave=false;linkError='';saveNotebookCache();renderProfile()}catch(e){toast(e.message)}};$('#use-device-notes').onclick=async()=>{try{const pending=changesBetween(state,lastSaved);const {notebook}=await notebookRequest('GET',currentUser.token);lastSaved=clone(notebook.progress);state=Object.assign(freshState(),applyChanges(clone(notebook.progress),pending));linkConflict=false;linkError='';await saveCloud();renderProfile()}catch(e){toast(e.message)}}}
 }
 $('#resume-private-notebook').onclick=async()=>{const token=tokenFromInput($('#resume-private-link').value);if(!token){toast('Paste a private link from this atlas.');return}const b=$('#resume-private-notebook');b.disabled=true;try{await openPrivateNotebook(token,true);renderProfile();toast('Your notebook is open.')}catch(e){b.disabled=false;toast(e.message)}};
 $('#local-profile').onchange=async e=>{if(currentUser?.token&&pendingSave){await saveCloud();if(pendingSave){toast('Export your unsynced work before switching.');return}}switchLocalProfile(e.target.value)};
 $('#new-profile-create').onclick=()=>{const name=$('#new-profile-name').value.trim();if(!name){toast('Enter a notebook name.');return}const id=crypto.randomUUID();writeProfiles([...profiles,{id,name}]);switchLocalProfile(id)};
 $('#profile-export').onclick=()=>$('#export').click();$('#profile-import').onchange=async e=>{const file=e.target.files[0];if(!file)return;if(file.size>3000000){toast('That file is too large.');return}try{const n=JSON.parse(await file.text()),validIds=new Set(data.exercises.map(q=>q.id));for(const g of progressGroups)for(const[k,v]of Object.entries(n[g]||{})){const id=g==='rubrics'?k.split('-')[0]:k;if(!validIds.has(id))continue;if(g==='notes'&&(typeof v!=='string'||v.length>30000))continue;if(g==='ratings'&&!['again','learning','confident'].includes(v))continue;if((g==='bookmarks'||g==='rubrics')&&typeof v!=='boolean')continue;if(!(k in state[g]))state[g][k]=v}persist();toast('Missing entries imported. Existing notes kept.')}catch{toast('Could not read that backup.')}};
}
window.addEventListener('online',()=>{if(currentUser?.token)reconnectNotebook()});
