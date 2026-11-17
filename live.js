const SHEET_ID = '1J5GsH4KaPL7CwEpS_5sXhY9A-TZDlLScr1tXS2cyONU';
const TAB = '客户开发';
const DEFAULT_CLIENT_ID = '745042573393-a70a7planugqks4jetbncotp076190rf.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const API = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`;
const GROUPS = {
  '基础资料': [0,1,2,3,4,5,6,21,22,33],
  '关键联系人': [7,8,9,10,11,12,13],
  '采购与报价': [14,15,16,17,18,19,20,29,30,31,32],
  '跟进记录': [23,24,25,26,27,28,34],
  '客户背调': [35,36,37,38,39,40,41,42,43,44,45,46,47,48],
};
const EXPECTED = {0:'客户编号',1:'公司名称',22:'开发阶段',33:'负责人',48:'背调结论/开发建议'};
const app = document.querySelector('#app');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const column = index => {let n=index+1,s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26)}return s};
let clientId = localStorage.getItem('lithium-crm-google-client-id') || DEFAULT_CLIENT_ID;
let googleLoginReady = Boolean(window.google?.accounts?.oauth2);
let token = null, tokenExpires = 0, tokenClient = null;
let headers = [], rows = [], selectedId = null, filter = '', stage = '', group = '基础资料';
let edit = false, draft = [], snapshot = [], message = '', messageType = '', busy = false, lastSync = null;

