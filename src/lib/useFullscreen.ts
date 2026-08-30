import { useCallback, useEffect, useState } from 'react'

/**
 * Ask the browser for fullscreen. Refusals are swallowed on purpose: without a
 * user gesture the request is rejected, and iOS Safari has no element
 * fullscreen at all. Fullscreen is a nicety, never a reason for reading to break.
 */
export function enterFullscreen() {
  document.documentElement.requestFullscreen?.().catch(() => {})
}

function exitFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
}

/**
 * Fullscreen state, read from `fullscreenchange` rather than from our own calls,
 * so leaving with Escape keeps the UI honest.
 */
export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(() => document.fullscreenElement != null)

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement != null)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const enter = useCallback(enterFullscreen, [])
  const exit = useCallback(exitFullscreen, [])
  const toggle = useCallback(() => {
    if (document.fullscreenElement) exitFullscreen()
    else enterFullscreen()
  }, [])

  return { isFullscreen, enter, exit, toggle }
}
