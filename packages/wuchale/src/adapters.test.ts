// $ node --import ../testing/resolve.ts %f

import { test } from 'node:test'
import { createHeuristic, defaultHeuristicOpts, newMessage } from './adapters.js'

const heuristic = createHeuristic(defaultHeuristicOpts)

function newMsg(msgStr: string, script = true) {
    return newMessage({
        msgStr: [msgStr],
        details: {
            file: 'test.ts',
            scope: script ? 'script' : 'markup',
            insideProgram: true,
            funcName: 'myFn',
        },
    })
}

test('Default heuristic checks correct', t => {
    // markup
    t.assert.equal(heuristic(newMsg('Hello <0/>!', false)), 'message')
    t.assert.equal(heuristic(newMsg('Hello <0>there</0>!', false)), 'message')
    t.assert.equal(heuristic(newMsg('<0>Hello</0> there, <1>welcome</1>!', false)), 'message')
    t.assert.equal(heuristic(newMsg('<0>Hello</0>, <1>and welcome</1>!', false)), false)
    // script
    t.assert.equal(heuristic(newMsg('{0} was successfully deleted!')), 'message')
    t.assert.equal(heuristic(newMsg("{0}'s role was updated to administrator.")), 'message')
    t.assert.equal(heuristic(newMsg('{0}/api/users')), false)
    t.assert.equal(heuristic(newMsg('{0}')), false)
    t.assert.equal(heuristic(newMsg('Hello world')), 'message')
    t.assert.equal(heuristic(newMsg('someVariable')), false)
})
