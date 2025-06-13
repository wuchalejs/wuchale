import setupPreprocess from './index'
import {readFileSync} from 'node:fs'
import { expect, test } from 'vitest'

// just for syntax highlighting down there
const svelte = args => args[0]
const javascript = svelte

const prep = setupPreprocess({localesDir: 'locales', locales: ['en', 'am']}).markup

const script = javascript`
const a0 = 'Abebe'
const a = '+Abebe'
const a1 = \`+Keza \${a} t/bet hede\`
const b = {abebe: '+Beso'}
const c = {bele: {['+Feres']: ['+Galebe']}}
`
const markup = svelte`
<p>{a0} Kebede</p>
<p>{a} Kebede</p>
<p>{a1} Kebede</p>
<p>Kebede {'+Beso'}</p>

<p>{\`+Foo ${34} bar \${3} ee\`}</p>

<!-- <p>{\`+Foo \${34} bar \${3} ee\`} Kebebew</p> -->
<!-- <p>Kebede <b>Beso</b></p> -->
<!-- <p>Abebe <i>{b.abebe}</i> bela</p> -->
<!-- <p>Feres {c.bele['+Feres']}</p> -->
<!-- <p title={a}>Beso</p> -->
<!-- <p title="+Abebe">Beso</p> -->
<!-- <p>I <b style="color: red">might <i>really</i></b> be crazy.</p> -->
`

test('test', () => {
    for (const line of markup.split('\n')) {
        if (!line.trim()) {
            continue
        }
        console.log(markup)
        prep({line, filename: 'foo'}).code
    }
    expect(3).toBe(3)
})
