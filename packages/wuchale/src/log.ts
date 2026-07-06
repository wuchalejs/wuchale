const colors = {
    red: 31,
    green: 32,
    yellow: 33,
    magenta: 35,
    cyan: 36,
    grey: 90,
    reset: 0,
}

const colorStart = '\x1b['

const encode = (code: number) => `${colorStart}${code}m`

type ColorFuncs = Record<keyof typeof colors, (msg: string | number) => string>

const colorFuncsEntries = Object.entries(colors).map(([col, code]) => [
    col,
    (msg: string | number) => `${encode(code)}${msg}${encode(colors.reset)}`,
])

export const color = <ColorFuncs>Object.fromEntries(colorFuncsEntries)

export const logLevels = {
    error: 3,
    warn: 2,
    info: 1,
    verbose: 0,
}

export type LogLevel = keyof typeof logLevels

export class Logger {
    #logLevel: number

    constructor(logLevelName: LogLevel) {
        this.#logLevel = logLevels[logLevelName]
    }

    checkLevel = (level: LogLevel) => logLevels[level] >= this.#logLevel

    #show = (message: string[], level: LogLevel, col: keyof ColorFuncs) => {
        if (!this.checkLevel(level)) {
            return
        }
        let func = console.log
        if (level !== 'verbose') {
            func = console[level]
        }
        func(...message.map(m => (m.startsWith(colorStart) ? m : color[col](m))))
    }

    info = (...msg: any[]) => this.#show(msg, 'info', 'cyan')
    warn = (...msg: any[]) => this.#show(msg, 'warn', 'yellow')
    error = (...msg: any[]) => this.#show(msg, 'error', 'red')
    verbose = (...msg: any[]) => this.#show(msg, 'verbose', 'grey')
}
