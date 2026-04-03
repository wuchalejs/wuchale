import { mkdir, readFile, statfs, unlink, writeFile } from 'node:fs/promises'

export type FS = {
    read(file: string): string | null | Promise<string | null>
    write(file: string, content: string): void | Promise<void>
    mkdir(path: string): void | Promise<void>
    exists(path: string): boolean | Promise<boolean>
    unlink(path: string): void | Promise<void>
}

export const defaultFS: FS = {
    async read(file: string) {
        try {
            return await readFile(file, 'utf-8')
        } catch (err: any) {
            if (err.code !== 'ENOENT') {
                throw err
            }
            return null
        }
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

    async unlink(path: string) {
        await unlink(path)
    },
}

export const readOnlyFS: FS = {
    ...defaultFS,
    write: () => {},
    mkdir: () => {},
    unlink: () => {},
}
