import { useRef, useEffect } from 'react'
import { useEditor, Milkdown } from '@milkdown/react'
import { Editor as MilkdownEditor, rootCtx, defaultValueCtx, editorViewCtx } from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { nord } from '@milkdown/theme-nord'
import { listener, listenerCtx } from '@milkdown/plugin-listener'
import { block } from '@milkdown/plugin-block'
import { clipboard } from '@milkdown/plugin-clipboard'
import { upload } from '@milkdown/plugin-upload'
import { getMarkdown as getMarkdownAction, replaceAll as replaceAllAction } from '@milkdown/kit/utils'
import { TextSelection } from '@milkdown/kit/prose/state'
import { editorHandle } from '../editor-ref'
import '../styles/editor.css'
import '@milkdown/theme-nord/style.css'

interface EditorProps {
  onDocChange: (doc: unknown) => void
}

export function Editor({ onDocChange }: EditorProps) {
  const onDocChangeRef = useRef(onDocChange)
  onDocChangeRef.current = onDocChange

  const { loading, get } = useEditor((root) => {
    return MilkdownEditor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root)
        ctx.set(defaultValueCtx, '')
      })
      .config((ctx) => {
        const manager = ctx.get(listenerCtx)
        manager.updated((_ctx, doc) => {
          onDocChangeRef.current(doc)
        })
      })
      .use(nord)
      .use(commonmark)
      .use(gfm)
      .use(listener)
      .use(block)
      .use(clipboard)
      .use(upload)
  }, [])

  useEffect(() => {
    if (loading) return

    const ed = get()
    if (!ed) return

    editorHandle.current = {
      getMarkdown: () => {
        try {
          return ed.action(getMarkdownAction()) ?? ''
        } catch {
          return ''
        }
      },
      setMarkdown: (md: string) => {
        try {
          ed.action(replaceAllAction(md))
        } catch (e) {
          console.error('setMarkdown error:', e)
        }
      },
      scrollToPos: (pos: number) => {
        try {
          const view = ed.ctx.get(editorViewCtx)
          const doc = view.state.doc
          const safePos = Math.min(Math.max(0, pos), doc.content.size)
          const sel = TextSelection.near(doc.resolve(safePos))
          const tr = view.state.tr.setSelection(sel)
          view.dispatch(tr)
          view.focus()
          view.scrollIntoView()
        } catch (e) {
          console.error('scrollToPos error:', e)
        }
      },
      getScrollContainer: () => {
        return document.querySelector('.milkdown') as HTMLElement | null
      }
    }

    return () => {
      editorHandle.current = null
    }
  }, [loading, get])

  return (
    <div className="editor-container">
      <Milkdown />
    </div>
  )
}
