import { vi } from 'vitest'

/**
 * jsdom implements no part of the Fullscreen API, so stub it with something
 * that behaves like a browser: requests and exits move `document.fullscreenElement`
 * and fire `fullscreenchange`, the event the reader actually listens to.
 */
export function stubFullscreen({ refuse = false } = {}) {
  const original = Object.getOwnPropertyDescriptor(document, 'fullscreenElement')

  const setElement = (el: Element | null) => {
    Object.defineProperty(document, 'fullscreenElement', { value: el, configurable: true })
    document.dispatchEvent(new Event('fullscreenchange'))
  }

  const requestFullscreen = vi.fn(function (this: Element) {
    if (refuse) return Promise.reject(new TypeError('fullscreen refused'))
    setElement(this)
    return Promise.resolve()
  })
  const exitFullscreen = vi.fn(() => {
    setElement(null)
    return Promise.resolve()
  })

  Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true })
  Element.prototype.requestFullscreen = requestFullscreen
  document.exitFullscreen = exitFullscreen

  return {
    requestFullscreen,
    exitFullscreen,
    /** What pressing Escape does: the browser leaves fullscreen without being asked. */
    escape: () => setElement(null),
    restore: () => {
      if (original) Object.defineProperty(document, 'fullscreenElement', original)
    },
  }
}
