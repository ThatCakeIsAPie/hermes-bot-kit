// The reasoning Effort field in the model picker's dialogs: the per-bot Model
// dialog (the panel's Model row) and Skills, tools and model. The built
// plugin.js under the loader replica, a real DOM, driven with clicks and
// select changes; every gateway call is recorded. One plugin per file (one
// window), so the cases are subtests of one boot.

import assert from 'node:assert/strict'
import test from 'node:test'

import { LOCAL, READY, waitFor } from './loader-boot.mjs'
import { bootFull, buttonWithText, CONFIG, dialogEl, reactErrors, rowButton, SCOUT } from './loader-surfaces.mjs'

const LEVELS = [
  ['none', 'Off'],
  ['minimal', 'Minimal'],
  ['low', 'Low'],
  ['medium', 'Medium'],
  ['high', 'High'],
  ['xhigh', 'Extra high'],
  ['max', 'Max'],
  ['ultra', 'Ultra']
]

const settle = () => new Promise(resolve => setTimeout(resolve, 60))

/** Pick `value` in a <select> the way a user does (React listens to `change`). */
function choose(select, value) {
  select.value = value
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

test('Effort field: Model dialog and Skills, tools and model', { skip: !READY && 'dev dependencies not installed' }, async t => {
  // What the fake gateway answers; each case sets what it needs.
  const gw = { effort: 'high', hold: null, getFails: false, setFails: null, configure: { applied: { model: true } } }
  const primitives = true
  const { panes, workspaces, mount, errors, calls, internals } = await bootFull(t, {
    primitives,
    answers: {
      'profiles.describe': () => ({ model: { provider: 'nous', default: 'hermes-4' } }),
      'config.get': async () => {
        if (gw.hold) await gw.hold
        if (gw.getFails) throw new Error('unknown method config.get')
        return { value: gw.effort, display: 'show' }
      },
      'config.set': params => {
        if (gw.setFails) throw new Error(gw.setFails)
        return { value: params.value }
      },
      'profiles.configure': () => gw.configure
    }
  })
  const { roster2, openDialog, primeModelOptions } = internals
  const rosterEl = mount(panes.find(p => p.id === 'roster').render)
  await waitFor(() => rowButton(rosterEl, 'Scout'), 'roster rows')
  const providers = [{ slug: 'nous', name: 'Nous', models: ['hermes-4', 'hermes-3'] }]
  primeModelOptions(SCOUT, { providers })
  primeModelOptions(LOCAL, { providers })

  const sent = method => calls.filter(c => c.method === method)
  const dialog = () => dialogEl(primitives)
  const effortSelect = () => dialog()?.querySelector('select[aria-label="Effort"]')
  const save = () => buttonWithText(dialog(), 'Save')
  /** Open a Model dialog fresh and wait until the bot's model is shown. */
  const openModel = async (bot = SCOUT) => {
    openDialog(null)
    await waitFor(() => !dialog(), 'the previous dialog to close')
    roster2.models.set({})
    calls.length = 0
    openDialog({ kind: 'model', bot })
    await waitFor(() => dialog()?.querySelector('select[aria-label="Model"]'), 'the model picker')
    return dialog()
  }
  const closeAll = async () => {
    openDialog(null)
    await waitFor(() => !dialog(), 'the dialog to close')
  }

  await t.test('1. the Effort field lists the eight levels and preselects what config.get returned', async () => {
    Object.assign(gw, { effort: 'high', getFails: false, setFails: null })
    const el = await openModel()
    await waitFor(() => effortSelect() && !effortSelect().disabled && effortSelect().value === 'high', 'the effort preselected')
    assert.deepEqual([...effortSelect().options].map(o => [o.value, o.textContent]), LEVELS)
    assert.deepEqual(
      [...el.querySelectorAll('.gbo-field > span:first-child')].map(s => s.textContent).slice(0, 3),
      ['Provider', 'Model', 'Effort'],
      'Effort sits under Provider and Model'
    )
    assert.ok(el.textContent.includes('Hermes uses the closest level the model supports.'), 'the hint')
    const reads = sent('config.get').filter(c => c.params.key === 'reasoning')
    assert.ok(reads.length >= 1 && reads.every(c => c.via === 'mini::scout' && !('session_id' in c.params)), 'read on the bot\'s route, no session_id')
    assert.equal(save().disabled, true, 'nothing changed: Save is off')
    await closeAll()
  })

  await t.test('1b. while config.get is pending the field is disabled; it enables with the answer', async () => {
    Object.assign(gw, { effort: 'low', getFails: false, setFails: null })
    let release
    gw.hold = new Promise(resolve => (release = resolve))
    await openModel()
    assert.equal(effortSelect().disabled, true, 'disabled while loading')
    assert.equal(save().disabled, true)
    release()
    gw.hold = null
    await waitFor(() => !effortSelect().disabled && effortSelect().value === 'low', 'enabled with the level')
    await closeAll()
  })

  await t.test('2. changing only the effort enables Save and sends one config.set, no model write', async () => {
    Object.assign(gw, { effort: 'high', getFails: false, setFails: null })
    await openModel()
    await waitFor(() => effortSelect()?.value === 'high' && !effortSelect().disabled, 'the effort preselected')
    choose(effortSelect(), 'xhigh')
    await waitFor(() => !save().disabled, 'Save enabled by the effort change')
    save().click()
    await waitFor(() => !dialog(), 'the dialog to close after saving')
    const writes = sent('config.set')
    assert.equal(writes.length, 1, 'exactly one config.set')
    assert.deepEqual(writes[0].params, { key: 'reasoning', value: 'xhigh', scope: 'global' })
    assert.equal(writes[0].via, 'mini::scout', 'on the bot\'s own route')
    assert.equal(sent('profiles.configure').length, 0, 'no model write')
    assert.equal(sent('cli.exec').length, 0, 'no model write')
    assert.equal(roster2.models.get()['mini::scout'].effort, 'xhigh', 'the Model row follows')
  })

  await t.test('2b. putting the effort back to what it was leaves Save off', async () => {
    gw.effort = 'high'
    await openModel()
    await waitFor(() => effortSelect()?.value === 'high' && !effortSelect().disabled, 'the effort preselected')
    choose(effortSelect(), 'low')
    await waitFor(() => !save().disabled, 'Save on')
    choose(effortSelect(), 'high')
    await waitFor(() => save().disabled, 'Save off again')
    await closeAll()
  })

  // Before any model save: a model save re-reads the roster, and this fake host answers it with no bots.
  await t.test('4. the write carries the open chat\'s runtime session id; without a live chat for that bot it carries none', async () => {
    Object.assign(gw, { effort: 'high', getFails: false, setFails: null })
    // No chat is open: no session_id.
    await openModel()
    await waitFor(() => effortSelect()?.value === 'high' && !effortSelect().disabled, 'the effort preselected')
    choose(effortSelect(), 'low')
    await waitFor(() => !save().disabled, 'Save on')
    save().click()
    await waitFor(() => !dialog(), 'the dialog to close')
    assert.deepEqual(sent('config.set').map(c => c.params), [{ key: 'reasoning', value: 'low', scope: 'global' }])

    // Security's Bot Chat is open and attached. Scout's dialog is another bot: no session_id.
    rowButton(rosterEl, 'Security').click()
    mount((await waitFor(() => workspaces.get('grokbot-override'), 'the chat workspace')).render)
    await waitFor(() => internals.app.chat.get()?.runtimeId === 'rt-security', 'the chat\'s live runtime session')
    await openModel()
    await waitFor(() => effortSelect()?.value === 'high' && !effortSelect().disabled, 'the effort preselected')
    choose(effortSelect(), 'ultra')
    await waitFor(() => !save().disabled, 'Save on')
    save().click()
    await waitFor(() => !dialog(), 'the dialog to close')
    assert.deepEqual(sent('config.set').map(c => c.params), [{ key: 'reasoning', value: 'ultra', scope: 'global' }])
    assert.equal(sent('config.set')[0].via, 'mini::scout')

    // The open chat's own bot: the write carries its live runtime session id.
    await openModel(LOCAL)
    await waitFor(() => effortSelect()?.value === 'high' && !effortSelect().disabled, 'the effort preselected')
    assert.equal(sent('config.get').every(c => !('session_id' in c.params)), true, 'the read never carries a session id')
    choose(effortSelect(), 'max')
    await waitFor(() => !save().disabled, 'Save on')
    save().click()
    await waitFor(() => !dialog(), 'the dialog to close')
    assert.deepEqual(sent('config.set').map(c => c.params), [{ key: 'reasoning', value: 'max', scope: 'global', session_id: 'rt-security' }])
  })

  await t.test('3. changing only the model sends no config.set', async () => {
    gw.effort = 'high'
    await openModel()
    await waitFor(() => effortSelect()?.value === 'high' && !effortSelect().disabled, 'the effort preselected')
    choose(dialog().querySelector('select[aria-label="Model"]'), 'hermes-3')
    await waitFor(() => !save().disabled, 'Save enabled by the model change')
    save().click()
    await waitFor(() => !dialog(), 'the dialog to close after saving')
    assert.equal(sent('config.set').length, 0, 'no effort write')
    const configure = sent('profiles.configure')
    assert.equal(configure.length, 1)
    assert.deepEqual(configure[0].params, { name: 'scout', model: 'hermes-3', provider: 'nous' })
  })

  await t.test('3b. a model and an effort: the model goes first, then the effort', async () => {
    gw.effort = 'high'
    await openModel()
    await waitFor(() => effortSelect()?.value === 'high' && !effortSelect().disabled, 'the effort preselected')
    choose(dialog().querySelector('select[aria-label="Model"]'), 'hermes-3')
    choose(effortSelect(), 'low')
    await waitFor(() => !save().disabled, 'Save on')
    save().click()
    await waitFor(() => !dialog(), 'the dialog to close after saving')
    const order = calls.filter(c => c.method === 'profiles.configure' || c.method === 'config.set').map(c => c.method)
    assert.deepEqual(order, ['profiles.configure', 'config.set'])
    assert.equal(sent('config.set')[0].params.value, 'low')
  })

  await t.test('3c. a model that is not saved leaves the effort unwritten and the dialog open', async () => {
    gw.effort = 'high'
    gw.configure = { applied: { model: false } }
    await openModel()
    await waitFor(() => effortSelect()?.value === 'high' && !effortSelect().disabled, 'the effort preselected')
    choose(dialog().querySelector('select[aria-label="Model"]'), 'hermes-3')
    choose(effortSelect(), 'low')
    await waitFor(() => !save().disabled, 'Save on')
    save().click()
    await waitFor(() => dialog()?.querySelector('.gbo-form-error'), 'the error')
    assert.match(dialog().querySelector('.gbo-form-error').textContent, /Not saved: model/)
    assert.equal(sent('config.set').length, 0, 'no effort write after a failed model')
    gw.configure = { applied: { model: true } }
    await closeAll()
  })

  await t.test('3d. the effort write failing keeps the dialog open, says the model was saved, and a retry writes only the effort', async () => {
    gw.effort = 'high'
    gw.setFails = 'invalid value (4002)'
    await openModel()
    await waitFor(() => effortSelect()?.value === 'high' && !effortSelect().disabled, 'the effort preselected')
    choose(dialog().querySelector('select[aria-label="Model"]'), 'hermes-3')
    choose(effortSelect(), 'low')
    await waitFor(() => !save().disabled, 'Save on')
    save().click()
    await waitFor(() => dialog()?.querySelector('.gbo-form-error'), 'the error')
    const text = dialog().querySelector('.gbo-form-error').textContent
    assert.match(text, /model was saved/)
    assert.match(text, /invalid value \(4002\)/)
    assert.equal(sent('profiles.configure').length, 1)
    gw.setFails = null
    await waitFor(() => !save().disabled, 'Save on for the retry')
    save().click()
    await waitFor(() => !dialog(), 'the dialog to close after the retry')
    assert.equal(sent('profiles.configure').length, 1, 'the saved model is not written again')
    assert.equal(sent('config.set').length, 2)
  })

  await t.test('5. a failing config.get leaves the model flow working, and the effort usable', async () => {
    Object.assign(gw, { getFails: true, setFails: null })
    const el = await openModel()
    await waitFor(() => effortSelect() && !effortSelect().disabled, 'the effort field usable')
    assert.match(el.textContent, /The current effort could not be read\./)
    assert.equal(effortSelect().value, '', 'nothing preselected')
    assert.deepEqual([...effortSelect().options].map(o => o.value).slice(1), LEVELS.map(([id]) => id), 'the eight levels are still offered')
    assert.equal(save().disabled, true)
    choose(dialog().querySelector('select[aria-label="Model"]'), 'hermes-3')
    await waitFor(() => !save().disabled, 'Save enabled by the model change')
    save().click()
    await waitFor(() => !dialog(), 'the dialog to close after saving')
    assert.equal(sent('profiles.configure').length, 1, 'the model saved')
    assert.equal(sent('config.set').length, 0, 'no effort write: none was picked')

    // The effort can still be chosen after a failed read.
    await openModel()
    await waitFor(() => effortSelect() && !effortSelect().disabled, 'the effort field usable')
    choose(effortSelect(), 'medium')
    await waitFor(() => !save().disabled, 'Save on')
    save().click()
    await waitFor(() => !dialog(), 'the dialog to close')
    assert.deepEqual(sent('config.set').map(c => c.params), [{ key: 'reasoning', value: 'medium', scope: 'global' }])
    gw.getFails = false
  })

  await t.test('6. Skills, tools and model: the field sits next to the picker and saves with the dialog', async () => {
    Object.assign(gw, { effort: 'low', getFails: false, setFails: null })
    openDialog(null)
    await waitFor(() => !dialog(), 'the previous dialog to close')
    calls.length = 0
    openDialog({ kind: 'config', bot: SCOUT, initial: { ...CONFIG } })
    await waitFor(() => effortSelect() && !effortSelect().disabled && effortSelect().value === 'low', 'the effort preselected')
    assert.deepEqual([...effortSelect().options].map(o => o.value), LEVELS.map(([id]) => id))
    assert.equal(save().disabled, true)
    choose(effortSelect(), 'high')
    await waitFor(() => !save().disabled, 'Save enabled by the effort change')
    save().click()
    await waitFor(() => !dialog(), 'the dialog to close after saving')
    assert.deepEqual(sent('config.set').map(c => c.params), [{ key: 'reasoning', value: 'high', scope: 'global' }])
    assert.equal(sent('profiles.configure').length, 0, 'nothing else was dirty')

    // Model + effort together; the model failing leaves the effort alone.
    gw.configure = { applied: { model: false } }
    calls.length = 0
    openDialog(null)
    await waitFor(() => !dialog(), 'closed')
    openDialog({ kind: 'config', bot: SCOUT, initial: { ...CONFIG } })
    await waitFor(() => effortSelect() && !effortSelect().disabled, 'the effort field usable')
    choose(dialog().querySelector('select[aria-label="Model"]'), 'hermes-3')
    choose(effortSelect(), 'max')
    await waitFor(() => !save().disabled, 'Save on')
    save().click()
    await waitFor(() => dialog()?.querySelector('.gbo-form-error'), 'the error')
    assert.match(dialog().querySelector('.gbo-form-error').textContent, /Not saved: model, effort/)
    assert.equal(sent('config.set').length, 0, 'no effort write after a failed model')
    gw.configure = { applied: { model: true } }
    await closeAll()
  })

  await t.test('7. the create-bot dialog has no Effort field', async () => {
    openDialog(null)
    await waitFor(() => !dialog(), 'closed')
    openDialog({ kind: 'create', tab: 'model' })
    const el = await waitFor(() => dialog(), 'the create dialog')
    await settle()
    assert.ok(el.textContent.includes('Provider'))
    assert.equal(el.querySelector('select[aria-label="Effort"]'), null)
    assert.ok(!el.textContent.includes('Effort'))
    await closeAll()
  })

  assert.deepEqual(reactErrors(errors), [], 'no React error anywhere')
})
