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
  await send('Browser.close');
} finally {
  socket?.close();
  process.kill();
  await pause(500);
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
