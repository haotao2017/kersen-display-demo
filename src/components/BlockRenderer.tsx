import React from 'react'
import { HeroBlock } from '@/blocks/HeroBlock/Component'
import { RichTextBlock } from '@/blocks/RichTextBlock/Component'
import { ImageBlock } from '@/blocks/ImageBlock/Component'
import { CTABlock } from '@/blocks/CTABlock/Component'

type Block = {
  blockType: string
  id?: string | null
  [key: string]: unknown
}

export function BlockRenderer({ blocks }: { blocks: Block[] }) {
  if (!blocks?.length) return null

  return (
    <div className="block-renderer">
      {blocks.map((block, index) => {
        const key = block.id ?? index
        const props = block as any

        switch (block.blockType) {
          case 'hero':        return <HeroBlock      key={key} {...props} />
          case 'richText':    return <RichTextBlock  key={key} {...props} />
          case 'imageGallery':return <ImageBlock     key={key} {...props} />
          case 'cta':         return <CTABlock       key={key} {...props} />
          default:            return null
        }
      })}
    </div>
  )
}
