let locale = 'en'

/**
 * @param {string} newLocale
*/
export function setLocale(newLocale) {
    locale = newLocale
}

export default () => locale
