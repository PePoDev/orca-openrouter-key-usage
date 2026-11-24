const api = 'https://openrouter.ai/api/v1/';
const numeric = value => Number.isFinite(value) ? value : null;
const flag = value => typeof value === 'boolean' ? value : null;
const clean = value => typeof value === 'string' && value.length <= 160 && !value.includes('sk-or-') ? value : null;
const date = value => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

export class UsageError extends Error {}

// Only these two functions construct a URL. The credential is never placed in a query string.
async function read(url, token, fetcher) {
  let response;
  try {
    response = await fetcher(url, {
      method: 'GET', redirect: 'error', cache: 'no-store',
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000)
    });
  } catch {
    throw new UsageError('Could not reach OpenRouter. Check the connection and try again.');
  }
  if (!response.ok) {
    await response.body?.cancel();
    const messages = {
      401: 'OpenRouter rejected your key. Check or replace it.',
      403: 'OpenRouter denied access for this key.',
      404: 'OpenRouter could not find that resource for this key.',
      429: 'OpenRouter is rate limiting requests. Try again later.'
    };
    throw new UsageError(messages[response.status] ?? 'OpenRouter returned HTTP ' + response.status + '.');
  }
  const data = (await response.json().catch(() => null))?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new UsageError('OpenRouter returned an unreadable response.');
  return data;
}

function budget(b) {
  if (!b || typeof b !== 'object') return null;
  return {
    scope: clean(b.scope), interval: b.reset_interval === null ? 'lifetime' : clean(b.reset_interval),
    cap: numeric(b.limit_usd), left: numeric(b.remaining_usd), spent: numeric(b.spend_usd),
    resetAt: date(b.resets_at), byok: flag(b.include_byok)
  };
}

export async function keyUsage(token, fetcher = fetch) {
  const d = await read(api + 'key', token, fetcher);
  if (d.is_management_key === true || d.is_provisioning_key === true) throw new UsageError('Enter a regular inference API key.');
  if (!Number.isFinite(d.usage)) throw new UsageError('OpenRouter did not return key usage.');
  const periods = ['_daily', '_weekly', '_monthly', ''].map(suffix => ({
    spend: numeric(d['usage' + suffix]), byok: numeric(d['byok_usage' + suffix])
  }));
  const budgets = Array.isArray(d.budgets) ? d.budgets.map(budget).filter(Boolean) : [];
  const effective = budget(d.effective_budget);
  if (effective && !budgets.some(b => b.scope === effective.scope && b.cap === effective.cap && b.left === effective.left && b.interval === effective.interval)) budgets.push(effective);
  if (Number.isFinite(d.limit) && !budgets.some(b => b.scope === 'key_limit')) {
    budgets.push({scope: 'key_limit', cap: d.limit, left: numeric(d.limit_remaining),
      spent: Number.isFinite(d.limit_remaining) ? d.limit - d.limit_remaining : null,
      interval: d.limit_reset === null ? 'lifetime' : clean(d.limit_reset),
      resetAt: null, byok: flag(d.include_byok_in_limit)});
  }
  const available = budgets.filter(b => Number.isFinite(b.left)).sort((a,b) => a.left - b.left);
  const free = d.free_model_daily_requests;
  return {
    periods, budgets, effective: effective ?? available[0] ?? null,
    freeRequests: free ? {used: numeric(free.used), left: numeric(free.remaining), cap: numeric(free.limit)} : null,
    freeTier: flag(d.is_free_tier), keyLimit: numeric(d.limit), keyUncapped: d.limit === null,
    keyReset: d.limit_reset === null ? 'lifetime' : clean(d.limit_reset), keyLeft: numeric(d.limit_remaining),
    expires: date(d.expires_at), noExpiry: d.expires_at === null,
    regions: Array.isArray(d.allowed_data_regions) ? d.allowed_data_regions.map(clean).filter(Boolean) : null,
    byokInLimit: flag(d.include_byok_in_limit)
  };
}

export async function generationUsage(token, id, fetcher = fetch) {
  if (typeof id !== 'string' || !/^gen-[a-zA-Z0-9_-]{1,160}$/.test(id)) throw new UsageError('Enter the gen- ID returned by OpenRouter.');
  const url = new URL('generation', api);
  url.searchParams.set('id', id);
  const d = await read(url, token, fetcher);
  if (d.id !== id || !clean(d.model)) throw new UsageError('OpenRouter did not return a matching generation.');
  return {
    id, model: clean(d.model), provider: clean(d.provider_name), at: date(d.created_at),
    cost: numeric(d.total_cost), upstreamCost: numeric(d.upstream_inference_cost),
    input: numeric(d.native_tokens_prompt) ?? numeric(d.tokens_prompt),
    output: numeric(d.native_tokens_completion) ?? numeric(d.tokens_completion),
    cached: numeric(d.native_tokens_cached), reasoning: numeric(d.native_tokens_reasoning),
    latency: numeric(d.latency), duration: numeric(d.generation_time), byok: flag(d.is_byok),
    finish: clean(d.finish_reason), streamed: flag(d.streamed)
  };
}
