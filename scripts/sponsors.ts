// $ node %f
import { readFileSync, writeFileSync } from 'node:fs'

type Sponsor = {
    username: string
    id?: number | undefined
}

type Data = {
    sponsors: Sponsor[]
    backers: Sponsor[]
    private: number
}

const sponsFile = './sponsors.json'
const data: Data = JSON.parse(readFileSync(sponsFile, 'utf-8'))
const readmeFile = '../README.md'
let readme = readFileSync(readmeFile, 'utf-8')

function replaceAnchor(anchor: string, repl: string, endMark: string) {
    const start = readme.indexOf(anchor) + anchor.length
    const end = readme.indexOf(endMark, start)
    readme = readme.slice(0, start) + repl + readme.slice(end)
}

for (const key of ['sponsors', 'backers'] as const) {
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
    const size = key === 'sponsors' ? 96 : 48
    for (const s of spons) {
        secBody.push(
            `[![${s.username}](https://avatars.githubusercontent.com/u/${s.id}?v=4&s=${size})](https://github.com/${s.username})`,
        )
    }
    replaceAnchor(`<!-- s:${key} -->\n`, secBody.join('\n'), '\n\n')
}

// replaceAnchor('<!-- s:private -->', data.private.toString(), ' ')

writeFileSync(readmeFile, readme)
writeFileSync(sponsFile, JSON.stringify(data, null, '  '))
