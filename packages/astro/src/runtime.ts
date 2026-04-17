import type { Composite } from 'wuchale'

export type WuchaleComponentProps = {
    n?: boolean
    x: Composite
    t: ((...a: any[]) => any)[]
    a?: any[]
}

export default ({ t, n, x, a }: WuchaleComponentProps) =>
    x.map((x, i) => {
        if (typeof x === 'string') {
            return x
        }
        if (typeof x === 'number') {
            if (!n || i > 0) {
                return a![x]
            }
            return null
        }
        const tag = t[x[0] as number]
        if (tag == null) {
            return 'i18n-404:tag'
        } else {
            return tag(x)
        }
    })
