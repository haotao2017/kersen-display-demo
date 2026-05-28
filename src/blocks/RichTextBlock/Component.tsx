import React from 'react'

type LexicalNode = {
  type: string
  text?: string
  format?: number
  tag?: string
  url?: string
  listType?: string
  children?: LexicalNode[]
}

function serializeNodes(nodes: LexicalNode[]): React.ReactNode[] {
  return nodes.map((node, i) => {
    if (node.type === 'text') {
      let el: React.ReactNode = node.text
      if ((node.format ?? 0) & 1) el = <strong key={i}>{el}</strong>
      if ((node.format ?? 0) & 2) el = <em key={i}>{el}</em>
      if ((node.format ?? 0) & 8) el = <s key={i}>{el}</s>
      return el
    }

    const children = serializeNodes(node.children ?? [])

    switch (node.type) {
      case 'paragraph':
        return <p key={i}>{children}</p>
      case 'heading': {
        const Tag = (node.tag ?? 'h2') as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
        return <Tag key={i}>{children}</Tag>
      }
      case 'list':
        return node.listType === 'bullet'
          ? <ul key={i}>{children}</ul>
          : <ol key={i}>{children}</ol>
      case 'listitem':
        return <li key={i}>{children}</li>
      case 'link':
        return <a key={i} href={node.url}>{children}</a>
      case 'linebreak':
        return <br key={i} />
      default:
        return <React.Fragment key={i}>{children}</React.Fragment>
    }
  })
}

export function RichTextBlock({ content }: { content: { root?: LexicalNode } | null }) {
  if (!content?.root?.children) return null

  return (
    <section className="block-section">
      <div className="rich-text-block">{serializeNodes(content.root.children)}</div>
    </section>
  )
}
