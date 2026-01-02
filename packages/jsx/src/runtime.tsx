import type { Composite, Mixed } from 'wuchale'

export type WuchaleComponentProps = {
    n?: boolean
    x: Composite
    t: Function[]
    a: any[]
}

export function selectFragment(
    { n, x, t, a }: WuchaleComponentProps,
    i: number,
): string | Mixed | Composite | undefined {
    if (typeof x === 'string') {
        return x
    }
    if (typeof x === 'number') {
        if (!n || i > 0) {
            return a[x]
        }
        return
    }
    const tag = t[x[0] as number]
    if (tag == null) {
        return 'i18n-404:tag'
    } else {
        return tag(x)
    }
}

export default (props: WuchaleComponentProps) => {
    return props.x.map((fragment, i) => selectFragment({ ...props, x: fragment as Composite }, i))
}
