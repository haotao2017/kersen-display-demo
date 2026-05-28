import React from 'react'

type Props = {
  heading: string
  subheading?: string | null
  backgroundImage?: { url?: string | null; alt: string } | null
  ctaLabel?: string | null
  ctaUrl?: string | null
}

export function HeroBlock({ heading, subheading, backgroundImage, ctaLabel, ctaUrl }: Props) {
  return (
    <section className="block-section">
      <div
        className="block-hero"
        style={backgroundImage?.url ? { '--hero-bg': `url(${backgroundImage.url})` } as React.CSSProperties : undefined}
      >
        <div className="block-hero-content">
          <span className="block-eyebrow">Featured Page</span>
          <h1>{heading}</h1>
          {subheading && <p>{subheading}</p>}
          {ctaLabel && ctaUrl && (
            <a href={ctaUrl} className="block-button primary">
              {ctaLabel}
            </a>
          )}
        </div>
      </div>
    </section>
  )
}
