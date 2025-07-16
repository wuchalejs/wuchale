// $node %f wuchale
// @ts-check

import { execSync } from 'child_process'
import { readFile } from 'fs/promises'
import readline from 'readline'
import { glob } from 'tinyglobby'

if (execSync(`git status --porcelain`).toString().trim()) {
    console.log('Worktree not clean. Exiting')
    process.exit(1)
}

readline.emitKeypressEvents(process.stdin)
if (process.stdin.isTTY) {
    process.stdin.setRawMode(true)
}

console.log('q/escape/c: exit, enter: first choice')
/**
 * @param {any} choices
 * @param {any} [question]
 */
async function ask(choices, question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    })
    if (question) {
        console.log(question)
    }
    const ids = []
    for (const c of choices) {
        console.log(' ', c)
        ids.push(c.split(':')[0])
    }
    return new Promise((res, rej) => {
        const listener = (/** @type {any} */ _, /** @type {{ name: any; }} */ key) => {
            process.stdin.off('keypress', listener)
            switch (key.name) {
                case 'q':
                case 'escape':
                case 'c': // for Ctrl+C
                    rl.close()
                    rej()
                    break
                case 'return':
                    rl.close()
                    res(ids[0])
                    break
                default:
                    rl.close()
                    console.log('\r')
                    if (ids.includes(key.name)) {
                        res(key.name)
                        return
                    }
                    console.error('Wrong key', key.name)
                    ask(choices, question).then(res, rej)
            }
        }
        process.stdin.on('keypress', listener)
    })
}

/**
 * @param {string} question
 */
async function confirm(question) {
    return await ask(['y: yes', 'n: no'], question) === 'y'
}

const pac = process.argv[2]
if (pac == null) {
    console.error('No workspace given')
    process.exit(1)
}

const packageJson = JSON.parse((await readFile('package.json')).toString())
const workspaces = []
let pacDir
for (const dir of await glob(packageJson.workspaces, { onlyDirectories: true })) {
    const pacJson = JSON.parse((await readFile(`${dir}package.json`)).toString())
    workspaces.push({
        dir,
        name: pacJson.name,
        deps: Object.keys({ ...pacJson.dependencies, ...pacJson.devDependencies }),
    })
    if (pacJson.name === pac) {
        pacDir = dir
    }
}
if (pacDir == null) {
    console.error('Package not found in workspaces')
    process.exit(1)
}

/**
 * @param {string} pac
 * @param {string} dir
 */
async function versionWorkspace(pac, dir) {
    const verType = await ask(['M: major', 'm: minor', 'p: patch'], `Versioning ${pac}:`)
    const versionTypes = {
        M: 'major',
        m: 'minor',
        p: 'patch',
    }
    const versionType = versionTypes[verType]
    execSync(`npm version ${versionType} -w ${pac} --no-git-tag-version`)
    const version = JSON.parse((await readFile(`${dir}package.json`)).toString()).version
    const newVersions = {[pac]: version}
    for (const {name, dir, deps} of workspaces) {
        if (name === pac) {
            continue
        }
        for (const dep of deps) {
            if (dep !== pac) {
                continue
            }
            if (await confirm(`${name} depends on ${packageJson.name}. Update?`)) {
                const update = await versionWorkspace(name, dir)
                Object.assign(newVersions, update.versions)
            }
        }
    }
    return {
        versionType,
        versions: newVersions,
    }
}

const {versionType, versions} = await versionWorkspace(pac, pacDir)
if (!execSync(`git status --porcelain`).toString().trim()) {
    console.log('No change. Exiting')
    process.exit(0)
}
const updated = Object.entries(versions)
const commitMsg = `bump ${versionType} version for ${pac} to ${versions[pac]}`
console.log('commit:', commitMsg)
execSync(`git add -u && git commit -m "${commitMsg}"`)
for (const [pac, version] of updated) {
    const tagName = `${pac}@${version}`
    console.log('tag:', tagName)
    execSync(`git tag ${tagName}`)
}
if (updated.length && await confirm('Push new commit and tags?')) {
    console.log('Pushing...')
    execSync('git push && git push --tags')
}
