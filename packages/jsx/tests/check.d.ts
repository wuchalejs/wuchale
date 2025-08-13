/**
 * @param {any} t
 * @param {string} content
 * @param {string} expectedContent
 * @param {string} expectedTranslations
 * @param {string[] | string[][]} expectedCompiled
 * @param {string} [filename]
 */
export function testContent(t: any, content: string, expectedContent: string, expectedTranslations: string, expectedCompiled: string[] | string[][], filename?: string): Promise<void>;
/**
 * @param {any} t
 * @param {string} dir
 */
export function testDir(t: any, dir: string): Promise<void>;
export const jsx: any;
//# sourceMappingURL=check.d.ts.map