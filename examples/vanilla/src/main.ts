import './style.css'
import { setupCounter } from './counter.ts'

import {setCatalog} from 'wuchale/runtime'

const showMsg = (element: HTMLParagraphElement) => {
    element.innerHTML = 'Click on the Vite and TypeScript logos to learn more'
}

let locale = 'en'

const setHTML = async () => {
    const module = await import(`./locales/${locale}.js`)
    setCatalog(module)
    document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
      <div>
        <h1>Vite + TypeScript</h1>
        <div class="card">
          <button id="locale" type="button">${locale}</button>
        </div>
        <div class="card">
          <button id="counter" type="button"></button>
        </div>
        <p class="read-the-docs"></p>
      </div>
    `
    showMsg(document.querySelector<HTMLParagraphElement>('.read-the-docs')!)
    setupCounter(document.querySelector<HTMLButtonElement>('#counter')!)
    const lbtn = document.querySelector<HTMLButtonElement>('#locale')!
    lbtn.addEventListener('click', () => {
        locale = locale == 'en' ? 'es' : 'en'
        setHTML()
    })
}

await setHTML()

