// Record the README demo: drives a real Liftoff instance in headless Chrome and
// saves captioned frames, which scripts/demo/make_gif.py turns into docs/images/demo.gif.
//
// Prerequisites: backend running with an AI provider configured, frontend served
// (npm run build && npx vite preview --port 4173), Chrome installed.
//
//   node scripts/demo/record.mjs [baseUrl] [outDir]
//
// Talks to Chrome over --remote-debugging-pipe (fd 3/4): no ports, no dependencies.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2).filter((a) => a !== '--dry');
// --dry: exercise the browser automation up to the first AI call (no provider needed).
const DRY = process.argv.includes('--dry');
const BASE = args[0] || 'http://localhost:4173';
const OUT = args[1] || join(tmpdir(), 'liftoff-demo-frames');
const AZURE_PROJECT = 'Azure web app';
const WIDTH = 1280;
const HEIGHT = 800;
const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => p && existsSync(p));

const AZURE_PROMPT =
  'A Python web app on App Service with a private Azure SQL database, Key Vault for secrets, a Storage account and Application Insights, in East US.';
const AWS_PROMPT =
  'A serverless orders API: API Gateway HTTP API, a Lambda function, a DynamoDB table, an SQS queue for events and an S3 bucket for receipts, in us-east-1.';
const QUESTION = 'How do I make this architecture zone-redundant?';

// ---------------------------------------------------------------- CDP over a pipe
class Browser {
  constructor() {
    this.userDir = mkdtempSync(join(tmpdir(), 'liftoff-chrome-'));
    this.proc = spawn(CHROME, [
      '--headless=new', '--remote-debugging-pipe', '--no-first-run', '--no-default-browser-check',
      '--hide-scrollbars', `--window-size=${WIDTH},${HEIGHT}`, `--user-data-dir=${this.userDir}`, 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = [];
    let buffer = '';
    this.proc.stdio[4].on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let idx;
      while ((idx = buffer.indexOf('\0')) >= 0) {
        const msg = JSON.parse(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
        } else {
          this.listeners.forEach((fn) => fn(msg));
        }
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdio[3].write(payload + '\0');
    });
  }

  async open() {
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    this.session = sessionId;
    await this.cmd('Page.enable');
    await this.cmd('Runtime.enable');
    await this.cmd('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  }

  cmd(method, params = {}) {
    return this.send(method, params, this.session);
  }

  async goto(url, settleMs = 2500) {
    const loaded = new Promise((resolve) => {
      const fn = (msg) => {
        if (msg.method === 'Page.loadEventFired' && msg.sessionId === this.session) {
          this.listeners = this.listeners.filter((f) => f !== fn);
          resolve();
        }
      };
      this.listeners.push(fn);
    });
    await this.cmd('Page.navigate', { url });
    await loaded;
    await sleep(settleMs);
    await this.eval(HELPERS);
  }

  async eval(expression) {
    const res = await this.cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description || 'evaluate failed');
    return res.result.value;
  }

  async waitFor(expression, timeoutMs, label) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.eval(expression)) return;
      await sleep(1000);
    }
    throw new Error(`Timed out waiting for: ${label}`);
  }

  async shot(path) {
    const { data } = await this.cmd('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path, Buffer.from(data, 'base64'));
  }

  close() {
    this.proc.kill();
    try { rmSync(this.userDir, { recursive: true, force: true }); } catch { /* Chrome may still hold files */ }
  }
}

// In-page helpers: find by visible text, click, and set React-controlled input values.
const HELPERS = `
window.__lf = {
  visible(el) { return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length)); },
  byText(selector, text) {
    return [...document.querySelectorAll(selector)].find((e) => this.visible(e) && e.textContent.trim().includes(text));
  },
  click(selector, text) {
    const el = text ? this.byText(selector, text) : [...document.querySelectorAll(selector)].find((e) => this.visible(e));
    if (!el || el.disabled) return false;
    el.click();
    return true;
  },
  type(selector, value) {
    const el = [...document.querySelectorAll(selector)].find((e) => this.visible(e));
    if (!el) return false;
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.focus();
    return true;
  },
  count(selector) { return [...document.querySelectorAll(selector)].filter((e) => this.visible(e)).length; },
};
true;`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const js = (value) => JSON.stringify(value);

// ---------------------------------------------------------------- recording
const frames = [];
let frameNo = 0;

async function frame(browser, scene, caption, holdMs) {
  const file = `${String(++frameNo).padStart(3, '0')}.png`;
  await browser.shot(join(OUT, file));
  frames.push({ file, scene, caption, hold_ms: holdMs });
  console.log(`  frame ${file} [${scene}] ${caption}`);
}

