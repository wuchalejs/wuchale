/**
 * Wuchale runtime component for Astro
 * Handles mixed content (text + nested elements) in translations
 *
 * Usage in transformed Astro templates:
 * <W_tx_ t={[() => <b key="_0">{_w_runtime_.tx(_w_ctx_)}</b>]} x={_w_runtime_.cx(0)} />
 */
import type { Composite, Mixed } from 'wuchale'

export type WuchaleComponentProps = {
    /** nested flag - indicates if this is nested within another W_tx_ */
    n?: boolean
    /** content structure from compiled translation */
    x: Composite
    /** tag renderer functions for nested elements */
    t: Function[]
    /** arguments/placeholders */
    a: any[]
}

/**
 * Select and render a fragment from the translation content
 */
export function selectFragment({ n, x, t, a }: WuchaleComponentProps, i: number): string | Mixed | Composite {
    if (typeof x === 'string') {
        return x
    }
    if (typeof x === 'number') {
        if (!n || i > 0) {
            return a[x]
        }
        return `i18n-400:${x}`
    }
    const tag = t[x[0] as number]
    if (tag == null) {
        return 'i18n-404:tag'
    } else {
        return tag(x)
    }
}

/**
 * W_tx_ component - renders mixed content translations
 * This component handles translations that contain both text and nested elements
 *
 * Example input: "Click <b>here</b> to continue"
 * Compiled to: x=["Click ", [0], " to continue"] with t=[() => <b>here</b>]
 */
export default function W_tx_(props: WuchaleComponentProps) {
    if (!Array.isArray(props.x)) {
        return selectFragment(props, 0)
    }
    return props.x.map((fragment, i) => selectFragment({ ...props, x: fragment as Composite }, i))
}
