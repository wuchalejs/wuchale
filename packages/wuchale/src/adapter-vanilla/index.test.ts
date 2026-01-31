// $ node --import '#test-resolve' %f

import { test } from 'node:test'
import { testLoadersExist } from '#test-utils'

test('Default loader file paths', async () => {
    await testLoadersExist(['server', 'vite', 'bundle'])
})
