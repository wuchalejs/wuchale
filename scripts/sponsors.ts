// $ node %f
import { readFileSync, writeFileSync } from 'node:fs'

type Sponsor = {
    username: string
    id?: number | undefined
}

type Data = {
    sponsors: Sponsor[]
    backers: Sponsor[]
    past: Sponsor[]
}

const props: { [K in keyof Data]: { title: string; size: number } } = {
    sponsors: { title: 'Sponsors:', size: 96 },
    backers: { title: 'Special thanks to our supporters:', size: 48 },
    past: { title: 'Past supporters:', size: 48 },
}

const sponsFile = './sponsors.json'
const data: Data = JSON.parse(readFileSync(sponsFile, 'utf-8'))
const readmeFile = '../README.md'
let readme = readFileSync(readmeFile, 'utf-8')

function replaceAnchor(anchor: string, title: string, repl: string) {
    const start = readme.indexOf(anchor) + anchor.length
    let end = start
    if (readme[start] !== '\n') {
        const endStart = readme.indexOf('\n\n', start) + 2
        end = readme.indexOf('\n\n', endStart)
    }
    readme = readme.slice(0, start) + (repl ? `${title}\n\n${repl}` : '') + readme.slice(end)
}

for (const key of Object.keys(props) as (keyof Data)[]) {
    const spons = data[key]
    const newSpons = spons.filter(s => s.id === undefined)
    if (newSpons.length) {
        const ress = await Promise.all(newSpons.map(s => fetch(`https://api.github.com/users/${s.username}`)))
        const jsons = (await Promise.all(ress.map(r => r.json()))) as { id: number }[]
        newSpons.forEach((s, i) => {
            s.id = jsons[i]?.id
        })
    }
    const secBody: string[] = []
    const prop = props[key]
    for (const s of spons) {
        secBody.push(
            `[![${s.username}](https://avatars.githubusercontent.com/u/${s.id}?v=4&s=${prop.size})](https://github.com/${s.username})`,
        )
    }
    replaceAnchor(`<!-- s:${key} -->`, prop.title, secBody.join('\n'))
}

writeFileSync(readmeFile, readme)
writeFileSync(sponsFile, JSON.stringify(data, null, '  '))
