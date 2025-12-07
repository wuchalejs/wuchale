declare module 'solid-js' {
    export function For(props: any): any
    export function createSignal(init: any): [Function, Function]
}

declare module 'solid-js/store' {
    export function createStore(init: any): [any, (...args: any[]) => void]
}

declare module 'react' {
    export function useState(init: any): [any, Function]
    export function useEffect(cb: Function, deps: Array): any
    export function useMemo(cb: Function, deps: Array): any
}
