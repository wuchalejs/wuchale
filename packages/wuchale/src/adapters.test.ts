// $ node --import ../testing/resolve.ts %f

import { test } from 'node:test'
import { createHeuristic, defaultHeuristicOpts, newText } from './text.js'

const heuristic = createHeuristic(defaultHeuristicOpts)

function scriptTxt(body: string) {
    return newText({
        body: [body],
        path: [{ type: 'function', name: 'myFn' }],
    })
}

const file = 'test.ts'

test('Default heuristic checks correct', t => {
    t.assert.equal(heuristic(scriptTxt('{0} was successfully deleted!'), file), 'message')
    t.assert.equal(heuristic(scriptTxt("{0}'s role was updated to administrator."), file), 'message')
    t.assert.equal(heuristic(scriptTxt('{0}/api/users'), file), false)
    t.assert.equal(heuristic(scriptTxt('{0}'), file), false)
    t.assert.equal(heuristic(scriptTxt('Hello world'), file), 'message')
    t.assert.equal(heuristic(scriptTxt('someVariable'), file), false)
})
