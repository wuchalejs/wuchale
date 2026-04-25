declare module 'solid-js' {
    export function For(props: any): any
    export function createSignal<T>(init: T): [() => T, ((a: T | (() => T)) => void)]
}

declare module 'solid-js/store' {
    export function createStore(init: any): [any, (...args: any[]) => void]
}

declare module 'react' {
    export function useState<T>(init: T | (() => T)): [T, ((a: T | (() => T)) => void)]
    export function useEffect(cb: Function, deps: Array): any
    export function useMemo(cb: Function, deps: Array): any
}
