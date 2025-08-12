// these are just to silence TS without comments

declare module "react" {
    export const useState: Function
    export const useEffect: Function
}

declare module "solid-js/store" {
    export const createStore: Function
}
