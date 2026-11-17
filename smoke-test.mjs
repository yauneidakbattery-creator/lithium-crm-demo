import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = 'https://yauneidakbattery-creator.github.io/lithium-crm-demo/';
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = await mkdtemp(join(tmpdir(), 'lithium-crm-smoke-'));
const process = spawn(chrome, [
  '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--disable-extensions', '--remote-debugging-port=0',
  `--user-data-dir=${profile}`, '--window-size=1440,900', url,
], { stdio: 'ignore' });

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
try {
  let port;
  for (let i = 0; i < 80; i++) {
    try {
      port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
      break;
    } catch { await pause(250); }
  }
  if (!port) throw new Error('Chrome DevTools did not start');
  let tab;
  for (let i = 0; i < 40; i++) {
    tab = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())
      .find(page => page.type === 'page' && page.url.startsWith(url));
    if (tab) break;
    await pause(250);
  }
  if (!tab) throw new Error('Demo tab did not open');
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const callId = ++id;
    pending.set(callId, { resolve, reject });
    socket.send(JSON.stringify({ id: callId, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const check = async (name, expression) => {
    const passed = await evaluate(expression);
    console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
    if (!passed) throw new Error(name);
  };
  for (let i = 0; i < 80; i++) {
    if (await evaluate(`document.readyState === 'complete' && !!document.querySelector('#view')`)) break;
    await pause(250);
  }
  console.log('Loaded URL:', await evaluate('location.href'));
  console.log('Page title:', await evaluate('document.title'));
  await check('公开页面加载', `document.title.includes('锂电池CRM') && !!document.querySelector('#view')`);
  await check('客户列表显示四家公司', `document.querySelectorAll('[data-client]').length === 4`);
  await evaluate(`document.querySelector('[data-page="users"]').click()`);
  await check('用户与权限页面', `document.querySelector('#view h1')?.textContent === '用户与权限'`);
  await evaluate(`document.querySelector('#account').click();document.querySelector('#account-menu [data-page="settings"]').click()`);
  await check('个人设置页面', `document.querySelector('#view h1')?.textContent === '个人设置'`);
  await evaluate(`document.querySelector('[data-page="customers"]').click()`);
  await evaluate(`document.querySelector('#search').value='West Marine';document.querySelector('#search').dispatchEvent(new Event('input',{bubbles:true}))`);
  await check('客户搜索筛选', `document.querySelectorAll('[data-client]').length === 1 && document.querySelector('#view').textContent.includes('West Marine')`);
  await evaluate(`document.querySelector('[data-client]').click()`);
  await check('客户侧栏打开', `document.querySelector('.drawer h2')?.textContent === 'West Marine'`);
  await evaluate(`document.querySelector('.drawer [data-page="detail"]').click()`);
  await check('客户详情打开', `document.querySelector('#view').textContent.includes('West Marine') && !!document.querySelector('.detail-top')`);
  await evaluate(`document.querySelector('[data-page="customers"]').click()`);
  await check('返回客户列表', `document.querySelector('#view h1')?.textContent === '客户管理'`);
  await send('Page.navigate', { url: 'https://yauneidakbattery-creator.github.io/lithium-crm-demo/live.html' });
  for (let i = 0; i < 80; i++) {
    try { if (await evaluate(`!!document.querySelector('#connect')`)) break; } catch {}
    await pause(250);
  }
  await check('同步页先显示 Google 连接入口', `!!document.querySelector('#connect') && !document.body.textContent.includes('真实客户数据')`);
  await check('OAuth 客户端 ID 已配置', `document.querySelector('#client-id')?.value === '745042573393-a70a7planugqks4jetbncotp076190rf.apps.googleusercontent.com'`);
  for (let i = 0; i < 20; i++) {
    if (await evaluate(`!!window.google?.accounts?.oauth2 && !document.querySelector('#connect').disabled`)) break;
    await pause(250);
  }
  await check('Chrome 中 Google 登录组件已就绪', `!!window.google?.accounts?.oauth2 && !document.querySelector('#connect').disabled`);
  await evaluate(`(() => {
    const header = Array.from({length:49}, (_,i)=>'字段'+i);
    header[0]='客户编号';header[1]='公司名称';header[22]='开发阶段';header[33]='负责人';header[48]='背调结论/开发建议';
    const row = Array(49).fill('');row[0]='US-MAR-001';row[1]='West Marine';row[22]='未联系';row[33]='待分配';
    window.__writes=[];
    window.google={accounts:{oauth2:{initTokenClient:({callback})=>({requestAccessToken:()=>callback({access_token:'test-only',expires_in:3600})})}}};
    window.fetch=async (url,options={})=>{
      let data={};
      if(String(url).includes('A1%3AAW1000')) data={values:[header,row]};
      else if(String(url).includes('A2%3AAW2')) data={values:[row]};
      else if(String(url).includes('values:batchUpdate')) {
        const body=JSON.parse(options.body);window.__writes.push(body);
        for(const item of body.data) if(item.range.endsWith('B2'))row[1]=item.values[0][0];
        data={totalUpdatedCells:body.data.length};
      }
      return {ok:true,status:200,json:async()=>data};
    };
    document.querySelector('#connect').click();
  })()`);
  for (let i = 0; i < 40; i++) {
    if (await evaluate(`!!document.querySelector('#edit')`)) break;
    await pause(250);
  }
  await check('模拟授权后读取表格', `document.querySelectorAll('[data-id]').length === 1 && document.body.textContent.includes('West Marine')`);
  await evaluate(`document.querySelector('#edit').click();document.querySelector('[data-field="1"]').value='West Marine Updated';document.querySelector('#save').click()`);
  for (let i = 0; i < 40; i++) {
    if (await evaluate(`window.__writes.length > 0`)) break;
    await pause(250);
  }
  await check('模拟保存只写回改动单元格', `window.__writes.length === 1 && window.__writes[0].data.length === 1 && window.__writes[0].data[0].range.endsWith('B2') && window.__writes[0].data[0].values[0][0] === 'West Marine Updated'`);
  await send('Browser.close');
} finally {
  socket?.close();
  process.kill();
  await pause(500);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
