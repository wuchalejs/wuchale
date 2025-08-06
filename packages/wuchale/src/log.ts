
export class Logger {
    #showMsgs = true

    constructor (showMsgs: boolean) {
        this.#showMsgs = showMsgs
    }

    #show = (message: string, type: 'info' | 'warn' | 'error') => {
        if (!this.#showMsgs) {
            return
        }
        console[type](message)
    }

    info = (msg: string) => this.#show(msg, 'info')
    warn = (msg: string) => this.#show(msg, 'warn')
    error = (msg: string) => this.#show(msg, 'error')

}
