// $ node %f
import { readFileSync, writeFileSync } from 'node:fs'

type Data = {
    sponsors: string[]
    backers: string[]
}

const data: Data = JSON.parse(readFileSync('./sponsors.json', 'utf-8'))
const readmeFile = '../README.md'
let readme = readFileSync(readmeFile, 'utf-8')

for (const [key, spons] of Object.entries(data)) {
    const ress = await Promise.all(spons.map(s => fetch(`https://api.github.com/users/${s}`)))
    const jsons = (await Promise.all(ress.map(r => r.json()))) as { id: string }[]
    const secBody: string[] = []
    const size = key === 'sponsors' ? 96 : 48
    for (const [i, json] of jsons.entries()) {
        const user = spons[i]
        secBody.push(
            `[![${user}](https://avatars.githubusercontent.com/u/${json.id}?v=4&s=${size})](https://github.com/${user})`,
        )
    }
    const anchor = `<!-- s:${key} -->\n`
    const start = readme.indexOf(anchor) + anchor.length
    const end = readme.indexOf('\n\n', start)
    readme = readme.slice(0, start) + secBody.join('\n') + readme.slice(end)
}

writeFileSync(readmeFile, readme)
