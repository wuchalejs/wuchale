// $ node --import ../../testing/resolve.ts %f

import { test } from 'node:test'
// @ts-expect-error
import { testLoadersExist } from '../../testing/utils.ts'

test('Default loader file paths', async () => {
    await testLoadersExist(['server', 'vite', 'bundle'])
})
