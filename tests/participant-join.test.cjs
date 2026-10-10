const { test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

function load(file, mocks) {
  const exports = {}
  const source = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  }).outputText
  vm.runInNewContext(source, {
    exports, Error, process: { env: { NEXT_PUBLIC_EVENT_ID: 'event' } },
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : require(name),
  })
  return exports
}

function setup({ serverUser = true, active = false, listError = null } = {}) {
  const navigations = []
  const effects = []
  const state = []
  const listCalls = []
  const participant = { id: 'old-account', name: 'Test', event_id: 'event', is_active: active }
  const redirect = url => { navigations.push(url); throw new Error(`redirect:${url}`) }
  const auth = load('lib/auth.ts', {
    'next/navigation': { redirect },
    '@/lib/supabase/server': { createClient: async () => ({
      auth: { getUser: async () => ({ data: { user: serverUser ? { id: 'user' } : null } }) },
      from: () => {
        const filters = {}
        const query = {
          select: () => query,
          eq: (field, value) => { filters[field] = value; return query },
          maybeSingle: async () => ({ data: filters.is_active === true && !active ? null : participant }),
        }
        return query
      },
    }) },
  })
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) },
    // The old browser lookup could see an inactive participant through admin RLS.
    from: () => {
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: participant }) }
      return query
    },
    rpc: async (name, args) => {
      listCalls.push({ name, args })
      return { data: listError ? null : [{ participant_id: 'available', participant_name: 'Available', is_claimed: false }], error: listError }
    },
  }
  const join = load('components/auth/ParticipantJoin.tsx', {
    react: {
      useMemo: fn => fn(), useEffect: fn => effects.push(fn),
      useState: initial => { const index = state.length; state.push(initial); return [initial, value => { state[index] = value }] },
    },
    'next/navigation': { useRouter: () => ({ replace: url => navigations.push(url), refresh: () => navigations.push('refresh') }) },
    '@/lib/supabase/client': { createClient: () => client },
  })
  const page = load('app/join/page.tsx', {
    'next/navigation': { redirect }, '@/lib/auth': auth,
    '@/components/auth/ParticipantJoin': { __esModule: true, default: join.default },
  })
  return { auth, page: page.default, join: join.default, effects, state, listCalls, navigations }
}

async function boot(fixture) {
  fixture.join({ eventId: 'event' })
  fixture.effects.forEach(effect => effect())
  await new Promise(resolve => setImmediate(resolve))
}

test('inactive claimed admin stays on name selection and loads choices instead of bouncing Home/Join', async () => {
  const f = setup()
  assert.equal(await f.auth.getCurrentParticipant(), null)
  await f.page()
  await boot(f)
  assert.deepEqual(f.navigations, [])
  assert.equal(f.listCalls[0].name, 'list_available_participants')
  assert.equal(f.state[0][0].participant_id, 'available')
  assert.equal(f.state[3], false)
})

test('browser-only session cannot trigger an automatic redirect when server cannot verify it', async () => {
  const f = setup({ serverUser: false, active: true })
  await f.page()
  await boot(f)
  assert.deepEqual(f.navigations, [])
  assert.equal(f.state[0].length, 1)
})

test('server-verified active participant goes directly to Home using the same access check', async () => {
  const f = setup({ active: true })
  assert.equal((await f.auth.getCurrentParticipant()).id, 'old-account')
  await assert.rejects(f.page(), /redirect:\//)
  assert.deepEqual(f.navigations, ['/'])
})

test('roster failure remains on Join with an error and ends loading', async () => {
  const f = setup({ listError: new Error('Roster unavailable') })
  await f.page()
  await boot(f)
  assert.deepEqual(f.navigations, [])
  assert.equal(f.state[3], false)
  assert.equal(f.state[5], 'Roster unavailable')
})
