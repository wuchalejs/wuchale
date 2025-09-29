// $node %f wuchale
// @ts-check

import readline from 'readline'
import { color } from '../log.js'

export function setupInteractive() {
    readline.emitKeypressEvents(process.stdin)
    if (process.stdin.isTTY) {
        process.stdin.setRawMode(true)
    }
}

export async function ask(choices: string[], question: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    })
    if (question) {
        console.log(question)
    }
    const data = {}
    for (const [i, c] of choices.entries()) {
        const key = i + 1
        console.log(`  ${color.cyan(key)}: ${c}`)
        data[key] = c
    }
    process.stdout.write(` > ${color.grey('(enter to select the first one)\x1b[3G')}`)
    return new Promise((res, rej) => {
        const select = (choice: string) => {
            console.log(` \x1b[K${color.cyan(choice)} selected\r`)
            res(choice)
        }
        const listener = (_: any, key: {name: string}) => {
            process.stdin.off('keypress', listener)
            switch (key.name) {
                case 'q':
                case 'escape':
                case 'c': // for Ctrl+C
                    rl.close()
                    rej()
                    break
                case 'return':
                    rl.close()
                    select(choices[0])
                    break
                default:
                    rl.close()
                    if (key.name in data) {
                        select(data[key.name])
                        return
                    }
                    console.warn(`Wrong key: ${color.cyan(key.name)}`)
                    ask(choices, question).then(res, rej)
            }
        }
        process.stdin.on('keypress', listener)
    })
}
