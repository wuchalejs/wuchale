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

test('Default heuristic checks correct', t => {
    t.assert.equal(heuristic(scriptMsg('{0} was successfully deleted!')), 'message')
    t.assert.equal(heuristic(scriptMsg("{0}'s role was updated to administrator.")), 'message')
    t.assert.equal(heuristic(scriptMsg('{0}/api/users')), false)
    t.assert.equal(heuristic(scriptMsg('{0}')), false)
    t.assert.equal(heuristic(scriptMsg('Hello world')), 'message')
    t.assert.equal(heuristic(scriptMsg('someVariable')), false)
})
