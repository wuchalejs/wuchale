import type { ChangelogFunctions } from '@changesets/types'

const commitBaseUrl = 'https://github.com/wuchalejs/wuchale/commit/'

export default {
    async getReleaseLine(changeset) {
        let [firstLine, ...futureLines] = changeset.summary.split('\n').map(l => l.trimEnd())
        if (firstLine?.startsWith('!')) {
            firstLine = `⚠️ BREAKING: ${firstLine}`
        }
        let commitLinkPref = ''
        if (changeset.commit) {
            // for website changelog link
            commitLinkPref = `[${changeset.commit.slice(0, 7)}](${commitBaseUrl}${changeset.commit}): `
        }
        let returnVal = `- ${commitLinkPref}${firstLine}`
        if (futureLines.length > 0) {
            returnVal += `\n${futureLines.map(l => `  ${l}`).join('\n')}`
        }
        return returnVal
    },
    async getDependencyReleaseLine(changesets, dependenciesUpdated) {
        if (changesets.length === 0) {
            return ''
        }
        const commits = changesets.map(c => c.commit?.slice(0, 7)).filter(_ => _)
        const entryTitle = `- Updated dependencies${commits.length ? ` [${commits.join(', ')}]` : ''}:`
        const updatedDepenenciesList = dependenciesUpdated.map(
            dependency => `  - ${dependency.name}@${dependency.newVersion}`,
        )
        return [entryTitle, ...updatedDepenenciesList].join('\n')
    },
} satisfies ChangelogFunctions
