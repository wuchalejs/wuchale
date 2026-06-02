// $ node --import ../testing/resolve.ts %f

import { test } from 'node:test'
import { createHeuristic, defaultHeuristicOpts, newMessage } from './adapters.js'

const heuristic = createHeuristic(defaultHeuristicOpts)

function scriptMsg(msgStr: string) {
    return newMessage({
        msgStr: [msgStr],
        details: {
            file: 'test.ts',
            scope: 'script',
            insideProgram: true,
            funcName: 'myFn',
        },
    })
}

test('heuristic: template literal starting with placeholder + space is extracted', t => {
    // `${name} was successfully deleted!` → wuchale msgStr: `{0} was successfully deleted!`
    t.assert.equal(heuristic(scriptMsg('{0} was successfully deleted!')), 'message')
})

test("heuristic: template literal starting with placeholder + 's<space> is extracted", t => {
    // `${user.email}'s role was updated` → wuchale msgStr: `{0}'s role was updated`
    t.assert.equal(heuristic(scriptMsg("{0}'s role was updated to administrator.")), 'message')
})

test('heuristic: plain template literal starting with path-like expression is NOT extracted', t => {
    // `${base}/api/users` — structural, not translatable
    t.assert.equal(heuristic(scriptMsg('{0}/api/users')), false)
})

test('heuristic: plain template literal with only expression and dot is NOT extracted', t => {
    // `${obj.key}` — no natural language
    t.assert.equal(heuristic(scriptMsg('{0}')), false)
})

test('heuristic: normal uppercase-starting script string is extracted', t => {
    t.assert.equal(heuristic(scriptMsg('Hello world')), 'message')
})

test('heuristic: lowercase-starting script string is NOT extracted', t => {
    t.assert.equal(heuristic(scriptMsg('someVariable')), false)
})
