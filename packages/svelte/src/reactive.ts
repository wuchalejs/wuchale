import { createSubscriber } from "svelte/reactivity"

/** 
 * This is a way to bypass svelte's reactivity restriction
 * outside .svelte.js files The purpose is dev mode HMR
 * without invalidating whole trees
*/
export class ReactiveArray extends Array {
    constructor(...args: number[]) {
        super(...args)
        let update: () => void
        const subscribe = createSubscriber((updateArg: () => void) => {
            update = updateArg
        })
        return new Proxy(this, {
            get(target, prop, receiver) {
                subscribe()
                return Reflect.get(target, prop, receiver)
            },
            set(target, prop, value, receiver) {
                target[prop] = value
                update?.()
                return Reflect.set(target, prop, value, receiver)
            },
        })
    }
    static from = (array: number[]) => new ReactiveArray(...array)
}
