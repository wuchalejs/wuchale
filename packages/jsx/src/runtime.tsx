import type { Composite, Mixed } from 'wuchale'

export type WuchaleComponentProps = {
    nest?: boolean
    ctx: Composite
    tags: Function
    args: any[]
}

export function selectFragment({nest, ctx, tags, args}: WuchaleComponentProps, i: number): string | Mixed | Composite {
    if (typeof ctx === 'string') {
        return ctx
    } if (typeof ctx === 'number') {
        if (!nest || i > 0) {
            return args[ctx]
        }
    } else {
        const tag = tags[ctx[0] as number]
        if (tag == null) {
            return 'i18n-404:tag'
        } else {
            return tag(ctx)
        }
    }
}

export default (props: WuchaleComponentProps) => {
    return props.ctx.map((fragment, i) => selectFragment({...props, ctx: fragment as Composite}, i))
}
