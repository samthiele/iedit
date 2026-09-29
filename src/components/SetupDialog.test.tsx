import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App.tsx'
import { SetupDialog } from './SetupDialog.tsx'

describe('setup test button', () => {
  let root: Root | null = null
  const host = document.createElement('div')
  document.body.appendChild(host)

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    host.replaceChildren()
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('checks the draft key against the selected model', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' } }],
    }), { status: 200 })))
    root = createRoot(host)
    await act(async () => {
      root?.render(<SetupDialog catalog={null} parallelKey="" onParallelKey={() => undefined} onClose={() => undefined} onSaved={() => undefined} />)
    })
    const chatgpt = [...host.querySelectorAll('button')].find((button) => button.textContent === 'ChatGPT')
    await act(async () => {
      chatgpt?.click()
    })
    const key = host.querySelector('input[type="password"]')
    if (!(key instanceof HTMLInputElement)) throw new Error('missing key field')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(key, 'sk-test')
      key.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const test = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Test')
    await act(async () => {
      test?.click()
    })
    expect(host.textContent).toContain('The key works. gpt-4.1-mini is available.')
  })

  it('shows a wait note while asking which models the server has', async () => {
    let release: (response: Response) => void = () => undefined
    const pending = new Promise<Response>((resolve) => {
      release = resolve
    })
    vi.stubGlobal('fetch', vi.fn(() => pending))
    root = createRoot(host)
    await act(async () => {
      root?.render(<SetupDialog catalog={null} parallelKey="" onParallelKey={() => undefined} onClose={() => undefined} onSaved={() => undefined} />)
    })
    const chatgpt = [...host.querySelectorAll('button')].find((button) => button.textContent === 'ChatGPT')
    await act(async () => {
      chatgpt?.click()
    })
    const key = host.querySelector('input[type="password"]')
    if (!(key instanceof HTMLInputElement)) throw new Error('missing key field')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      setter?.call(key, 'sk-test')
      key.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const load = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Load models')
    await act(async () => {
      load?.click()
    })
    expect(host.querySelector('.wait')?.textContent).toBe('Asking what models are available')
    await act(async () => {
      release(new Response(JSON.stringify({ data: [{ id: 'gpt-4.1-mini' }] }), { status: 200 }))
      await pending
    })
    expect(host.querySelector('.wait')).toBeNull()
    expect(host.textContent).toContain('Loaded 1 models.')
  })
})

describe('science pass note', () => {
  let root: Root | null = null
  const host = document.createElement('div')
  document.body.appendChild(host)

  afterEach(() => {
    act(() => root?.unmount())
    root = null
    host.replaceChildren()
    localStorage.clear()
  })

  it('keeps the Parallel key in Setup and states the limit of the science pass', async () => {
    root = createRoot(host)
    await act(async () => {
      root?.render(<App />)
    })
    expect(host.textContent).toContain('Checks claims and reasoning with a web search. This can be helpful, though is narrower than a full literature search or human thought. Always think yourself, always verify yourself.')
    expect(host.textContent).toContain('Science checks are also sent to Parallel, possibly including small sections/snippets of your text.')
    const parallel = host.querySelector('a[href="https://parallel.ai/privacy-policy"]')
    expect(parallel?.textContent).toBe('Parallel privacy policy')
    expect(host.querySelector('a[href="/test"]')?.textContent).toBe('WORD')
    expect(host.querySelector('a[href="/test?demo=latex"]')?.textContent).toBe('LATEX')
    expect(host.querySelector('.parallel-key')).toBeNull()
    const setup = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Setup')
    await act(async () => {
      setup?.click()
    })
    const field = host.querySelector('.parallel-key')
    expect(field).toBeInstanceOf(HTMLInputElement)
    expect(field?.getAttribute('placeholder')).toBe('Optional. Raises the free search limit.')
  })
})