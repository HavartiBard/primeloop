import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchCanvasLayout, saveCanvasLayout } from '../api'

export type CardPositions = Record<string, { x: number; y: number }>

export interface UseCanvasLayoutResult {
  positions: CardPositions
  isLoading: boolean
  updatePosition: (cardId: string, x: number, y: number) => void
}

const SAVE_DEBOUNCE_MS = 500

export function useCanvasLayout(): UseCanvasLayoutResult {
  const [positions, setPositions] = useState<CardPositions>({})
  const [isLoading, setIsLoading] = useState(true)
  const pendingRef = useRef<CardPositions>({})
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchCanvasLayout()
      .then((loaded) => {
        if (!cancelled) {
          setPositions(loaded)
          setIsLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const updatePosition = useCallback((cardId: string, x: number, y: number) => {
    setPositions((prev) => ({ ...prev, [cardId]: { x, y } }))
    pendingRef.current[cardId] = { x, y }

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      const toSave = { ...pendingRef.current }
      pendingRef.current = {}
      saveCanvasLayout(toSave)
    }, SAVE_DEBOUNCE_MS)
  }, [])

  return { positions, isLoading, updatePosition }
}
