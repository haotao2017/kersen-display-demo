import React from 'react'

type Button = {
  label: string
  url: string
  style?: 'primary' | 'secondary' | null
  id?: string | null
}

type Props = {
  heading: string
  description?: string | null
  buttons?: Button[]
}

export function CTABlock({ heading, description, buttons }: Props) {
  return (
    <section className="block-section">
      <div className="cta-block">
        <span className="block-eyebrow">Call to Action</span>
        <h2>{heading}</h2>
        {description && <p>{description}</p>}
      {!!buttons?.length && (
        <div className="cta-actions">
          {buttons.map((btn, index) => (
            <a
              key={btn.id ?? index}
              href={btn.url}
              className={`block-button ${btn.style === 'secondary' ? 'secondary' : 'primary'}`}
            >
              {btn.label}
            </a>
          ))}
        </div>
      )}
      </div>
    </section>
  )
}
