import { randomUUID } from 'node:crypto';
import { generationUsage, keyUsage, UsageError } from './api.mjs';

const credentialSlot = 'openrouter';
const cacheSlot = 'usage-v1';
const blank = () => ({ updated: null, usage: null, days: [], requests: [] });
const utcDay = time => new Date(time).toISOString().slice(0,10);
const publicError = err => err instanceof UsageError ? err.message : 'Orca could not access plugin data. Check the OS keyring and try again.';
const usd = value => value.toLocaleString('en-US', {style:'currency', currency:'USD', maximumFractionDigits: 4});

export function recordDay(days, periods, time) {
  const today = utcDay(time);
  const cutoff = utcDay(time - 89 * 86400000);
  const row = { day: today, at: time, spend: periods[0].spend, byok: periods[0].byok };
  return [...days.filter(d => d.day !== today && d.day >= cutoff && d.day < today), row];
}

export async function start(orca, { fetcher = fetch, now = Date.now } = {}) {
  let secret = null, snapshot = blank(), warning = '', ready = false, stopped = false;
  let queue = Promise.resolve();
  function serial(job) {
    const next = queue.then(job);
    queue = next.catch(() => {});
    return next;
  }
  function view() {
    return { configured: !!secret, warning, ...snapshot };
  }
  async function load() {
    if (ready) return;
    const raw = await orca.secrets.get(credentialSlot);
    secret = raw ? JSON.parse(raw) : null;
    if (secret && (!secret.token || !secret.id)) throw new Error('Invalid store');
    const cache = await orca.storage.get(cacheSlot);
    snapshot = secret && cache?.id === secret.id ? cache.snapshot : blank();
    ready = true;
  }
  async function store(next) {
    await orca.storage.set(cacheSlot, { id: secret.id, snapshot: next });
    snapshot = next;
  }
  async function notify() {
    if (stopped) return;
    const usage = snapshot.usage;
    let text = 'OpenRouter', tone = warning ? 'warning' : 'neutral';
    const limit = usage?.effective;
    if (usage && !warning) {
      if (Number.isFinite(limit?.left)) {
        text = usd(Math.max(0,limit.left)) + ' left';
        if (limit.left <= 0) tone = 'danger';
        else if (limit.cap > 0 && limit.left / limit.cap <= 0.1) tone = 'warning';
      } else if (Number.isFinite(usage.periods[0].spend)) text = usd(usage.periods[0].spend) + ' today';
    }
    orca.panels.post('usage.changed', {});
    await orca.host.call('statusBar.update', { id: 'spend', text, visible: !!secret || !!warning, tone,
      tooltip: warning || (limit?.scope ? limit.scope.replaceAll('_',' ') + ' · ' + (limit.interval || 'unspecified') + '. ' : '') + 'Click to refresh key usage.' });
  }
  async function update(usage) {
    const time = now();
    await store({ ...snapshot, updated: time, usage, days: recordDay(snapshot.days, usage.periods, time) });
    warning = '';
  }
  async function refresh() {
    try {
      await load();
      if (secret) await update(await keyUsage(secret.token, fetcher));
    } catch (err) { warning = publicError(err); }
    await notify();
    return view();
  }
  const actions = {
    async state() { await load(); return view(); },
    refresh,
    async connect(input) {
      const token = typeof input?.token === 'string' ? input.token.trim() : '';
      if (!/^sk-or-[\w-]{10,300}$/.test(token)) throw new UsageError('Enter a regular OpenRouter API key beginning with sk-or-.');
      await load();
      const live = await keyUsage(token, fetcher);
      if (secret?.token !== token) {
        const next = { id: randomUUID(), token };
        await orca.secrets.set(credentialSlot, JSON.stringify(next));
        secret = next;
        snapshot = blank();
      }
      await update(live);
      await notify();
      return view();
    },
    async disconnect() {
      await load();
      await orca.storage.delete(cacheSlot);
      snapshot = blank();
      await orca.secrets.delete(credentialSlot);
      secret = null;
      warning = '';
      await notify();
      return view();
    },
    async track(input) {
      await load();
      if (!secret) throw new UsageError('Connect an API key first.');
      const data = await generationUsage(secret.token, input?.id, fetcher);
      await store({ ...snapshot, requests: [data, ...snapshot.requests.filter(r => r.id !== data.id)].slice(0,100) });
      await notify();
      return view();
    }
  };
  for (const [name, action] of Object.entries(actions)) {
    orca.panels.handle(name, (input, context) => {
      if (context?.panel?.surface !== 'panel' || context.panel.contributionId !== 'dashboard') throw new Error('Unknown panel');
      return serial(async () => {
        try { return { data: await action(input) }; }
        catch (err) { return { error: publicError(err) }; }
      });
    });
  }
  let refreshing;
  function schedule() {
    refreshing ??= serial(refresh).finally(() => { refreshing = undefined; });
    return refreshing;
  }
  orca.commands.register('usage.refresh', async () => { await schedule(); });
  await schedule();
  const timer = setInterval(() => { schedule().catch(() => {}); }, 60000);
  timer.unref?.();
  return () => { stopped = true; clearInterval(timer); };
}

let stop;
export default async function activate(orca) { stop = await start(orca); }
export function deactivate() { stop?.(); }
