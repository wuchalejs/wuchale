// $ node --import ../../wuchale/testing/resolve.ts %f

import { test } from 'node:test'
// @ts-expect-error
import { testLoadersExist } from '../../wuchale/testing/utils.ts'
import { getDefaultLoaderPath } from './index.js'

test('Default loader file paths', async () => {
    await testLoadersExist(['default', 'react', 'solidjs'], getDefaultLoaderPath)
})
