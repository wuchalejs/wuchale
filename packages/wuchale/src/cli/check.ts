import { type Config } from '../config.js'
import { readOnlyFS } from '../fs.js'
import { type CheckErrorType, Hub } from '../hub.js'
import { color } from '../log.js'

export const checkHelp = `
Usage:
    ${color.cyan('wuchale check {options}')}

Options:
    ${color.cyan('--full')}           check if there are unextracted and newly obsolete messages in source code as well
    ${color.cyan('--help')}, ${color.cyan('-h')}       Show this help
`

const checkErrMsgs: { [key in CheckErrorType]: string } = {
    notEquivalent: 'Not equivalent',
    unequalLength: 'Unequal length',
}

export async function check(config: Config, root: string, full: boolean) {
    // console.log because if the user invokes this command, they want full info regardless of config
    const hub = await Hub.create('cli', () => config, root, 0, readOnlyFS)
    const { checked, errors, syncs } = await hub.check(full)
    for (const err of errors) {
        console.error(`${color.magenta(err.adapter)}: ${color.red(checkErrMsgs[err.type])}`)
        console.error(`  ${color.grey('Source:')} ${err.source}`)
        console.error(`  ${color.grey('Target locale:')} ${err.locale}`)
        console.error(`  ${color.grey('Translation:')} ${err.translation}`)
    }
    for (const key of syncs) {
        console.error(`${color.red(key)}: Pending changes`)
    }
    if (errors.length > 0 || syncs.length > 0) {
        process.exit(1)
    }
    console.log(color.green(`${checked} items checked. No errors found`))
}
