import type { Config } from '../config.js'
import { Hub } from '../hub.js'

export async function extract(config: Config, root: string, clean: boolean, watch: boolean, sync: boolean) {
    const hub = new Hub(() => config, root)
    await hub.init('cli')
    await hub.directVisit(clean, watch, sync)
}
