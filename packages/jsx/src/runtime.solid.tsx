import { For } from 'solid-js'
import type { Composite } from 'wuchale'
import { selectFragment, type WuchaleComponentProps } from './runtime.jsx'

export default (props: WuchaleComponentProps) => {
    return (
        <For each={props.x}>
            {(fragment: Composite, i: () => number) => <>{selectFragment({ ...props, x: fragment }, i())}</>}
        </For>
    )
}
