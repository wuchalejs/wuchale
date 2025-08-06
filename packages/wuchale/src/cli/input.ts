// $node %f wuchale
// @ts-check

import readline from 'readline'

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
        console.log(`${question} (enter: first choice)`)
    }
    const data = {}
    for (const [i, c] of choices.entries()) {
        const key = i + 1
        console.log(`  ${key}: ${c}`)
        data[key] = c
    }
    return new Promise((res, rej) => {
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
                    res(choices[0])
                    break
                default:
                    rl.close()
                    console.log(` ${key} selected\r`)
                    if (key.name in data) {
                        res(data[key.name])
                        return
                    }
                    console.error('Wrong key', key.name)
                    ask(choices, question).then(res, rej)
            }
        }
        process.stdin.on('keypress', listener)
    })
}
