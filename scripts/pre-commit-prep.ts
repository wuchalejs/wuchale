// $ cd .. && node scripts/%f

import { renameSync, symlinkSync } from 'node:fs'
import { resolve } from 'node:path'

const file = resolve(import.meta.filename, '../../.git/hooks/pre-commit')
const fileTmp = `${file}.x`
symlinkSync('../../scripts/pre-commit', fileTmp)
renameSync(fileTmp, file)