async function promptToDiagram(browser, cloud, prompt, scene, label, project) {
  console.log(`Scene: ${label}`);
  await browser.goto(`${BASE}/workspace?prompt=1&cloud=${cloud}`);
  await browser.eval(`__lf.type('input[placeholder="Enter project name"]', ${js(project)})`);
  const words = prompt.split(' ');
  const steps = 4;
  for (let i = 1; i <= steps; i++) {
    const partial = words.slice(0, Math.ceil((words.length * i) / steps)).join(' ');
    await browser.eval(`__lf.type('textarea', ${js(partial)})`);
    await sleep(150);
    await frame(browser, scene, label, i === steps ? 1400 : 450);
  }
  if (!(await browser.eval(`__lf.click('button', 'Generate & Create Project')`))) throw new Error('Generate button not found');
  await sleep(1200);
  await frame(browser, scene, `${label} - generating`, 900);
  if (DRY) return;
  await browser.waitFor(`__lf.count('.react-flow__node-service') > 0`, 240000, `${cloud} diagram`);
  await sleep(2500); // let layout and icons settle
  await frame(browser, scene, `${label} - done`, 3200);
}

async function askAdvisor(browser) {
  const scene = 'advisor';
  const label = 'Ask about the diagram (answers grounded in Microsoft Learn via MCP)';
  console.log(`Scene: ${label}`);
  // Switch back to the Azure project generated earlier (tabs are persisted).
  if (!(await browser.eval(`__lf.click('button, div[role="tab"], span', ${js(AZURE_PROJECT)})`))) {
    throw new Error('Azure project tab not found');
  }
  await sleep(1500);
  if (!(await browser.eval(`__lf.click('button[title="Open Azure Architect Chat"]')`))) throw new Error('chat button not found');
  await sleep(1200);
  await browser.eval(`__lf.type('textarea[placeholder="Ask about Azure architecture..."]', ${js(QUESTION)})`);
  await frame(browser, scene, label, 1500);
  await browser.eval(`(() => { const t = [...document.querySelectorAll('textarea[placeholder="Ask about Azure architecture..."]')].find((e) => __lf.visible(e)); t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`);
  await sleep(1500);
  await frame(browser, scene, `${label} - thinking`, 900);
  await browser.waitFor(`document.body.innerText.includes('learn.microsoft.com')`, 240000, 'grounded answer with sources');
  await sleep(1500);
  await frame(browser, scene, `${label} - answer with sources`, 4200);
  await browser.eval(`__lf.click('button[title="Close"]')`);
}

async function generateIaC(browser) {
  const scene = 'iac';
  const label = 'Generate secure, modular IaC from the diagram';
  console.log(`Scene: ${label}`);
  if (!(await browser.eval(`__lf.click('button', 'Generate IaC')`))) throw new Error('Generate IaC not found');
  await sleep(1500);
  await frame(browser, scene, label, 1200);
  await browser.waitFor(`!!__lf.byText('button', 'Generate Bicep') && !__lf.byText('button', 'Generating')`, 240000, 'single-file generation');
  await browser.eval(`__lf.click('button', 'Generate Bicep')`);
  await sleep(1500);
  await frame(browser, scene, `${label} - generating modules`, 900);
  await browser.waitFor(`document.body.innerText.includes('main.bicep') && !__lf.byText('button', 'Generating')`, 300000, 'modular files');
  await sleep(1500);
  await frame(browser, scene, `${label} - files and guardrail report`, 3600);
  if (await browser.eval(`__lf.click('button', 'View full report') || __lf.click('button', 'report')`)) {
    await sleep(1500);
    await frame(browser, scene, 'Every template is checked against security guardrails', 3600);
  }
}

async function main() {
  if (!CHROME) throw new Error('Chrome/Edge not found; set CHROME_PATH');
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const browser = new Browser();
  try {
    await browser.open();
    await promptToDiagram(browser, 'azure', AZURE_PROMPT, 'azure', 'Describe an Azure architecture', AZURE_PROJECT);
    if (DRY) return;
    await promptToDiagram(browser, 'aws', AWS_PROMPT, 'aws', 'Describe an AWS architecture', 'AWS orders API');
    await askAdvisor(browser);
    await generateIaC(browser);
  } finally {
    writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({ width: WIDTH, height: HEIGHT, frames }, null, 2));
    browser.close();
  }
  console.log(`Saved ${frames.length} frames to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
