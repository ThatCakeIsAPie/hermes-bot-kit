// The profile panel's Model row with the bot's reasoning effort: `model · Effort`
// when config.get could say, exactly the old row when not. The real modules
// bundled with the fake SDK (dev/bundle.mjs); needs the dev dependencies.

import assert from 'node:assert/strict'
import { existsSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

const ready = existsSync(new URL('../node_modules/esbuild', import.meta.url)) && existsSync(new URL('../node_modules/react-dom', import.meta.url))
const skip = !ready && 'dev dependencies not installed'

const flush = () => new Promise(resolve => setImmediate(resolve))
const settle = async (n = 10) => {
  for (let i = 0; i < n; i += 1) await flush()
}

const remote = name => ({
  name,
  remoteSource: true,
  sourceScoped: true,
  connectionId: 'mini',
  connectionKind: 'ssh',
  route: { connectionId: 'mini', mode: 'remote', profile: name, targetProfile: name },
  canonical_session: { id: `${name}-root` }
})

let shared = null
async function load() {
  if (!shared) {
    const { bundlePreview } = await import('../dev/bundle.mjs')
    const file = await bundlePreview()
    const mod = await import(pathToFileURL(file).href)
    mod.appApi.start({ storage: { get: (k, f) => (k === 'enabled' ? false : f), set: () => undefined }, onEvent: () => () => undefined, setTimeout: () => () => undefined })
    shared = { ...mod, host: mod.fakeSdk.host }
    process.on('exit', () => rmSync(dirname(file), { recursive: true, force: true }))
  }
  const calls = []
  const handlers = {}
  const answer = async (method, params, route) => {
    calls.push({ method, params, route })
    const h = handlers[method]
    return h ? h(params, route) : {}
  }
  shared.host.request = (method, params) => answer(method, params, null)
  shared.host.requestProfile = (route, method, params) => answer(method, params, route)
  shared.rosterStoresApi.roster2.models.set({})
  return { ...shared, calls, handlers }
}

const row = html => html.match(/<button type="button" class="panel-row panel-row--setting gbo-model-row"([^>]*)>([\s\S]*?)<\/button>/)

test('Model row: the effort follows the model name when config.get answers; the tooltip includes it', { skip }, async () => {
  const { rosterApi, rosterStoresApi, renderElement, ProfilePanel, calls, handlers } = await load()
  const bot = remote('scout')
  handlers['profiles.describe'] = () => ({ model: { provider: 'example', default: 'demo-small' } })
  handlers['config.get'] = () => ({ value: 'high', display: 'show' })
  await rosterApi.loadBotModel(bot)
  await settle()
  const reads = calls.filter(c => c.method === 'config.get')
  assert.equal(reads.length, 1, 'read once')
  assert.deepEqual(reads[0].params, { key: 'reasoning' }, 'the profile default: no session_id')
  assert.equal(reads[0].route?.connectionId, 'mini', 'on the bot\'s own route')
  assert.equal(rosterStoresApi.roster2.models.get()['mini::scout'].effort, 'high')
  const html = row(renderElement(ProfilePanel, { bot }))
  assert.match(html[2], /<span class="gbo-model-name">demo-small · High<\/span>/)
  assert.match(html[1], /title="Model: example · demo-small · Effort: High"/)
  assert.match(html[1], /aria-label="Model: demo-small · High\. Change the model"/)
})

test('Model row: with no effort known the row is exactly as before', { skip }, async () => {
  const { rosterApi, rosterStoresApi, renderElement, ProfilePanel, handlers } = await load()
  handlers['profiles.describe'] = () => ({ model: { provider: 'example', default: 'demo-small' } })
  for (const [name, answer] of [
    ['older', () => { throw new Error('unknown method config.get') }],
    ['empty', () => ({})],
    ['odd', () => ({ value: 'warp-speed' })]
  ]) {
    handlers['config.get'] = answer
    const bot = remote(name)
    await rosterApi.loadBotModel(bot)
    await settle()
    assert.deepEqual({ ...rosterStoresApi.roster2.models.get()[`mini::${name}`] }, { loading: false, loaded: true, provider: 'example', model: 'demo-small', error: null }, `${name}: no effort in the store`)
    const html = row(renderElement(ProfilePanel, { bot }))
    assert.match(html[2], /<span class="gbo-model-name">demo-small<\/span>/, name)
    assert.match(html[1], /title="Model: example · demo-small"/, name)
    assert.match(html[1], /aria-label="Model: demo-small\. Change the model"/, name)
  }
})

test('Model row: a bot on the profile default model still reads Default · effort', { skip }, async () => {
  const { rosterApi, renderElement, ProfilePanel, handlers } = await load()
  handlers['profiles.describe'] = () => ({ model: {} })
  handlers['config.get'] = () => ({ value: 'medium', display: 'hide' })
  const bot = remote('plain')
  await rosterApi.loadBotModel(bot)
  await settle()
  const html = row(renderElement(ProfilePanel, { bot }))
  assert.match(html[2], /<span class="gbo-model-name">Default · Medium<\/span>/)
  assert.match(html[1], /title="Model: the profile’s default · Effort: Medium"/)
})

test('saveBotEffort: config.set {key, value, scope:"global"} on the bot\'s route; the row follows; the live chat\'s runtime id rides along', { skip }, async () => {
  const { rosterApi, rosterStoresApi, appApi, calls, handlers } = await load()
  const bot = remote('scout')
  rosterApi.primeBotModel(bot, { provider: 'example', model: 'demo-small' })
  handlers['config.set'] = params => ({ value: params.value })
  appApi.app.chat.set(null)
  await rosterApi.saveBotEffort(bot, 'xhigh')
  const writes = calls.filter(c => c.method === 'config.set')
  assert.deepEqual(writes.map(c => c.params), [{ key: 'reasoning', value: 'xhigh', scope: 'global' }])
  assert.equal(writes[0].route?.connectionId, 'mini')
  assert.equal(rosterStoresApi.roster2.models.get()['mini::scout'].effort, 'xhigh')
  // A chat of another bot is not this bot's session.
  appApi.app.chat.set({ bot: remote('other'), runtimeId: 'rt-other' })
  await rosterApi.saveBotEffort(bot, 'low')
  assert.ok(!('session_id' in calls.filter(c => c.method === 'config.set')[1].params))
  // This bot's chat, attached.
  appApi.app.chat.set({ bot, runtimeId: 'rt-scout' })
  await rosterApi.saveBotEffort(bot, 'max')
  assert.deepEqual(calls.filter(c => c.method === 'config.set')[2].params, { key: 'reasoning', value: 'max', scope: 'global', session_id: 'rt-scout' })
  // Its chat without a live runtime (detached / reconnecting): none.
  appApi.app.chat.set({ bot, runtimeId: '' })
  await rosterApi.saveBotEffort(bot, 'high')
  assert.ok(!('session_id' in calls.filter(c => c.method === 'config.set')[3].params))
  appApi.app.chat.set(null)
})

test('saveAdvanced: the effort goes after a model that landed, never after one that did not', { skip }, async () => {
  const { rosterApi, calls, handlers } = await load()
  const bot = remote('scout')
  rosterApi.primeBotModel(bot, { provider: 'example', model: 'demo-small' })
  handlers['config.set'] = params => ({ value: params.value })
  const state = { loaded: true, provider: 'example', model: 'demo-large', skills: [], toolsets: [], mcp: [], soul: '', dirtyModel: true, dirtyEffort: true, effort: 'low' }
  handlers['profiles.configure'] = () => ({ applied: { model: true } })
  const ok = await rosterApi.saveAdvanced(bot, state)
  assert.deepEqual(calls.map(c => c.method).filter(m => m === 'profiles.configure' || m === 'config.set'), ['profiles.configure', 'config.set'])
  assert.deepEqual({ ok: ok.ok, applied: ok.applied }, { ok: true, applied: { model: true, effort: true } })
  calls.length = 0
  handlers['profiles.configure'] = () => ({ applied: { model: false } })
  const bad = await rosterApi.saveAdvanced(bot, state)
  assert.equal(calls.filter(c => c.method === 'config.set').length, 0, 'no effort write after a failed model')
  assert.equal(bad.ok, false)
  assert.equal(bad.applied.effort, false)
  // Only the effort dirty: no model write at all.
  calls.length = 0
  handlers['config.set'] = () => {
    throw new Error('invalid value (4002)')
  }
  const down = await rosterApi.saveAdvanced(bot, { ...state, dirtyModel: false })
  assert.deepEqual(calls.map(c => c.method).filter(m => m === 'profiles.configure' || m === 'cli.exec'), [])
  assert.equal(down.ok, false)
  assert.match(down.effortError, /invalid value \(4002\)/)
})
