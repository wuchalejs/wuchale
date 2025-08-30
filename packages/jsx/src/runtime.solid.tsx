import type { Composite } from 'wuchale'
import { type WuchaleComponentProps, selectFragment } from './runtime.jsx'
import { For } from 'solid-js'

export default (props: WuchaleComponentProps) => {
    return <For each={props.x}>
        {(fragment: Composite, i: () => number) => <>{selectFragment({...props, x: fragment}, i())}</>}
    </For>
}
