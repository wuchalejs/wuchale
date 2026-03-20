import { type Config } from '../config.js'
import { readOnlyFS } from '../fs.js'
import { Hub } from '../hub.js'
import { color } from '../log.js'

export async function check(config: Config, root: string) {
    // console.log because if the user invokes this command, they want full info regardless of config
    const hub = new Hub(() => config, root, 0, readOnlyFS)
    await hub.init('cli')
    const { checked, errors } = hub.check()
    for (const err of errors) {
        const message = err.type === 'notEquivalent' ? 'Not equivalent' : 'Unequal length'
        console.error(`${color.magenta(err.adapter)}: ${color.red(message)}`)
        console.error(`  ${color.grey('Source:')} ${err.source}`)
        console.error(`  ${color.grey('Target locale:')} ${err.locale}`)
        console.error(`  ${color.grey('Translation:')} ${err.translation}`)
    }
    if (errors.length > 0) {
        process.exit(1)
    }
    console.log(color.green(`${checked} items checked. No errors found`))
}
