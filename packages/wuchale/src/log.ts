const colors = {
    red: 31,
    green: 32,
    yellow: 33,
    magenta: 35,
    cyan: 36,
    grey: 90,
    reset: 0,
}

const encode = (code: number) => `\x1b[${code}m`

type ColorFuncs = Record<keyof typeof colors, (msg: string | number) => string>

const colorFuncsEntries = Object.entries(colors).map(([col, code]) => [
    col,
    (msg: string | number) => `${encode(code)}${msg}${encode(colors.reset)}`,
])

export const color = <ColorFuncs>Object.fromEntries(colorFuncsEntries)

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

    log = (msg: string) => this.#show(msg, 'log')
    info = (msg: string) => this.#show(color.cyan(msg), 'info')
    warn = (msg: string) => this.#show(color.yellow(msg), 'warn')
    error = (msg: string) => this.#show(color.red(msg), 'error')
}
