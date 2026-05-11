// $ cd .. && node scripts/%f

import { symlinkSync } from 'node:fs'
import { resolve } from 'node:path'

const file = resolve(import.meta.filename, '../../.git/hooks/pre-commit')
symlinkSync('../../scripts/pre-commit', file)
