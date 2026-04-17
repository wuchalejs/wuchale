import { mkdir, readFile, statfs, unlink, writeFile } from 'node:fs/promises'

export type FS = {
    read(file: string): string | null | Promise<string | null>
    write(file: string, content: string): void | Promise<void>
    mkdir(path: string): void | Promise<void>
    exists(path: string): boolean | Promise<boolean>
    unlink(path: string): boolean | Promise<boolean>
}

async function handleEnoent<T>(func: () => Promise<T>, defRet: T) {
    try {
        return await func()
    } catch (err: any) {
        if (err.code !== 'ENOENT') {
            throw err
        }
        return defRet
    }
}

export const defaultFS: FS = {
    async read(file: string) {
        return handleEnoent(() => readFile(file, 'utf-8'), null)
    },

    async write(file: string, content: string) {
        await writeFile(file, content)
    },

    async mkdir(path: string) {
        await mkdir(path, { recursive: true })
    },

    async exists(path: string) {
        return handleEnoent(async () => {
            await statfs(path)
            return true
        }, false)
    },

    async unlink(path: string) {
        return handleEnoent(async () => {
            await unlink(path)
            return true
        }, false)
    },
}

export const readOnlyFS: FS = {
    ...defaultFS,
    write: () => {},
    mkdir: () => {},
    unlink: () => true,
}
