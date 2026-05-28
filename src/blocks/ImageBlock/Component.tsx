import React from 'react'

type ImageItem = {
  image?: { url?: string | null; alt: string } | null
  id?: string | null
}

type Props = {
  caption?: string | null
  images?: ImageItem[]
}

export function ImageBlock({ caption, images }: Props) {
  const validImages = images?.filter((item) => item.image?.url) ?? []
  if (!validImages.length) return null

  return (
    <section className="block-section image-gallery-block">
      <div className="image-gallery-grid">
        {validImages.map((item, index) => (
          <figure key={item.id ?? index} className="image-gallery-card">
            <img
              src={item.image!.url!}
              alt={item.image!.alt}
            />
          </figure>
        ))}
      </div>
      {caption && <p className="image-gallery-caption">{caption}</p>}
    </section>
  )
}
