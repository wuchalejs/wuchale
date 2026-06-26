import git from '@changesets/changelog-git'
import type { ChangelogFunctions } from '@changesets/types'

export default {
    getReleaseLine: git.getReleaseLine,
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
