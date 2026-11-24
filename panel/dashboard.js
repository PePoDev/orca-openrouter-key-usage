'use strict';
const $ = id => document.getElementById(id);
let model, view = 'overview', busy = false;
const tabs = [...document.querySelectorAll('button[data-view]')];
const missing = '—';
const usd = value => Number.isFinite(value) ? value.toLocaleString('en-US',{style:'currency', currency:'USD', maximumFractionDigits: value !== 0 && Math.abs(value) < 0.01 ? 6 : 2}) : missing;
const count = value => Number.isFinite(value) ? value.toLocaleString() : missing;
const bool = value => value == null ? missing : value ? 'Yes' : 'No';
const instant = value => value == null ? missing : new Date(value).toLocaleString();
const title = value => value ? value.replaceAll('_',' ').replace(/^./, c => c.toUpperCase()) : missing;
const ms = value => value == null ? missing : count(value) + ' ms';
function el(tag, text) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  return node;
}
function details(pairs) {
  const list = el('dl');
  for (const [key,value] of pairs) list.append(el('dt',key), el('dd',value ?? missing));
  return list;
}
function table(headers, rows) {
  const t = el('table'), head = t.createTHead().insertRow(), body = t.createTBody();
  for (const value of headers) { const th = el('th',value); th.scope = 'col'; head.append(th); }
  for (const row of rows) {
    const tr = body.insertRow();
    for (const value of row) tr.append(el('td',value));
  }
  return t;
}
function overview(u) {
  const b = u.effective;
  const capped = Number.isFinite(b?.left);
  $('leadLabel').textContent = capped ? 'Available budget' : 'Spent today';
  $('leadValue').textContent = usd(capped ? Math.max(0,b.left) : u.periods[0].spend);
  $('leadInfo').textContent = capped ? [title(b.scope),title(b.interval),usd(b.cap)+' limit'].join(' · ') : 'OpenRouter credits · UTC';
  const periods = ['Today','This week','This month','All time'];
  $('periods').replaceChildren(table(['UTC period','Credits','External BYOK'],u.periods.map((p,i) => [periods[i],usd(p.spend),usd(p.byok)])));
  const cards = u.budgets.map(budget => {
    const card = el('article'), top = el('div'); top.className = 'metric';
    top.append(el('b',title(budget.scope)),el('span',title(budget.interval)));
    card.append(top);
    if (budget.cap > 0 && Number.isFinite(budget.spent)) {
      const meter = el('progress'); meter.max = budget.cap; meter.value = Math.min(budget.cap,Math.max(0,budget.spent));
      meter.setAttribute('aria-label', 'Budget used for '+title(budget.scope)); card.append(meter);
    }
    card.append(details([['Spent / limit',usd(budget.spent)+' / '+usd(budget.cap)],['Remaining',usd(budget.left)],
      ['Next reset',budget.interval==='lifetime' ? 'Never' : instant(budget.resetAt)],['Counts external BYOK',bool(budget.byok)]]));
    return card;
  });
  $('budgets').replaceChildren(...(cards.length ? cards : [el('p','OpenRouter reported no budget layers.')]));
  const pairs = [
    ['Key limit',u.keyUncapped ? 'Uncapped' : usd(u.keyLimit)], ['Key limit remaining',usd(u.keyLeft)],
    ['Key limit period',u.keyUncapped ? missing : title(u.keyReset)], ['Counts external BYOK',bool(u.byokInLimit)],
    ['Expiry',u.noExpiry ? 'No expiry' : instant(u.expires)], ['Free tier',bool(u.freeTier)],
    ['Allowed regions',u.regions?.length ? u.regions.join(', ') : missing]
  ];
  if (u.freeRequests) pairs.push(['Free model requests today',count(u.freeRequests.used)+' / '+count(u.freeRequests.cap)],['Free requests left',count(u.freeRequests.left)]);
  $('keyInfo').replaceChildren(details(pairs));
}
function visibleDays() {
  const cutoff = new Date(Date.now() - (Number($('range').value)-1)*86400000).toISOString().slice(0,10);
  return model.days.filter(d => d.day >= cutoff).toReversed();
}
function historyView() {
  const days = visibleDays();
  const byDay = new Map(days.map(d => [d.day,d.spend]));
  const span = Number($('range').value);
  const peak = Math.max(0,...days.map(d => d.spend ?? 0));
  const bars = Array.from({length:span}, (_,i) => {
    const day = new Date(Date.now() - (span-i-1)*86400000).toISOString().slice(0,10);
    const spend = byDay.get(day), bar = el('span');
    bar.title = day+' · '+usd(spend);
    bar.style.height = spend == null ? '0' : Math.max(2,peak ? 100*spend/peak : 0)+'%';
    return bar;
  });
  $('trend').replaceChildren(...bars);
  $('ledger').replaceChildren(days.length ? table(['UTC day','Credits','External BYOK'], days.map(d => [d.day,usd(d.spend),usd(d.byok)])) : el('p','No observations in this period.'));
  $('export').disabled = !days.length;
}
function requestView() {
  const list = $('requestList');
  if (!model.requests.length) { list.replaceChildren(el('p','No requests looked up yet.')); return; }
  const groups = new Map();
  for (const r of model.requests) {
    const g = groups.get(r.model) ?? { n:0, cost:0, known:0 };
    g.n++;
    if (r.cost != null) { g.cost += r.cost; g.known++; }
    groups.set(r.model,g);
  }
  const summary = table(['Model','Lookups','Known cost'],[...groups].map(([name,g]) => [name,count(g.n),g.known ? usd(g.cost) : missing]));
  const cards = model.requests.map(r => {
    const card = el('details'), heading = el('summary',r.model+' · '+usd(r.cost));
    card.dataset.id = r.id;
    card.append(heading,details([['Generation',r.id],['Time',instant(r.at)],['Provider',r.provider],['Input tokens',count(r.input)],
      ['Output tokens',count(r.output)],['Cached tokens',count(r.cached)],['Reasoning tokens',count(r.reasoning)],['Total cost',usd(r.cost)],
      ['Upstream inference cost',usd(r.upstreamCost)],['Latency',ms(r.latency)],['Generation time',ms(r.duration)],['BYOK',bool(r.byok)],
      ['Streamed',bool(r.streamed)],['Finish reason',r.finish]]));
    return card;
  });
  const expanded = new Set([...list.querySelectorAll('details[open]')].map(d => d.dataset.id));
  for (const card of cards) card.open = expanded.has(card.dataset.id);
  list.replaceChildren(el('h2','Looked-up requests by model'),summary,...cards);
}
function render() {
  if (!model) return;
  const configured = model.configured;
  if (!configured) view = 'settings';
  document.querySelector('nav').hidden = !configured;
  $('refresh').hidden = !configured;
  $('stamp').textContent = model.updated ? 'Last checked '+instant(model.updated) : '';
  $('warning').textContent = model.warning; $('warning').hidden = !model.warning;
  for (const tab of tabs) {
    const active = tab.dataset.view === view;
    $(tab.dataset.view).hidden = !active;
    tab.setAttribute('aria-pressed',String(active));
  }
  $('connectTitle').textContent = configured ? 'Replace your API key' : 'Connect your API key';
  $('save').textContent = configured ? 'Replace key' : 'Connect key';
  $('keyHint').textContent = configured ? 'Replacing the key starts a new local history after verification.' : 'Orca stores your regular API key encrypted on this device and sends it only to OpenRouter.';
  $('remove').hidden = !configured;
  if (view === 'overview' && model.usage) overview(model.usage);
  if (view === 'history') historyView();
  if (view === 'requests') requestView();
}
async function request(name, input) {
  const reply = await window.orca.plugin.request(name,input);
  if (reply.error) throw new Error(reply.error);
  return reply.data;
}
async function readState() {
  try { model = await request('state'); render(); }
  catch { $('feedback').textContent = 'Could not load the panel. Reopen it in Orca.'; }
}
async function act(name, input, button, finish) {
  if (busy) return;
  busy = true; button.disabled = true;
  $('feedback').textContent = name === 'connect' ? 'Verifying your key…' : 'Updating…';
  try {
    model = await request(name,input);
    if (finish) finish();
    $('feedback').textContent = '';
    render();
  } catch (err) { $('feedback').textContent = err.message || 'Request failed. Try again.'; }
  finally { busy = false; button.disabled = false; }
}
for (const tab of tabs) tab.onclick = () => { view = tab.dataset.view; $('feedback').textContent=''; render(); };
$('connect').onsubmit = event => {
  event.preventDefault();
  const token = $('token').value; $('token').value = '';
  void act('connect',{token},$('save'),() => { view = 'overview'; $('gen').value = ''; $('remove').open = false; });
};
$('lookup').onsubmit = event => {
  event.preventDefault();
  const id = $('gen').value.trim();
  void act('track',{ id },event.currentTarget.querySelector('button'),() => { $('gen').value=''; });
};
$('forget').onclick = () => act('disconnect',{},$('forget'),() => {
  $('token').value = ''; $('gen').value = ''; $('remove').open = false;
  for (const id of ['leadValue','leadInfo','periods','budgets','keyInfo','ledger','requestList']) $(id).replaceChildren();
});
$('refresh').onclick = () => act('refresh',{},$('refresh'));
$('range').onchange = historyView;
$('export').onclick = async () => {
  const columns = ['day_utc','observed_at_utc','openrouter_usd','external_byok_usd'];
  const rows = visibleDays().map(d => [d.day,new Date(d.at).toISOString(),d.spend,d.byok].join(','));
  try {
    await window.orca.files.saveAs({ suggestedName:'openrouter-key-history.csv', mimeType:'text/csv',
      data: [columns.join(','),...rows].join('\r\n') });
  } catch { $('feedback').textContent = 'Could not save the CSV. Please try again.'; }
};
window.orca.on('usage.changed', () => { if (!busy) void readState(); });
$('feedback').textContent = '';
void readState();
