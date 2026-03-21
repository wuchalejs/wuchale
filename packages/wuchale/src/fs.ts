import { mkdir, readFile, statfs, writeFile } from 'node:fs/promises'

export type FS = {
    inMemory: boolean
    read(file: string): string | Promise<string>
    write(file: string, content: string): void | Promise<void>
    mkdir(path: string): void | Promise<void>
    exists(path: string): boolean | Promise<boolean>
}

export const defaultFS: FS = {
    inMemory: false,

    async read(file: string) {
        return await readFile(file, 'utf-8')
    },

    async write(file: string, content: string) {
        await writeFile(file, content)
    },

    async mkdir(path: string) {
        await mkdir(path, { recursive: true })
    },

    async exists(path: string) {
        try {
            await statfs(path)
            return true
        } catch (err: any) {
            if (err.code !== 'ENOENT') {
                throw err
            }
            return false
        }
    },
}

export const readOnlyFS: FS = {
    ...defaultFS,
    inMemory: true,
    write: () => {},
    mkdir: () => {},
}
