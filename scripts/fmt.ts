// $ node %f
import { exec } from 'node:child_process'

const ecmd = (cmd: string, print = true): Promise<string> =>
    new Promise(res => {
        exec(cmd, (err, sout, serr) => {
            if (err) {
                console.error(serr.trim())
                process.exit(1)
            }
            sout = sout.trim()
            print && sout && console.log(sout)
            res(sout)
        })
    })

const staged = await ecmd('git diff --staged --diff-filter=ACM --name-only', false)

if (staged) {
    await ecmd('npm run fmt -- --staged --no-errors-on-unmatched')
    for (const file of staged.split('\n')) {
        await ecmd(`git add ${file}`)
    }
}
