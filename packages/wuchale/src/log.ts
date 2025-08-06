const colors = {
    red: 31,
    green: 32,
    yellow: 33,
    magenta: 35,
    cyan: 36,
    reset: 0,
}

const encode = (code: number) => `\x1b[${code}m`

type ColorFuncs = {[col in keyof typeof colors]: (msg: string) => string}

const colorFuncsEntries = Object.entries(colors).map(([col, code]) => [
    col,
    (msg: string) => `${encode(code)}${msg}${encode(colors.reset)}`,
])

export const color = <ColorFuncs>Object.fromEntries(colorFuncsEntries)

export type LogArgs = (string | number | [keyof typeof colors, string | number])[]

export class Logger {
    #showMsgs = true

    constructor (showMsgs: boolean) {
        this.#showMsgs = showMsgs
    }

    #show = (message: string, type: 'log' | 'info' | 'warn' | 'error') => {
        if (!this.#showMsgs) {
            return
        }
        console[type](message)
    }

    log = (...msgs: LogArgs) => {
        let mainMsg = ''
        for (const msg of msgs) {
            if (typeof msg === 'string' || typeof msg === 'number') {
                mainMsg += msg
            } else {
                mainMsg += color[msg[0]](String(msg[1]))
            }
        }
        this.#show(mainMsg, 'log')
    }

    info = (msg: string) => this.#show(color.cyan(msg), 'info')
    warn = (msg: string) => this.#show(color.yellow(msg), 'warn')
    error = (msg: string) => this.#show(color.red(msg), 'error')
}
