# OpenRouter Key Usage

A desktop Orca sidebar and status-bar meter for one regular OpenRouter API key. Enter the key in the panel's **Connect key** form. It is kept in Orca's encrypted secret store. The worker sends it only to OpenRouter over HTTPS and rejects redirects.

## Dashboard

- **Overview** shows OpenRouter credit spend and external BYOK spend for today, this week (Monday–Sunday), this month and all time. Periods use UTC. The budget section shows applicable key, member or workspace limits reported for your key, remaining amounts, reset times, expiry and free-model request allowances. A shared budget can include spending by others.
- **History** shows the latest observed daily counters for each of the past 90 UTC days and exports the selected period as CSV. The plugin samples every minute while running. A day can be partial or absent, and the ledger begins with the first successful check.
- **Requests** accepts a generation ID returned by OpenRouter. It keeps the latest 100 distinct lookups and shows their models, providers, costs, tokens and timing. The model summary covers those lookups. A regular key provides no account-wide activity feed.
- **Key** verifies replacement credentials before switching. Disconnect clears the plugin's local credential and report data.

The plugin calls [current key](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key) and [generation metadata](https://openrouter.ai/docs/api/api-reference/generations/get-generation). It never submits inference requests. API response fields can vary. Missing figures display as a dash.

## Install from a checkout

In Orca 1.4.271 or later, run `orca plugin install .` from the checkout and review its approval. The worker asks for its own secrets and storage. Open **OpenRouter Key Usage** in the sidebar. Click the status bar meter to refresh.

Run `node --test` for the offline fixture tests and `orca plugin check .` to validate the plugin. No package install or build is needed.