function say(text, type='') { message=text; messageType=type; const box=document.querySelector('#message'); if(box){box.textContent=text;box.className=`status ${type}`;} }
function activeToken() { return token && Date.now() < tokenExpires - 60_000; }
function renderSetup() {
  app.innerHTML = `<div class="panel setup"><h1>连接客户开发表格</h1><p class="muted">使用有权访问原表格的 Google 账号授权。登录后可读取 49 个字段，并将客户修改写回原表格。公开访客无法直接看到表格数据。</p><button class="button primary" id="connect" ${googleLoginReady?'':'disabled'}>使用 Google 账号连接</button><p id="message" class="status ${messageType}" role="status">${escapeHtml(message||'正在加载 Google 登录组件…')}</p><p class="hint">请在 Chrome 或 Edge 中完成 Google 授权。如果当前在 Codex 内置浏览器，请复制本页地址到浏览器地址栏打开。</p><details><summary class="hint">连接配置</summary><label class="field"><span>Google OAuth 网页客户端 ID</span><input id="client-id" placeholder="xxxxxxxx.apps.googleusercontent.com" value="${escapeHtml(clientId)}"></label><p class="hint">Google Cloud 中需启用 Google Sheets API，并将 <b>${escapeHtml(location.origin)}</b> 加入“已获授权的 JavaScript 来源”。客户端 ID 是公开标识；访问令牌仅保存在本页内存中。</p></details><div class="notice">当前按 Google 表格本身的共享权限控制读写。老板/业务员分区权限仍需服务端实现，不能仅凭页面按钮限制。</div></div>`;
  document.querySelector('#connect').onclick = connect;
}
function loadGoogleLogin() {
  if(googleLoginReady){renderSetup();return}
  const script=document.createElement('script');
  script.src='https://accounts.google.com/gsi/client';
  script.async=true;
  let finished=false;
  const finish=ready=>{
    if(finished)return;finished=true;googleLoginReady=ready;
    if(ready){say('Google 登录已就绪，请点击连接。','success');renderSetup()}
    else say('当前浏览器无法加载 Google 登录。请复制本页地址，在 Chrome 或 Edge 中打开后刷新。','error');
  };
  script.onload=()=>finish(Boolean(window.google?.accounts?.oauth2));
  script.onerror=()=>finish(false);
  document.head.append(script);
  setTimeout(()=>finish(Boolean(window.google?.accounts?.oauth2)),10000);
}
function connect() {
  clientId = document.querySelector('#client-id').value.trim();
  if(!/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId)){say('请填写有效的 Google OAuth 网页客户端 ID。','error');return}
  localStorage.setItem('lithium-crm-google-client-id',clientId);
  if(!googleLoginReady||!window.google?.accounts?.oauth2){say('Google 登录尚未就绪。请在 Chrome 或 Edge 中打开并刷新。','error');return}
  tokenClient = google.accounts.oauth2.initTokenClient({client_id:clientId,scope:SCOPE,callback:async response=>{
    if(response.error){say(`Google 授权失败：${response.error}`,'error');return}
    token=response.access_token;tokenExpires=Date.now()+Number(response.expires_in||3500)*1000;
    await reload();
  }});
  tokenClient.requestAccessToken({prompt:'consent'});
}
async function request(path, options={}) {
  if(!activeToken()){token=null;headers=[];rows=[];edit=false;renderSetup();throw new Error('授权已过期，请重新连接 Google。')}
  const response = await fetch(`${API}${path}`, { ...options, headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(options.headers||{})} });
  let body; try {body=await response.json()} catch {body={}}
  if(response.status===401||response.status===403){token=null;headers=[];rows=[];edit=false;renderSetup()}
  if(!response.ok) throw new Error(body.error?.message || `Google Sheets API 返回 ${response.status}`);
  return body;
}
const range = coordinates => encodeURIComponent(`'${TAB}'!${coordinates}`);
async function reload() {
  busy=true; say('正在从 Google 表格读取…');
  try {
    const data=await request(`/values/${range('A1:AW1000')}?valueRenderOption=FORMATTED_VALUE`);
    const nextHeaders=(data.values?.[0]||[]);
    for(const [index,value] of Object.entries(EXPECTED)) if(nextHeaders[Number(index)]!==value) throw new Error(`表格第 ${Number(index)+1} 列标题已变化，已停止同步以免写错列。`);
    if(nextHeaders.length!==49) throw new Error('表格列数不是预期的 49 列，已停止同步。');
    headers=nextHeaders;
    rows=(data.values||[]).slice(1).map((values,index)=>({sheetRow:index+2,values:Array.from({length:49},(_,i)=>String(values[i]??''))})).filter(row=>row.values[0]&&row.values[1]);
    if(selectedId&&!rows.some(row=>row.values[0]===selectedId))selectedId=null;
    if(!selectedId)selectedId=rows[0]?.values[0]||null;
    edit=false;lastSync=new Date();message=`已同步 ${rows.length} 家客户 · ${lastSync.toLocaleTimeString('zh-CN')}`;messageType='success';renderLive();
  } catch(error){say(error.message,'error'); if(headers.length)renderLive(); else renderSetup()}
  finally {busy=false}
}
function selected(){return rows.find(row=>row.values[0]===selectedId)}
function renderLive() {
  const visible=rows.filter(row=>`${row.values[1]} ${row.values[7]} ${row.values[0]}`.toLowerCase().includes(filter.toLowerCase())&&(!stage||row.values[22]===stage));
  const stages=[...new Set(rows.map(row=>row.values[22]).filter(Boolean))].sort();
  app.innerHTML=`<div class="top"><div><h1>客户管理</h1><div class="muted">与“${TAB}”表格双向同步 · ${rows.length} 家客户</div></div><div class="actions"><button class="button" id="refresh">↻ 从表格刷新</button><button class="button" id="new">＋ 新建客户</button><button class="button" id="disconnect">断开连接</button></div></div><div class="banner">当前 Google 账号必须拥有表格访问权限。业务员分区和老板权限尚未在服务端强制执行；共享表格前请先确认对方应看到的全部数据。</div><div class="status ${messageType}" id="message" role="status"><span class="dot"></span>${escapeHtml(message)}</div><div class="toolbar"><input id="search" placeholder="搜索公司、联系人或客户编号" value="${escapeHtml(filter)}"><select id="stage"><option value="">全部阶段</option>${stages.map(s=>`<option ${stage===s?'selected':''}>${escapeHtml(s)}</option>`).join('')}</select></div><div class="content"><section class="panel tablewrap" style="padding:0"><table class="table"><thead><tr><th>客户名称</th><th>国家/地区</th><th>客户类型</th><th>开发阶段</th><th>负责人</th><th>下一步行动</th></tr></thead><tbody>${visible.length?visible.map(row=>`<tr data-id="${escapeHtml(row.values[0])}" class="${row.values[0]===selectedId?'selected':''}"><td><strong>${escapeHtml(row.values[1])}</strong><small>${escapeHtml(row.values[0])}</small></td><td>${escapeHtml(row.values[2])}</td><td>${escapeHtml(row.values[5])}</td><td><span class="tag">${escapeHtml(row.values[22]||'未设置')}</span></td><td>${escapeHtml(row.values[33]||'待分配')}</td><td>${escapeHtml(row.values[28])}</td></tr>`).join(''):`<tr><td colspan="6" class="empty">没有符合条件的客户</td></tr>`}</tbody></table></section><aside class="panel detail" id="detail">${renderDetail()}</aside></div>`;
  document.querySelector('#refresh').onclick=()=>{if(edit&&!confirm('放弃未保存的修改并刷新？'))return;reload()};
  document.querySelector('#disconnect').onclick=()=>{token=null;tokenExpires=0;headers=[];rows=[];edit=false;say('已断开 Google 连接。');renderSetup()};
  document.querySelector('#new').onclick=createCustomer;
  document.querySelector('#search').oninput=e=>{if(edit)collectDraft();filter=e.target.value;const pos=e.target.selectionStart;renderLive();const input=document.querySelector('#search');input.focus();input.setSelectionRange(pos,pos)};
  document.querySelector('#stage').onchange=e=>{if(edit)collectDraft();stage=e.target.value;renderLive()};
  document.querySelectorAll('[data-id]').forEach(el=>el.onclick=()=>{if(edit&&!confirm('放弃未保存的修改？'))return;selectedId=el.dataset.id;edit=false;group='基础资料';renderLive()});
  bindDetail();
}
function renderDetail() {
  const row=selected(); if(!row)return '<div class="empty">请选择客户</div>';
  const values=edit?draft:row.values;
  return `<div class="detail-head"><div><h2>${escapeHtml(row.values[1])}</h2><small>${escapeHtml(row.values[0])} · 表格第 ${row.sheetRow} 行</small></div><button class="button" id="${edit?'cancel':'edit'}">${edit?'取消':'编辑'}</button></div><div class="sections">${Object.keys(GROUPS).map(name=>`<button data-group="${escapeHtml(name)}" class="${group===name?'active':''}">${escapeHtml(name)}</button>`).join('')}</div>${edit?`<div class="edit-grid">${GROUPS[group].filter(i=>i!==0).map(i=>`<label class="field ${[6,15,27,28,34,40,47,48].includes(i)?'wide':''}"><span>${escapeHtml(headers[i])}</span>${[6,15,27,28,34,40,47,48].includes(i)?`<textarea data-field="${i}">${escapeHtml(values[i])}</textarea>`:`<input data-field="${i}" value="${escapeHtml(values[i])}">`}</label>`).join('')}</div><button class="button primary" id="save">保存到 Google 表格</button>`:GROUPS[group].map(i=>`<div class="kv"><span>${escapeHtml(headers[i])}</span><span>${escapeHtml(values[i]||'—')}</span></div>`).join('')}<div class="notice">只写入本次修改的字段。保存前会再次读取原行，发现冲突时停止写入。</div>`;
}
function bindDetail() {
  document.querySelectorAll('[data-group]').forEach(el=>el.onclick=()=>{if(edit)collectDraft();group=el.dataset.group;document.querySelector('#detail').innerHTML=renderDetail();bindDetail()});
  const editButton=document.querySelector('#edit'); if(editButton)editButton.onclick=()=>{edit=true;draft=[...selected().values];snapshot=[...selected().values];document.querySelector('#detail').innerHTML=renderDetail();bindDetail()};
  const cancelButton=document.querySelector('#cancel'); if(cancelButton)cancelButton.onclick=()=>{edit=false;document.querySelector('#detail').innerHTML=renderDetail();bindDetail()};
  const saveButton=document.querySelector('#save'); if(saveButton)saveButton.onclick=save;
}
function collectDraft(){document.querySelectorAll('[data-field]').forEach(input=>{draft[Number(input.dataset.field)]=input.value})}
async function save() {
  if(busy)return;collectDraft();
  const row=selected();if(!row)return;
  const changed=draft.map((value,index)=>value!==snapshot[index]?index:-1).filter(index=>index>=0);
  if(!changed.length){edit=false;renderLive();say('没有需要保存的修改。');return}
  if(!draft[1].trim()){say('公司名称不能为空。','error');return}
  if(changed.includes(0)){say('客户编号不能修改。','error');return}
  busy=true;say('正在核对表格并保存…');
  try {
    const latest=await request(`/values/${range(`A${row.sheetRow}:AW${row.sheetRow}`)}?valueRenderOption=FORMATTED_VALUE`);
    const current=Array.from({length:49},(_,i)=>String(latest.values?.[0]?.[i]??''));
    if(current[0]!==snapshot[0]||changed.some(i=>current[i]!==snapshot[i]))throw new Error('表格中的这条客户已发生变化。请刷新后核对，再重新编辑。');
    const data=changed.map(index=>({range:`'${TAB}'!${column(index)}${row.sheetRow}`,values:[[draft[index]]]}));
    await request('/values:batchUpdate',{method:'POST',body:JSON.stringify({valueInputOption:'RAW',data})});
    await reload();say(`已保存 ${changed.length} 个字段到 Google 表格。`,'success');
  } catch(error){say(error.message,'error')}
  finally{busy=false}
}
async function createCustomer(){
  const company=prompt('新客户公司名称：');if(company===null)return;
  if(!company.trim()){say('公司名称不能为空。','error');return}
  if(!activeToken()){renderSetup();return}
  const id=`CRM-${crypto.randomUUID().slice(0,8).toUpperCase()}`;
  const values=Array(49).fill('');values[0]=id;values[1]=company.trim();values[22]='未联系';
  busy=true;say('正在新建客户…');
  try{
    await request(`/values/${range('A:AW')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,{method:'POST',body:JSON.stringify({values:[values]})});
    selectedId=id;await reload();say('新客户已写入 Google 表格。','success');
  }catch(error){say(error.message,'error')}finally{busy=false}
}
renderSetup();
loadGoogleLogin();
